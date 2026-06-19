import os

import json
import time
import shutil

from ..utils import timestamp

from .. import redis, store
from . import worker


@worker.task(bind=True)
def predict(self, path, model_type, architecture, key, **kwargs):

    T = timestamp()

    directory = os.path.join(os.getcwd(), 'data', 'tmp', path)
    os.makedirs(directory, exist_ok=True)

    bucket = kwargs.get('bucket', 'data')
    store.fget_dir(bucket, f'models/{path}', directory)

    from ..models import Model
    model = Model().load(model_type, architecture, directory)

    batch_size = kwargs.get('batch_size', 32)
    sleep = kwargs.get('sleep', 0.005)
    timeout = kwargs.get('timeout', 900) / 1000

    while timestamp() - T < timeout:

        self.check_status()

        inputs = redis.lrange(f'inputs:{key}', 0, batch_size - 1)
        batch = []
        ids = []
        
        for input in inputs:
            data = json.loads(input.decode('utf-8'))
            batch.append(data['text'])
            ids.append(data['id'])
        
        if len(batch) > 0:
            T = timestamp()

            outputs = model.predict(batch)
    
            for (id, output) in zip(ids, outputs):
                data = json.dumps(output).encode('utf-8')
                redis.set(id, data)

            redis.ltrim(f'inputs:{key}', len(ids), -1)
        
        time.sleep(sleep)
    
    outputs = redis.keys(f'outputs:{key}:*')
    
    if len(outputs) > 0: 
        redis.delete(*outputs)

    shutil.rmtree(directory)
