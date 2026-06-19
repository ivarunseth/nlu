from flask import g, request, session, current_app
from flask_httpauth import HTTPBasicAuth, HTTPTokenAuth

from jwt import decode, ExpiredSignatureError, InvalidTokenError

from .database import User

from . import db


# Authentication objects for username/password auth, token auth, and a
# token optional auth that is used for open endpoints.
basic_auth = HTTPBasicAuth()
token_auth = HTTPTokenAuth('Bearer')
token_optional_auth = HTTPTokenAuth('Bearer')


def extract_bearer_token_from_headers(headers):
    authorization = headers.get('Authorization') if headers else None
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != 'bearer':
        return None
    return token.strip() or None


def _invalidate_token(token):
    user = User.query.filter_by(token=token).first()
    if user is not None:
        user.token = None
        db.session.commit()
        session.clear()


def validate_token(token):
    if not token:
        return False
    try:
        data = decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])
    except (ExpiredSignatureError, InvalidTokenError):
        _invalidate_token(token)
        return False
    user = User.query.filter_by(id=data['id'], token=token).first()
    if user is None:
        return False
    g.current_user = user
    return True


@basic_auth.verify_password
def verify_password(email, password):
    """Password verification callback."""
    if not email or not password:
        return False
    user = User.query.filter_by(email=email).first()
    if user is None or not user.verify_password(password):
        return False
    g.current_user = user
    return True


@basic_auth.error_handler
def password_error():
    """Return a 401 error to the client."""
    # To avoid login prompts in the browser, use the "Bearer" realm.
    return {'error': 'Invalid email or password.'}, 401, \
        {'WWW-Authenticate': 'Bearer realm="Authentication Required"'}


@token_auth.verify_token
def verify_token(token):
    """Token verification callback."""
    token = token or extract_bearer_token_from_headers(request.headers)
    return validate_token(token)


@token_auth.error_handler
def token_error():
    """Return a 401 error to the client."""
    return {'error': 'Invalid email or password.'}, 401, \
        {'WWW-Authenticate': 'Bearer realm="Authentication Required"'}


@token_optional_auth.verify_token
def verify_optional_token(token):
    """Alternative token authentication that allows anonymous logins."""
    if not token:
        # no token provided, mark the logged in users as None and continue
        g.current_user = None
        return True
    # but if a token was provided, make sure it is valid
    return validate_token(token)
