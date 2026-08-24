import os

import time
import uuid
import threading
from dataclasses import dataclass, asdict
from typing import Optional

from redis import StrictRedis
from redis.exceptions import WatchError

from ..config import configs


_registries = {}
_lock = threading.Lock()


@dataclass(frozen=True)
class Route:
    path: str
    model_type: str
    version: str = ''
    name: str = ''
    task_id: str = ''
    api_key: str = ''
    # Per-deployment serving options set from the publish UI. Optional
    # numerics fall back to the app config when unset (None): ``timeout``
    # and ``interval`` are read per request by the infer view, the rest by
    # the serving task at startup.
    lazy: bool = False
    cache: bool = True
    top: int = 1
    label_threshold: float = 0.0
    annotation_threshold: float = 0.0
    timeout: Optional[float] = None
    interval: Optional[float] = None
    batch_size: Optional[int] = None
    sleep: Optional[float] = None
    idle_timeout: Optional[float] = None
    heartbeat_interval: Optional[float] = None
    heartbeat_ttl: Optional[int] = None
    output_ttl: Optional[int] = None

    def to_mapping(self) -> dict:
        mapping = asdict(self)
        mapping['lazy'] = '1' if self.lazy else '0'
        mapping['cache'] = '1' if self.cache else '0'
        return {k: ('' if v is None else str(v)) for k, v in mapping.items()}

    @classmethod
    def from_mapping(cls, mapping: dict) -> Optional['Route']:
        if not mapping:
            return None
        decoded = {
            (k.decode() if isinstance(k, bytes) else k):
            (v.decode() if isinstance(v, bytes) else v)
            for k, v in mapping.items()
        }
        if not decoded.get('path') or not decoded.get('model_type'):
            return None

        def number(key, cast, default=None):
            return cast(float(decoded[key])) if decoded.get(key) else default

        return cls(
            path=decoded['path'],
            model_type=decoded['model_type'],
            version=decoded.get('version', ''),
            name=decoded.get('name', ''),
            task_id=decoded.get('task_id', ''),
            api_key=decoded.get('api_key', ''),
            lazy=decoded.get('lazy', '0') == '1',
            cache=decoded.get('cache', '1') != '0',
            top=number('top', int, default=1),
            label_threshold=number('label_threshold', float, default=0.0),
            annotation_threshold=number('annotation_threshold', float, default=0.0),
            timeout=number('timeout', float),
            interval=number('interval', float),
            batch_size=number('batch_size', int),
            sleep=number('sleep', float),
            idle_timeout=number('idle_timeout', float),
            heartbeat_interval=number('heartbeat_interval', float),
            heartbeat_ttl=number('heartbeat_ttl', int),
            output_ttl=number('output_ttl', int),
        )


