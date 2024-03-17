import eventlet
eventlet.monkey_patch()

from server import create_prediction_server


application = app = create_prediction_server() 

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)