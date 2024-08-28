import random

from .. import worker


@worker.task
def text_classification(X, y, directory, validation_split=0.1, \
                        epochs=200, batch_size=32, embedding_dims=64, dropout=0.2, \
                        early_stopping=True, monitor='val_loss', patience=10, \
                        pruning=True, save_format='tf'):
    
    random.seed(101)

    X, y = map(list, zip(*random.sample(list(zip(X, y)), len(X))))

    from ..scripts.text_classification import TextClassification
    model = TextClassification()
    
    model.train(X, y, validation_split, \
                epochs, batch_size, embedding_dims, dropout, \
                early_stopping, monitor, patience, \
                pruning)
    
    cm, accuracy, report = model.evaluate(X, y)
    
    model.save(directory, save_format=save_format)

    return cm.tolist(), accuracy, report
