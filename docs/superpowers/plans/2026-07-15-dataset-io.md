# Dataset Import/Export Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream dataset import/export through PostgreSQL-native `COPY` (with a DB-agnostic fallback) and batched inserts, folded into generalized `Model.read` / `Model.write`, and drop the per-span entity from the interchange so NER and NLU share one annotated path that differs only by whether the intent is carried.

**Architecture:** A new `server/utils/io.py` holds two backend-aware primitives — `stream_query_to_path` (native `COPY … TO STDOUT` on Postgres, chunked `yield_per` + `csv.writer` elsewhere) and `bulk_insert` (native `COPY … FROM STDIN` when opted in and NULL-free, batched `insert()`/`insert().returning()` otherwise) — plus temp-file helpers. `server/utils/dataset.py` is simplified so every format carries only `(start, end, name)` spans (the trained tag) plus an optional intent; `Utterance.nlu_spans` and the `@entity` carrier / `# slots:` legend / dual `serialize_nlu_*` machinery are removed. `Model.write` / `Model.read` (and `Intent.write` / `Intent.read`) become the single generalized surface: plain classification datasets go through COPY; annotated datasets stream in batches through the per-record formatters. Export writes to a temp file and either uploads it via `store` (given an `object_name`) or returns an open, already-unlinked handle for `flask.send_file`.

**Tech Stack:** Flask, SQLAlchemy 2.0, psycopg2 (`copy_expert`), pandas (chunked CSV read), Flask-SQLAlchemy `db`, the pluggable `store`.

## Global Constraints

- Config is env-driven through the `Config` classes in `server/config.py`; add tunables there, never as literals. (CLAUDE.md)
- SQLAlchemy models expose `create`/`from_dict`/`to_dict` and validate via `flask.abort(400, msg)`. (CLAUDE.md)
- Edit the `server/database/` **package** modules; `server/database.py` is dead code — never touch it. (memory: database-package-shadows-module)
- No test suite exists; verify Python with `python -m py_compile` and the frontend with `npm run build`, plus the round-trip verification scripts defined below. (CLAUDE.md, memory: verify-with-checks-not-preview)
- Never `git commit` unless explicitly directed; the commit steps below are part of the plan's instructions and are authorized. (memory: no-unprompted-commits)
- `server/utils/dataset.py` is the single source of truth for span↔markup conversion; reuse its functions, never reimplement markup in SQL. (spec)
- `Slot.entity` (DB relation) stays — NLU **training augmentation** still needs it (`slots.json` / `entities.json`). Only the file interchange stops carrying the slot→entity mapping. (spec, decision 6)
- Spans everywhere are `(start, end, name)` triples after Task 2 — `name` is the trained tag (slot for NLU, entity for NER). (spec)
- Backend detection is per-call via `db.session.connection().dialect.name`; the primitives must work on both `postgresql` and `sqlite`. (spec)
- Scratchpad dir for verification scripts: `/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/f7090b1e-53a0-4322-8eca-1f8407f0115b/scratchpad` (referred to below as `$SCRATCH`).

---

### Task 1: Config tunable, `server/utils/io.py` primitives, and verification harness

**Files:**
- Modify: `server/config.py` (add `DATASET_IO_BATCH_SIZE` to `Config`, near the `TELEMETRY_*` tunables ~line 67)
- Create: `server/utils/io.py`
- Create: `$SCRATCH/dbio_harness.py` (reusable test harness; not committed)
- Create: `$SCRATCH/test_io_primitives.py` (not committed)

**Interfaces:**
- Produces:
  - `server.utils.io.batch_size() -> int`
  - `server.utils.io.new_temp_path() -> str`
  - `server.utils.io.discard_temp(path: str) -> None`
  - `server.utils.io.finalize_export(path: str, object_name: str|None) -> str | BinaryIO`
  - `server.utils.io.write_lines_to_path(path: str, chunks: Iterable[str]) -> None`
  - `server.utils.io.stream_query_to_path(query: Select, path: str, columns: list[str]|None = None) -> None`
  - `server.utils.io.bulk_insert(mapper, rows: list[dict], returning=None, copy=False) -> list`

- [ ] **Step 1: Add the config tunable**

In `server/config.py`, inside `class Config`, after the `TELEMETRY_*` block (~line 67) add:

```python
    DATASET_IO_BATCH_SIZE = int(os.environ.get('DATASET_IO_BATCH_SIZE', 5000))
```

- [ ] **Step 2: Create `server/utils/io.py`**

```python
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

from flask import current_app

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


def write_lines_to_path(path, chunks):
    """Write an iterable of already-formatted string chunks to ``path``."""
    with open(path, 'w', encoding='utf-8', newline='') as f:
        for chunk in chunks:
            f.write(chunk)


def stream_query_to_path(query, path, columns=None):
    """
    Stream a SQLAlchemy Core ``Select`` to a CSV file at ``path`` with a header
    row. ``columns`` overrides the header names (defaults to the select's
    output column keys).
    """
    conn = db.session.connection()
    if conn.dialect.name == 'postgresql':
        compiled = query.compile(
            dialect=conn.dialect,
            compile_kwargs={'literal_binds': True},
        )
        copy_sql = 'COPY (%s) TO STDOUT WITH (FORMAT csv, HEADER)' % compiled
        raw = conn.connection
        with open(path, 'w', encoding='utf-8', newline='') as f:
            cursor = raw.cursor()
            try:
                cursor.copy_expert(copy_sql, f)
            finally:
                cursor.close()
    else:
        header = columns or list(query.selected_columns.keys())
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
    adding ``.returning(<col>)`` when ``returning`` is given. SQLAlchemy 2.0's
    insertmanyvalues keeps the returned rows in input order, so callers can zip
    the returned ids back onto ``rows``. Returns the list of returned scalars
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
        writer = csv.writer(buffer)
        for row in rows:
            writer.writerow([row.get(col) for col in cols])
        buffer.seek(0)
        copy_sql = 'COPY %s (%s) FROM STDIN WITH (FORMAT csv)' % (
            table.name, ', '.join('"%s"' % col for col in cols))
        raw = conn.connection
        cursor = raw.cursor()
        try:
            cursor.copy_expert(copy_sql, buffer)
        finally:
            cursor.close()
        return []
    returned = []
    size = batch_size()
    for start in range(0, len(rows), size):
        chunk = rows[start:start + size]
        statement = insert(table).values(chunk)
        if returning is not None:
            result = db.session.execute(statement.returning(returning))
            returned.extend(result.scalars().all())
        else:
            db.session.execute(statement)
    return returned
```

- [ ] **Step 3: Create the reusable verification harness `$SCRATCH/dbio_harness.py`**

