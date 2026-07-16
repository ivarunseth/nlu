"""
Prediction telemetry pipeline.

The inference data plane (the triton app) never touches the control-plane
database. Instead, after fetching a prediction back from Redis it pushes a
compact record onto a per-environment telemetry queue (``<env>:telemetry``)
via the same registry. The control plane runs a background consumer that
watches every environment's queue and batch-inserts the records as
``Prediction`` rows, so the serving hot path stays free of database writes.

``persist`` and ``sweep`` are also exposed for the Analyse endpoints to watch
and prune on read as a safety net when the consumer is not running.
"""

import json
import time

from flask import Flask, current_app

from .. import db
from .registry import Registry, registry_for


def record(model_id, environment, version, input, output, cached=False, latency=None):
    """Shape a single resolved prediction into a telemetry record.

    ``output`` is the parsed prediction (or error) dict as stored in Redis.
    The record carries the model, environment and served version itself —
    never a reference to the control-plane instance, which is deleted and
    recreated on every republish — so persisted history survives redeploys.
    """
    return {
        'model_id': model_id,
        'environment': environment,
        'version': version,
        'created_at': time.time(),
        'latency': latency,
        'cached': bool(cached),
        'input': input,
        'output': output,
    }


def push(registry: Registry, records: list[dict]):
    """Enqueue telemetry records onto their environment's queue."""
    if records:
        messages = [json.dumps(item).encode('utf-8') for item in records]
        registry.push(registry._telemetry(), messages)


def watch(environment: str, size: int):
    """Move up to ``size`` records from one environment's queue into the db.

    Returns the number of rows inserted. The caller owns the transaction
    boundary decision; a failure here leaves the batch in Redis for retry.
    """
    from ..database import Prediction

    registry = registry_for(environment)
    raw = registry.watch(registry._telemetry(), size)
    if not raw:
        return 0

    rows = []
    for item in raw:
        # A record that fails to parse or shape (e.g. one queued by an older
        # data plane) is dropped rather than poisoning the whole batch.
        try:
            data = json.loads(item.decode('utf-8'))
            rows.append(Prediction.create(data))
        except Exception:
            continue

    if rows:
        db.session.bulk_save_objects(rows)
        db.session.commit()
    return len(rows)


def persist(size: int=None):
    """Watch every environment's telemetry queue once; returns rows inserted."""
    size = size or current_app.config['TELEMETRY_BATCH_SIZE']
    total = 0
    for environment in current_app.config['ALLOWED_ENVIRONMENTS']:
        total += watch(environment, size)
    return total


def sweep(days: int):
    """Delete predictions older than ``days``; returns rows removed."""
    from ..database import Prediction
    cutoff = time.time() - days * 86400
    removed = Prediction.query.filter(Prediction.created_at < cutoff).delete()
    db.session.commit()
    return removed


def consume(app: Flask):
    """Background loop: batch-insert telemetry for every environment forever."""
    interval = app.config['TELEMETRY_INTERVAL']
    with app.app_context():
        while True:
            try:
                items = persist()
            except Exception:
                db.session.rollback()
                app.logger.exception('telemetry persistence failed')
                items = 0
            if not items:
                time.sleep(interval)
