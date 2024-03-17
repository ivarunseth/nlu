import hashlib
import json
import time

from flask import request, abort

from ...auth import token_optional_auth
from ... import redis

from . import nlu


@nlu.post('/models/<modelId>/<version>/predictions')
@token_optional_auth.login_required
def predict(modelId, version):
    if not 'query' in request.args:
        abort(400, 'query is missing in request parameters')
    query = request.args.get('query').strip()
    if query is None or query == '':
        return '', 204
    message = {'id': f'prediction-result:{modelId}:{version}:' + hashlib.sha256(query.encode('utf-8')).hexdigest(), 
               'text': query}
    cached = redis.get(message['id'])
    if cached: 
        return json.loads(cached.decode('utf-8')), 200
    redis.rpush(f'prediction-queue:{modelId}:{version}', json.dumps(message).encode('utf-8'))
    while True:
        prediction = redis.get(message['id'])
        if prediction:
            break
        time.sleep(0.1)
    return json.loads(prediction.decode('utf-8')), 200
