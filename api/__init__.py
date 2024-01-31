import os

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_socketio import SocketIO

from sqlalchemy import MetaData

from redis import StrictRedis

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
socketio = SocketIO(cors_allowed_origins='*',
                    channel='socketio', 
                    logger=False,
                    engineio_logger=True)
redis = StrictRedis(host=os.environ.get('REDIS_HOST', 'localhost'), 
                    port=os.environ.get('REDIS_POST', '6379'), 
                    db=os.environ.get('REDIS_DB', '0'))


from . import models


def create_application(config_name=os.environ.get('FLASK_ENV', 'development')):
    app = Flask(__name__)
    app.config.from_object(flask_config[config_name])

    db.init_app(app)
    migrate.init_app(app, db, directory='./migrations')
    
    socketio.init_app(app, message_queue=app.config['SOCKETIO_MESSAGE_QUEUE'])
    
    from .events import Status
    socketio.on_namespace(Status('/status'))

    from .main import main as main_blueprint
    app.register_blueprint(main_blueprint, url_prefix='/api')

    from .blueprints import api as api_blueprint
    app.register_blueprint(api_blueprint, url_prefix='/api')

    return app
