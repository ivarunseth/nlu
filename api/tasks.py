import os
import datetime

import pandas as pd

from celery import shared_task


MODELS_DIRECTORY = os.path.join(os.getcwd(), 'data', 'models')


@shared_task
def train(model_dict, filepath, **kwargs):

    # Importing the dataset
    dataset = pd.read_csv(filepath)
    X = dataset.iloc[:, 0].values.tolist()
    y = dataset.iloc[:, 1].values.tolist()

    # Splitting the dataset into the Training set and Test set
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size = 0.20, random_state = 101)

    # Initializing TextClassification model
    from .nlp import TextClassification
    model = TextClassification(**kwargs)

    # Training the Text Classification model on the Training set
    model.train(X_train, y_train)

    # Evaluating the Test set results
    model.evaluate(X_test, y_test)

    # Saving the model after training
    directory = os.path.join(MODELS_DIRECTORY, model.name, model.language, \
                             datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S'))
    model.save(directory)

    return directory
