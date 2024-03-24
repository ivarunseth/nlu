import eventlet
eventlet.monkey_patch()

from server import create_application


application, socketio = app, socket = create_application() 

if __name__ == '__main__':
    socket.run(app, log_output=True)
