import os
import json
import time
import uuid
import shutil
import tempfile

from redis.exceptions import LockError

from . import serving


@serving.task(bind=True)
def serve(self, model_id, path, model_type, **kwargs):
    """Serve ``model_id`` until idle or unpublished. See module docstring."""

    from ..config import Config as config
    environment = kwargs['environment']
    bucket = kwargs.get('bucket', config.STORAGE_BUCKET)

    from ..utils.registry import registry_for
    registry = registry_for(environment)
    route = registry.route(model_id)

    def setting(name, default, cast):
        value = kwargs.get(name)
        if value is None and route is not None:
            value = getattr(route, name)
        return cast(default if value is None else value)

    lazy = setting('lazy', False, bool)
    batch_size = setting('batch_size', config.INFERENCE_BATCH_SIZE, int)
    sleep = setting('sleep', config.INFERENCE_SLEEP, float)
    idle_timeout = setting('idle_timeout', config.INFERENCE_IDLE_TIMEOUT, float)
    heartbeat_interval = setting('heartbeat_interval', config.INFERENCE_HEARTBEAT_INTERVAL, float)
    heartbeat_ttl = setting('heartbeat_ttl', max(int(heartbeat_interval * 3), 1), int)
    output_ttl = setting('output_ttl', config.INFERENCE_OUTPUT_TTL, int)
    start_ttl = int(config.INFERENCE_START_TTL)

    # Identifies this run as the owner of the alive flag. It is not the task
    # id: a lazy revive reuses the deployment's task id, and only the run that
    # actually set the flag may retire it.
    run = uuid.uuid4().hex

    # The route names the task id that owns this deployment; a run that was
    # superseded while still queued must not load or serve under it.
    if route is not None and route.task_id and route.task_id != self.request.id:
        return

    # The lock is the serving-ownership token, so it has to outlive every
    # blocking step taken while holding it. Loading is unbounded (artifact
    # download, framework import, graph load) and nothing refreshes the lock
    # until the first heartbeat, which is a further heartbeat_interval after
    # the model comes online -- so a heartbeat_ttl lock silently expires
    # mid-load and the first heartbeat then kills a healthy deployment. Start
    # on the same budget the publishing blueprint reserves for a start, and narrow to
    # heartbeat_ttl once the heartbeat loop is refreshing it.
    lock = registry.lock(model_id, timeout=max(start_ttl, heartbeat_ttl))

    try:
        # Wait briefly for a superseded predecessor to notice the republished
        # route and release the lock, so restarts hand over without a dead start.
        if not lock.acquire(blocking=True, blocking_timeout=heartbeat_ttl):
            return
    except LockError:
        return

    directory = tempfile.mkdtemp(prefix=f'{model_id}-', dir=os.path.join(os.getcwd(), 'data', 'tmp'))
    online = False

    try:
        from .. import store
        store.fget_dir(bucket, f'models/{path}', directory)

        from ..models import Model
        model = Model.load(model_type, directory)

        try:
            lock.timeout = heartbeat_ttl
            lock.reacquire()
        except LockError:
            # Loading outran even the start budget; serve nothing rather than
            # serve without owning the deployment.
            return

        registry.online(model_id, ttl=heartbeat_ttl, owner=run)
        online = True

        idle_since = time.monotonic()
        last_heartbeat = idle_since

        queue = registry._inputs(model_id)

        while True:
            route = registry.route(model_id)
            # Exit when unpublished, or when a restart republished the route
            # under a new task id: this run no longer owns the deployment.
            if route is None or (route.task_id and route.task_id != self.request.id):
                break

            raw = registry.watch(queue, batch_size)

            inputs, keys, kwargs = [], [], {}
            for item in raw:
                data = json.loads(item.decode('utf-8'))
                inputs.append(data.pop('data'))
                keys.append(data.pop('id'))
                for key_, value in data.items():
                    kwargs.setdefault(key_, []).append(value)

            if inputs and keys:
                try:
                    outputs = model.predict(inputs, **kwargs or {})

                    for i, (input, output) in enumerate(zip(inputs, outputs)):
                        outputs[i] = json.dumps({'input': input, **output}).encode('utf-8')

                    registry.set(keys, outputs, ttl=output_ttl)
                
                except Exception as error:
                    failure = json.dumps({'error': str(error), 'type': type(error).__name__})
                    registry.set(keys, [failure] * len(keys), ttl=output_ttl)
                
                idle_since = time.monotonic()
            
            elif lazy and time.monotonic() - idle_since > idle_timeout:
                break
            
            else:
                time.sleep(sleep)

            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                alive = self.check_status(task_id=self.request.id)
                if alive:
                    # Ownership first: a run that has lost the lock must not
                    # advertise itself as serving for another heartbeat_ttl.
                    try:
                        lock.reacquire()
                    except LockError:
                        break
                    registry.heartbeat(model_id, ttl=heartbeat_ttl, owner=run)
                    last_heartbeat = now

    finally:
        try:
            owned = lock.owned()
        except Exception:
            owned = False
        # Superseded means the route is gone (unpublish already revoked and
        # purged) or names another task id (a restart already published its
        # replacement and claimed the start slot). Holding the lock does not
        # make that state this run's to clean up: offline() would delete the
        # replacement's start claim while it is still loading, and the infer
        # view would then launch a duplicate serve under the same task id.
        try:
            current = registry.route(model_id)
            superseded = current is None or \
                (current.task_id and current.task_id != self.request.id)
        except Exception:
            superseded = True

        # Clean up only while still holding the serving lock and still the
        # deployment's owner: a superseded task must not wipe the alive
        # flag, start claim or cached outputs of the replacement.
        if owned and not superseded:
            if online:
                registry.offline(model_id)
                registry.purge(model_id)

        elif online:
            # Either the lock is gone (expired under a stall) or a restart /
            # unpublish handed serving over. Retire this run's own alive flag
            # so the infer view stops pushing requests into a queue nobody is
            # reading; the flag is only cleared while it still names this run,
            # so a replacement that already came online keeps its own.
            registry.retire(model_id, run)

        if owned:
            try:
                lock.release()
            except LockError:
                pass

        shutil.rmtree(directory, ignore_errors=True)
