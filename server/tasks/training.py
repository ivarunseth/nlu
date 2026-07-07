import os

import shutil

from .. import store
from . import sage


@sage.task(bind=True)
def train(self, path, model_type, architecture='deep_neural_network', random_state=42, \
          test_split=0.2, validation_split=0.1, epochs=200, batch_size=32, \
          early_stopping=True, monitor='val_loss', patience=10, \
          callbacks=[], save_format='tf', **kwargs):
    
    directory = os.path.join(os.getcwd(), 'data','tmp', path)
    os.makedirs(directory, exist_ok=True)

    bucket = os.environ.get('STORAGE_BUCKET', 'data')
    store.fget(bucket, f'models/{path}/data.csv', os.path.join(directory, 'data.csv'))

    import random
    random.seed(random_state)

    from ..models import Model
    model = Model.create(model_type, architecture)

    from ..models.callbacks import TrainingCallback
    callbacks.append(TrainingCallback(self, wrapper_model=model))

    history = model.train(
        data=os.path.join(directory, 'data.csv'),
        test_split=test_split,
        validation_split=validation_split,
        epochs=epochs,
        batch_size=batch_size,
        early_stopping=early_stopping,
        monitor=monitor,
        patience=patience,
        callbacks=callbacks,
        **kwargs
    )

    evaluation = {
        'train': model.evaluate(model.X_train, model.y_train),
        'test': model.evaluate(model.X_test, model.y_test)
    }

    model.save(directory, save_format=save_format)
    
    store.fput_dir(bucket, f'models/{path}', directory)
    shutil.rmtree(directory)

    return {
        'accuracy': evaluation['test'].get('accuracy'),
        'evaluation': evaluation,
        'history': history,
        'summary': model._get_summary()
    }
