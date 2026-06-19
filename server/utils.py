import json
import os
import shutil
import io
import zipfile
import time
from datetime import datetime

from flask import current_app
from werkzeug.utils import secure_filename


def timestamp():
    """Return the current timestamp as an integer."""
    return int(time.time())


def format_timestamp(t, format='%d/%m/%Y - %H:%M:%S'):
    return datetime.strftime(datetime.fromtimestamp(t), format)


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
