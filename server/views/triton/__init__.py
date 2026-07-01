from flask import Blueprint

triton = Blueprint('triton', __name__)


from . import inference  # noqa: E402,F401
