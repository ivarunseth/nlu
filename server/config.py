import os


class Config(object):
    DEBUG = False
    TESTING = False

    SECRET_KEY = os.environ.get('SECRET_KEY', '51f52814-0071-11e6-a247-000ec6c2372c')

    ALLOWED_EXTENSIONS = {'csv', 'tsv'}
    ALLOWED_MODELS = {'text_classification', 'named_entity_recognition', 'natural_language_understanding'}
    ALLOWED_ENVIRONMENTS = {'development', 'testing', 'production'}
    
    SESSION_TYPE = os.environ.get('SESSION_TYPE', 'filesystem')

    SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///indicnlu.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = os.environ.get('SQLALCHEMY_TRACK_MODIFICATIONS', False)

    SOCKETIO_MESSAGE_QUEUE = os.environ.get('SOCKETIO_MESSAGE_QUEUE', os.environ.get('CELERY_BROKER_URL', 'redis://'))

    STORAGE_PROVIDER = os.environ.get('STORAGE_PROVIDER', 'local')
    STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET', 'data')

    REQUEST_STATS_WINDOW = 15
    TOKEN_EXPIRY = 720


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    pass


class TestingConfig(Config):
    TESTING = True
    SERVER_NAME = 'localhost'


flask_config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig
}
