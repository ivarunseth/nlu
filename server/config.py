import os

from dotenv import load_dotenv
load_dotenv()


class Config(object):
    # The debug server is opt-in rather than implied by an environment name,
    # so a stack does not run the interactive debugger by accident. app.py
    # also drives its reloader off this flag.
    DEBUG = os.environ.get('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes')
    TESTING = False

    SECRET_KEY = os.environ.get('SECRET_KEY', '51f52814-0071-11e6-a247-000ec6c2372c')

    # Listen port for `python app.py` (containers always bind 5000).
    PORT = int(os.environ.get('PORT', 5000))

    # The URL users reach the UI on. It is the only absolute URL the backend
    # emits: deployment endpoints are PUBLIC_URL/api/inference/<env>/<model>.
    PUBLIC_URL = os.environ.get('PUBLIC_URL', 'http://localhost').rstrip('/')

    ALLOWED_EXTENSIONS = {'csv', 'tsv'}
    ALLOWED_MODELS = {'text_classification', 'named_entity_recognition', 'natural_language_understanding'}

    # The inference environments. Each has its own route registry (a Redis
    # URL), its own serving queue of the same name, and its own API-key TTL.
    # No HTTP process "serves" an environment: the inference blueprint reads
    # it from the request path, and serving workers from their queue.
    ALLOWED_ENVIRONMENTS = {
        name: {
            'redis_url': os.environ.get(f'REDIS_URL_{name.upper()}', 'redis://localhost:6379/0'),
            'token_ttl': int(os.environ.get(f'INFERENCE_API_KEY_TTL_{name.upper()}', token_ttl)),
        }
        for name, token_ttl in (
            ('testing', 12 * 60 * 60),
            ('production', 30 * 24 * 60 * 60),
        )
    }

    SESSION_TYPE = os.environ.get('SESSION_TYPE', 'filesystem')

    SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///indicnlu.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = os.environ.get('SQLALCHEMY_TRACK_MODIFICATIONS', False)

    SOCKETIO_MESSAGE_QUEUE = os.environ.get('SOCKETIO_MESSAGE_QUEUE', os.environ.get('CELERY_BROKER_URL', 'redis://'))

    STORAGE_PROVIDER = os.environ.get('STORAGE_PROVIDER', 'local')
    STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET', 'data')

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

    # Long-running views run in the request worker (server.blueprints.apply_async).
    # Their results are HTTP responses fetched once, so they live in Redis with
    # a TTL rather than in the database next to training/serving history.
    REQUEST_RESULT_BACKEND = os.environ.get('REQUEST_RESULT_BACKEND', 'redis://localhost:6379/1')
    REQUEST_RESULT_TTL = int(os.environ.get('REQUEST_RESULT_TTL', 3600))
    # The request worker holds no TensorFlow, so its children can be reused
    # (the training/serving workers must not: one task per process there).
    REQUEST_MAX_TASKS_PER_CHILD = int(os.environ.get('REQUEST_MAX_TASKS_PER_CHILD', 50))
