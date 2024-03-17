import eventlet
eventlet.monkey_patch()

from server import socketio, create_application


application = app = create_application() 

if __name__ == '__main__':
    socketio.run(app, log_output=True)
