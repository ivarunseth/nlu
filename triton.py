"""
Entrypoint for the inference data plane — one process per environment.

The request handler waits on Redis for its prediction, so the server must hold
many concurrent waiters cheaply. gevent's monkey-patching turns those blocking
waits into cooperative yields.

    FLASK_ENV=production python inference.py

In production, prefer a gevent WSGI server::

    FLASK_ENV=production gunicorn -k gevent -w 4 inference:application
"""

from gevent import monkey
monkey.patch_all()


from server import create_triton_server  # noqa: E402


application = app = create_triton_server()


if __name__ == '__main__':
    host = app.config.get('HOST', '0.0.0.0')
    port = app.config.get('INFERENCE_PORT', 5002)

    app.run(host=host, port=port, debug=True, use_reloader=True)
