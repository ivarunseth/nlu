from flask import request, abort, g, current_app

from server.auth import token_auth, token_optional_auth
from server.database import User

from server import db
from . import blueprint


@blueprint.post('/users')
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


@blueprint.get('/users')
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


@blueprint.get('/users/<userId>')
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


@blueprint.post('/users/forgot-password')
def forgot_password():
    """
    Request a password reset.
    Always returns 200 to avoid leaking which emails are registered.
    """
    email = request.form.get('email', '').strip()
    if email:
        user = User.query.filter_by(email=email).first()
        if user:
            # TODO: generate a reset token and send a reset email when email
            # infrastructure is available. For now we silently acknowledge.
            current_app.logger.info('Password reset requested for %s', email)
    return '', 200


@blueprint.put('/users/<userId>')
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
