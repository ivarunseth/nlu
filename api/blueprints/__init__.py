from flask import Blueprint

api = Blueprint('api', __name__)

from . import users, tokens, models, labels, utterances, trainings, prediction # noqa


@api.errorhandler(400)
def bad_request(error):
    return {'error': error.description}, 400


@api.errorhandler(404)
def not_found_error(error):
    return {'error': error.description}, 404


@api.errorhandler(500)
def internal_server_error(error):
    return {'error', error.description}, 500
