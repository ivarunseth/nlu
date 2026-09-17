"""Sign-up, sign-in and session tokens. Owns the `user` table."""

from flask import Blueprint

from server.blueprints import register_error_handlers

blueprint = Blueprint('auth', __name__, url_prefix='/api/auth')
register_error_handlers(blueprint)

from . import users, tokens  # noqa: E402,F401
