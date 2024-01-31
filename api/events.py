from flask_socketio import emit, join_room, leave_room
from flask_socketio.namespace import Namespace

from celery.result import AsyncResult

from .auth import verify_token
from .backend import worker


class Status(Namespace):

    def on_connect(self):
        pass

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