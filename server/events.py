import functools

from flask import request, session
from flask_socketio import join_room, leave_room, disconnect, ConnectionRefusedError
from flask_socketio.namespace import Namespace

from .auth import verify_token


def authenticate(f):
    @functools.wraps(f)
    def wrapped(*args, **kwargs):
        if 'token' in session: 
            if verify_token(session['token']):
                return f(*args, **kwargs)
            del session['token']
        disconnect()
    return wrapped


class Event(Namespace):

    def on_connect(self, auth):
        if 'Authorization' in request.headers:
            token = request.headers.get('Authorization').split()[1]
        elif auth and 'token' in auth:
            token = auth['token']
        else:
            raise ConnectionRefusedError('Authorization required')
        if not verify_token(token):
            raise ConnectionRefusedError('token is invalid or expired')
        session['token'] = token

    def on_disconnect(self):
        if 'token' in session:
            del session['token']

    @authenticate
    def on_join(self, room):
        join_room(room)

    @authenticate
    def on_leave(self, room):
        leave_room(room)
