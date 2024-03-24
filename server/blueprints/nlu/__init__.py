from flask import Blueprint

nlu = Blueprint('nlu', __name__)


from . import prediction #noqa

from ...utils import add_request, requests_per_second


request_stats = []


@nlu.before_app_request
def before_request():
    """Update requests per second stats."""
    add_request(request_stats)


@nlu.get('/stats')
def get_stats():
    return {'requests_per_second': requests_per_second(request_stats)}


@nlu.errorhandler(400)
def bad_request(error):
    return {'error': error.description}, 400


@nlu.errorhandler(404)
def not_found_error(error):
    return {'error': error.description}, 404


@nlu.errorhandler(500)
def internal_server_error(error):
    return {'error', error.description}, 500
