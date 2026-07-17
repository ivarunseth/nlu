import os

from dotenv import load_dotenv
load_dotenv()


class Config(object):
    DEBUG = False
    TESTING = False

    SECRET_KEY = os.environ.get('SECRET_KEY', '51f52814-0071-11e6-a247-000ec6c2372c')

    ALLOWED_EXTENSIONS = {'csv', 'tsv'}
    ALLOWED_MODELS = {'text_classification', 'named_entity_recognition', 'natural_language_understanding'}

    ALLOWED_ENVIRONMENTS = {
        name: {
            'server': {
                'host': os.environ.get(f'SERVER_HOST_{name.upper()}',
                                       os.environ.get('SERVER_HOST', 'http://localhost')),
                'port': int(os.environ.get(f'SERVER_PORT_{name.upper()}', server_port)),
            },
            'triton': {
                'host': os.environ.get(f'INFERENCE_HOST_{name.upper()}',
                                       os.environ.get('INFERENCE_HOST', 'http://localhost')),
                'port': int(os.environ.get(f'INFERENCE_PORT_{name.upper()}', triton_port)),
            },
            'redis_url': os.environ.get(f'REDIS_URL_{name.upper()}', 'redis://localhost:6379/0'),
            'token_ttl': int(os.environ.get(f'INFERENCE_API_KEY_TTL_{name.upper()}', token_ttl)),
        }
        for name, server_port, triton_port, token_ttl in (
            ('development', 5001, 5002, 2 * 60 * 60),
            ('testing', 5003, 5004, 12 * 60 * 60),
            ('production', 5005, 5006, 30 * 24 * 60 * 60),
        )
    }
    
    SESSION_TYPE = os.environ.get('SESSION_TYPE', 'filesystem')

    SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///indicnlu.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = os.environ.get('SQLALCHEMY_TRACK_MODIFICATIONS', False)

    SOCKETIO_MESSAGE_QUEUE = os.environ.get('SOCKETIO_MESSAGE_QUEUE', os.environ.get('CELERY_BROKER_URL', 'redis://'))

    STORAGE_PROVIDER = os.environ.get('STORAGE_PROVIDER', 'local')
    STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET', 'data')

    REQUEST_STATS_WINDOW = 15
    TOKEN_EXPIRY = 720
    
    INFERENCE_BATCH_SIZE = int(os.environ.get('INFERENCE_BATCH_SIZE', 32))
    INFERENCE_SLEEP = float(os.environ.get('INFERENCE_SLEEP', 0.005))
    INFERENCE_IDLE_TIMEOUT = float(os.environ.get('INFERENCE_IDLE_TIMEOUT', 300))
    INFERENCE_HEARTBEAT_INTERVAL = float(os.environ.get('INFERENCE_HEARTBEAT_INTERVAL', 5))
    INFERENCE_REQUEST_TIMEOUT = float(os.environ.get('INFERENCE_REQUEST_TIMEOUT', 30))
    INFERENCE_POLL_INTERVAL = float(os.environ.get('INFERENCE_POLL_INTERVAL', 0.01))
    INFERENCE_OUTPUT_TTL = int(os.environ.get('INFERENCE_OUTPUT_TTL', 300))
    INFERENCE_START_TTL = int(os.environ.get('INFERENCE_START_TTL', 120))
    INFERENCE_MAX_BATCH = int(os.environ.get('INFERENCE_MAX_BATCH', 256))
    INFERENCE_BATCH_TIMEOUT = float(os.environ.get('INFERENCE_BATCH_TIMEOUT', 120))

    AUGMENT_ENABLED = os.environ.get('AUGMENT_ENABLED', 'true').lower() in ('1', 'true', 'yes')
    AUGMENT_UNK_TOKEN = os.environ.get('AUGMENT_UNK_TOKEN', '[UNK]')

    TELEMETRY_BATCH_SIZE = int(os.environ.get('TELEMETRY_BATCH_SIZE', 100))
    TELEMETRY_INTERVAL = float(os.environ.get('TELEMETRY_INTERVAL', 1.0))
    TELEMETRY_RETENTION_DAYS = int(os.environ.get('TELEMETRY_RETENTION_DAYS', 30))

    DATASET_IO_BATCH_SIZE = int(os.environ.get('DATASET_IO_BATCH_SIZE', 5000))


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    pass


class TestingConfig(Config):
    TESTING = True
    SERVER_NAME = 'localhost'


configs = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig
}
