import os

import time
import datetime

import io

import zipfile

from flask import current_app
from werkzeug.utils import secure_filename

from jwt import encode, decode, InvalidTokenError


def timestamp():
    """Return the current timestamp as an integer."""
    return int(time.time())


def format_timestamp(t, format='%d/%m/%Y - %H:%M:%S'):
    return datetime.datetime.strftime(datetime.datetime.fromtimestamp(t), format)


def generate_api_key(model_id, environment):
    """Mint a signed inference API key scoped to one deployment.

    The key is a JWT carrying the deployment's model and environment plus
    an expiry drawn from the environment's ``token_ttl``, so the inference
    server can reject stale or foreign keys without a database.
    """
    ttl = current_app.config['ALLOWED_ENVIRONMENTS'][environment]['token_ttl']
    now = timestamp()
    return encode(
        {'model_id': model_id, 'environment': environment, 'iat': now, 'exp': now + ttl},
        current_app.config['SECRET_KEY'],
        algorithm='HS256',
    )


def api_key_expiry(api_key):
    """The unix expiry an API key carries, or None if it is not a JWT."""
    if not api_key:
        return None
    try:
        return decode(api_key, options={'verify_signature': False}).get('exp')
    except InvalidTokenError:
        return None


def add_request(request_stats):
    t = timestamp()
    while len(request_stats) > 0 and \
            request_stats[0] < t - current_app.config['REQUEST_STATS_WINDOW']:
        del request_stats[0]
    request_stats.append(t)


def requests_per_second(request_stats):
    return len(request_stats) / current_app.config['REQUEST_STATS_WINDOW']


def allowed_file(filename):
    filename = secure_filename(filename)
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']


def zip_file(path):
    zipFile = io.BytesIO()
    with zipfile.ZipFile(zipFile, 'w', zipfile.ZIP_DEFLATED) as f:
        for root, dirs, files in os.walk(path):
            for file in files:
                f.write(os.path.join(root, file), \
                        os.path.relpath(os.path.join(root, file), path))
    zipFile.seek(0)
    return zipFile
