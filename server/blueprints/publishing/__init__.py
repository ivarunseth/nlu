"""
Deployments: publish a trained version into an environment, rotate its
API key, stop it. Owns the `instance` and `environment` tables and is the
only writer of inference routes into the registry (`Instance.start`).
"""

from flask import Blueprint

from server import CLI
from server.blueprints import register_error_handlers

blueprint = Blueprint('publishing', __name__, url_prefix='/api/publishing')
register_error_handlers(blueprint)

from . import instances  # noqa: E402,F401


def init_app(app):
    # Sync the `environments` table to ALLOWED_ENVIRONMENTS. Skipped under
    # the flask CLI, where the table may not exist yet.
    if CLI:
        return
    from server.database import Environment
    with app.app_context():
        Environment.update()
