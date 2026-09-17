"""
Dashboards over the dataset, training history and live predictions.
Read-only on every other blueprint's tables; owns `prediction`, which is
written only by the telemetry consumer this package starts.
"""

import gevent
from flask import Blueprint

from server import CLI
from server.blueprints import register_error_handlers, register_status_route

blueprint = Blueprint('analytics', __name__, url_prefix='/api/analytics')
register_error_handlers(blueprint)
register_status_route(blueprint)

from . import analytics  # noqa: E402,F401


def init_app(app):
    # One consumer per process drains every environment's telemetry queue
    # into `prediction` rows. Run this blueprint with one gunicorn worker;
    # more are harmless (they share the queue) but pointless.
    if CLI:
        return
    from server.utils.telemetry import consume
    gevent.spawn(consume, app)
