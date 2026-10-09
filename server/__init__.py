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

from .config import Config
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


# True under the `flask` CLI (`flask db upgrade`): blueprints skip their
# background work then, so a migration command boots nothing.
CLI = 'db' in sys.argv


def create_app(*names, init=True):
    """
    The Flask app for the given blueprints (default: all of them).

    One process, any subset: `python app.py` mounts everything for local
    development; each container mounts exactly one. Blueprint packages that
    define ``init_app`` get it called here, after registration — unless
    ``init`` is false, which is how the request worker replays a view
    without also starting that blueprint's background work.
    """
    from . import blueprints

    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)
    from . import database  # noqa: F401 — registers the models
    migrate.init_app(app, db, directory='./migrations')

    Session(app)
    store.init_app(app)

    for name in names or blueprints.NAMES:
        package = blueprints.load(name)
        if package.blueprint is not None:
            app.register_blueprint(package.blueprint)
        init_app = getattr(package, 'init_app', None)
        if init and init_app is not None:
            init_app(app)

    return app
