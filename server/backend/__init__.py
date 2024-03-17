import os

from datetime import timezone

from kombu import Queue, Exchange

from celery import Celery, Task
from celery.exceptions import Ignore
from celery.result import AsyncResult

from flask_socketio import SocketIO

from redis.lock import Lock
from redis.exceptions import LockError

from .. import redis


class WorkerConfig(object):
    
    broker_url = os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    broker_connection_retry_on_startup = True
    result_backend = os.environ.get('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')
    result_extended = True
    result_persistent = True
    include = ['server.backend.tasks.training', 'server.backend.tasks.prediction']
    task_routes = {
        'server.backend.tasks.training.*': {
            'queue': 'training',
            'routing': 'training'
        },
        'server.backend.tasks.prediction.*': {
            'queue': 'prediction',
            'routing_key': 'prediction'
        }
    }
    task_queues = (
        Queue('training', Exchange('training', type='direct'), routing_key='training', durable=True),
        Queue('prediction', Exchange('prediction', type='direct'), routing_key='prediction', durable=True)
    )
    accept_content = ['json', 'application/json']
    task_serializer = 'json'
    result_serializer = 'json'
    worker_deduplicate_successful_tasks = True
    worker_prefetch_multiplier = 1
    worker_max_tasks_per_child = 1
    worker_send_task_events = True
    task_track_started = True
    task_acks_late = True
    task_acks_on_failure_or_timeout = True
    task_reject_on_worker_lost = True
    task_default_routing_key = 'training'
    task_default_exchange = 'training'
    task_default_queue = 'training'


class WorkerResult(AsyncResult):

    def is_aborted(self):
        return self.state == 'ABORTED'
    
    def abort(self):
        self.backend.store_result(
            self.id,
            state='ABORTED',
            result=None,
            traceback=None)
        
    def to_dict(self, extended=False):
        task_dict = {
            'task_id': self.task_id,
            'name': self.name,
            'status': self.status,
            'worker': self.worker,
            'children': self.children,
            'date_done': self.date_done.replace(tzinfo=timezone.utc).astimezone(tz=None).strftime('%d/%m/%Y - %H:%M:%S') if self.date_done else None,
            'retries': self.retries,
            'queue': self.queue,
            'traceback': self.traceback
        }
        if extended:
            task_dict.update({
                'args': self.args,
                'kwargs': self.kwargs,
                'result': self.backend.prepare_exception(self.result) if self.failed() else self.result
            })
        return task_dict


class WorkerTask(Task):
    
    abstract = True
    lock_key = 'celery-task-lock-{}'

    def AsyncResult(self, task_id):
        return WorkerResult(task_id, backend=self.backend)
    
    def is_aborted(self, **kwargs):
        task_id = kwargs.get('task_id', self.request.id)
        result = self.AsyncResult(task_id)
        if not isinstance(result, WorkerResult):
            return False
        return result.is_aborted()

    def push_status(self):
        status = {'status': self.AsyncResult(self.request.id).status, 'task_id': self.request.id}
        self.socketio.emit('status', status, room=self.request.id, namespace='/status')

    def before_start(self, *args, **kwargs):
        self.socketio = SocketIO(
            app=None,
            cors_allowed_origins='*',
            channel='socketio',
            message_queue=os.environ.get('SOCKETIO_MESSAGE_QUEUE', 'redis://'),
            async_mode='threading',
            logger=False,  
            engineio_logger=False)
        super().before_start(*args, **kwargs)
        self.push_status()
    
    def on_success(self, *args, **kwargs):
        super().on_success(*args, **kwargs)
        self.push_status()
    
    def on_failure(self, *args, **kwargs):
        super().on_failure(*args, **kwargs)
        self.push_status()

    def update_state(self, *args, **kwargs):
        super().update_state(*args, **kwargs)
        self.push_status()

    def __call__(self, *args, **kwargs):
        try:
            lock = Lock(redis, self.lock_key.format(self.request.id), blocking=False)
            acquired = lock.acquire()
            if not acquired:
                raise LockError('Task is already running in another worker')
            return self.run(*args, **kwargs)
        except LockError:
            raise Ignore
        except:
            raise
        finally:
            if acquired:
                lock.release()


def create_worker():

    worker = Celery(__name__)

    worker.config_from_object(WorkerConfig)

    worker.Task = WorkerTask

    return worker


worker = create_worker()
