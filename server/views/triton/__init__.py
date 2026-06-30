"""
Data-plane blueprint: the single, environment-agnostic prediction endpoint.

Registered by ``server.create_inference_server`` under ``/api``. The request
hot path reads everything from Redis (the instance registry) and never touches
the control-plane database.
"""

from flask import Blueprint

triton = Blueprint('triton', __name__)


from . import inference  # noqa: E402,F401
