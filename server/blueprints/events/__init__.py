"""
The Socket.IO server — the only process that hosts /socket.io. Every other
process emits through the Redis message queue (server.utils.socket), and
this one fans those messages out to the browsers in the right rooms.

Long-polling needs a client's requests to keep hitting one process, so run
exactly one gunicorn worker for this blueprint.
"""

from server import socketio
from .namespace import Event

blueprint = None


def init_app(app):
    socketio.init_app(app,
                      manage_session=False,
                      message_queue=app.config['SOCKETIO_MESSAGE_QUEUE'])
    socketio.on_namespace(Event('/'))
