# serve.py
from gevent import monkey
monkey.patch_all()

import sys


def create_app():
    """Control-plane app for the ``flask`` CLI.

    The CLI discovers this factory in app.py by name, so `flask db upgrade`
    works with no FLASK_APP set. It returns the Flask app alone: the CLI has
    no use for the Socket.IO server, and only a Flask instance is accepted.
    server/__init__.py skips background-task startup while 'db' is in argv,
    so a migration command does not boot the telemetry consumer.
    """
    from server import create_application_server
    app, _ = create_application_server()
    return app


def main(arg):
    if arg == 'triton':
        from server import create_triton_server
        app = create_triton_server()
        host = app.config.get('HOST', '0.0.0.0')
        port = app.config['ALLOWED_ENVIRONMENTS'][app.config['ENVIRONMENT']]['triton']['port']
        debug = app.config.get('DEBUG', False)
        app.run(host=app.config.get('HOST', '0.0.0.0'), port=port, 
                debug=debug, use_reloader=debug)

    else:
        from server import create_application_server
        app, socketio = create_application_server()
        host = app.config.get('HOST', '0.0.0.0')
        port = app.config['ALLOWED_ENVIRONMENTS'][app.config['ENVIRONMENT']]['server']['port']
        debug = app.config.get('DEBUG', False)
        socketio.run(app, host=host, port=port,
                     debug=debug, use_reloader=debug, log_output=debug)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'api')
