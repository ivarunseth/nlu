import os

import json
import time
import uuid
import threading
from dataclasses import dataclass, asdict
from typing import Optional

from redis import StrictRedis
from redis.exceptions import WatchError

from .config import configs


@dataclass(frozen=True)
class Route:
    path: str
    model_type: str
    version: str = ''
    name: str = ''
    task_id: str = ''
    api_key: str = ''

    def to_mapping(self) -> dict:
        return {k: ('' if v is None else str(v)) for k, v in asdict(self).items()}

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
        return cls(
            path=decoded['path'],
            model_type=decoded['model_type'],
            version=decoded.get('version', ''),
            name=decoded.get('name', ''),
            task_id=decoded.get('task_id', ''),
            api_key=decoded.get('api_key', ''),
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

    def get(self, model_id, key):
        raw = self.redis.get(self._output(model_id, key))
        return json.loads(raw.decode('utf-8')) if raw else None

    def push(self, model_id, key, query, **kwargs):
        message = json.dumps({'id': key, 'query': query, **kwargs}).encode('utf-8')
        self.redis.rpush(self._inputs(model_id), message)

    def wait(self, model_id, key, timeout, interval):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            output = self.get(model_id, key)
            if output:
                return output
            time.sleep(interval)
        return None

    def lock(self, model_id, timeout):
        return self.redis.lock(
            self._lock(model_id),
            timeout=timeout,
            blocking=False,
            thread_local=False,
        )

    def online(self, model_id, ttl):
        self.redis.set(self._alive(model_id), '1', ex=ttl)
        self.redis.delete(self._starting(model_id))

    def heartbeat(self, model_id, ttl):
        self.redis.set(self._alive(model_id), '1', ex=ttl)

    def offline(self, model_id):
        self.redis.delete(self._alive(model_id), self._starting(model_id))

    def pop(self, model_id, batch_size):
        key = self._inputs(model_id)
        with self.redis.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(key)
                    raw = pipe.lrange(key, 0, batch_size - 1)
                    if not raw:
                        pipe.unwatch()
                        return [], [], {}

                    queries, keys, kwargs = [], [], {}
                    for item in raw:
                        data = json.loads(item.decode('utf-8'))
                        queries.append(data.pop('query'))
                        keys.append(data.pop('id'))
                        for key_, value in data.items():
                            kwargs.setdefault(key_, []).append(value)

                    pipe.multi()
                    pipe.ltrim(key, len(keys), -1)
                    pipe.execute()
                    return queries, keys, kwargs
                except WatchError:
                    continue

    def set(self, model_id, keys, values, ttl):
        """Store caller-serialized values under the given request ids."""
        with self.redis.pipeline(transaction=False) as pipe:
            for key, value in zip(keys, values):
                pipe.set(self._output(model_id, key), value, ex=ttl)
            pipe.execute()

_registries = {}
_lock = threading.Lock()


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
            from . import redis as shared
            client = shared

        registry = Registry(client, environment)
        _registries[environment] = registry
        return registry
