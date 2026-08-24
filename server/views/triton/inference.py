import time
import math

import json

from hashlib import sha256
from uuid import uuid4

from flask import current_app, request, abort

from ...auth import api_key_required
from ...utils.registry import registry_for
from ...utils import telemetry

from . import triton


@triton.post('/infer/<model_id>')
@api_key_required
def infer(model_id):
    started = time.perf_counter()

    environment = current_app.config['ENVIRONMENT']

    registry = registry_for(environment)
    route = registry.route(model_id)

    if route is None:
        abort(404, 'Model is not published in %s: %s' % (environment, model_id))

    data = request.get_json(silent=True) or {}
    top = max(request.args.get('top', route.top, type=int), 1)

    def threshold(name, configured):
        """
        A cutoff from the query string, falling back to the deployment's.

        Clamped rather than rejected: an out-of-range query arg should degrade
        to the nearest sane cutoff, not fail a prediction request. NaN needs
        its own branch because it is not out of range so much as meaningless —
        ``float('nan')`` parses, so it never reaches the unparseable fallback;
        min/max propagate it rather than clamping it; and every comparison
        against it is False, so it would silently reject the whole response.
        It falls back the way an unparseable value does.
        """
        value = request.args.get(name, configured, type=float)
        if value is None or math.isnan(value):
            value = configured
        return min(max(value, 0.0), 1.0)

    label_threshold = threshold('label_threshold', route.label_threshold)
    annotation_threshold = threshold('annotation_threshold', route.annotation_threshold)

    if 'inputs' not in data:
        abort(400, 'An "inputs" list is required for batch inference')

    inputs = data['inputs']

    if not isinstance(inputs, list) or not inputs:
        abort(400, 'A non-empty "inputs" list is required')

    max_batch = current_app.config['INFERENCE_MAX_BATCH']

    if len(inputs) > max_batch:
        abort(400, '"inputs" accepts at most %d inputs per request' % max_batch)
    
    if not all(isinstance(query, str) for query in inputs):
        abort(400, 'Every "inputs" element must be a string')

    keys, pending = [], {}
    for query in inputs:
        if not query.strip():
            keys.append(None)
            continue
        
        if route.cache:
            # The thresholds belong in the key: they change the response, so a
            # result cached under one cutoff must never be served under
            # another. A config change therefore lands on fresh keys and the
            # stale entries simply expire on output_ttl — no purge needed.
            hash = sha256(
                f'{top}:{label_threshold}:{annotation_threshold}:{query}'.encode('utf-8')
            ).hexdigest()
            key = registry._output(model_id, hash)
        else:
            key = registry._output(model_id, uuid4().hex)

        keys.append(key)
        pending.setdefault(key, query)

    resolved, cached = {}, set()
    if route.cache and pending:
        resolved = registry.get(list(pending), pull=False)
        cached = set(resolved)

        for key in resolved:
            pending.pop(key, None)

    if pending:
        if not registry.alive(model_id) and \
            registry.claim(model_id, ttl=current_app.config['INFERENCE_START_TTL']):
            from ...tasks.inference import model
            model.apply_async(
                task_id=route.task_id,
                args=(model_id, route.path, route.model_type),
                kwargs={'environment': environment},
                queue=environment,
            )

        items = [
            json.dumps({
                'id': key,
                'data': value,
                'top': top,
                'label_threshold': label_threshold,
                'annotation_threshold': annotation_threshold,
            }).encode('utf-8')
            for key, value in zip(list(pending), list(pending.values()))
        ]
        
        registry.push(registry._inputs(model_id), items)

        timeout = current_app.config['INFERENCE_BATCH_TIMEOUT'] \
            or route.timeout or current_app.config['INFERENCE_REQUEST_TIMEOUT']
        interval = route.interval or current_app.config['INFERENCE_POLL_INTERVAL']

        raw = registry.wait(list(pending), timeout, interval, pull=not route.cache)

        resolved.update({key: json.loads(value.decode('utf-8')) \
                         for key, value in raw.items()})

    latency = round((time.perf_counter() - started) * 1000, 2)

    outputs, records = [], []

    for query, key in zip(inputs, keys):
        if key is None:
            outputs.append({
                'input': query,
                'error': 'A non-empty input string is required',
                'type': 'ValidationError',
            })
            continue
        
        output = resolved.get(key)

        if isinstance(output, (bytes, bytearray)):
            output = json.loads(output.decode('utf-8'))
        
        if output is None:
            output = {
                'input': query,
                'error': 'Prediction timed out for model %s' % model_id,
                'type': 'Timeout',
            }
        
        outputs.append(output)
        
        records.append(telemetry.record(
            model_id, environment, route.version, query, output,
            cached=key in cached, latency=latency,
        ))

    try:
        telemetry.push(registry, records)
    except Exception:
        current_app.logger.exception('telemetry push failed')

    response = {
        'environment': environment,
        'model': route.name,
        'version': route.version,
        'outputs': outputs,
    }

    return response, 200
