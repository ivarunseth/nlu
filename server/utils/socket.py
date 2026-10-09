"""
Write-only Socket.IO handle for every process that is not the `events`
server (route handlers in other blueprints, Celery tasks).

Flask-SocketIO lets a process that hosts no Socket.IO server still emit:
a ``SocketIO`` built with ``message_queue`` and no app publishes to the
Redis channel the server subscribes to. One such instance per process is
enough, and it must be built lazily — prefork workers fork after import,
and an instance created before the fork would share its Redis connection
across children.
"""

from flask_socketio import SocketIO

from ..config import Config

_emitter = None


def emitter() -> SocketIO:
    global _emitter
    if _emitter is None:
        _emitter = SocketIO(
            app=None,
            message_queue=Config.SOCKETIO_MESSAGE_QUEUE,
            channel='socketio',
            async_mode='threading',
            logger=False,
            engineio_logger=False,
        )
    return _emitter


def emit(event, payload, room, namespace='/'):
    emitter().emit(event, payload, room=room, namespace=namespace)
