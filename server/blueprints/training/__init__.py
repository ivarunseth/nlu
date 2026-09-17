"""
Training runs: create, start, stop, inspect. Owns the `training` table;
enqueues onto the `training` Celery queue; announces runs over Socket.IO
through the message queue (the `events` blueprint hosts the server).
"""

from flask import Blueprint

from server.blueprints import register_error_handlers, register_status_route

blueprint = Blueprint('training', __name__, url_prefix='/api/training')
register_error_handlers(blueprint)
register_status_route(blueprint)

from . import trainings  # noqa: E402,F401
