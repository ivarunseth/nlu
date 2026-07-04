import os
import time
import shutil
import tempfile

from redis.exceptions import LockError

from .. import store
from . import triton


@triton.task(bind=True)
def model(self, model_id, path, model_type, **kwargs):
    """Serve ``model_id`` until idle or unpublished. See module docstring."""

    from ..config import configs
    config = configs[os.environ.get('FLASK_ENV', 'production')]
    environment = kwargs.get('environment', os.environ.get('FLASK_ENV', 'production'))
    bucket = kwargs.get('bucket', config.STORAGE_BUCKET)

    batch_size = int(kwargs.get('batch_size', config.INFERENCE_BATCH_SIZE))
    sleep = float(kwargs.get('sleep', config.INFERENCE_SLEEP))
    idle_timeout = float(kwargs.get('idle_timeout', config.INFERENCE_IDLE_TIMEOUT))
    heartbeat_interval = float(kwargs.get('heartbeat_interval', config.INFERENCE_HEARTBEAT_INTERVAL))
    heartbeat_ttl = max(int(heartbeat_interval * 3), 1)
    output_ttl = int(kwargs.get('output_ttl', config.INFERENCE_OUTPUT_TTL))

    from ..registry import registry_for
    registry = registry_for(environment)

    lock = registry.lock(model_id, timeout=heartbeat_ttl)

    try:
        if not lock.acquire():
            return
    except LockError:
        return

    directory = tempfile.mkdtemp(prefix=f'{model_id}-', dir=os.path.join(os.getcwd(), 'data', 'tmp'))
    online = False

    try:
        store.fget_dir(bucket, f'models/{path}', directory)

        from ..models import Model
        model = Model.load(model_type, directory)

        registry.online(model_id, ttl=heartbeat_ttl)
        online = True

        idle_since = time.monotonic()
        last_heartbeat = idle_since

        while True:
            self.check_status(task_id=self.request.id)

            route = registry.route(model_id)
            if route is None:
                break

            queries, ids, kwargs = registry.pop(model_id, batch_size)

            if ids:
                try:
                    predictions = model.predict(queries, **kwargs)
                    outputs = []
                    for query, prediction in zip(queries, predictions):
                        outputs.append({
                            'environment': environment, 
                            'model': route.name, 
                            'version': route.version, 'query': query, **prediction}
                        )
                    registry.set(model_id, ids, outputs, ttl=output_ttl)
                except Exception as error:
                    failure = {'error': str(error), 'type': type(error).__name__}
                    registry.set(model_id, ids, [failure] * len(ids), ttl=output_ttl)
                idle_since = time.monotonic()
            elif time.monotonic() - idle_since > idle_timeout:
                break
            else:
                time.sleep(sleep)

            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                registry.heartbeat(model_id, ttl=heartbeat_ttl)
                try:
                    lock.reacquire()
                except LockError:
                    break
                last_heartbeat = now
    finally:
        if online:
            registry.offline(model_id)
            registry.purge(model_id)
        try:
            lock.release()
        except LockError:
            pass
        shutil.rmtree(directory, ignore_errors=True)
