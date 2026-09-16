from flask import request, g
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
        if verify_token(token) and self.may_join(room):
            join_room(room)

    @staticmethod
    def may_join(room):
        """
        Task and model rooms are keyed by unguessable ids; a ``user:<id>``
        room is only the caller's own, since it carries their run
        announcements.
        """
        if isinstance(room, str) and room.startswith('user:'):
            return room == f'user:{g.current_user.id}'
        return True

    def on_leave(self, token, room):
        if verify_token(token):
            leave_room(room)