class Registry:

    def __init__(self, redis: StrictRedis, environment: str):
        self.redis = redis
        self.environment = environment

    def _key(self, *parts): return ':'.join((self.environment, *parts))

    def _route(self, model_id): return self._key('routes', model_id)

    def _alive(self, model_id): return self._key('models', model_id, 'alive')

    def _starting(self, model_id): return self._key('models', model_id, 'starting')

    def _lock(self, model_id): return self._key('models', model_id, 'lock')

    def _inputs(self, model_id): return self._key('inputs', model_id)

    def _output(self, model_id, key): return self._key('outputs', model_id, key)

    def _telemetry(self): return self._key('telemetry')

    def publish(self, model_id, route: Route):
        # Replace the route atomically; a serving task reads a missing route
        # as a shutdown signal, so it must never observe the gap.
        with self.redis.pipeline() as pipe:
            pipe.delete(self._route(model_id))
            pipe.hset(self._route(model_id), mapping=route.to_mapping())
            pipe.execute()

    def revoke(self, model_id):
        self.redis.delete(
            self._route(model_id),
            self._inputs(model_id),
            self._starting(model_id),
        )
        self.purge(model_id)

    def purge(self, model_id):
        keys = list(self.redis.scan_iter(match=self._output(model_id, '*')))
        if keys:
            self.redis.delete(*keys)

    def route(self, model_id) -> Optional[Route]:
        return Route.from_mapping(self.redis.hgetall(self._route(model_id)))

    def alive(self, model_id) -> bool:
        return bool(self.redis.exists(self._alive(model_id)))

    def claim(self, model_id, ttl) -> bool:
        return bool(self.redis.set(self._starting(model_id), uuid.uuid4().hex, nx=True, ex=ttl))

    def lock(self, model_id, timeout):
        return self.redis.lock(
            self._lock(model_id),
            timeout=timeout,
            blocking=False,
            thread_local=False,
        )

    # Clear the alive flag only while it still names ``owner``. A serving run
    # that lost its lock has to retire its own flag without wiping the flag of
    # the replacement that took over.
    _RETIRE = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    end
    return 0
    """

    def online(self, model_id, ttl, owner='1'):
        self.redis.set(self._alive(model_id), owner, ex=ttl)
        self.redis.delete(self._starting(model_id))

    def heartbeat(self, model_id, ttl, owner='1'):
        self.redis.set(self._alive(model_id), owner, ex=ttl)

    def offline(self, model_id):
        self.redis.delete(self._alive(model_id), self._starting(model_id))

    def retire(self, model_id, owner):
        """Drop the alive flag if ``owner`` still holds it, leaving the start
        claim alone: it may already belong to a replacement."""
        self.redis.eval(self._RETIRE, 1, self._alive(model_id), owner)

    def get(self, keys, pull=False):
        """Fetch many outputs in one round-trip, keyed by request id;
        missing keys are omitted. With ``pull`` each hit is deleted, so
        it is served exactly once."""
        if not keys:
            return {}
        with self.redis.pipeline(transaction=False) as pipe:
            for key in keys:
                if pull:
                    pipe.getdel(key)
                else:
                    pipe.get(key)
            values = pipe.execute()
        return {key: value for key, value in zip(keys, values) if value}

    def pull(self, key):
        """Fetch an output and delete it, so it is served exactly once."""
        return self.redis.getdel(key)

    def push(self, queue, items):
        """Enqueue many inputs in one round-trip; kwargs apply to each."""
        if items:
            self.redis.rpush(queue, *items)

    def wait(self, keys, timeout, interval, pull=False):
        """Poll a set of keys until all resolve or the deadline passes,
        returning whatever resolved, keyed by request id."""
        resolved = {}
        pending = list(dict.fromkeys(keys))
        deadline = time.monotonic() + timeout
        while pending:
            found = self.get(pending, pull=pull)
            if found:
                resolved.update(found)
                pending = [key for key in pending if key not in found]
            if not pending or time.monotonic() >= deadline:
                break
            time.sleep(interval)
        return resolved

    def watch(self, queue, size):
        with self.redis.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(queue)
                    raw = pipe.lrange(queue, 0, size - 1)
                    if not raw:
                        pipe.unwatch()
                        return []
                    pipe.multi()
                    pipe.ltrim(queue, len(raw), -1)
                    pipe.execute()
                    return raw
                except WatchError:
                    continue

    def set(self, keys, values, ttl):
        """Store caller-serialized values under the given request ids."""
        with self.redis.pipeline(transaction=False) as pipe:
            for key, value in zip(keys, values):
                pipe.set(key, value, ex=ttl)
            pipe.execute()


def registry_for(environment, redis=None) -> Registry:
    if redis is not None:
        return Registry(redis, environment)

    with _lock:
        cached = _registries.get(environment)
        if cached is not None:
            return cached

        # Registries are also built outside an app context (celery workers),
        # so read the settings from the config class directly.
        config = configs[os.environ.get('FLASK_ENV', 'production')]
        url = (config.ALLOWED_ENVIRONMENTS.get(environment) or {}).get('redis_url')
        if url:
            client = StrictRedis.from_url(url)
        else:
            from .. import redis as shared
            client = shared

        registry = Registry(client, environment)
        _registries[environment] = registry
        return registry
