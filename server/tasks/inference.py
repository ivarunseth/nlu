import os
import json
import time
import shutil
import tempfile

from redis.exceptions import LockError

from . import triton


@triton.task(bind=True)
def model(self, model_id, path, model_type, **kwargs):
    """Serve ``model_id`` until idle or unpublished. See module docstring."""

    from ..config import configs
    config = configs[os.environ.get('FLASK_ENV', 'production')]
    environment = kwargs.get('environment', os.environ.get('FLASK_ENV', 'production'))
    bucket = kwargs.get('bucket', config.STORAGE_BUCKET)

    from ..registry import registry_for
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

    lock = registry.lock(model_id, timeout=heartbeat_ttl)

    try:
        if not lock.acquire():
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

        registry.online(model_id, ttl=heartbeat_ttl)
        online = True

        idle_since = time.monotonic()
        last_heartbeat = idle_since

        queue = registry._inputs(model_id)

        while True:
            route = registry.route(model_id)
            if route is None:
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

                    registry.set(model_id, keys, outputs, ttl=output_ttl)
                
                except Exception as error:
                    failure = json.dumps({'error': str(error), 'type': type(error).__name__})
                    registry.set(model_id, keys, [failure] * len(keys), ttl=output_ttl)
                
                idle_since = time.monotonic()
            
            elif lazy and time.monotonic() - idle_since > idle_timeout:
                break
            
            else:
                time.sleep(sleep)

            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                alive = self.check_status(task_id=self.request.id)
                if alive:
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
