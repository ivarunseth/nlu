from functools import wraps


from flask import g, request, url_for
from celery import states

from ..tasks.request import dispatch


def apply_async(f):
    """
    This decorator transforms a sync route to asynchronous by running it
    in a background thread.
    """
    @wraps(f)
    def route(*args, **kwargs):
        # If we are already running the request on the celery side, then we
        # just call the wrapped view to allow the request to execute.
        if not getattr(g, 'sync', True):
            return f(*args, **kwargs)

        # If we are on the Flask side, we need to launch the Celery task,
        # passing the request environment, which will be used to reconstruct
        # the request object. The request body has to be handled as a special
        # case, since WSGI requires it to be provided as a file-like object.
        environ = {k: v for k, v in request.environ.items()
                   if isinstance(v, (str, bytes))}
        
        if 'wsgi.input' in request.environ:
            environ['wsgi.input'] = request.get_data()
        
        t = dispatch.apply_async(args=(environ,))

        # Return a 202 response, with a link that the client can use to
        # obtain task status that is based on the Celery task id.
        if t.state == states.PENDING or t.state == states.RECEIVED or \
                t.state == states.STARTED:
            return '', 202, {'Location': url_for('api.tasks.get_status', taskId=t.id)}

        # If the task already finished, return its return value as response.
        # This would be the case when CELERY_ALWAYS_EAGER is set to True.
        return t.info
    return route
