# Text Classification (Bag of Words)

# Importing the libraries
import os
import json

from collections import Counter
from datetime import datetime

import pandas as pd
import numpy as np
import pickle
import re

from tqdm import tqdm

from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.naive_bayes import GaussianNB, MultinomialNB, ComplementNB, BernoulliNB
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import confusion_matrix, accuracy_score, classification_report


class TextClassification:


    STOPWORDS_DIRECTORY = os.path.join(os.getcwd(), 'data', 'stopwords')
    UNICODE_RANGES = {
        'english': 'a-zA-Z',
        'hinglish': 'a-zA-Z',
        'hindi': '\u0900-\u097F',
        'marathi': '\u0900-\u097F',
        'gujurati': '\u0A80-\u0AFF',
        'bengali': '\u0980-\u09FF',
        'punjabi': '\u0A00-\u0A7F',
        'tamil': '\u0B80-\u0BFF',
        'telugu': '\u0C00-\u0C7F',
        'odia': '\u0B00-\u0B7F',
        'assamese': '\u0980-\u09FF',
        'kannada': '\u0C80-\u0CFF',
        'malayalam': '\u0D00-\u0D7F'
    }
    DEFAULT_UNICODE_RANGE = ''.join(list(set([value for value in UNICODE_RANGES.values()])))


    def __init__(self, name='bag-of-words', language='english', remove_stopwords=True, stopwords={}, classifier_params={}):
        self.name = name
        self.language = language
        self.unicode_range = self.UNICODE_RANGES.get(self.language, self.DEFAULT_UNICODE_RANGE)
        self.stopwords = stopwords if bool(stopwords) else self.init_stopwords() if remove_stopwords else None
        self.classifier_params = classifier_params
    

    def init_stopwords(self):
        try:
            with open(os.path.join(self.STOPWORDS_DIRECTORY, self.language), encoding='utf-8') as stopwords_file:
                stopwords = set(stopwords_file.read().split('\n'))
            return stopwords
        except FileNotFoundError:
            return None


    def init_classifier(self, name='MultinomialNB', **kwargs):
        if name == 'LogisticRegression':
            self.classifier = LogisticRegression(**kwargs)
        elif name == 'GaussianNB':
            self.classifier = GaussianNB(**kwargs)
        elif name == 'MultinomialNB':
            self.classifier = MultinomialNB(**kwargs)
        elif name == 'ComplementNB':
            self.classifier = ComplementNB(**kwargs)
        elif name == 'BernoulliNB':
            self.classifier = BernoulliNB(**kwargs)
        elif name == 'SVC':
            self.classifier = SVC(**kwargs)
        elif name == 'SGDClassifier':
            self.classifier = SGDClassifier(**kwargs)
        elif name == 'DecisionTreeClassifier':
            self.classifier = DecisionTreeClassifier(**kwargs)
        elif name == 'RandomForestClassifier':
            self.classifier = RandomForestClassifier(**kwargs)
        elif name == 'MLPClassifier':
            self.classifier = MLPClassifier(**kwargs)
        else:
            raise ValueError(f"Invalid classifier 'name' keyword argument: {name}.")


    def preprocess(self, corpus, progress=False):
        for i, text in enumerate(tqdm(corpus, 'Preprocessing', disable=not progress)):
            text = re.sub('[^%s]' % self.unicode_range, ' ', text).lower()
            if self.stopwords is not None:
                words = []
                for word in text.split():
                    if word in self.stopwords:
                        continue
                    words.append(word)
                text = ' '.join(words)
            corpus[i] = text
        return corpus


    def train(self, X, y, **kwargs):
        X = self.preprocess(X, progress=True)
        self.vectorizer = TfidfVectorizer(stop_words=list(self.stopwords) if self.stopwords else None)
        X = self.vectorizer.fit_transform(X)
        self.init_classifier(**self.classifier_params)
        if isinstance(self.classifier, GaussianNB):
            X = X.toarray()
        self.classifier.fit(X, y, **kwargs)
        print(f'Completed training {self.name} {self.language} text classifier')


    def evaluate(self, X, y):
        predictions = self.predict(X)

        cm = confusion_matrix(y, predictions)
        print(f'\nConfusion Matrix: \n{cm}')

        accuracy = accuracy_score(y, predictions)
        print(f'\nAccuracy: {accuracy:.2f}')

        report = classification_report(y, predictions)
        print(f'\nClassification Report: \n{report}')

        return cm, accuracy, report
    

    def save(self, directory):
        os.makedirs(directory, exist_ok=True)

        with open(os.path.join(directory, 'stopwords.txt'), 'w', encoding='utf-8') as stopwords_file:
            stopwords_file.write('\n'.join(list(self.stopwords or {})))

        with open(os.path.join(directory, 'model.pkl'), 'wb') as model_file:
            pickle.dump(self.classifier, model_file)

        with open(os.path.join(directory, 'vectorizer.pkl'), 'wb') as vectorizer_file:
            pickle.dump(self.vectorizer, vectorizer_file)
        
        with open(os.path.join(directory, 'config.json'), 'w') as config_file:            
            json.dump({
                'name': self.name,
                'language': self.language,
                'remove_stopwords': bool(self.stopwords),
                'classifier_params': { 
                    'name': self.classifier.__class__.__name__,
                    **self.classifier.get_params() 
                }
            }, config_file, indent=4)

        print(f'Saved model and config files at: {directory}')


    @staticmethod
    def load(directory):
        with open(os.path.join(directory, 'config.json')) as config_file:
            config = json.load(config_file)
        
        with open(os.path.join(directory, 'stopwords.txt'), encoding='utf-8') as stopwords_file:
            stopwords = set(stopwords_file.read().split('\n'))
        
        model = TextClassification(name=config['name'], 
                                   language=config['language'], 
                                   remove_stopwords=config['remove_stopwords'], 
                                   stopwords=stopwords,
                                   classifier_params=config['classifier_params'])

        with open(os.path.join(directory, 'vectorizer.pkl'), 'rb') as vectorizer_file:
            model.vectorizer = pickle.load(vectorizer_file)

        with open(os.path.join(directory, 'model.pkl'), 'rb') as model_file: 
            model.classifier = pickle.load(model_file)

        print(f'Successfully loaded {model.name} {model.language} text classifier')

        return model


    def predict(self, X):
        X = self.vectorizer.transform(self.preprocess(X))
        if isinstance(self.classifier, GaussianNB):
            X = X.toarray()
        return self.classifier.predict(X)


if __name__ == '__main__':

    # Importing the dataset
    dataset = pd.read_csv(os.path.join(os.getcwd(), 'data', 'examples', 'Restaurant_Reviews.tsv'), delimiter='\t',  quoting=3)
    # dataset = pd.read_csv(os.path.join(os.getcwd(), 'data', 'examples', 'BBC_train_data.tsv'), delimiter='\t',  quoting=3)
    X = dataset.iloc[:, 0].values
    y = dataset.iloc[:, 1].values

    # Splitting the dataset into the Training set and Test set
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size = 0.20, random_state = 101)

    # Training the Text Classification model on the Training set
    model = TextClassification(name='restaurant-reviews', language='english')
    model.train(X_train, y_train)

    # Evaluating the Test set results
    model.evaluate(X_test, y_test)

    # Saving the model after training
    directory = os.path.join(os.getcwd(), 'data', model.name, model.language, datetime.now().strftime('%Y-%m-%d_%H-%M-%S'))
    model.save(directory)

    # Loading the Text Classification model for prediction
    model = TextClassification.load(directory)

    # Predicting new results
    while True:
        sample = str(input('\nEnter a sample: ')).strip()
        if sample == '':
            break
        print(f'Prediction: {model.predict([sample])}')
    