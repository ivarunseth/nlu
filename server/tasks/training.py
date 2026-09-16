import os

import shutil

from .. import store
from . import sage


@sage.task(bind=True, broadcast_model_room=True)
def train(self, path, model_type, architecture='deep_neural_network', random_state=42, \
          test_split=0.2, validation_split=0.1, epochs=200, batch_size=32, \
          early_stopping=True, monitor='val_loss', patience=10, \
          callbacks=[], save_format='tf', **kwargs):
    
    directory = os.path.join(os.getcwd(), 'data','tmp', path)
    os.makedirs(directory, exist_ok=True)

    bucket = os.environ.get('STORAGE_BUCKET', 'data')
    # The authored dataset and its sidecars (slots.json / entities.json) live
    # under data/; the model reads them internally. Kept as a subfolder of the
    # artifact working dir so the final fput_dir re-uploads it alongside the
    # saved model.
    data_dir = os.path.join(directory, 'data')
    store.fget_dir(bucket, f'models/{path}/data', data_dir)

    import random
    random.seed(random_state)

    from ..models import Model
    model = Model.create(model_type, architecture)

    from ..models.callbacks import AbortCallback, StatusCallback
    callbacks = [AbortCallback(self), StatusCallback(self, model)]

    history = model.train(
        data=data_dir,
        test_split=test_split,
        validation_split=validation_split,
        epochs=epochs,
        batch_size=batch_size,
        early_stopping=early_stopping,
        monitor=monitor,
        patience=patience,
        callbacks=callbacks,
        random_state=random_state,
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
