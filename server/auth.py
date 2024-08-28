from flask import g, request, session, current_app
from flask_httpauth import HTTPBasicAuth, HTTPTokenAuth

from jwt import decode, ExpiredSignatureError, InvalidTokenError

from .models import User

from . import db


# Authentication objects for username/password auth, token auth, and a
# token optional auth that is used for open endpoints.
basic_auth = HTTPBasicAuth()
token_auth = HTTPTokenAuth('Bearer')
token_optional_auth = HTTPTokenAuth('Bearer')


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
    if not 'Authorization' in request.headers:
        return False
    token = token or request.headers['Authorization'].split()[1]
    if not token:
        return False
    try:
        data = decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])
    except (ExpiredSignatureError, InvalidTokenError):
        user = User.query.filter_by(token=token).first()
        if user is not None:
            user.token = None
            db.session.commit()
            session.clear()
        return False
    user = User.query.filter_by(id=data['id'], token=token).first()
    if user is None:
        return False
    g.current_user = user
    return True


@token_auth.error_handler
def token_error():
    """Return a 401 error to the client."""
    return {'error': 'Invalid email or password.'}, 401, \
        {'WWW-Authenticate': 'Bearer realm="Authentication Required"'}


@token_optional_auth.verify_token
def verify_optional_token(token):
    """Alternative token authentication that allows anonymous logins."""
    if token == '':
        # no token provided, mark the logged in users as None and continue
        g.current_user = None
        return True
    # but if a token was provided, make sure it is valid
    return verify_token(token)