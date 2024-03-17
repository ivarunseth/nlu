import json
import time

from celery.exceptions import Reject
from celery.signals import worker_shutting_down

from ... import redis
from .. import worker


shutting_down = False


def on_worker_shutting_down(*args, **kwargs):
    global shutting_down
    shutting_down = True


worker_shutting_down.connect(on_worker_shutting_down)


@worker.task(bind=True)
def text_classification(self, modelId, version, directory):

    from ..scripts import TextClassification
    model = TextClassification.load(directory)

    message_queue = f'prediction-queue:{modelId}:{version}'
    batch_size = model.params['batch_size']

    while not self.is_aborted() and not shutting_down:

        messages = redis.lrange(message_queue, 0, batch_size - 1)
        batch = []
        ids = []
        
        for message in messages:
            message = json.loads(message.decode('utf-8'))            
            batch.append(message['text'])
            ids.append(message['id'])
        
        if len(ids) > 0:
            predictions = model.predict(batch) 
    
            for (id, prediction) in zip(ids, predictions):
                output = {'label': {'name': prediction[0], 'confidence': float(prediction[1])}}
                redis.set(id, json.dumps(output).encode('utf-8'))

            redis.ltrim(f'prediction-queue:{modelId}:{version}', len(ids), -1)
        
        time.sleep(0.1)
    
    outputs = redis.keys(f'prediction-result:{modelId}:{version}:*')
    if len(outputs) > 0: 
        redis.delete(*outputs)
    
    if not self.is_aborted() and shutting_down:
        raise Reject('Task is requeued for classification', requeue=True)
