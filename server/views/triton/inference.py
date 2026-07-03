import hashlib

from flask import current_app, request, abort

from ...registry import registry_for

from . import triton


@triton.post('/models/<model_id>/infer')
def infer(model_id):
    environment = current_app.config['ENVIRONMENT']
    registry = registry_for(environment)

    route = registry.route(model_id)
    if route is None:
        abort(404, 'Model is not published in %s: %s' % (environment, model_id))

    data = request.get_json(silent=True) or {}
    query = data.get('query')
    if not isinstance(query, str) or not query.strip():
        abort(400, 'A non-empty "query" string is required')

    top = max(request.args.get('top', 1, type=int), 1)

    request_id = hashlib.sha256(f'{top}:{query}'.encode('utf-8')).hexdigest()

    cached = registry.get(model_id, request_id)
    if cached is not None:
        if 'error' in cached:
            return cached, 502
        return cached, 200

    if not registry.alive(model_id) and \
        registry.claim(model_id, ttl=current_app.config['INFERENCE_START_TTL']):
        from ...tasks.inference import model
        model.apply_async(
            args=(model_id, route.path, route.model_type),
            kwargs={'environment': environment},
            queue=environment,
        )   

    registry.push(model_id, request_id, query, top=top)

    output = registry.wait(
        model_id,
        request_id,
        current_app.config['INFERENCE_REQUEST_TIMEOUT'],
        current_app.config['INFERENCE_POLL_INTERVAL'],
    )

    if output is None:
        abort(504, 'Prediction timed out for model %s' % model_id)

    if 'error' in output:
        return output, 502

    return output, 200


@triton.errorhandler(400)
def bad_request(error):
    return {'error': error.description}, 400


@triton.errorhandler(404)
def not_found(error):
    return {'error': error.description}, 404


@triton.errorhandler(504)
def gateway_timeout(error):
    return {'error': error.description}, 504
