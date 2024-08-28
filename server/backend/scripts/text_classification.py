# Text Classification

# Importing the libraries
import os

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


class TextClassification:


    def preprocess_X(self, X, progress=False):
        for i, text in enumerate(tqdm(X, 'Preprocessing', disable=not progress)):
            text = str(text).strip().lower()
            text = re.sub('<.*?>', ' ', text)
            text = re.sub('[%s]' % re.escape(string.punctuation), ' ', text)
            X[i] = text
        return np.array(X)
    

    def preprocess_y(self, y):
        inversed_labels = {label: int(i) for i, label in self.labels.items()}
        return np.array([inversed_labels[label] for label in y])


    def vectorize(self, X):
        return self.vectorizer(X).numpy()


    def train(self, X, y, validation_split=0.1, epochs=200, \
              batch_size=32, embedding_dims=64, dropout=0.2, \
              early_stopping=True, monitor='val_loss', patience=10, \
              pruning=False):
        
        X = self.preprocess_X(X, progress=True)
        print(f'\n{X.shape=}')
        
        self.labels = {str(i): label for i, label in enumerate(set(y))}
        y = self.preprocess_y(y)
        print(f'\n{y.shape=}')

        max_tokens = len(Counter(' '.join(X).split()))
        print(f'\n{max_tokens=}')
        
        sequence_length = max([len(text) for text in X])
        print(f'\n{sequence_length=}')
        
        num_classes = len(np.unique(y))
        print(f'\n{num_classes=}\n')

        self.vectorizer = tf.keras.layers.TextVectorization(
            max_tokens=max_tokens,
            output_mode='int',
            output_sequence_length=sequence_length)
        
        self.vectorizer.adapt(X)
        
        X = self.vectorize(X)
        
        self.classifier = tf.keras.models.Sequential([
            tf.keras.layers.Embedding(len(self.vectorizer.get_vocabulary()), embedding_dims),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.GlobalAveragePooling1D(),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.Dense(num_classes, activation='softmax', name="dense_output")])

        if pruning:
            pruning_params = {
                'pruning_schedule': tfmot.sparsity.keras.PolynomialDecay(
                    initial_sparsity=0.50,
                    final_sparsity=0.80,
                    begin_step=0,
                    end_step=np.ceil(X.shape[0] * (1 - validation_split) / batch_size).astype(np.int32) * epochs)
            }
            self.classifier = tfmot.sparsity.keras.prune_low_magnitude(self.classifier, **pruning_params)
 
        self.classifier.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])

        self.classifier.summary()
        
        callbacks = []

        if early_stopping:
            callbacks += [tf.keras.callbacks.EarlyStopping(monitor=monitor, patience=patience, restore_best_weights=True)]
        
        if pruning:
            callbacks += [tfmot.sparsity.keras.UpdatePruningStep()]

        history = self.classifier.fit(
            X, y,
            validation_split=validation_split, 
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks)
        
        if pruning: 
            self.classifier = tfmot.sparsity.keras.strip_pruning(self.classifier)
            self.classifier.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
        
        self.params = {
            'max_tokens': max_tokens,
            'sequence_length': sequence_length,
            'num_classes': num_classes,
            'validation_split': validation_split,
            'epochs': epochs,
            'batch_size': batch_size,
            'embedding_dims': embedding_dims,
            'dropout': dropout,
            'monitor': monitor,
            'patience': patience,
            'pruning': pruning
        }

        print(f'\nCompleted training text classifier')

        return history


    def evaluate(self, X, y, verbose=0):
        predictions = [prediction[0] for prediction in self.predict(X, verbose=verbose)]

        cm = confusion_matrix(y, predictions)
        print(f'\nConfusion Matrix: \n{cm}')

        accuracy = accuracy_score(y, predictions)
        print(f'\nAccuracy: {accuracy:.2f}')

        report = classification_report(y, predictions)
        print(f'\nClassification Report: \n{report}')

        return cm, accuracy, report
    

    def save(self, directory, save_format='tf'):
        os.makedirs(directory, exist_ok=True)

        with open(os.path.join(directory, 'labels.txt'), 'w', encoding='utf-8') as labels_file:
            labels_file.write(json.dumps(self.labels, ensure_ascii=False, indent=4))

        with open(os.path.join(directory, 'params.txt'), 'w') as params_file:
            params_file.write(json.dumps({**self.params, 'save_format': save_format}, indent=4))
        
        with open(os.path.join(directory, 'vocab.txt'), 'w', encoding='utf-8') as vocab_file:
            vocab_file.write('\n'.join(self.vectorizer.get_vocabulary()))

        with open(os.path.join(directory, 'vectorizer.pkl'), 'wb') as vectorizer_file:
            pickle.dump(self.vectorizer.get_weights(), vectorizer_file)

        if save_format == 'tf':
            tf.keras.models.save_model(self.classifier, os.path.join(directory, 'model'), include_optimizer=False)
        elif save_format == 'keras':
            tf.keras.models.save_model(self.classifier, os.path.join(directory, 'model.keras'))
        elif save_format == 'h5':
            tf.keras.models.save_model(self.classifier, os.path.join(directory, 'model.h5'), include_optimizer=False)
        elif save_format == 'tflite':
            converter = tf.lite.TFLiteConverter.from_keras_model(self.classifier)
            converter._experimental_lower_tensor_list_ops = False
            converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS, tf.lite.OpsSet.SELECT_TF_OPS]
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            self.classifier = converter.convert()
            with open(os.path.join(directory, 'model.tflite'), 'wb') as model_file:
                model_file.write(self.classifier)
        elif save_format == 'onnx':
            self.classifier, _ = tf2onnx.convert.from_keras(self.classifier, output_path=os.path.join(directory, 'model.onnx'))
        else:
            raise ValueError(f'Invalid value for save_format argument: {save_format}. Choose from tf, keras, h5, tflite or onnx.')

        print(f'Saved model and config files at: {directory}\n')


    @staticmethod
    def load(directory):
        model = TextClassification()

        with open(os.path.join(directory, 'labels.txt'), 'r', encoding='utf-8') as labels_file:
            model.labels = json.loads(labels_file.read())
        
        with open(os.path.join(directory, 'params.txt'), 'r') as params_file:
            model.params = json.loads(params_file.read())
        
        model.vectorizer = tf.keras.layers.TextVectorization(
            max_tokens=model.params['max_tokens'],
            output_mode='int',
            output_sequence_length=model.params['sequence_length'])
        
        with open(os.path.join(directory, 'vocab.txt'), 'r', encoding='utf-8') as vocab_file:
            model.vectorizer.set_vocabulary(vocab_file.read().split('\n'))

        with open(os.path.join(directory, 'vectorizer.pkl'), 'rb') as vectorizer_file:
            model.vectorizer.set_weights(pickle.load(vectorizer_file))
        
        if model.params['save_format'] == 'tf':
            model.classifier = tf.keras.models.load_model(os.path.join(directory, 'model'), compile=False)
            model.classifier.summary()
        elif model.params['save_format'] == 'keras':
            model.classifier = tf.keras.models.load_model(os.path.join(directory, 'model.keras'), compile=False)
            model.classifier.summary()
        elif model.params['save_format'] == 'h5':
            model.classifier = tf.keras.models.load_model(os.path.join(directory, 'model.h5'), compile=False)
            model.classifier.summary()
        elif model.params['save_format'] == 'tflite':
            model.classifier = tf.lite.Interpreter(model_path=os.path.join(directory, 'model.tflite'))
        elif model.params['save_format'] == 'onnx':
            model.classifier = onnxruntime.InferenceSession(os.path.join(directory, 'model.onnx'), providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
        else:
            raise ValueError('Invalid value for save_format argument: %s. Choose from tf, keras, h5, tflite or onnx.' % model.params['save_format'])

        print(f'\nSuccessfully loaded text classifier')

        return model


    def predict(self, X, verbose=0):
        X = self.vectorize(self.preprocess_X(X))

        if isinstance(self.classifier, onnxruntime.InferenceSession):
            prediction = self.classifier.run(output_names=['dense_output'], input_feed={'embedding_input': np.array(X).astype(np.float32)})[0]
        elif isinstance(self.classifier, tf.lite.Interpreter):
            input_details = self.classifier.get_input_details()[0]
            output_details = self.classifier.get_output_details()[0]
            self.classifier.resize_tensor_input(input_details['index'], X.shape)
            self.classifier.allocate_tensors()
            self.classifier.set_tensor(input_details['index'], X.astype(input_details['dtype']))
            self.classifier.invoke()
            prediction = self.classifier.get_tensor(output_details['index'])
        else:
            prediction = self.classifier.predict(X, verbose=verbose)

        if len(prediction[0]) == 1:
            prediction = [(self.labels['0'], 1 - prediction[i][0]) if prediction[i][0] < 0.5 else \
                          (self.labels['1'], prediction[i][0]) for i in range(len(prediction))]
        else:
            prediction = [(self.labels[str(index)], prediction[i][index]) for i, index in enumerate(np.argmax(prediction, axis=1))]

        return prediction


if __name__ == '__main__':
    
    # Importing the dataset
    # dataset = pd.read_csv(os.path.join(os.getcwd(), 'data', 'examples', 'BBC_train_data.tsv'), delimiter='\t',  quoting=3)
    # dataset = pd.read_csv(os.path.join(os.getcwd(), 'data', 'examples', 'bengali_hate_v2.0.csv'))
    dataset = pd.read_csv(os.path.join(os.getcwd(), 'data', 'examples', 'Restaurant_Reviews.tsv'), delimiter='\t',  quoting=3)
    # dataset = pd.read_csv(os.path.join(os.getcwd(), 'data', 'examples', 'IMDB Dataset.csv'))
    # dataset = pd.read_csv(os.path.join(os.getcwd(), 'data', 'examples', 'telugu_news_dataset.csv'))

    X = dataset.iloc[:, 0].values.astype(str)
    y = dataset.iloc[:, 1].values.astype(str)

    # Splitting the dataset into the Training set and Test set
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.10, random_state=101)

    # Training the Text Classification model on the Training set
    model = TextClassification()
    model.train(X_train, y_train, pruning=True)

    # Evaluating the Test set results
    model.evaluate(X_test, y_test)

    # Saving the model after training
    directory = os.path.join(os.getcwd(), 'data', 'models', 'reviews', 'english', datetime.now().strftime('%Y-%m-%d_%H-%M-%S'))
    model.save(directory)

    # Loading the Text Classification model for prediction
    model = TextClassification.load(directory)

    # Predicting new results
    while True:
        utterance = str(input('\nEnter an utterance: ')).strip()
        if utterance == '':
            break
        print(f'Prediction: {model.predict([utterance])[0]}')
    