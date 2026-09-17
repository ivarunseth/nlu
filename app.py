from gevent import monkey
monkey.patch_all()

import sys


def create_app(*names):
    """
    gunicorn / flask-CLI entry: `gunicorn "app:create_app('dataset')"`,
    `flask db upgrade` (which discovers this by name and mounts everything,
    with background work skipped — see server.CLI).
    """
    from server import create_app as factory
    return factory(*names)


def main(names):
    """`python app.py [name ...]` — the named blueprints, default all, on PORT."""
    app = create_app(*names)
    debug = app.config['DEBUG']
    port = app.config['PORT']
    if 'socketio' in app.extensions:
        # The events blueprint is mounted: serve through Socket.IO so the
        # WebSocket upgrade works under the dev server.
        from server import socketio
        socketio.run(app, host='0.0.0.0', port=port,
                     debug=debug, use_reloader=debug, log_output=debug)
    else:
        app.run(host='0.0.0.0', port=port, debug=debug, use_reloader=debug)


if __name__ == '__main__':
    main(sys.argv[1:])
