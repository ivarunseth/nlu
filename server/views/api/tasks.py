from flask import abort, url_for
from celery import states

from ...tasks.request import dispatch

from . import api


@api.get('/status/<taskId>')
def get_status(taskId):
    """
    Return status about an asynchronous task. If this request returns a 202
    status code, it means that task hasn't finished yet. Else, the response
    from the task is returned.
    """
    task = dispatch.AsyncResult(taskId)
    if task.state == states.PENDING:
        abort(404)
    if task.state == states.RECEIVED or task.state == states.STARTED:
        return '', 202, {'Location': url_for('api.tasks.get_status', taskId=taskId)}
    return task.info
