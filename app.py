from gevent import monkey
monkey.patch_all()

from server import create_application_server


application, socketio = app, socket = create_application_server() 


if __name__ == '__main__':
    host=app.config.get('HOST', '0.0.0.0')
    # One control-plane process per environment, each on its own port.
    port=app.config['ALLOWED_ENVIRONMENTS'][app.config['ENVIRONMENT']]['server']['port']
    debug=app.config.get('DEBUG', False)
    use_reloader=app.config.get('DEBUG', False)
    log_output=app.config.get('DEBUG', False)

    socket.run(app, host=host, port=port, debug=debug, \
               use_reloader=use_reloader, log_output=log_output)
    