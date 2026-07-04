import os

from dotenv import load_dotenv
load_dotenv()


class Config(object):
    DEBUG = False
    TESTING = False

    SECRET_KEY = os.environ.get('SECRET_KEY', '51f52814-0071-11e6-a247-000ec6c2372c')

    ALLOWED_EXTENSIONS = {'csv', 'tsv'}
    ALLOWED_MODELS = {'text_classification', 'named_entity_recognition', 'natural_language_understanding'}

    # Per-environment settings. Both apps run once per environment, so each
    # gets its own host/port: 'server' is the control plane (app.py) and
    # 'triton' the inference data plane (triton.py); redis_url backs the
    # environment's registry.
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
        }
        for name, server_port, triton_port in (
            ('development', 5001, 5002),
            ('testing', 5003, 5004),
            ('production', 5005, 5006),
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
    
    INFERENCE_API_KEY_NBYTES = int(os.environ.get('INFERENCE_API_KEY_NBYTES', 32))
    INFERENCE_BATCH_SIZE = int(os.environ.get('INFERENCE_BATCH_SIZE', 32))
    INFERENCE_SLEEP = float(os.environ.get('INFERENCE_SLEEP', 0.005))
    INFERENCE_IDLE_TIMEOUT = float(os.environ.get('INFERENCE_IDLE_TIMEOUT', 300))
    INFERENCE_HEARTBEAT_INTERVAL = float(os.environ.get('INFERENCE_HEARTBEAT_INTERVAL', 5))
    INFERENCE_REQUEST_TIMEOUT = float(os.environ.get('INFERENCE_REQUEST_TIMEOUT', 30))
    INFERENCE_POLL_INTERVAL = float(os.environ.get('INFERENCE_POLL_INTERVAL', 0.01))
    INFERENCE_OUTPUT_TTL = int(os.environ.get('INFERENCE_OUTPUT_TTL', 300))
    INFERENCE_START_TTL = int(os.environ.get('INFERENCE_START_TTL', 120))


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
