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
