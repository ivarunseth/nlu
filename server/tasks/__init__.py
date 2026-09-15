import os

from datetime import timezone

from kombu import Queue, Exchange
from kombu.utils.encoding import ensure_bytes

from celery import Celery, Task, states
from celery.backends.database import session_cleanup
from celery.exceptions import Ignore, Reject
from celery.result import AsyncResult
from celery.signals import worker_shutting_down

from flask_socketio import SocketIO

from redis.lock import Lock
from redis.exceptions import LockError

from .. import redis


shutting_down = False
MISSING = object()


class TaskAbortedError(Exception):
    pass


class WorkerShutdownError(Exception):
    pass


class WorkerConfig(object):

    broker_url = os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    broker_connection_retry_on_startup = True
    result_backend = os.environ.get(
        'CELERY_RESULT_BACKEND',
        f"db+{os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///instance/indicnlu.db')}"
    )
    database_table_names = {
        'task': 'taskmeta',
        'group': 'tasksetmeta',
    }
    result_extended = True
    result_persistent = True
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
    task_default_exchange = 'default'


class WorkerResult(AsyncResult):

    def is_aborted(self):
        return self.state == 'ABORTED'
    
    def update_state(self, state, result=MISSING, traceback=MISSING, **metadata):
        meta = dict(self._get_task_meta())
        meta.update(metadata)
        meta['status'] = state
        if result is not MISSING:
            meta['result'] = self.backend.encode_result(result, state)
        if traceback is not MISSING:
            meta['traceback'] = traceback
        meta['date_done'] = self.app.now() if state in states.READY_STATES or state == 'ABORTED' else None

        session = self.backend.ResultSession()
        with session_cleanup(session):
            task = session.query(self.backend.task_cls).filter(
                self.backend.task_cls.task_id == self.id
            ).first()
            if not task:
                task = self.backend.task_cls(self.id)
                task.task_id = self.id
                session.add(task)

            columns = [
                column.name for column in self.backend.task_cls.__table__.columns
                if column.name not in {'id', 'task_id'}
            ]
            for column in columns:
                value = meta.get(column)
                if column in {'args', 'kwargs'} and value is not None:
                    value = ensure_bytes(self.backend.encode(value))
                setattr(task, column, value)
            session.commit()
        self._cache = None

    def abort(self, result=MISSING):
        self.update_state('ABORTED', result=result)

    def revoke(self, *args, **kwargs):
        super().revoke(*args, **kwargs)
        self.update_state(states.REVOKED, result=None, traceback=None)
        
    def to_dict(self, extended=False):
        result = self.result
        if isinstance(result, Exception):
            result = self.backend.prepare_exception(result)
        status = self.status
        date_done = self.date_done if status in states.READY_STATES or status == 'ABORTED' else None

        task_dict = {
            'task_id': self.task_id,
            'name': self.name,
            'status': status,
            'worker': self.worker,
            'children': self.children,
            'date_done': date_done.replace(tzinfo=timezone.utc).astimezone(tz=None).strftime('%d/%m/%Y - %H:%M:%S') if date_done else None,
            'result': result,
            'retries': self.retries,
            'queue': self.queue,
            'traceback': self.traceback
        }
        if extended:
            task_dict.update({'args': self.args, 'kwargs': self.kwargs})
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

    def check_status(self, **kwargs):
        task_id = kwargs.get('task_id', self.request.id)
        if self.is_aborted(task_id=task_id):
            raise TaskAbortedError('Task has been aborted')
        if shutting_down:
            raise WorkerShutdownError('Worker is shutting down')
        return True

    def push_status(self, extended=False):
        self.socketio.emit(
            'status', 
            self.AsyncResult(self.request.id).to_dict(extended), 
            room=self.request.id, 
            namespace='/'
        )
    
    def before_start(self, *args, **kwargs):
        super().before_start(*args, **kwargs)
        
        self.socketio = SocketIO(
            app=None,
            cors_allowed_origins='*',
            channel='socketio',
            message_queue=os.environ.get('SOCKETIO_MESSAGE_QUEUE', 'redis://'),
            async_mode='threading',
            logger=False,  
            engineio_logger=False)
        
        self.push_status(extended=True)
    
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
        acquired = False
        try:
            lock = Lock(redis, self.lock_key.format(self.request.id), blocking=False)
            acquired = lock.acquire()
            if not acquired:
                raise LockError('Task is already running in another worker')
            return self.run(*args, **kwargs)
        except (LockError, TaskAbortedError):
            raise Ignore
        except WorkerShutdownError:
            raise Reject('Task has been requeued.', requeue=True)
        except:
            raise
        finally:
            if acquired:
                lock.release()


def _queues(*names):
    return tuple(Queue(name, Exchange('default', type='direct'), routing_key=name, durable=True) for name in names)


def create_worker(name, include, queues, task_class=None, **kwargs):
    worker = Celery(name)
    worker.config_from_object(WorkerConfig)
    worker.conf.update(
        include=include,
        task_queues=_queues(*queues),
        task_default_queue=queues[0],
        task_default_routing_key=queues[0],
        **kwargs,
    )
    if task_class:
        worker.Task = task_class
    return worker


api = create_worker(
    'api',
    include=['server.tasks.request'],
    queues=('default',),
    task_class=None,
    task_serializer='pickle',
    result_serializer='pickle',
    accept_content=['pickle'],
)


sage = create_worker(
    'sage',
    include=['server.tasks.training'],
    queues=('training',),
    task_class=WorkerTask,
)


triton = create_worker(
    'triton',
    include=['server.tasks.inference'],
    queues=(
        'testing', 
        'production',
    ),
    task_class=WorkerTask,
)


def on_worker_shutting_down(*args, **kwargs):
    global shutting_down
    shutting_down = True


worker_shutting_down.connect(on_worker_shutting_down)
