from flask import request
from flask_socketio import emit, join_room, leave_room, ConnectionRefusedError
from flask_socketio.namespace import Namespace

from celery.result import AsyncResult

from .auth import verify_token
from .backend import worker


class Status(Namespace):

    def on_connect(self, auth):
        if 'Authorization' in request.headers:
            token = request.headers.get('Authorization').split()[1]
        elif auth and 'token' in auth:
            token = auth.get('token')
        else:
            raise ConnectionRefusedError('Authorization required')
        if not verify_token(token):
            raise ConnectionRefusedError('token is invalid or expired')

    def on_disconnect(self):
        pass

    def on_join(self, room):
        join_room(room)

    def on_leave(self, room):
        leave_room(room)

    def on_status(self, data):
        if not 'task_id' in data:
            return
        task = AsyncResult(data['task_id'], app=worker)
        if task is None:
            return
        emit('status', {'status': task.status, 'task_id': task.id}, room=task.id, namespace='/status')
