import os
import time
import shutil
import tempfile

from redis.exceptions import LockError

from .. import store
from ..config import flask_config
from ..registry import registry_for
from . import triton


@triton.task(bind=True)
def model(self, model_id, path, model_type, **kwargs):
    """Serve ``model_id`` until idle or unpublished. See module docstring."""

    config = flask_config[os.environ.get('FLASK_ENV', 'production')]
    environment = kwargs.get('environment', os.environ.get('FLASK_ENV', 'production'))
    bucket = kwargs.get('bucket', config.STORAGE_BUCKET)

    batch_size = int(kwargs.get('batch_size', config.INFERENCE_BATCH_SIZE))
    sleep = float(kwargs.get('sleep', config.INFERENCE_SLEEP))
    idle_timeout = float(kwargs.get('idle_timeout', config.INFERENCE_IDLE_TIMEOUT))
    heartbeat_interval = float(kwargs.get('heartbeat_interval', config.INFERENCE_HEARTBEAT_INTERVAL))
    heartbeat_ttl = max(int(heartbeat_interval * 3), 1)
    output_ttl = int(kwargs.get('output_ttl', config.INFERENCE_OUTPUT_TTL))

    registry = registry_for(environment)

    lock = registry.serve_lock(model_id, timeout=heartbeat_ttl)

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

            if registry.route(model_id) is None:
                break

            texts, ids = registry.drain(model_id, batch_size)

            if ids:
                try:
                    outputs = model.predict(texts)
                    registry.publish_outputs(model_id, ids, outputs, ttl=output_ttl)
                except Exception as error:
                    failure = {'error': str(error), 'type': type(error).__name__}
                    registry.publish_outputs(model_id, ids, [failure] * len(ids), ttl=output_ttl)
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
        try:
            lock.release()
        except LockError:
            pass
        shutil.rmtree(directory, ignore_errors=True)
