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
        if not getattr(g, 'sync', True):
            return f(*args, **kwargs)

        environ = {k: v for k, v in request.environ.items() if isinstance(v, (str, bytes))}
        
        if 'wsgi.input' in request.environ:
            environ['_wsgi.input'] = request.get_data()
        
        t = dispatch.apply_async(args=(environ,))

        if t.state in {states.PENDING, states.RECEIVED, states.STARTED}:
            return {'task_id': t.id, 'status': t.state}, 202, \
                {'Location': url_for('api.tasks.get_status', taskId=t.id)}
        
        return t.info
    return route
