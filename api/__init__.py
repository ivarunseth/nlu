import os

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_socketio import SocketIO

from sqlalchemy import MetaData

from celery import Celery

from .config import flask_config


metadata = MetaData(naming_convention={
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s"
})
db = SQLAlchemy(metadata=metadata)
migrate = Migrate()
socketio = SocketIO(cors_allowed_origins="*", engineio_logger=True)


from . import models


def create_application(config_name=os.environ.get('FLASK_ENV', 'development')):
    app = Flask(__name__)
    app.config.from_object(flask_config[config_name])

    db.init_app(app)
    migrate.init_app(app, db, directory='./migrations')
    
    socketio.init_app(app,
                      message_queue=app.config['SOCKETIO_MESSAGE_QUEUE'])
    
    from .events import Training
    socketio.on_namespace(Training('/training'))

    celery = Celery(app.import_name)
    celery.conf.update(app.config['CELERY_CONFIG'])
    
    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)
        def to_dict(self):
            return 
        def send_status(self):
            socketio.emit('status', 
                          {'status': self.AsyncResult(self.request.id).status, 'task_id': self.request.id}, 
                          room=self.request.id, 
                          namespace='/training')
        def before_start(self, *args, **kwargs):
            super().before_start(*args, **kwargs)
            self.send_status()
        def on_success(self, *args, **kwargs):
            super().on_success(*args, **kwargs)
            self.send_status()
        def on_failure(self, *args, **kwargs):
            super().on_failure(*args, **kwargs)
            self.send_status()

    celery.Task = ContextTask

    celery.set_default()

    from .main import main as main_blueprint
    app.register_blueprint(main_blueprint, url_prefix='/api')

    from .blueprints import api as api_blueprint
    app.register_blueprint(api_blueprint, url_prefix='/api')

    return app, celery
