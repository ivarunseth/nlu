from celery import shared_task


@shared_task
def text_classification(X, y, directory):

    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size = 0.10, random_state = 101)
    
    from ..nlp import TextClassification
    model = TextClassification()
    
    history = model.train(X_train, y_train)
    
    confusion_matrix, accuracy, report = model.evaluate(X_test, y_test)
    
    model.save(directory)

    return confusion_matrix.tolist(), accuracy, report, history.history
