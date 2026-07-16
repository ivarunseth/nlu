"""
Control-plane blueprint: model management, training, publishing, auth, stats.

Registered by ``server.create_application`` under ``/api``. Prediction lives in
the sibling ``inference`` blueprint, served by ``server.create_inference_server``.
"""


from flask import Flask, Blueprint
from flask_socketio import SocketIO

api = Blueprint('api', __name__)


from . import instances, users, tokens, models, intents, entities, slots, values, utterances, tags, trainings, analytics  # noqa: E402,F401

from ...utils.common import add_request, requests_per_second  # noqa: E402


request_stats = []


def before_app_first_request(app: Flask, socketio: SocketIO):
    with app.app_context():
        from ...database import Environment
        Environment.update()

    from ...utils.telemetry import consume
    socketio.start_background_task(consume, app)


@api.before_app_request
def before_request():
    """Update requests per second stats."""
    add_request(request_stats)


@api.get('/stats')
def get_stats():
    return {'requests_per_second': requests_per_second(request_stats)}


@api.errorhandler(400)
def bad_request(error):
    return {'error': error.description}, 400


@api.errorhandler(404)
def not_found_error(error):
    return {'error': error.description}, 404


@api.errorhandler(409)
def conflict_error(error):
    # Surfaced conflicts the client resolves explicitly — e.g. reassigning
    # an utterance to an intent that lacks one of its spans' slots (IN-5).
    return {'error': error.description}, 409


@api.errorhandler(500)
def internal_server_error(error):
    return {'error': error.description}, 500
