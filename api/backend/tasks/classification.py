import json
import time

from celery.exceptions import Ignore
from celery.signals import worker_shutting_down

from ... import redis
from .. import worker


shutting_down = False


def on_worker_shutting_down(*args, **kwargs):
    global shutting_down
    shutting_down = True


worker_shutting_down.connect(on_worker_shutting_down)


@worker.task(bind=True)
def text_classification(self, modelId, directory):

    from ...nlp import TextClassification
    model = TextClassification.load(directory)
    
    while not self.is_aborted() and not shutting_down:
        messages = redis.lrange(f'prediction-queue:{modelId}', 0, model.params['batch_size'] - 1)
        batch = []
        ids = []
        
        for message in messages:
            message = json.loads(message.decode('utf-8'))
            
            if not 'id' in message or not 'text' in message:
                continue
            
            batch.append(message['text'])
            ids.append(message['id'])
        
        if len(ids) > 0:            
            predictions = model.predict(batch)
    
            for (id, query, prediction) in zip(ids, batch, predictions):
                output = {'label': {'name': prediction[0], 'confidence': float(prediction[1])}, 'query': query}
                redis.set(id, json.dumps(output).encode('utf-8'))

            redis.ltrim(f'prediction-queue:{modelId}', len(ids), -1)
        
        time.sleep(0.1)
    
    outputs = redis.keys(f'prediction-result:{modelId}:*')
    
    if len(outputs) > 0: redis.delete(*outputs)
    
    if not self.is_aborted() and shutting_down:
        raise Ignore
