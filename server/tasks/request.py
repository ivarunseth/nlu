from io import BytesIO

from flask import g
from werkzeug.exceptions import InternalServerError

from . import api


@api.task
def dispatch(environ):
    from .. import create_application_server
    app, _ = create_application_server()

    if 'wsgi.input' in environ:
        environ['wsgi.input'] = BytesIO(environ['wsgi.input'])

    # Create a request context similar to that of the original request
    # so that the task can have access to flask.g, flask.request, etc.
    with app.request_context(environ):
        # Record the fact that we are running in the Celery worker now
        g.sync = False

        # Run the route function and record the response
        try:
            response = app.full_dispatch_request()
        except:
            # If we are in debug mode we want to see the exception
            # Else, return a 500 error
            if app.debug:
                raise
            response = app.make_response(InternalServerError())
        return (response.get_data(), response.status_code, response.headers)
