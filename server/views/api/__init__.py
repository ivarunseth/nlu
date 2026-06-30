"""
Control-plane blueprint: model management, training, publishing, auth, stats.

Registered by ``server.create_application`` under ``/api``. Prediction lives in
the sibling ``inference`` blueprint, served by ``server.create_inference_server``.
"""

from flask import Flask, Blueprint

api = Blueprint('api', __name__)


from . import instances, users, tokens, models, labels, utterances, trainings  # noqa: E402,F401

from ...utils import add_request, requests_per_second  # noqa: E402


request_stats = []


def before_app_first_request(app: Flask):
    with app.app_context():
        if app.testing:
            return

        from ...database import Environment
        Environment.update()


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


@api.errorhandler(500)
def internal_server_error(error):
    return {'error': error.description}, 500
