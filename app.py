import eventlet
eventlet.monkey_patch()

from api import socketio, create_application

# Create an application instance that web servers can use. We store it as
# "application" (the wsgi default) and also the much shorter and convenient
# "app".
application = app = create_application() 

if __name__ == '__main__':
    socketio.run(app, log_output=True)
