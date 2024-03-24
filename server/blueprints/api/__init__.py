from flask import Blueprint

api = Blueprint('api', __name__)


from . import users, tokens, models, labels, utterances, trainings # noqa

from ...utils import add_request, requests_per_second


request_stats = []


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
    return {'error', error.description}, 500
