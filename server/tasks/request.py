"""
Replay an HTTP request inside the request worker.

``server.blueprints.apply_async`` ships the WSGI environ here and answers
202 at once. A small body comes base64-encoded in the message; a large one
(an upload) waits in blob storage under ``requests/<task_id>`` and the
message names it — the broker never carries it. This task rebuilds the
request's blueprint alone — no ``init_app`` hooks, so no telemetry
consumer or environment sync in a worker — and runs the view for real
with ``g.sync = False``, which is what stops the decorator from
dispatching a second time. The stored result is ``(base64 body, status,
headers)``; the status route turns it back into an HTTP response. A
spooled body is deleted afterwards whether or not the view succeeded.
"""

from base64 import b64decode, b64encode
from io import BytesIO

from flask import g
from werkzeug.exceptions import InternalServerError

from . import api


def spool_object(task_id):
    """Where a replayed request's large body waits in blob storage."""
    return f'requests/{task_id}'


@api.task
def dispatch(environ: dict):
    # Work on a copy: the argument is what Celery would record with the
    # result, and it must stay JSON (no stream object in it).
    environ = dict(environ)

    from .. import create_app, store
    app = create_app(environ.pop('_blueprint'), init=False)

    spooled = environ.pop('_wsgi.input_object', None)
    if '_wsgi.input' in environ:
        environ['wsgi.input'] = BytesIO(b64decode(environ.pop('_wsgi.input')))
    elif spooled:
        body = store.get(app.config['STORAGE_BUCKET'], spooled)
        if body is None:
            raise FileNotFoundError(f'Spooled request body is missing: {spooled}')
        environ['wsgi.input'] = body

    try:
        return _replay(app, environ)
    finally:
        if spooled:
            store.delete(app.config['STORAGE_BUCKET'], spooled)


def _replay(app, environ):
    with app.request_context(environ):
        g.sync = False

        try:
            response = app.full_dispatch_request()
        except Exception:
            if app.debug:
                raise
            response = app.make_response(InternalServerError())

        # Downloads come back streamed (send_file sets direct_passthrough);
        # the result has to be bytes, so buffer the body here.
        response.direct_passthrough = False
        body = b64encode(response.get_data()).decode('ascii')
        return (body, response.status_code, list(response.headers.items()))
