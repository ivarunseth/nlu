from flask_socketio import emit, join_room, leave_room
from flask_socketio.namespace import Namespace

from .auth import verify_token
from .backend import WorkerResult, worker


class Status(Namespace):

    def on_connect(self, auth):
        print(auth)

    def on_disconnect(self):
        pass

    def on_join(self, room):
        join_room(room)

    def on_leave(self, room):
        leave_room(room)

    def on_status(self, data):
        if 'token' not in data:
            return
        if not verify_token(data['token']):
            return
        if not 'task_id' in data:
            return
        task = WorkerResult(data['task_id'], app=worker)
        if task is None:
            return
        emit('status', task.to_dict(), room=task.id, namespace='/status')