import os

from datetime import timezone

from kombu import Queue, Exchange
from kombu.utils.encoding import ensure_bytes

from celery import Celery, Task, states
from celery.backends.database import session_cleanup
from celery.exceptions import Ignore, Reject
from celery.result import AsyncResult
from celery.signals import worker_shutting_down

from redis.lock import Lock
from redis.exceptions import LockError

from .. import redis
from ..config import Config


shutting_down = False
MISSING = object()


class TaskAbortedError(Exception):
    pass


class WorkerShutdownError(Exception):
    pass


class WorkerConfig(object):

    broker_url = os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    broker_connection_retry_on_startup = True
    # Deliberately not CELERY_RESULT_BACKEND: Celery lets that environment
    # variable override every app's configured backend, and the request
    # worker (`api`) needs a different one from training/serving.
    result_backend = os.environ.get(
        'TASK_RESULT_BACKEND',
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
    # Tasks that also report into their model's room (see push_status); the
    # training task opts in, serving tasks stay on their task room only.
    broadcast_model_room = False

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
        payload = self.AsyncResult(self.request.id).to_dict(extended)
        # The task room feeds the page that owns this run (History, Publish);
        # the model room feeds the app-wide training strip, which must keep
        # receiving after such a page leaves the task room on unmount — both
        # share one browser socket, and rooms are per socket.
        rooms = [self.request.id]
        model_room = self.model_room() if self.broadcast_model_room else None
        if model_room:
            rooms.append(model_room)
        for room in rooms:
            self.socketio.emit('status', payload, room=room, namespace='/')

    def model_room(self):
        """The ``model:<id>`` room, for tasks whose first argument is a ``<model_id>/<version>`` path."""
        args = self.request.args or ()
        if args and isinstance(args[0], str) and args[0]:
            return f'model:{args[0].split("/")[0]}'
        return None
    
    def before_start(self, *args, **kwargs):
        super().before_start(*args, **kwargs)
        from ..utils.socket import emitter
        self.socketio = emitter()
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


class RequestTask(WorkerTask):
    """
    Base for ``dispatch``: the same status pushes to the task room, minus
    the payload. The stored result is the HTTP response itself and is
    fetched once over ``/api/<blueprint>/status/<task_id>``; the socket
    only tells the browser when to fetch.
    """

    def push_status(self, extended=False):
        payload = self.AsyncResult(self.request.id).to_dict()
        payload['result'] = None
        self.socketio.emit('status', payload, room=self.request.id, namespace='/')


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


# Replays long-running HTTP requests (server.blueprints.apply_async). No ML
# stack, so it runs from the api image. JSON like every other app (bodies
# travel base64-encoded) — control replies use the task serializer, and
# flower, on the training app, only accepts json. Results live in Redis and
# expire: the status route fetches each once.
api = create_worker(
    'api',
    include=['server.tasks.request'],
    queues=('default',),
    task_class=RequestTask,
    # The task argument is the whole request, Authorization header included;
    # never copy it into the result store the way the extended meta would.
    result_extended=False,
    worker_max_tasks_per_child=Config.REQUEST_MAX_TASKS_PER_CHILD,
    result_backend=Config.REQUEST_RESULT_BACKEND,
    result_expires=Config.REQUEST_RESULT_TTL,
)


training = create_worker(
    'training',
    include=['server.tasks.train'],
    queues=('training',),
    task_class=WorkerTask,
)


serving = create_worker(
    'serving',
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
