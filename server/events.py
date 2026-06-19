from flask import request
from flask_socketio import join_room, leave_room, ConnectionRefusedError
from flask_socketio.namespace import Namespace

from .auth import verify_token, extract_bearer_token_from_headers

class Event(Namespace):

    def on_connect(self, auth):
        token = auth.get('token') if auth else None
        if not token:
            token = extract_bearer_token_from_headers(request.headers)
        if not token:
            raise ConnectionRefusedError('Authorization required')
        if not verify_token(token):
            raise ConnectionRefusedError('token is invalid or expired')

    def on_join(self, token, room):
        if verify_token(token):
            join_room(room)

    def on_leave(self, token, room):
        if verify_token(token):
            leave_room(room)
