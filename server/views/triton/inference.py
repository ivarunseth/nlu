from hashlib import sha256
from uuid import uuid4

from flask import current_app, request, abort

from ...auth import api_key_required
from ...registry import registry_for

from . import triton


@triton.post('/infer/<model_id>')
@api_key_required
def infer(model_id):
    environment = current_app.config['ENVIRONMENT']
    registry = registry_for(environment)

    route = registry.route(model_id)
    if route is None:
        abort(404, 'Model is not published in %s: %s' % (environment, model_id))

    data = request.get_json(silent=True) or {}
    top = max(request.args.get('top', route.top, type=int), 1)

    if 'inputs' not in data:
        abort(400, 'An "inputs" list is required for batch inference')

    inputs = data['inputs']
    max_batch = current_app.config['INFERENCE_MAX_BATCH']

    if not isinstance(inputs, list) or not inputs:
        abort(400, 'A non-empty "inputs" list is required')
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
            key = sha256(f'{top}:{query}'.encode('utf-8')).hexdigest()
        else:
            key = uuid4().hex
        keys.append(key)
        pending.setdefault(key, query)

    resolved = {}
    if route.cache and pending:
        resolved = registry.get(model_id, list(pending))
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

        registry.push(model_id, list(pending), list(pending.values()), top=top)

        timeout = current_app.config['INFERENCE_BATCH_TIMEOUT'] \
            or route.timeout or current_app.config['INFERENCE_REQUEST_TIMEOUT']
        interval = route.interval or current_app.config['INFERENCE_POLL_INTERVAL']

        resolved.update(registry.wait(
            model_id, list(pending), timeout, interval, pull=not route.cache))

    outputs = []
    for query, key in zip(inputs, keys):
        if key is None:
            outputs.append({
                'input': query,
                'error': 'A non-empty input string is required',
                'type': 'ValidationError',
            })
            continue
        output = resolved.get(key)
        if output is None:
            outputs.append({
                'input': query,
                'error': 'Prediction timed out for model %s' % model_id,
                'type': 'Timeout',
            })
        else:
            outputs.append(output)

    return {
        'environment': environment,
        'model': route.name,
        'version': route.version,
        'outputs': outputs,
    }, 200

