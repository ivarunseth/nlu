import os


class Config(object):
    DEBUG = False
    TESTING = False
    ALLOWED_EXTENSIONS = {'csv', 'tsv'}
    MODELS_DIRECTORY = os.path.join(os.getcwd(), 'data', 'models')
    SECRET_KEY = os.environ.get('SECRET_KEY', '51f52814-0071-11e6-a247-000ec6c2372c')
    SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///indicnlu.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = os.environ.get('SQLALCHEMY_TRACK_MODIFICATIONS', False)
    SOCKETIO_MESSAGE_QUEUE = os.environ.get('SOCKETIO_MESSAGE_QUEUE', os.environ.get('CELERY_BROKER_URL', 'redis://'))
    REQUEST_STATS_WINDOW = 15


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    pass


class TestingConfig(Config):
    TESTING = True
    SERVER_NAME = 'localhost'
    CELERY_CONFIG = {'task_always_eager': True}


flask_config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig
}
