"""
One blueprint per deployable service. Each package under this one exposes

* ``blueprint`` — a :class:`flask.Blueprint` with its ``url_prefix`` set
  (``/api/<name>``), or ``None`` for a package with no HTTP routes;
* ``init_app(app)`` — optional; process-level extras only that service
  needs (the Socket.IO server, the telemetry consumer, CORS).

``server.create_app(*names)`` mounts any subset, so one process can run
all of them (local development) or exactly one (a container). The names
here are also the URL prefixes, the nginx locations and the compose
service names.
"""

from base64 import b64decode, b64encode
from functools import wraps
from importlib import import_module
from uuid import uuid4

from celery import states
from flask import abort, current_app, g, make_response, request, url_for

NAMES = ('auth', 'dataset', 'training', 'publishing', 'analytics', 'inference', 'events')


def load(name):
    if name not in NAMES:
        raise ValueError('Unknown blueprint %r. Known: %s' % (name, ', '.join(NAMES)))
    return import_module(f'{__name__}.{name}')


def register_error_handlers(blueprint):
    """JSON error bodies, the same on every blueprint."""
    @blueprint.errorhandler(400)
    def bad_request(error):
        return {'error': error.description}, 400

    @blueprint.errorhandler(404)
    def not_found(error):
        return {'error': error.description}, 404

    @blueprint.errorhandler(409)
    def conflict(error):
        # Surfaced conflicts the client resolves explicitly — e.g. reassigning
        # an utterance to an intent that lacks one of its spans' slots.
        return {'error': error.description}, 409

    @blueprint.errorhandler(500)
    def internal_server_error(error):
        return {'error': error.description}, 500

    @blueprint.errorhandler(504)
    def gateway_timeout(error):
        return {'error': error.description}, 504


def apply_async(f):
    """
    Run the view in the request worker and answer at once.

    The caller gets ``202 {"task_id", "status"}`` with a ``Location``
    pointing at this blueprint's status route; the worker replays the
    request (``server.tasks.request.dispatch``) and pushes ``status`` events
    into the task-id Socket.IO room, so the browser fetches the result when
    it is ready instead of polling. Stack it below the auth decorator: the
    API process then rejects bad tokens before dispatching, and the worker
    re-runs the same check on the replayed request.

    The body rides in the Celery message only while it is small
    (``REQUEST_INLINE_BODY_LIMIT``). A dataset upload is streamed to blob
    storage under ``requests/<task_id>`` instead — never held whole in this
    process, never pushed through the broker — and the worker streams it
    back and deletes it once the replay is done.

    Inside the worker ``g.sync`` is false and the view simply runs.
    """
    @wraps(f)
    def route(*args, **kwargs):
        if not getattr(g, 'sync', True):
            return f(*args, **kwargs)

        from server.tasks.request import dispatch, spool_object
        task_id = str(uuid4())
        environ = {k: v for k, v in request.environ.items() if isinstance(v, str)}
        if 'wsgi.input' in request.environ:
            if (request.content_length or 0) > current_app.config['REQUEST_INLINE_BODY_LIMIT']:
                from server import store
                store.put(current_app.config['STORAGE_BUCKET'], spool_object(task_id), request.stream)
                environ['_wsgi.input_object'] = spool_object(task_id)
            else:
                environ['_wsgi.input'] = b64encode(request.get_data()).decode('ascii')

        # Celery writes no state until the worker picks the task up, so a
        # queued task would be indistinguishable from an unknown id. Record
        # RECEIVED before sending — after would race a fast worker's SUCCESS.
        dispatch.backend.store_result(task_id, None, states.RECEIVED)
        dispatch.apply_async(args=(environ,), task_id=task_id)
        location = url_for(f'{request.blueprint}.get_status', taskId=task_id)
        return {'task_id': task_id, 'status': states.RECEIVED}, 202, {'Location': location}
    return route


def register_status_route(blueprint):
    """``GET /api/<blueprint>/status/<taskId>`` for views wrapped in apply_async."""
    from server.auth import token_auth

    @blueprint.get('/status/<taskId>')
    @token_auth.login_required
    def get_status(taskId):
        """
        202 while the task is queued or running, the view's own response
        once it is done, 404 for an id the result store has never seen (or
        has expired — PENDING is Celery's "no record"), 500 if the replay
        itself failed.
        """
        from server.tasks.request import dispatch
        task = dispatch.AsyncResult(taskId)
        if task.state == states.PENDING:
            abort(404, 'Unknown task: %s' % taskId)
        if task.state in (states.RECEIVED, states.STARTED, states.RETRY):
            return {'task_id': taskId, 'status': task.state}, 202, {'Location': request.path}
        if task.state == states.SUCCESS:
            body, status, headers = task.result
            return make_response(b64decode(body), status, headers)
        abort(500, 'Request failed: %s' % task.info)
