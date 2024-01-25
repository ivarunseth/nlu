import os

os.environ['TF_FORCE_GPU_ALLOW_GROWTH'] = 'true'

import string
import json

from collections import Counter
from datetime import datetime

import pandas as pd
import numpy as np
import pickle
import re

from tqdm import tqdm

from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, accuracy_score, classification_report

import tensorflow as tf

tf.compat.v1.enable_eager_execution()

import tensorflow_model_optimization as tfmot

import tf2onnx
import onnxruntime


class NamedEntityRecognition:
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

    def __init__(self, name='ner_model', language='english', remove_stopwords=True, stopwords=None):
        self.name = name
        self.language = language
        self.unicode_range = self.UNICODE_RANGES.get(self.language, self.DEFAULT_UNICODE_RANGE)
        self.stopwords = stopwords if stopwords else self.init_stopwords() if remove_stopwords else None
        self.labels = None
        self.tokenizer = None
        self.model = None

    def init_stopwords(self):
        try:
            with open(os.path.join(self.STOPWORDS_DIRECTORY, self.language), encoding='utf-8') as stopwords_file:
                stopwords = set(stopwords_file.read().split('\n'))
            return stopwords
        except FileNotFoundError:
            return None

    def init_classifier(self, num_classes, embedding_dims=16, lstm_dims=100, dropout=0.2):
        model = tf.keras.Sequential([
            tf.keras.layers.Embedding(input_dim=len(self.tokenizer.word_index) + 1, output_dim=embedding_dims),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.Bidirectional(tf.keras.layers.LSTM(lstm_dims, return_sequences=True)),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.GlobalAveragePooling1D(),
            tf.keras.layers.Dense(num_classes, activation='softmax', name='dense_output')
        ])

        model.summary()

        model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])

        return model

    def preprocess(self, data):
        for i, pattern in enumerate(data):
            text = str(pattern)
            for entity in re.findall(r'{(.*?)}', pattern):
                label, value = entity.split(':')
                text = text.replace(entity, value)
            tags = []
            for entity in re.findall(r'{(.*?)}', text):
                label, value = entity.split(':')
                start = text.index(entity)
                end = start + len(entity)
                tags.append((start, end, label))
            data[i] = (text, tags)
        return data

    def train(self, X, y, validation_split=0.1, seed=42, embedding_dims=16, dropout=0.2,
              epochs=200, batch_size=32, monitor='val_loss', patience=10):

        X = self.preprocess_X(X, progress=True)
        print(f'\n{X.shape=}')

        max_tokens = len(Counter(' '.join(X).split()))
        print(f'\n{max_tokens=}')

        sequence_length = max([len(text) for text in X])
        print(f'\n{sequence_length=}')

        iob_data = self.convert_to_iob_sequences(y)
        self.labels = {label: i for i, label in enumerate(set(label for _, entities in iob_data for _, _, label in entities))}
        y = [entities for _, entities in iob_data]
        print(f'\n{y[:2]=}')

        num_classes = len(set(self.labels.values())) + 1
        print(f'\n{num_classes=}\n')

        X_train, X_valid, y_train, y_valid = train_test_split(X, y, test_size=validation_split, random_state=seed)

        self.tokenizer = Tokenizer()
        self.tokenizer.fit_on_texts(X_train)

        X_train = pad_sequences(self.tokenizer.texts_to_sequences(X_train), maxlen=sequence_length)
        X_valid = pad_sequences(self.tokenizer.texts_to_sequences(X_valid), maxlen=sequence_length)

        y_train = self.convert_to_iob_sequences(y_train, sequence_length)
        y_valid = self.convert_to_iob_sequences(y_valid, sequence_length)

        self.model = self.init_classifier(
            num_classes=num_classes,
            embedding_dims=embedding_dims,
            dropout=dropout)

        early_stopping = tf.keras.callbacks.EarlyStopping(
            monitor=monitor,
            patience=patience,
            restore_best_weights=True)

        history = self.model.fit(
            X_train, y_train,
            validation_data=[X_valid, y_valid],
            epochs=epochs,
            batch_size=batch_size,
            callbacks=[early_stopping])

        return history

    def convert_to_iob_sequences(self, patterns, sequence_length):
        iob_sequences = []
        for pattern in patterns:
            iob_sequence = np.zeros((sequence_length, len(self.labels) + 1))
            for start, end, label in pattern:
                iob_sequence[start:end + 1, self.labels[label]] = 1
            iob_sequences.append(iob_sequence)
        return np.array(iob_sequences)

    def evaluate(self, X, y):
        X = self.preprocess_X(X)
        y = self.convert_to_iob_sequences(self.convert_to_iob_format(y), len(X[0]))
        return self.model.evaluate(X, y)

    def save(self, directory, save_format='tf'):
        os.makedirs(directory, exist_ok=True)

        self.model.save(directory, save_format=save_format)

        with open(os.path.join(directory, 'assets', 'labels.pkl'), 'wb') as labels_file:
            pickle.dump(self.labels, labels_file)

        with open(os.path.join(directory, 'assets', 'tokenizer.pkl'), 'wb') as tokenizer_file:
            pickle.dump(self.tokenizer, tokenizer_file)

        with open(os.path.join(directory, 'config.json'), 'w') as config_file:
            classifier_config = {
                'name': self.model.__class__.__name__,
                **self.model.get_config()
            }
            config = {
                'name': self.name,
                'language': self.language,
                'remove_stopwords': bool(self.stopwords),
                'classifier_config': classifier_config
            }
            json.dump(config, config_file, indent=4)

        print(f'\nSaved model and config files at: {directory}')

    @staticmethod
    def load(directory):
        with open(os.path.join(directory, 'config.json')) as config_file:
            config = json.load(config_file)

        with open(os.path.join(directory, 'assets', 'tokenizer.pkl'), 'rb') as tokenizer_file:
            tokenizer = pickle.load(tokenizer_file)

        model = load_model(directory)

        with open(os.path.join(directory, 'assets', 'labels.pkl'), 'rb') as labels_file:
            labels = pickle.load(labels_file)

        ner_model = NamedEntityRecognition(name=config['name'],
                                           language=config['language'],
                                           remove_stopwords=config['remove_stopwords'],
                                           stopwords=None)  # Assuming stopwords were not saved

        ner_model.model = model
        ner_model.labels = labels
        ner_model.tokenizer = tokenizer

        print(f'\nSuccessfully loaded {ner_model.name} {ner_model.language} NER model')

        return ner_model

    def predict(self, X):
        X_preprocessed = self.preprocess_X(X)
        X_sequences = self.tokenizer.texts_to_sequences(X_preprocessed)
        X_padded = pad_sequences(X_sequences, maxlen=len(X_sequences[0]))
        predictions = self.model.predict(X_padded)

        # Convert predictions to entity labels
        predicted_labels = []
        for i, prediction in enumerate(predictions):
            entities = []
            for j, label_probs in enumerate(prediction):
                if np.argmax(label_probs) != 0:
                    entities.append((j, j, list(self.labels.keys())[np.argmax(label_probs)]))
            predicted_labels.append(entities)

        return predicted_labels


if __name__ == '__main__':

    # Sample data
    sample_data = [
        "{datetime:Todays} date please",
        "What will be the date in {location:India}"
        # Add more sample data
    ]

    # Sample labels
    sample_labels = [
        [(1, 9, 'datetime')],
        [(26, 31, 'location')]
        # Add more sample labels
    ]

    # Create an instance of the NamedEntityRecognition class
    ner_model = NamedEntityRecognition(name='ner_model', language='english', remove_stopwords=False)

    # Train the model on the sample data
    history = ner_model.train(sample_data, sample_labels, epochs=10, batch_size=32)

    # Evaluate the model on the sample data
    loss, accuracy = ner_model.evaluate(sample_data, sample_labels)
    print(f'Loss: {loss}, Accuracy: {accuracy}')

    # Save the trained model
    # model_directory = 'path/to/save/model'
    # ner_model.save(model_directory)

    # Load the saved model
    # loaded_ner_model = NamedEntityRecognition.load(model_directory)

    # Predict entities for new text
    new_text = "Please provide the date for {location:New York}"
    predictions = ner_model.predict([new_text])
    print(predictions)