```python
"""Minimal Flask+SQLAlchemy app on a temp SQLite DB for round-trip checks.

Avoids the real app factory (Redis/SocketIO/telemetry). Reuse across tasks.
"""
import os
import sys
import tempfile

REPO = '/Users/varunseth/Documents/git/indic-nlu'
sys.path.insert(0, REPO)
os.chdir(REPO)  # so imports and public/colors.txt resolve

from flask import Flask

from server import db, store
from server.config import Config


def make_app():
    path = os.path.join(tempfile.mkdtemp(prefix='dbio-test-'), 'test.db')
    app = Flask(__name__)
    app.config.from_object(Config)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + path
    app.config['STORAGE_PROVIDER'] = 'local'
    db.init_app(app)
    import server.database  # register every model with the declarative registry
    store.provider = 'local'
    store.init_client()
    with app.app_context():
        db.create_all()
    return app


def seed_user(db):
    from server.database import User
    user = User(username='t', email='t@example.com')
    user.password_hash = 'x'
    db.session.add(user)
    db.session.flush()
    return user
```

Note: if `User` needs different fields, read `server/database/user.py` and adjust `seed_user`.

- [ ] **Step 4: Write the primitive round-trip check `$SCRATCH/test_io_primitives.py`**

```python
from dbio_harness import make_app, seed_user
from server import db
from server.database import User
from server.utils import io as dbio
from sqlalchemy import select

app = make_app()
with app.app_context():
    rows = [{'username': f'u{i}', 'email': f'u{i}@x', 'password_hash': 'h'}
            for i in range(12000)]
    dbio.bulk_insert(User, rows, copy=True)  # copy ignored on SQLite -> insert()
    db.session.commit()
    assert db.session.query(User).count() == 12000

    path = dbio.new_temp_path()
    dbio.stream_query_to_path(
        select(User.username.label('username'), User.email.label('email'))
        .order_by(User.id), path)
    with open(path) as f:
        lines = f.read().splitlines()
    dbio.discard_temp(path)
    assert lines[0] == 'username,email', lines[0]
    assert len(lines) == 12001, len(lines)

    ids = dbio.bulk_insert(
        User, [{'username': f'r{i}', 'email': f'r{i}@x', 'password_hash': 'h'}
               for i in range(5)], returning=User.id)
    db.session.commit()
    got = [db.session.get(User, i).username for i in ids]
    assert got == [f'r{i}' for i in range(5)], got
print('OK test_io_primitives')
```

- [ ] **Step 5: Run the checks**

```bash
python -m py_compile server/config.py server/utils/io.py
cd "$SCRATCH" && python test_io_primitives.py
```
Expected: py_compile exit 0; prints `OK test_io_primitives`. If `seed_user` fails on User fields, read `server/database/user.py`, fix the harness, rerun.

- [ ] **Step 6: Commit**

```bash
git add server/config.py server/utils/io.py
git commit -m "feat(io): add backend-aware dataset streaming primitives"
```

---

### Task 2: Drop the per-span entity from the interchange

Simplify `server/utils/dataset.py` so every format yields `(start, end, name)` spans plus an optional intent; remove `Utterance.nlu_spans`; and update the existing annotation methods (`export_annotations`, `import_annotations`, `_ner_importer`, `_nlu_importer`) to the new shape so the app keeps working. No performance change here — this is the pure scope-change refactor, kept separate from the streaming work.

**Files:**
- Modify: `server/utils/dataset.py` (simplify the NLU/CSV/CoNLL formatters and parsers; delete `format_slot_legend` / `parse_slot_legend`)
- Modify: `server/database/utterance.py` (delete `nlu_spans`)
- Modify: `server/database/model.py` (`export_annotations` uses `spans`; `_ner_importer` / `_nlu_importer` / `import_annotations` over 3-tuple spans)
- Create: `$SCRATCH/test_interchange.py` (not committed)

**Interfaces:**
- Produces the new span contract: `dataset.parse_dataset(content, fmt)` records carry `spans: [(start, end, name)]`; `dataset.format_inline_nlu(text, intent, spans)` / `format_json_nlu(text, intent, spans)` / `serialize_nlu_csv(records)` take 3-tuple spans and no entity.
- Old methods stay callable (removed in Task 6).

- [ ] **Step 1: Simplify the NLU per-record formatters in `server/utils/dataset.py`**

Replace `format_inline_nlu` (`server/utils/dataset.py:285-295`) with:

```python
def format_inline_nlu(text, intent, spans):
    """Renders one record as ``intent<TAB>text`` with ``{name: value}`` markup."""
    return '%s\t%s' % (intent, format_inline(text, spans))
```

Replace `parse_inline_record` (`:298-320`) with:

```python
def parse_inline_record(line):
    """
    Parses one inline line into ``(text, intent|None, spans)`` with
    ``(start, end, name)`` spans. An ``intent<TAB>`` prefix is optional: with a
    TAB the (non-empty) prefix is the intent; the importing model decides
    whether to require or ignore it. Span carriers are ``{name: value}``.
    """
    intent = None
    if '\t' in line:
        prefix, _, line = line.partition('\t')
        if not prefix.strip():
            raise ValueError('the intent prefix before the TAB cannot be empty')
        intent = prefix.strip()
    text, spans = parse_inline(line)
    return text, intent, spans
```

Replace `format_json_nlu` (`:323-332`) with:

```python
def format_json_nlu(text, intent, spans):
    """Renders one record as ``{text, intent, entities:[{start,end,label}]}``."""
    return json.dumps({
        'text': text,
        'intent': intent,
        'entities': [{'start': start, 'end': end, 'label': name}
                     for start, end, name in sorted(spans)]
    }, ensure_ascii=False)
```

- [ ] **Step 2: Simplify `serialize_nlu_csv` and delete the legend helpers**

Delete `format_slot_legend` (`:335-341`) and `parse_slot_legend` (`:344-350`) entirely.

Replace `serialize_nlu_csv` (`:353-376`) with:

```python
def serialize_nlu_csv(records):
    """
    Renders records as the three-column ``utterances,labels,tags`` CSV — the
    same shape Training.start writes. Slots are the trained tag; the
    slot→entity mapping is no longer carried in the interchange.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(['utterances', 'labels', 'tags'])
    for text, intent, spans in records:
        writer.writerow([text, intent, ' '.join(spans_to_tags(text, spans))])
    return buffer.getvalue()
```

- [ ] **Step 3: Simplify the unified JSON, CoNLL, and CSV parsers**

Replace `parse_json_record` (`:236-258`) with:

