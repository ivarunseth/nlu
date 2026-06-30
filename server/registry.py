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
        )


class Registry:

    def __init__(self, redis: StrictRedis):
        self.redis = redis

    @staticmethod
    def _route_key(model_id): return f'route:{model_id}'

    @staticmethod
    def _alive_key(model_id): return f'instance:{model_id}:alive'

    @staticmethod
    def _starting_key(model_id): return f'instance:{model_id}:starting'

    @staticmethod
    def _lock_key(model_id): return f'instance:{model_id}:lock'

    @staticmethod
    def _inputs_key(model_id): return f'inputs:{model_id}'

    @staticmethod
    def _output_key(model_id, request_id): return f'outputs:{model_id}:{request_id}'

    def publish_route(self, model_id, route: Route):
        self.redis.delete(self._route_key(model_id))
        self.redis.hset(self._route_key(model_id), mapping=route.to_mapping())

    def revoke_route(self, model_id):
        self.redis.delete(
            self._route_key(model_id),
            self._inputs_key(model_id),
            self._starting_key(model_id),
        )

    def route(self, model_id) -> Optional[Route]:
        return Route.from_mapping(self.redis.hgetall(self._route_key(model_id)))

    def is_alive(self, model_id) -> bool:
        return bool(self.redis.exists(self._alive_key(model_id)))

    def claim_start(self, model_id, ttl) -> bool:
        token = uuid.uuid4().hex
        return bool(self.redis.set(self._starting_key(model_id), token, nx=True, ex=ttl))

    def cached_output(self, model_id, request_id):
        raw = self.redis.get(self._output_key(model_id, request_id))
        return json.loads(raw.decode('utf-8')) if raw else None

    def submit(self, model_id, request_id, text):
        message = json.dumps({'id': request_id, 'text': text}).encode('utf-8')
        self.redis.rpush(self._inputs_key(model_id), message)

    def await_output(self, model_id, request_id, timeout, interval):
        deadline = time.monotonic() + timeout
        key = self._output_key(model_id, request_id)
        while time.monotonic() < deadline:
            raw = self.redis.get(key)
            if raw:
                return json.loads(raw.decode('utf-8'))
            time.sleep(interval)
        return None

    def serve_lock(self, model_id, timeout):
        return self.redis.lock(
            self._lock_key(model_id),
            timeout=timeout,
            blocking=False,
            thread_local=False,
        )

    def online(self, model_id, ttl):
        self.redis.set(self._alive_key(model_id), '1', ex=ttl)
        self.redis.delete(self._starting_key(model_id))

    def heartbeat(self, model_id, ttl):
        self.redis.set(self._alive_key(model_id), '1', ex=ttl)

    def offline(self, model_id):
        self.redis.delete(self._alive_key(model_id), self._starting_key(model_id))

    def drain(self, model_id, batch_size):
        key = self._inputs_key(model_id)
        with self.redis.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(key)
                    raw = pipe.lrange(key, 0, batch_size - 1)
                    if not raw:
                        pipe.unwatch()
                        return [], []

                    texts, ids = [], []
                    for item in raw:
                        data = json.loads(item.decode('utf-8'))
                        texts.append(data['text'])
                        ids.append(data['id'])

                    pipe.multi()
                    pipe.ltrim(key, len(ids), -1)
                    pipe.execute()
                    return texts, ids
                except WatchError:
                    continue

    def publish_outputs(self, model_id, ids, outputs, ttl):
        with self.redis.pipeline(transaction=False) as pipe:
            for request_id, output in zip(ids, outputs):
                pipe.set(
                    self._output_key(model_id, request_id),
                    json.dumps(output).encode('utf-8'),
                    ex=ttl,
                )
            pipe.execute()

_registries = {}
_lock = threading.Lock()


def registry_for(environment, redis=None) -> Registry:
    if redis is not None:
        return Registry(redis)

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

        registry = Registry(client)
        _registries[environment] = registry
        return registry
