import os
import sys

from flask import Flask
from flask_session import Session
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_socketio import SocketIO

import sqlite3

from sqlalchemy import MetaData, event
from sqlalchemy.engine import Engine

from redis import StrictRedis

from .config import configs
from .storage import Storage


metadata = MetaData(naming_convention={
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s"
})
db = SQLAlchemy(metadata=metadata)
migrate = Migrate()

@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(connection, *args, **kwargs):
    """
    Tune every SQLite connection opened in this process (the Flask app's
    engine and, in the worker processes, the Celery result backend's engine —
    both point at the same file). WAL lets readers run alongside a writer, and
    a long busy_timeout makes concurrent writers block on the lock instead of
    failing immediately with "database is locked". Applies only to SQLite; a
    Postgres/MySQL backend is left untouched.
    """
    if isinstance(connection, sqlite3.Connection):
        cursor = connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


socketio = SocketIO(cors_allowed_origins='*',
                    channel='socketio', 
                    logger=True,
                    engineio_logger=True)
redis = StrictRedis(host=os.environ.get('REDIS_HOST', 'localhost'), 
                    port=os.environ.get('REDIS_PORT', '6379'), 
                    db=os.environ.get('REDIS_DB', '0'))
store = Storage()


def create_application_server(config_name=os.environ.get('FLASK_ENV', 'development')):
    app = Flask(__name__)
    app.config.from_object(configs[config_name])
    app.config['ENVIRONMENT'] = config_name

    db.init_app(app)
    from . import database

    migrate.init_app(app, db, directory='./migrations')

    Session(app)
    
    socketio.init_app(app, 
                      manage_session=False,
                      message_queue=app.config['SOCKETIO_MESSAGE_QUEUE'])
    
    store.init_app(app)
    
    from .events import Event
    socketio.on_namespace(Event('/'))

    from .views import api as api_bp, before_app_first_request
    app.register_blueprint(api_bp, url_prefix='/api')

    if 'db' not in sys.argv:
        before_app_first_request(app, socketio)

    return app, socketio


def create_triton_server(config_name=os.environ.get('FLASK_ENV', 'production')):
    app = Flask(__name__)
    app.config.from_object(configs[config_name])
    app.config['ENVIRONMENT'] = config_name

    from .views import triton as triton_bp
    app.register_blueprint(triton_bp, url_prefix='/api')

    return app