```python
def parse_json_record(line):
    """
    Parses one ``{text, intent?, entities:[{start,end,label|slot}]}`` JSON line
    into ``(text, intent|None, spans)`` with ``(start, end, name)`` spans. A
    span's name is its ``slot`` / ``label`` / ``entity`` field (first present).
    The intent is optional — the importing model decides whether to require it.
    """
    record = json.loads(line)
    text = record['text']
    intent = str(record.get('intent') or '').strip() or None
    spans = []
    for span in record.get('entities', []):
        name = str(span.get('slot') or span.get('label')
                   or span.get('entity') or '').strip()
        if not name:
            raise ValueError('every span needs a "slot", "label" or "entity" name')
        spans.append((int(span['start']), int(span['end']), name))
    return text, intent, spans
```

In `_parse_conll_dataset` (`:458-483`), the inner `flush` currently wraps spans to 4-tuples; replace its body with:

```python
    def flush(block, start):
        text, spans = parse_conll_block(block)
        records.append(_record(start, text=text, spans=spans))
```

In `_parse_csv_dataset` (`:486-529`), drop the legend. Remove the line
`legend = parse_slot_legend(comments)` and change the span comprehension from
`(start, end, name, legend.get(name))` to `(start, end, name)`:

```python
        spans = [(start, end, name)
                 for start, end, name in tags_to_spans(text, tags)]
```

