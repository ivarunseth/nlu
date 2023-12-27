import time

from flask import current_app
from werkzeug.utils import secure_filename

def timestamp():
    """Return the current timestamp as an integer."""
    return int(time.time())


def allowed_file(filename):
    filename = secure_filename(filename)
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']


def allowed_language(language):
    return language.lower() in current_app.config['ALLOWED_LANGUAGES']
