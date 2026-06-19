from gevent import monkey
monkey.patch_all()

from server import create_application


application, socketio = app, socket = create_application() 


if __name__ == '__main__':
    host=app.config.get('HOST', '0.0.0.0')
    port=app.config.get('PORT', 5001)
    debug=app.config.get('DEBUG', False)
    use_reloader=app.config.get('DEBUG', False)
    log_output=app.config.get('DEBUG', False)

    socket.run(app, host=host, port=port, debug=debug, \
               use_reloader=use_reloader, log_output=log_output)
