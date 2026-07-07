from flask import Blueprint

triton = Blueprint('triton', __name__)


from . import inference  # noqa: E402,F401


@triton.after_request
def after_request(response):
    headers = {
        'Access-Control-Allow-Origin': "*",
        'Access-Control-Allow-Headers': "Authorization, Content-Type",
        'Access-Control-Allow-Methods': "POST, OPTIONS"
    }
    for key, value in headers.items():
        response.headers[key] = value
    return response


@triton.errorhandler(400)
def bad_request(error):
    return {'error': error.description}, 400


@triton.errorhandler(404)
def not_found(error):
    return {'error': error.description}, 404


@triton.errorhandler(504)
def gateway_timeout(error):
    return {'error': error.description}, 504