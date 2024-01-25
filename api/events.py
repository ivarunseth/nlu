from flask import g
from flask_socketio import emit, join_room, leave_room
from flask_socketio.namespace import Namespace

from .auth import verify_token


class Training(Namespace):

    def on_connect(self):
        pass

    def on_disconnect(self):
        pass

    def on_join(self, room):
        join_room(room)

    def on_leave(self, room):
        leave_room(room)

    def on_status(self, data):
        if not verify_token(data['token']):
            return
        model = g.current_user.models.filter_by(id=data['model_id']).first()
        if model is None:
            return
        training = model.trainings.filter_by(task_id=data['task_id']).first()
        if training is None:
            return
        emit('status', {'status': training.task.status, 'task_id': training.task_id}, room=training.task_id, namespace='/training')