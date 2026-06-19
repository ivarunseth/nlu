from flask import g, session

from ..auth import basic_auth, token_auth

from .. import db
from . import api


@api.post('/tokens')
@basic_auth.login_required
def create_token():
    """
    Request a user token.
    This endpoint is requires basic auth with nickname and password.
    """
    if g.current_user.token is None:
        g.current_user.generate_token()
        db.session.commit()
    return g.current_user.to_dict(), 200


@api.delete('/tokens')
@token_auth.login_required
def delete_token():
    """
    Revoke a user token.
    This endpoint is requires a valid user token.
    """
    g.current_user.token = None
    db.session.commit()
    session.clear()
    return '', 204
