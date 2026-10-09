"""
Backend-aware streaming primitives for dataset import/export.

- ``stream_query_to_path`` dumps a read-only SELECT to a CSV file. On
  PostgreSQL it runs a server-side ``COPY (<query>) TO STDOUT`` over the
  session's psycopg2 connection (constant memory, no ORM); elsewhere it streams
  rows with ``csv.writer`` in ``DATASET_IO_BATCH_SIZE`` batches.
- ``bulk_insert`` loads a list of column dicts into a table. With ``copy=True``
  on PostgreSQL and no ``returning``, it uses ``COPY <table> FROM STDIN``;
  otherwise batched Core ``insert()`` (adding ``.returning`` when the caller
  needs server-generated ids back). Both run on the session's own
  connection/transaction, so a later ``rollback`` (e.g. ``flask.abort``) undoes
  everything.

Plus temp-file helpers so an export either uploads through ``store`` or hands
back an already-unlinked open file for ``flask.send_file``. Imports only
``db``/``store``/config — never the ORM models or Flask views — mirroring
``server/utils/dataset.py``'s role.
"""
import io
import os
import csv
import tempfile

from flask import current_app, send_file

from sqlalchemy import insert

from .. import db, store


def batch_size():
    return current_app.config['DATASET_IO_BATCH_SIZE']


def new_temp_path():
    """A closed temp-file path the caller writes to, then finalizes."""
    fd, path = tempfile.mkstemp(prefix='dbio-')
    os.close(fd)
    return path


def discard_temp(path):
    """Best-effort delete; used to clean up after a mid-write failure."""
    try:
        os.unlink(path)
    except OSError:
        pass


def finalize_export(path, object_name):
    """
    Deliver a freshly written export temp file.

    With ``object_name``: upload it into ``STORAGE_BUCKET`` via ``store`` and
    delete the temp file, returning the object path. Without: return an open
    binary handle with the path already unlinked — POSIX keeps the fd readable
    until close, so ``flask.send_file`` streams it and the OS reclaims it
    afterward, leaving no temp file even on a crash.
    """
    if object_name is not None:
        try:
            store.fput(current_app.config['STORAGE_BUCKET'], object_name, path)
        finally:
            discard_temp(path)
        return object_name
    handle = open(path, 'rb')
    discard_temp(path)
    return handle


def send_export(handle, **kwargs):
    """
    ``flask.send_file`` for an export handle from ``finalize_export``: the
    path is already unlinked, so werkzeug cannot stat it for a size — restore
    ``Content-Length`` from the still-open fd.
    """
    response = send_file(handle, **kwargs)
    response.content_length = os.fstat(handle.fileno()).st_size
    return response


def write_lines_to_path(path, chunks):
    """Write an iterable of already-formatted string chunks to ``path``."""
    with open(path, 'w', encoding='utf-8', newline='') as f:
        for chunk in chunks:
            f.write(chunk)


def stream_query_to_path(query, path):
    """
    Stream a SQLAlchemy Core ``Select`` to a CSV file at ``path`` with a header
    row (the select's output column keys).
    """
    conn = db.session.connection()
    if conn.dialect.name == 'postgresql':
        compiled = query.compile(dialect=conn.dialect)
        raw = conn.connection
        cursor = raw.cursor()
        try:
            inner_sql = cursor.mogrify(str(compiled), compiled.params).decode('utf-8')
            copy_sql = 'COPY (%s) TO STDOUT WITH (FORMAT csv, HEADER)' % inner_sql
            with open(path, 'w', encoding='utf-8', newline='') as f:
                cursor.copy_expert(copy_sql, f)
        finally:
            cursor.close()
    else:
        header = list(query.selected_columns.keys())
        with open(path, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(header)
            for row in db.session.execute(query).yield_per(batch_size()):
                writer.writerow(list(row))


def bulk_insert(mapper, rows, returning=None, copy=False):
    """
    Insert ``rows`` (a list of column dicts, all with the same keys) into
    ``mapper``'s table.

    ``copy=True`` + PostgreSQL + ``returning is None``: native
    ``COPY <table> (<cols>) FROM STDIN``. COPY renders a ``None`` as an empty
    CSV field, which Postgres rejects for a non-text column — so only callers
    whose rows are entirely non-NULL opt in (e.g. classification utterances:
    ``text`` + ``intent_id``). Tag rows always carry a NULL (one of
    ``entity_id`` / ``slot_id`` is unset), so they leave ``copy`` False.

    Otherwise: batched Core ``insert()`` of ``DATASET_IO_BATCH_SIZE`` rows,
    executed via SQLAlchemy 2.0's "insertmanyvalues" (parameters passed to
    ``execute()``, not baked in via ``.values()``), adding
    ``.returning(<col>, sort_by_parameter_order=True)`` when ``returning`` is
    given — that flag is required for the returned rows to actually come back
    in input order (it defaults to ``False``), so callers can zip the
    returned ids back onto ``rows``. Returns the list of returned scalars
    (empty otherwise).

    Runs on the session's connection, inside its transaction.
    """
    if not rows:
        return []
    conn = db.session.connection()
    table = mapper.__table__
    if copy and returning is None and conn.dialect.name == 'postgresql':
        cols = list(rows[0].keys())
        buffer = io.StringIO()
        writer = csv.writer(buffer, quoting=csv.QUOTE_ALL)
        for row in rows:
            writer.writerow([row.get(col) for col in cols])
        buffer.seek(0)
        copy_sql = 'COPY %s (%s) FROM STDIN WITH (FORMAT csv)' % (
            table.name, ', '.join('"%s"' % col for col in cols))
        cursor = conn.connection.cursor()
        try:
            cursor.copy_expert(copy_sql, buffer)
        finally:
            cursor.close()
        return []
    returned = []
    size = batch_size()
    # Built without .values(): passing ``chunk`` as execute()'s parameters
    # (below) is what makes SQLAlchemy use the "insertmanyvalues" feature.
    # insert(table).values(chunk) would instead compile a single multi-row
    # VALUES INSERT, a different code path that SQLAlchemy refuses to combine
    # with RETURNING + sort_by_parameter_order (raises CompileError) — and
    # gives no ordering guarantee at all otherwise.
    statement = insert(table)
    if returning is not None:
        statement = statement.returning(returning, sort_by_parameter_order=True)
    for start in range(0, len(rows), size):
        chunk = rows[start:start + size]
        result = db.session.execute(statement, chunk)
        if returning is not None:
            returned.extend(result.scalars().all())
    return returned
