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

    import pandas as pd
    data = pd.read_csv(os.path.join(directory, 'data.csv'))

    X = data['X'].tolist()
    y = data['y'].tolist()

    if len(X) > 2:
        from sklearn.model_selection import train_test_split
        try:
            X_train, X_test, y_train, y_test = \
                train_test_split(X, y, test_size=test_split, random_state=101, stratify=y)
        except ValueError:
            X_train, X_test, y_train, y_test = \
                train_test_split(X, y, test_size=test_split, random_state=101)
    else:
        X_train, y_train, X_test, y_test  = X, y, [], []

    from ..models import Model
    model = Model.create(model_type, architecture)

    from ..models.callbacks import TrainingCallback
    callbacks.append(TrainingCallback(self, wrapper_model=model))
    
    history = model.train(
        X_train, y_train, 
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
        'train': model.evaluate(X_train, y_train),
        'test': model.evaluate(X_test, y_test)
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
