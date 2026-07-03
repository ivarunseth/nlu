import os

import json
import time
import uuid
import threading
from dataclasses import dataclass, asdict
from typing import Optional

from redis import StrictRedis
from redis.exceptions import WatchError


@dataclass(frozen=True)
class Route:
    path: str
    model_type: str
    version: str = ''
    name: str = ''

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
        )


class Registry:

    def __init__(self, redis: StrictRedis, environment: str):
        self.redis = redis
        self.environment = environment

    def _key(self, *parts): return ':'.join((self.environment, *parts))

    def _route(self, model_id): return self._key('route', model_id)

    def _alive(self, model_id): return self._key('instance', model_id, 'alive')

    def _starting(self, model_id): return self._key('instance', model_id, 'starting')

    def _lock(self, model_id): return self._key('instance', model_id, 'lock')

    def _inputs(self, model_id): return self._key('inputs', model_id)

    def _output(self, model_id, request_id): return self._key('output', model_id, request_id)

    def publish(self, model_id, route: Route):
        self.redis.delete(self._route(model_id))
        self.redis.hset(self._route(model_id), mapping=route.to_mapping())

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

    def get(self, model_id, request_id):
        raw = self.redis.get(self._output(model_id, request_id))
        return json.loads(raw.decode('utf-8')) if raw else None

    def push(self, model_id, request_id, query, **kwargs):
        message = json.dumps({'id': request_id, 'query': query, **kwargs}).encode('utf-8')
        self.redis.rpush(self._inputs(model_id), message)

    def wait(self, model_id, request_id, timeout, interval):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            output = self.get(model_id, request_id)
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

                    queries, ids, kwargs = [], [], {}
                    for item in raw:
                        data = json.loads(item.decode('utf-8'))
                        queries.append(data.pop('query'))
                        ids.append(data.pop('id'))
                        for key_, value in data.items():
                            kwargs.setdefault(key_, []).append(value)

                    pipe.multi()
                    pipe.ltrim(key, len(ids), -1)
                    pipe.execute()
                    return queries, ids, kwargs
                except WatchError:
                    continue

    def set(self, model_id, ids, outputs, ttl):
        with self.redis.pipeline(transaction=False) as pipe:
            for request_id, output in zip(ids, outputs):
                pipe.set(
                    self._output(model_id, request_id),
                    json.dumps(output).encode('utf-8'),
                    ex=ttl,
                )
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

        url = os.environ.get(f'REDIS_URL_{environment.upper()}')
        if url:
            client = StrictRedis.from_url(url)
        else:
            from . import redis as shared
            client = shared

        registry = Registry(client, environment)
        _registries[environment] = registry
        return registry
