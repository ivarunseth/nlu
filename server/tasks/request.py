from io import BytesIO

from flask import g
from werkzeug.exceptions import InternalServerError

from . import api


@api.task
def dispatch(environ: dict):
    from .. import create_application_server
    app, _ = create_application_server()

    if '_wsgi.input' in environ:
        environ['wsgi.input'] = BytesIO(environ.pop('_wsgi.input'))

    with app.request_context(environ):
        g.sync = False

        try:
            response = app.full_dispatch_request()
        except:
            if app.debug:
                raise
            response = app.make_response(InternalServerError())

        return (response.get_data(), response.status_code, response.headers)
