"""
Prediction. The one blueprint that never queries the database: it reads the
deployment's route from the environment's registry (Redis), hands inputs
to the serving worker over Redis, and pushes telemetry for `analytics` to
persist. CORS is open because deployments are called from anywhere with an
API key.
"""

from flask import Blueprint
from flask_cors import CORS

from server.blueprints import register_error_handlers

blueprint = Blueprint('inference', __name__, url_prefix='/api/inference')
register_error_handlers(blueprint)
CORS(blueprint, origins='*', methods=['POST', 'OPTIONS'],
     allow_headers=['Authorization', 'Content-Type'], send_wildcard=True)

from . import inference  # noqa: E402,F401
