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
    
    from ..scripts.text_classification import TextClassification
    model = TextClassification.load(directory)

    input_queue = f'input-queue:{modelId}:{version}'

    while not self.is_aborted() and not shutting_down:

        inputs = redis.lrange(input_queue, 0, model.params['batch_size'] - 1)
        batch = []
        ids = []
        
        for input in inputs:
            data = json.loads(input.decode('utf-8'))
            batch.append(data['text'])
            ids.append(data['id'])
        
        if len(batch) > 0:
            outputs = model.predict(batch) 
    
            for (id, output) in zip(ids, outputs):
                redis.set(id, json.dumps(output).encode('utf-8'))

            redis.ltrim(input_queue, len(ids), -1)
        
        time.sleep(0.01)
    
    outputs = redis.keys(f'output:{modelId}:{version}:*')
    
    if len(outputs) > 0: redis.delete(*outputs)
    
    if not self.is_aborted() and shutting_down:
        raise Reject('Task has been requeued.', requeue=True)