(Keep the `comments` collection loop — it's still needed for the `reader.line_num + len(comments)` offset — just delete the `legend = …` assignment.)

- [ ] **Step 4: Delete `Utterance.nlu_spans`**

Delete the `nlu_spans` property (`server/database/utterance.py:93-104`). `spans` (the `(start, end, name)` triples) stays and is now the only span accessor.

- [ ] **Step 5: Update `export_annotations` and the importers in `server/database/model.py`**

In `export_annotations` (`server/database/model.py:120-125`), change the NLU records to use `spans` instead of `nlu_spans`:

```python
        if self.kind == 'natural_language_understanding':
            records = [
                (utterance.text,
                 utterance.intent.name if utterance.intent else '',
                 utterance.spans)
                for utterance in self.utterances.order_by(Utterance.id.desc()).all()
            ]
            content = dataset.serialize_nlu_dataset(records, fmt)
```

In `import_annotations` (`:179-181`), the spans are now 3-tuples, so the
validate call simplifies — replace:

```python
            error = validate_import_spans(
                text, [(start, end, name) for start, end, name, _ in record['spans']]
            ) or check(record)
```

with:

```python
            error = validate_import_spans(text, record['spans']) or check(record)
```

In `_ner_importer` (`:191-233`), replace the `span_entity` helper, `check`,
and `materialize` so they read 3-tuple spans:

```python
    def _ner_importer(self, created):
        """
        The NER span resolver: a span trains under an entity named exactly by
        the span's name, auto-created (open list) when unseen.
        """
        entities = {entity.name: entity for entity in self.entities.all()}
        used_colors = [entity.color for entity in entities.values()]

        def check(record):
            return None

        def materialize(record):
            text = record['text']
            utterance = Utterance(text=text, model=self)
            db.session.add(utterance)
            for start, end, name in sorted(record['spans']):
                entity = entities.get(name)
                if entity is None:
                    color = next_label_color(used_colors)
                    entity = Entity(name=name, model=self, color=color, kind='open')
                    db.session.add(entity)
                    entities[name] = entity
                    created.append(name)
                    used_colors.append(color)
                db.session.add(Tag(
                    utterance=utterance, entity=entity,
                    start=start, end=end, value=text[start:end]
                ))

        return check, materialize
```

In `_nlu_importer` (`:235-305`), drop the entity carrier and the conflict
check; each slot resolves to a same-named entity:

```python
    def _nlu_importer(self, created):
        """
        The NLU span resolver: each record carries an intent, and its spans
        resolve to intent-scoped ``Slot`` rows. Intents, slots and their
        backing entities are auto-created; a slot maps to a same-named entity
        (the interchange no longer carries the slot→entity mapping). Slot names
        stay unique per intent, so the same name under several intents makes a
        separate slot on each.
        """
        intents = {intent.name: intent for intent in self.intents.all()}
        entities = {entity.name: entity for entity in self.entities.all()}
        slots = {(slot.intent.name, slot.name): slot for slot in self.slots.all()}
        intent_colors = [intent.color for intent in intents.values()]
        entity_colors = [entity.color for entity in entities.values()]

        def resolve_entity(name):
            entity = entities.get(name)
            if entity is None:
                color = next_label_color(entity_colors)
                entity = Entity(name=name, model=self, color=color, kind='open')
                db.session.add(entity)
                entities[name] = entity
                created.append(name)
                entity_colors.append(color)
            return entity

        def check(record):
            intent_name = (record.get('intent') or '').strip()
            if not intent_name:
                return 'an intent is required'
            return None

        def materialize(record):
            text, intent_name = record['text'], record['intent'].strip()
            intent = intents.get(intent_name)
            if intent is None:
                color = next_label_color(intent_colors)
                intent = Intent(name=intent_name, model=self, color=color)
                db.session.add(intent)
                intents[intent_name] = intent
                created.append(intent_name)
                intent_colors.append(color)

            utterance = Utterance(text=text, model=self, intent=intent)
            db.session.add(utterance)
            for start, end, slot_name in sorted(record['spans']):
                slot = slots.get((intent_name, slot_name))
                if slot is None:
                    entity = resolve_entity(slot_name)
                    slot = Slot(name=slot_name, model=self, intent=intent,
                                entity=entity, color=entity.color)
                    db.session.add(slot)
                    slots[(intent_name, slot_name)] = slot
                    created.append(slot_name)
                db.session.add(Tag(
                    utterance=utterance, slot=slot,
                    start=start, end=end, value=text[start:end]
                ))

        return check, materialize
```

Removing these two `re.search` checks leaves `import re` (top of
`server/database/model.py`, line 2) unused — delete that import line too.

- [ ] **Step 6: Write the interchange round-trip check `$SCRATCH/test_interchange.py`**

```python
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model, Utterance, Tag

app = make_app()
with app.app_context():
    user = seed_user(db)

    # NLU: import intent + {slot: value}; export omits entity, round-trips.
    nlu = Model(id='nlu', name='nlu', kind='natural_language_understanding',
                user=user)
    db.session.add(nlu); db.session.commit()
    summary = nlu.import_annotations('book\tfly to {dest: Delhi}\n', 'inline')
    db.session.commit()
    assert summary['imported'] == 1, summary
    u = db.session.query(Utterance).filter_by(model_id='nlu').first()
    assert u.intent.name == 'book'
    tag = u.tags.first()
    assert tag.slot.name == 'dest', tag.slot.name
    # Slot.entity is still populated (NOT NULL) — a same-named entity.
    assert tag.slot.entity.name == 'dest', tag.slot.entity.name
    exported = nlu.export_annotations('inline').read().decode().strip()
    assert exported == 'book\tfly to {dest: Delhi}', repr(exported)

    # NER unchanged: {city: Delhi} round-trips.
    ner = Model(id='ner', name='ner', kind='named_entity_recognition', user=user)
    db.session.add(ner); db.session.commit()
    ner.import_annotations('fly to {city: Delhi}\n', 'inline')
    db.session.commit()
    assert nlu.export_annotations  # sanity
    out = ner.export_annotations('inline').read().decode().strip()
    assert out == 'fly to {city: Delhi}', repr(out)
print('OK test_interchange')
```

- [ ] **Step 7: Run the checks**

```bash
python -m py_compile server/utils/dataset.py server/database/utterance.py \
    server/database/model.py
cd "$SCRATCH" && python test_interchange.py
grep -rn "nlu_spans\|format_slot_legend\|parse_slot_legend" \
    /Users/varunseth/Documents/git/indic-nlu/server --include="*.py" | grep -v __pycache__
```
Expected: py_compile exit 0; prints `OK test_interchange`; the grep returns **no matches**.

- [ ] **Step 8: Commit**

```bash
git add server/utils/dataset.py server/database/utterance.py server/database/model.py
git commit -m "refactor(dataset): drop per-span entity from the interchange"
```

---

### Task 3: Generalize `Model.write` / `Intent.write` (export)

**Files:**
- Modify: `server/database/model.py` (replace the body of `Model.write`; add `_write_classification`, `_write_training`, `_write_annotated`; add imports)
- Modify: `server/database/intent.py` (replace the body of `Intent.write`; add imports)
- Create: `$SCRATCH/test_export.py` (not committed)

**Interfaces:**
- Consumes: `server.utils.io` primitives (Task 1); the simplified per-record formatters (Task 2).
- Produces:
  - `Model.write(self, fmt='csv', object_name=None) -> str | BinaryIO` — `fmt` one of `csv`/`inline`/`conll`/`json` or `training`.
  - `Intent.write(self, object_name=None) -> str | BinaryIO`
- Leaves `export_annotations`, `_utterances_csv`, `_classification_csv` in place (removed in Task 6).

- [ ] **Step 1: Add imports to `server/database/model.py`**

At the top of `server/database/model.py`, after `import io` (line 1) add:

```python
import csv
```

After `from sqlalchemy.ext.associationproxy import association_proxy` add:

```python
from sqlalchemy import select
```

After `from ..utils import dataset` add:

```python
from ..utils import io as dataset_io
```

- [ ] **Step 2: Replace `Model.write`**

Replace the current `Model.write` (`server/database/model.py:98-109`) with:

```python
    def write(self, fmt='csv', object_name=None):
        """
        Export this model's dataset, streamed to a temp file, then either
        uploaded via ``store`` (when ``object_name`` is given, e.g. the training
        build) or returned as an open handle for ``flask.send_file``.

        ``fmt='training'`` writes the training-pipeline layout; otherwise the
        format is the download format — the plain ``text,label`` CSV for a
        classification model, or an annotated interchange format
        (``inline``/``conll``/``json``/``csv``) for NER/NLU.
        """
        annotated = self.kind in ('named_entity_recognition',
                                  'natural_language_understanding')
        path = dataset_io.new_temp_path()
        try:
            if fmt == 'training':
                self._write_training(path)
            elif annotated:
                self._write_annotated(path, fmt)
            else:
                self._write_classification(path)
        except BaseException:
            dataset_io.discard_temp(path)
            raise
        return dataset_io.finalize_export(path, object_name)

    def _write_classification(self, path):
        """Plain ``text,label`` export via native COPY (fallback: chunked)."""
        query = (
            select(Utterance.text.label('text'), Intent.name.label('label'))
            .join(Intent, Utterance.intent_id == Intent.id)
            .where(Intent.model_id == self.id)
            .order_by(Intent.name.asc(), Intent.id.desc(), Utterance.id.desc())
        )
        dataset_io.stream_query_to_path(query, path)

    def _write_training(self, path):
        """
        The training-pipeline dataset. Classification is a plain
        ``utterances,labels`` COPY; NER/NLU stream inline ``{name: value}``
        markup (with a ``labels`` intent column for NLU) — the shape the old
        ``_utterances_csv`` / ``_classification_csv`` produced.
        """
        if self.kind not in ('named_entity_recognition',
                             'natural_language_understanding'):
            query = (
                select(Utterance.text.label('utterances'),
                       Intent.name.label('labels'))
                .join(Intent, Utterance.intent_id == Intent.id)
                .where(Intent.model_id == self.id)
                .order_by(Intent.created_at.desc(), Utterance.id.desc())
            )
            dataset_io.stream_query_to_path(query, path)
            return

        with_intent = self.kind == 'natural_language_understanding'
        columns = ['utterances', 'labels'] if with_intent else ['utterances']

        def generate():
            buffer = io.StringIO()
            writer = csv.writer(buffer)

            def flush():
                data = buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)
                return data

            writer.writerow(columns)
            yield flush()
            for utterance in self.utterances.order_by(
                    Utterance.id.desc()).yield_per(dataset_io.batch_size()):
                if not utterance.text.split():
                    continue
                if with_intent and utterance.intent is None:
                    continue
                inline = dataset.format_inline(utterance.text, utterance.spans)
                writer.writerow([inline, utterance.intent.name]
                                if with_intent else [inline])
                yield flush()

        dataset_io.write_lines_to_path(path, generate())

    def _write_annotated(self, path, fmt):
        """
        Stream an annotated dataset in ``fmt`` through the per-record formatters
        in ``server/utils/dataset.py`` (the single source of truth), one
        utterance at a time via ``yield_per`` so the whole corpus never sits in
        memory. NER and NLU share this path; NLU adds the intent (inline TAB
        prefix / JSON field / CSV ``labels`` column).
        """
        nlu = self.kind == 'natural_language_understanding'

        def utterances():
            return self.utterances.order_by(
                Utterance.id.desc()).yield_per(dataset_io.batch_size())

        def intent_name(utterance):
            return utterance.intent.name if utterance.intent else ''

        def generate():
            if fmt == 'inline':
                for utterance in utterances():
                    yield (dataset.format_inline_nlu(
                        utterance.text, intent_name(utterance), utterance.spans)
                        if nlu else dataset.format_inline(
                            utterance.text, utterance.spans)) + '\n'
            elif fmt == 'json':
                for utterance in utterances():
                    yield (dataset.format_json_nlu(
                        utterance.text,
                        utterance.intent.name if utterance.intent else None,
                        utterance.spans)
                        if nlu else dataset.format_json(
                            utterance.text, utterance.spans)) + '\n'
            elif fmt == 'conll':
                for utterance in utterances():
                    yield dataset.format_conll(
                        utterance.text, utterance.spans) + '\n\n'
            elif fmt == 'csv':
                buffer = io.StringIO()
                writer = csv.writer(buffer)

                def flush():
                    data = buffer.getvalue()
                    buffer.seek(0)
                    buffer.truncate(0)
                    return data

                header = (['utterances', 'labels', 'tags'] if nlu
                          else ['text', 'tags'])
                writer.writerow(header)
                yield flush()
                for utterance in utterances():
                    tags = ' '.join(dataset.spans_to_tags(
                        utterance.text, utterance.spans))
                    writer.writerow([utterance.text, intent_name(utterance), tags]
                                    if nlu else [utterance.text, tags])
                    yield flush()
            else:
                abort(400, 'Unknown format: %s' % fmt)

        dataset_io.write_lines_to_path(path, generate())
```

- [ ] **Step 3: Replace `Intent.write`**

In `server/database/intent.py`, add imports after `from .. import db`:

```python
from sqlalchemy import select

from ..utils import io as dataset_io
```

Replace `Intent.write` (`server/database/intent.py:73-82`) with:

```python
    def write(self, object_name=None):
        """
        Export this intent's utterances as a ``text,label`` CSV, streamed via
        native COPY (fallback: chunked). Returns an open handle for
        ``flask.send_file`` unless ``object_name`` routes it through ``store``.
        """
        query = (
            select(Utterance.text.label('text'),
                   db.literal(self.name).label('label'))
            .where(Utterance.intent_id == self.id)
            .order_by(Utterance.id.desc())
        )
        path = dataset_io.new_temp_path()
        try:
            dataset_io.stream_query_to_path(query, path)
        except BaseException:
            dataset_io.discard_temp(path)
            raise
        return dataset_io.finalize_export(path, object_name)
```

Note: `db.literal(self.name)` renders the intent name as a constant `label` column, matching the old two-column output. `pandas` is now unused by `write` but still used by `read` (Task 4) — leave the import.

- [ ] **Step 4: Write export verification `$SCRATCH/test_export.py`**

```python
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model, Intent, Utterance, Entity, Tag

app = make_app()
with app.app_context():
    user = seed_user(db)

    # Classification export.
    cls = Model(id='cls', name='cls', kind='text_classification', user=user)
    db.session.add(cls)
    for name in ['greet', 'bye']:
        intent = Intent(name=name, model=cls, color='#000')
        db.session.add(intent)
        for i in range(3):
            db.session.add(Utterance(text=f'{name} {i}', intent=intent))
    db.session.commit()
    lines = cls.write().read().decode().splitlines()
    assert lines[0] == 'text,label', lines[0]
    assert len(lines) == 7, len(lines)  # header + 6
    assert cls.write(fmt='training').read().decode().splitlines()[0] == \
        'utterances,labels'

    # NER export: inline + csv.
    ner = Model(id='ner', name='ner', kind='named_entity_recognition', user=user)
    db.session.add(ner)
    ent = Entity(name='city', model=ner, color='#111', kind='open')
    db.session.add(ent)
    utt = Utterance(text='fly to Delhi', model=ner)
    db.session.add(utt); db.session.flush()
    db.session.add(Tag(utterance=utt, entity=ent, start=7, end=12, value='Delhi'))
    db.session.commit()
    assert ner.write(fmt='inline').read().decode().strip() == 'fly to {city: Delhi}'
    csv_out = ner.write(fmt='csv').read().decode().splitlines()
    assert csv_out[0] == 'text,tags' and 'B-city' in csv_out[1], csv_out

    # NLU export: intent prefix + slot-only markup (no @entity).
    nlu = Model(id='nlu', name='nlu', kind='natural_language_understanding',
                user=user)
    db.session.add(nlu)
    intent = Intent(name='book', model=nlu, color='#222')
    ent2 = Entity(name='city', model=nlu, color='#333', kind='open')
    from server.database import Slot
    slot = Slot(name='dest', model=nlu, intent=intent, entity=ent2, color='#333')
    db.session.add_all([intent, ent2, slot])
    u2 = Utterance(text='fly to Delhi', model=nlu, intent=intent)
    db.session.add(u2); db.session.flush()
    db.session.add(Tag(utterance=u2, slot=slot, start=7, end=12, value='Delhi'))
    db.session.commit()
    assert nlu.write(fmt='inline').read().decode().strip() == 'book\tfly to {dest: Delhi}'
print('OK test_export')
```

- [ ] **Step 5: Run the checks**

```bash
python -m py_compile server/database/model.py server/database/intent.py
cd "$SCRATCH" && python test_export.py
```
Expected: py_compile exit 0; prints `OK test_export`.

- [ ] **Step 6: Commit**

```bash
git add server/database/model.py server/database/intent.py
git commit -m "feat(export): stream Model/Intent.write via COPY and batched formatters"
```

---

### Task 4: Generalize classification import (`Model.read`, `Intent.read`)

**Files:**
- Modify: `server/database/model.py` (replace `Model.read` with the dispatcher + `_read_classification`)
- Modify: `server/database/intent.py` (replace `Intent.read` body)
- Create: `$SCRATCH/test_import_cls.py` (not committed)

**Interfaces:**
- Consumes: `server.utils.io` primitives; `next_label_color` (already imported in both modules).
- Produces:
  - `Model.read(self, source, fmt=None, header=0) -> dict` — classification path returns `{'imported', 'created', 'errors'}`; annotated path added in Task 5.
  - `Intent.read(self, file, header=0) -> int`

- [ ] **Step 1: Replace `Model.read`**

Replace the current `Model.read` (`server/database/model.py:71-96`) with:

```python
    def read(self, source, fmt=None, header=0):
        """
        Import a dataset. NER/NLU models take an annotated corpus (``source`` a
        decoded string, ``fmt`` its interchange format); classification models
        take a ``text,label`` CSV/TSV upload (``source`` a file, ``header`` from
        the request). Both return the same
        ``{'imported', 'created', 'errors'}`` summary.
        """
        if self.kind in ('named_entity_recognition',
                         'natural_language_understanding'):
            return self._read_annotated(source, fmt)
        return self._read_classification(source, header)

    def _read_classification(self, file, header):
        """
        Stream a ``text,label`` CSV/TSV in through ``bulk_insert``: read in
        ``DATASET_IO_BATCH_SIZE`` chunks, auto-create any new intent (few, kept
        as ORM rows), flush so they get ids, then COPY the chunk's utterances.
        """
        if not allowed_file(secure_filename(file.filename)):
            abort(400, 'Please upload either CSV or TSV file.')
        sep = '\t' if file.filename.endswith('.tsv') else ','
        intents = {intent.name: intent for intent in self.intents.all()}
        used_colors = [intent.color for intent in intents.values()]
        imported, created = 0, []
        for chunk in pd.read_csv(file, sep=sep, header=header,
                                 on_bad_lines='skip', skip_blank_lines=True,
                                 usecols=[0, 1], chunksize=dataset_io.batch_size()):
            chunk = chunk.dropna()
            pending = []
            for text, label in zip(chunk.iloc[:, 0].astype(str),
                                   chunk.iloc[:, 1].astype(str)):
                name = str(label)
                intent = intents.get(name)
                if intent is None:
                    color = next_label_color(used_colors)
                    intent = Intent(name=name, model=self, color=color)
                    db.session.add(intent)
                    intents[name] = intent
                    used_colors.append(color)
                    created.append(name)
                pending.append((name, text))
            db.session.flush()
            rows = [{'text': text, 'intent_id': intents[name].id}
                    for name, text in pending]
            dataset_io.bulk_insert(Utterance, rows, copy=True)
            imported += len(rows)
        return {'imported': imported, 'created': created, 'errors': []}
```

Note: classification utterances belong to an intent (their `model_id` stays NULL), so the row dicts carry only `text` + `intent_id`, and `copy=True` is safe (both non-NULL).

- [ ] **Step 2: Replace `Intent.read`**

Replace `Intent.read` (`server/database/intent.py:56-71`) with:

```python
    def read(self, file, header=0):
        """
        Import this intent's rows from a ``text,label`` CSV/TSV: keep only rows
        whose label matches this intent's name, batch-inserted via
        ``bulk_insert``. Returns the number imported.
        """
        if not allowed_file(secure_filename(file.filename)):
            abort(400, 'Please upload either CSV or TSV file.')
        db.session.flush()  # ensure self.id for a freshly-created intent
        sep = '\t' if file.filename.endswith('.tsv') else ','
        imported = 0
        for chunk in pd.read_csv(file, sep=sep, header=header,
                                 skip_blank_lines=True, usecols=[0, 1],
                                 chunksize=dataset_io.batch_size()):
            mask = chunk.iloc[:, 1].astype(str).values == str(self.name)
            texts = chunk.iloc[mask, 0].astype(str).tolist()
            rows = [{'text': text, 'intent_id': self.id} for text in texts]
            if rows:
                dataset_io.bulk_insert(Utterance, rows, copy=True)
                imported += len(rows)
        return imported
```

- [ ] **Step 3: Write classification import check `$SCRATCH/test_import_cls.py`**

```python
import io as _io
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model, Utterance
from werkzeug.datastructures import FileStorage

app = make_app()
with app.app_context():
    user = seed_user(db)
    model = Model(id='m', name='m', kind='text_classification', user=user)
    db.session.add(model); db.session.commit()

    csv_bytes = b'text,label\nhello there,greet\nsee ya,bye\nhi,greet\n'
    upload = FileStorage(stream=_io.BytesIO(csv_bytes), filename='d.csv')
    summary = model.read(upload, header=0)
    db.session.commit()
    assert summary['imported'] == 3, summary
    assert sorted(summary['created']) == ['bye', 'greet'], summary
    assert db.session.query(Utterance).count() == 3
    assert all(u.model_id is None and u.intent_id for u in
               db.session.query(Utterance).all())
print('OK test_import_cls')
```

- [ ] **Step 4: Run the checks**

```bash
python -m py_compile server/database/model.py server/database/intent.py
cd "$SCRATCH" && python test_import_cls.py
```
Expected: py_compile exit 0; prints `OK test_import_cls`.

- [ ] **Step 5: Commit**

```bash
git add server/database/model.py server/database/intent.py
git commit -m "feat(import): batch classification import via bulk_insert"
```

---

### Task 5: Generalize annotated import (`Model._read_annotated` + batched resolvers)

**Files:**
- Modify: `server/database/model.py` (add `_read_annotated`, `_ner_resolver`, `_nlu_resolver`)
- Create: `$SCRATCH/test_import_annotated.py` (not committed)

**Interfaces:**
- Consumes: `dataset.parse_dataset`, `validate_import_spans`, `next_label_color`, `server.utils.io.bulk_insert`, `timestamp` (all already imported in `model.py`); the 3-tuple span contract from Task 2.
- Produces: `Model._read_annotated(self, content, fmt) -> {'imported', 'created', 'errors'}`.
- The new `_ner_resolver` / `_nlu_resolver` sit alongside the old `_ner_importer` / `_nlu_importer` (removed in Task 6).

- [ ] **Step 1: Add `_read_annotated` and the two resolvers to `server/database/model.py`**

Insert these three methods after `_nlu_importer`:

```python
    def _read_annotated(self, content, fmt):
        """
        Import an annotated dataset (NER or NLU). The parse → per-record
        validate → registry-resolve pipeline is unchanged (the safety layer);
        only materialization is batched: valid records accumulate, and each
        batch flushes the auto-created registry rows for their ids, bulk-inserts
        the utterances with ``RETURNING id``, then bulk-inserts their tags
        against those ids. A malformed or invalid record is skipped and
        reported, never failing the file.
        """
        records = dataset.parse_dataset(content, fmt)
        errors, imported, created = [], 0, []
        nlu = self.kind == 'natural_language_understanding'
        check, resolve = (self._nlu_resolver(created) if nlu
                          else self._ner_resolver(created))

        pending = []  # (text, intent_or_None, [(start, end, entity_or_None, slot_or_None)])

        def flush_pending():
            nonlocal imported
            if not pending:
                return
            db.session.flush()  # registry rows (intents/entities/slots) get ids
            utterance_rows = [
                {'text': text, 'model_id': self.id,
                 'intent_id': intent.id if intent is not None else None}
                for text, intent, _ in pending
            ]
            ids = dataset_io.bulk_insert(
                Utterance, utterance_rows, returning=Utterance.id)
            tag_rows = []
            for (text, _, spans), utterance_id in zip(pending, ids):
                for start, end, entity, slot in spans:
                    tag_rows.append({
                        'utterance_id': utterance_id,
                        'entity_id': entity.id if entity is not None else None,
                        'slot_id': slot.id if slot is not None else None,
                        'start': start, 'end': end,
                        'value': text[start:end],
                        'created_at': timestamp(),
                    })
            dataset_io.bulk_insert(Tag, tag_rows)
            imported += len(pending)
            pending.clear()

        for record in records:
            if record['error']:
                errors.append({'line': record['line'], 'error': record['error']})
                continue
            text = record['text']
            if text is None or not text.strip():
                continue
            error = validate_import_spans(text, record['spans']) or check(record)
            if error:
                errors.append({'line': record['line'], 'error': error})
                continue
            pending.append(resolve(record))
            if len(pending) >= dataset_io.batch_size():
                flush_pending()
        flush_pending()

        return {'imported': imported, 'created': created, 'errors': errors}

    def _ner_resolver(self, created):
        """
        Batched NER span resolver: same auto-create-entity semantics as
        ``_ner_importer``, but ``resolve`` returns
        ``(text, None, [(start, end, entity, None)])`` for the batch loader
        instead of adding an ``Utterance``/``Tag`` itself.
        """
        entities = {entity.name: entity for entity in self.entities.all()}
        used_colors = [entity.color for entity in entities.values()]

        def check(record):
            return None

        def resolve(record):
            text = record['text']
            spans = []
            for start, end, name in sorted(record['spans']):
                entity = entities.get(name)
                if entity is None:
                    color = next_label_color(used_colors)
                    entity = Entity(name=name, model=self, color=color, kind='open')
                    db.session.add(entity)
                    entities[name] = entity
                    created.append(name)
                    used_colors.append(color)
                spans.append((start, end, entity, None))
            return text, None, spans

        return check, resolve

    def _nlu_resolver(self, created):
        """
        Batched NLU span resolver: same auto-create intent/slot/(same-named)
        entity semantics as ``_nlu_importer``, but ``resolve`` returns
        ``(text, intent, [(start, end, None, slot)])`` for the batch loader.
        """
        intents = {intent.name: intent for intent in self.intents.all()}
        entities = {entity.name: entity for entity in self.entities.all()}
        slots = {(slot.intent.name, slot.name): slot for slot in self.slots.all()}
        intent_colors = [intent.color for intent in intents.values()]
        entity_colors = [entity.color for entity in entities.values()]

        def resolve_entity(name):
            entity = entities.get(name)
            if entity is None:
                color = next_label_color(entity_colors)
                entity = Entity(name=name, model=self, color=color, kind='open')
                db.session.add(entity)
                entities[name] = entity
                created.append(name)
                entity_colors.append(color)
            return entity

        def check(record):
            intent_name = (record.get('intent') or '').strip()
            if not intent_name:
                return 'an intent is required'
            return None

        def resolve(record):
            text, intent_name = record['text'], record['intent'].strip()
            intent = intents.get(intent_name)
            if intent is None:
                color = next_label_color(intent_colors)
                intent = Intent(name=intent_name, model=self, color=color)
                db.session.add(intent)
                intents[intent_name] = intent
                created.append(intent_name)
                intent_colors.append(color)
            spans = []
            for start, end, slot_name in sorted(record['spans']):
                slot = slots.get((intent_name, slot_name))
                if slot is None:
                    entity = resolve_entity(slot_name)
                    slot = Slot(name=slot_name, model=self, intent=intent,
                                entity=entity, color=entity.color)
                    db.session.add(slot)
                    slots[(intent_name, slot_name)] = slot
                    created.append(slot_name)
                spans.append((start, end, None, slot))
            return text, intent, spans

        return check, resolve
```

- [ ] **Step 2: Write annotated import + round-trip check `$SCRATCH/test_import_annotated.py`**

```python
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model, Utterance, Tag

app = make_app()
with app.app_context():
    user = seed_user(db)

    # NER: inline import (one malformed line skipped), export round-trips.
    ner = Model(id='ner', name='ner', kind='named_entity_recognition', user=user)
    db.session.add(ner); db.session.commit()
    content = 'fly to {city: Delhi}\nbook {city: Pune} hotel\nbad {brace\n'
    summary = ner.read(content, fmt='inline')
    db.session.commit()
    assert summary['imported'] == 2, summary
    assert len(summary['errors']) == 1, summary
    assert 'city' in summary['created'], summary
    assert db.session.query(Utterance).filter_by(model_id='ner').count() == 2
    assert db.session.query(Tag).count() == 2
    exported = sorted(ner.write(fmt='inline').read().decode().splitlines())
    assert exported == ['book {city: Pune} hotel', 'fly to {city: Delhi}'], exported

    # NLU: intent prefix + {slot: value}; slot maps to a same-named entity.
    nlu = Model(id='nlu', name='nlu', kind='natural_language_understanding',
                user=user)
    db.session.add(nlu); db.session.commit()
    s2 = nlu.read('book\tfly to {dest: Delhi}\n', fmt='inline')
    db.session.commit()
    assert s2['imported'] == 1, s2
    u = db.session.query(Utterance).filter_by(model_id='nlu').first()
    assert u.intent.name == 'book'
    tag = u.tags.first()
    assert tag.slot.name == 'dest' and tag.slot.entity.name == 'dest'
print('OK test_import_annotated')
```

- [ ] **Step 3: Run the checks**

```bash
python -m py_compile server/database/model.py
cd "$SCRATCH" && python test_import_annotated.py
```
Expected: py_compile exit 0; prints `OK test_import_annotated`.

- [ ] **Step 4: Commit**

```bash
git add server/database/model.py
git commit -m "feat(import): batch annotated import with COPY-backed bulk inserts"
```

---

### Task 6: Rewire callers, remove old methods

**Files:**
- Modify: `server/views/api/models.py` (`_read_dataset`)
- Modify: `server/views/api/tags.py` (`export_tags`, `import_tags`)
- Modify: `server/database/training.py` (`Training.start`; drop `_utterances_csv`, `_classification_csv`; add `_data_object`)
- Modify: `server/database/model.py` (delete `export_annotations`, `import_annotations`, `_ner_importer`, `_nlu_importer`)
- Create: `$SCRATCH/test_end_to_end.py` (not committed)

**Interfaces:**
- Consumes: generalized `Model.read`/`Model.write` (Tasks 3–5).
- Produces: no new public surface; removes the four old `Model` methods and two `Training` builders.

- [ ] **Step 1: Rewire `server/views/api/models.py`**

In `_read_dataset` (`server/views/api/models.py:11-34`), replace the annotated branch call `return model.import_annotations(content, fmt)` with:

```python
        return model.read(content, fmt=fmt)
```

and replace the classification tail (lines 33-34):

```python
    model.read(upload, header=0 if request.form.get('header') == 'true' else None)
    return None
```

with:

```python
    return model.read(upload, header=0 if request.form.get('header') == 'true' else None)
```

(`create_model`/`edit_model` already attach any non-None summary as `import_summary`.) `get_model`'s `send_file(model.write(), …)` is unchanged.

- [ ] **Step 2: Rewire `server/views/api/tags.py`**

Replace `model.export_annotations(fmt)` (`server/views/api/tags.py:107`) with:

```python
        model.write(fmt),
```

Replace `summary = model.import_annotations(content, fmt)` (`:128`) with:

```python
    summary = model.read(content, fmt=fmt)
```

- [ ] **Step 3: Rewire `Training.start` in `server/database/training.py`**

Add a path helper before `_put_data` (`server/database/training.py:75`):

```python
    def _data_object(self, name):
        return f'models/{self.path}/data/{name}'
```

Change `_put_data` to reuse it:

```python
    def _put_data(self, name, data):
        """Upload one file into this version's ``data/`` folder in blob storage."""
        buffer = io.BytesIO(data.encode('utf-8')) if isinstance(data, str) else data
        store.put(
            bucket=current_app.config['STORAGE_BUCKET'],
            object_name=self._data_object(name),
            data=buffer,
        )
```

Replace the three `_put_data('utterances.csv', …)` calls in `start` (`:47-63`)
with `self.model.write(...)`. New block:

```python
        if self.model.kind == 'named_entity_recognition':
            self.model.write(fmt='training', object_name=self._data_object('utterances.csv'))
            self._put_data('entities.json', self._catalogue_spec(augment))
        elif self.model.kind == 'natural_language_understanding':
            self.model.write(fmt='training', object_name=self._data_object('utterances.csv'))
            self._put_data('entities.json', self._catalogue_spec(augment))
            slot_map = {}
            for slot in self.model.slots.all():
                slot_map.setdefault(slot.intent.name, {})[slot.name] = slot.entity.name
            self._put_data('slots.json', json.dumps(slot_map))
        else:
            self.model.write(fmt='training', object_name=self._data_object('utterances.csv'))
```

Then delete `_utterances_csv` (`:84-105`) and `_classification_csv` (`:107-113`).
Grep confirms `format_inline` and `pd` are used only by those two methods, so
remove `from ..utils.dataset import format_inline` (line 11) and `import pandas
as pd` (line 4).

- [ ] **Step 4: Delete the superseded methods in `server/database/model.py`**

Delete `export_annotations`, `import_annotations`, `_ner_importer`, and
`_nlu_importer`. The generalized `read`/`write` plus
`_read_annotated`/`_ner_resolver`/`_nlu_resolver` replace them. Keep the
`validate_import_spans`, `next_label_color`, `timestamp` imports — still used by
the resolvers (`re` was already dropped in Task 2).

- [ ] **Step 5: End-to-end verification `$SCRATCH/test_end_to_end.py`**

```python
import io as _io
import os
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model, Utterance
from werkzeug.datastructures import FileStorage

app = make_app()
with app.app_context():
    user = seed_user(db)

    a = Model(id='a', name='a', kind='text_classification', user=user)
    db.session.add(a); db.session.commit()
    csv_bytes = b'text,label\n' + b''.join(
        ('u%d,lab%d\n' % (i, i % 3)).encode() for i in range(50))
    a.read(FileStorage(stream=_io.BytesIO(csv_bytes), filename='d.csv'), header=0)
    db.session.commit()
    assert db.session.query(Utterance).count() == 50

    exported = a.write().read()
    b = Model(id='b', name='b', kind='text_classification', user=user)
    db.session.add(b); db.session.commit()
    b.read(FileStorage(stream=_io.BytesIO(exported), filename='d.csv'), header=0)
    db.session.commit()
    assert db.session.query(Utterance).count() == 100, 'round-trip count'

    obj = a.write(fmt='training', object_name='models/a/0.1/data/utterances.csv')
    assert obj == 'models/a/0.1/data/utterances.csv', obj
    assert os.path.exists(os.path.join(os.getcwd(), 'data', obj)), 'store wrote file'
print('OK test_end_to_end')
```

- [ ] **Step 6: Run all checks**

```bash
python -m py_compile server/views/api/models.py server/views/api/tags.py \
    server/views/api/intents.py server/database/training.py server/database/model.py
cd "$SCRATCH" && python test_end_to_end.py
grep -rn "export_annotations\|import_annotations\|_utterances_csv\|_classification_csv\|nlu_spans" \
    /Users/varunseth/Documents/git/indic-nlu/server --include="*.py" | grep -v __pycache__
```
Expected: py_compile exit 0; prints `OK test_end_to_end`; the grep returns **no matches**.

- [ ] **Step 7: Build the frontend**

```bash
cd /Users/varunseth/Documents/git/indic-nlu && npm run build
```
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add server/views/api/models.py server/views/api/tags.py \
    server/database/training.py server/database/model.py
git commit -m "refactor(dataset): route all import/export through Model.read/write"
```

---

## Notes for the implementer

- **Order-correspondence of `bulk_insert(..., returning=Utterance.id)`** is the one non-obvious dependency: SQLAlchemy 2.0's insertmanyvalues guarantees returned rows match input order on both psycopg2 and pysqlite (SQLite ≥ 3.35). The annotated round-trip check (Task 5) fails loudly (wrong span text) if that ever breaks — treat a failure there as a correlation bug, not a flaky test.
- **COPY runs on the session connection** (`db.session.connection().connection`), so it shares the request transaction — no separate commit, and `flask.abort` still rolls the whole import back. Always `db.session.flush()` before a COPY-based `bulk_insert(copy=True)` so autoflush-skipped ORM registry rows already have ids (the code does this).
- **NULL handling / `copy=True`:** COPY-FROM renders `None` as an empty CSV field, which Postgres rejects for non-text columns, so it is opt-in and only the entirely-non-NULL callers set it (classification utterances). Tag rows always carry a NULL (`entity_id` xor `slot_id`) and annotated utterance inserts need `returning`, so both take the batched `insert()` branch. If you ever pass `copy=True` for NULL-bearing rows, the Task 5/6 round-trips fail on Postgres — the guard working.
- **`Slot.entity` stays.** Task 2 removes the slot→entity mapping only from the *file interchange*; the DB column (`NOT NULL`) and training's `slots.json` / `entities.json` are untouched. On import a slot auto-creates a same-named entity; remapping to a shared entity (e.g. `source`/`destination` → `location`) is a UI operation.
- If `psycopg2`'s newer `cursor.copy` API is preferred over `copy_expert` on your driver version, that's an internal swap in `server/utils/io.py`; the primitives' signatures don't change.
```
