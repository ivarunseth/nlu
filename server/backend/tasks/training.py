from .. import worker


@worker.task
def text_classification(X, y, directory, test_split=0.1, validation_split=0.1, \
                        epochs=200, batch_size=32, embedding_dims=64, dropout=0.2, \
                        early_stopping=True, monitor='val_loss', patience=10, \
                        pruning=True, save_format='tf'):

    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_split, random_state = 101)
    
    from ..scripts import TextClassification
    model = TextClassification()
    
    history = model.train(X_train, y_train, validation_split, \
                          epochs, batch_size, embedding_dims, dropout, \
                          early_stopping, monitor, patience, \
                          pruning)
    
    train_cm, train_accuracy, train_report = model.evaluate(X_train, y_train)
    test_cm, test_accuracy, test_report = model.evaluate(X_test, y_test)
    
    model.save(directory, save_format=save_format)

    return history.history, train_cm.tolist(), train_accuracy, train_report, \
        test_cm.tolist(), test_accuracy, test_report
