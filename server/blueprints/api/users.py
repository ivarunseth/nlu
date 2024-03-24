from flask import request, abort, g

from ... import db
from ...auth import token_auth, token_optional_auth
from ...models import User

from . import api


@api.post('/users')
def create_user():
    """
    Register a new user.
    This endpoint is publicly available.
    """
    user = User.create(request.form)
    if User.query.filter_by(email=user.email).first():
        abort(400, 'User %s already exists' % user.email)
    db.session.add(user)
    db.session.commit()
    return user.to_dict(), 201


@api.get('/users')
@token_optional_auth.login_required
def get_users():
    """
    Return list of users.
    This endpoint is publicly available, but if the client has a token it
    should send it.
    """
    users = User.query.order_by(User.updated_at.asc(), User.email.asc())
    if request.args.get('updated_since'):
        users = users.filter(User.updated_at > int(request.args.get('updated_since')))
    return {'users': [user.to_dict() for user in users.all()]}, 200


@api.get('/users/<userId>')
@token_optional_auth.login_required
def get_user(userId):
    """
    Return a user.
    This endpoint is publicly available, but if the client has a token it
    should send it.
    """
    user = User.query.get(userId)
    if user is None:
        abort(404, 'User not found: %s' % userId)
    return user.to_dict(), 200


@api.put('/users/<userId>')
@token_auth.login_required
def edit_user(userId):
    """
    Modify an existing user.
    This endpoint is requires a valid user token.
    Note: users are only allowed to modify themselves.
    """
    user = User.query.get_or_404(userId)
    if user != g.current_user:
        abort(403)
    user.from_dict(request.get_json() or {})
    db.session.add(user)
    db.session.commit()
    return '', 204
