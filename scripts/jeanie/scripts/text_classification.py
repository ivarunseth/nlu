import os

os.environ['TOKENIZERS_PARALLELISM'] = 'true'
os.environ['TF_FORCE_GPU_ALLOW_GROWTH'] = 'true'

from collections import Counter
import shutil
import time

import math

import pandas as pd
import numpy as np
import string
import re

from sklearn.metrics import accuracy_score, matthews_corrcoef, confusion_matrix, classification_report, roc_curve, auc
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import label_binarize
from sklearn.utils.class_weight import compute_class_weight

import tensorflow as tf

gpus = tf.config.list_physical_devices('GPU')

from transformers import AutoConfig, AutoTokenizer, TFAutoModel as AutoModel, create_optimizer

import tf2onnx

from onnxruntime.transformers.optimizer import optimize_model
from onnxruntime.quantization import quant_pre_process, quantize_dynamic

from onnxruntime import InferenceSession


def stratify_and_split(X, y, test_size=0.2, random_state=42):
    
    stratify = [f'{label}_{len(text.split())}' for label, text in zip(y, X)]

    counts = Counter(stratify)
    
    X_filtered, y_filtered = [], []
    X_ignored, y_ignored = [], []
    stratify_filtered = []

    for i in range(len(X)):
        if counts[stratify[i]] < 2:
            X_ignored.append(X[i])
            y_ignored.append(y[i])
        else:
            X_filtered.append(X[i])
            y_filtered.append(y[i])
            stratify_filtered.append(stratify[i])

    X_train, X_test, y_train, y_test = train_test_split(X_filtered, y_filtered, 
                                                        test_size=test_size, 
                                                        random_state=random_state, 
                                                        stratify=stratify_filtered)

    X_train.extend(X_ignored)
    y_train.extend(y_ignored)
        
    return X_train, X_test, y_train, y_test


class TextClassification:


    def preprocess_X(self, X):
        """
        Preprocess the input text data by cleaning and normalizing it.
        """
        for i, text in enumerate(X):
            text = str(text).strip()
            text = re.sub('\s+', ' ', text)
            X[i] = text

        return self.tokenize(X)


    def preprocess_y(self, y):
        """
        Convert labels to their corresponding indices using the configuration.
        """
        return np.asarray([self.config.label2id[label] for label in y]).astype(np.int32)
    
    
    def tokenize(self, X):
        """
        Tokenize the input text data using the tokenizer from Hugging Face Transformers.
        """
        X = self.tokenizer(X, truncation=True, padding='max_length', max_length=self.parameters['max_seq_len'], return_tensors='np')
        
        return {key: np.asarray(X[key]).astype(np.int32) for key in ['input_ids', 'attention_mask']}
    
    
    def build(self):
        """
        Build the text classification model using a pre-trained transformer model.
        """
        sample = self.preprocess_X(['Hello, World!'])
        
        inputs = [tf.keras.layers.Input((self.parameters['max_seq_len'],), name=key, dtype=np.int32) for key in sample]
        
        base = AutoModel.from_pretrained(self.config._name_or_path).layers[0]
        
        base._trainable = self.parameters['trainable']
        
        output = base(inputs).last_hidden_state
        
        output = tf.keras.layers.GlobalAveragePooling1D()(output)
        
        output = tf.keras.layers.Dropout(self.parameters['dropout'])(output)
        
        output = tf.keras.layers.Dense(self.parameters['units'])(output)
        
        output = tf.keras.layers.Activation('relu')(output)
                
        output = tf.keras.layers.Dense(
            self.config.num_labels, 
            activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(l2=self.parameters['l2']),
            name='output'
        )(output)

        model = tf.keras.models.Model(inputs=inputs, outputs=output)
        
        optimizer, _ = create_optimizer(
            init_lr=self.parameters['learning_rate'],
            num_train_steps=self.parameters['num_train_steps'],
            weight_decay_rate=self.parameters['weight_decay_rate'],
            num_warmup_steps=self.parameters['num_warmup_steps']
        )

        loss = tf.keras.losses.SparseCategoricalCrossentropy(from_logits=False)
        
        model.compile(optimizer=optimizer, loss=loss, metrics=['accuracy'])
        
        model.summary()
        
        return model
    
    
    def train(self, X, y, 
              pretrained_model='distilbert/distilbert-base-uncased', trainable=False, \
              epochs=5, batch_size=16, validation_split=0.1, \
              units=768, dropout=0.15, l2=0.01, learning_rate=1e-2, \
              weight_decay_rate=0.01, num_warmup_steps=0, \
              early_stopping=True, monitor='val_loss', patience=3, min_delta=0.001, \
              callbacks=[]):
        """
        Train the text classification model with the given parameters.
        """        
        max_seq_len = max([len(x.split()) for x in X])
        
        id2label = {i: label for i, label in enumerate(set(y))}
        
        label2id = {label: i for i, label in id2label.items()}
        
        num_labels = len(id2label)
        
        if num_labels < 2: raise ValueError('The dataset must contain atleast two labels.')
        
        self.config = AutoConfig.from_pretrained(pretrained_model, id2label=id2label, label2id=label2id, num_labels=num_labels)
        
        self.parameters = {
            'max_seq_len': max_seq_len,
            'trainable': trainable,
            'epochs': epochs, 
            'batch_size': batch_size, 
            'num_train_steps': math.ceil((len(X) * (1 - validation_split) / batch_size) * epochs), 
            'validation_split': validation_split, 
            'units': units,
            'dropout': dropout, 
            'l2': l2, 
            'learning_rate': learning_rate,
            'weight_decay_rate': weight_decay_rate, 
            'num_warmup_steps': num_warmup_steps 
        }
        
        self.tokenizer = AutoTokenizer.from_pretrained(pretrained_model, keep_accents=True, config=self.config)

        X = self.preprocess_X(X)
                
        y = self.preprocess_y(y)
        
        if len(gpus) > 1:
            strategy = tf.distribute.MirroredStrategy()
            
            with strategy.scope(): 
                self.model = self.build()
        else:
            self.model = self.build()
        
        if early_stopping:
            callbacks.append(tf.keras.callbacks.EarlyStopping(monitor, min_delta, patience, restore_best_weights=True))

        class_weight = compute_class_weight('balanced', classes=np.unique(y), y=y)
            
        self.history = self.model.fit(
            X, y,
            validation_split=validation_split, 
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            class_weight=dict(enumerate(class_weight))
        )

        self.parameters['epochs'] = len(self.history.history['loss'])
        
        return self.history
    
    
    def save(self, path, save_format='saved_model'):
        """
        Save the trained model and tokenizer to the specified path.
        """
        if os.path.exists(path):
            shutil.rmtree(path)
        
        os.makedirs(path, exist_ok=True)
        
        if save_format in {'saved_model', 'tf', 'pb'}:
            self.model.save(path, include_optimizer=False)

        elif save_format in {'weights', 'h5'}:
            self.model.save_weights(os.path.join(path, 'tf_model.h5'))
        
        elif save_format == 'tflite':
            converter = tf.lite.TFLiteConverter.from_keras_model(self.model)
            
            converter._experimental_lower_tensor_list_ops = False
            
            converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS, tf.lite.OpsSet.SELECT_TF_OPS]
            
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            
            with tf.io.gfile.GFile(os.path.join(path, 'model.tflite'), 'wb') as model_file:
                model_file.write(converter.convert())
        
        elif save_format == 'onnx':
            model_path = os.path.join(path, 'model.onnx')
            
            tf2onnx.convert.from_keras(self.model, output_path=model_path)
                        
            quant_pre_process(model_path, model_path, skip_symbolic_shape=True)
            
            quantize_dynamic(model_path, model_path)
        
        else:
            raise ValueError('Invalid value for save_format argument: %s.' % save_format)

        self.tokenizer.save_pretrained(path)
                
        self.config.save_pretrained(path)

        self.parameters['save_format'] = save_format
        
        with open(os.path.join(path, 'parameters.json'), 'w') as parameters_file:
            parameters_file.write(json.dumps(self.parameters, indent=4))
        
        if isinstance(self.model, tf.keras.models.Model):
            with open(os.path.join(path, 'summary.txt'), 'w') as summary_file:
                self.model.summary(print_fn=lambda x: summary_file.write(x + '\n'))
        
        if self.history:
            with open(os.path.join(path, 'history.json'), 'w') as history_file:
                history_file.write(json.dumps(self.history.history, indent=4))
        
    
    @staticmethod
    def load(path, **kwargs):
        """
        Load the trained model and tokenizer from the specified path.
        """
        classifier = TextClassification()
        
        classifier.config = AutoConfig.from_pretrained(path)
        
        classifier.tokenizer = AutoTokenizer.from_pretrained(path)
        
        if classifier.parameters['save_format'] in {'saved_model', 'tf', 'pb'}:
            classifier.model = tf.keras.models.load_model(path)
            classifier.model.summary()

        elif classifier.parameters['save_format'] in {'weights', 'h5'}:
            classifier.model = classifier.build()
            classifier.model.load_weights(os.path.join(path, 'tf_model.h5'))

        elif classifier.parameters['save_format'] == 'tflite':
            classifier.model = tf.lite.Interpreter(os.path.join(path, 'model.tflite'))
            classifier.model.allocate_tensors()

            if kwargs.get('use_signature_runner', False):
                classifier.model = classifier.model.get_signature_runner(*classifier.model.get_signature_list())
        
        elif classifier.parameters['save_format'] == 'onnx':
            providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
            classifier.model = InferenceSession(os.path.join(path, 'model.onnx'), providers=providers)
        
        else:
            raise ValueError('Invalid value for save_format argument: %s.' % classifier.parameters['save_format'])
        
        return classifier
    
    
    def serialize(self, index, score, use_threshold=True):
        """
        Serialize the prediction to a dictionary.
        """
        label = self.config.id2label[index]
        threshold = self.config.thresholds.get(label, float('-inf'))
        if use_threshold and score < threshold:
            label, score = None, 1 - score
        return {'label': label, 'score': float(score, 3)}

    
    def postprocess(self, outputs, use_threshold=True):
        """
        Postprocess the predictions to human readable labels and scores.
        """
        return [self.serialize(index, outputs[i][index], use_threshold) for i, index in enumerate(np.argmax(outputs, axis=1))]
    
    
    def predict(self, X, use_threshold=True):
        """
        Predict labels for the given input text.
        """
        inputs = self.preprocess_X(X)

        if isinstance(self.model, InferenceSession):
            outputs = self.model.run(output_names=['output'], input_feed=inputs)[0]
        
        elif isinstance(self.model, tf.keras.models.Model):
            outputs = self.model.predict(inputs, use_multiprocessing=True, verbose=0)
        
        elif isinstance(self.model, tf.lite.Interpreter): 
            input_details = self.model.get_input_details()

            for i, name in enumerate(sorted(inputs.keys())):
                self.model.resize_tensor_input(input_details[i]['index'], inputs[name].shape)
                
                self.model.allocate_tensors()

                self.model.set_tensor(input_details[i]['index'], inputs[name])

            self.model.invoke()

            output_details = self.model.get_output_details()
            
            outputs = self.model.get_tensor(output_details[0]['index'])
        
        else:
            outputs = self.model(**inputs)['output']
            
        return self.postprocess(outputs, use_threshold)
    
    
    def evaluate(self, X, y):
        """
        Evaluate the model on the given test data and print the metrics.
        """
        predictions = self.predict(X, use_threshold=False)

        indices, labels, scores = [], [], []

        for prediction in predictions:
            indices.append(self.config.label2id[prediction['label']])
            labels.append(prediction['label'])
            scores.append(prediction['score'])
        
        y_bin = label_binarize(y, classes=list(self.config.label2id.values()))
        scores_bin = label_binarize(indices, classes=list(self.config.label2id.values()))

        self.config.thresholds = {}

        for i in range(y_bin.shape[1]):
            fpr, tpr, thresholds = roc_curve(y_bin[:, i], scores_bin[:, i])

            roc_auc = auc(fpr, tpr)
            print(f'\nClass {self.config.id2label[i]} - ROC AUC: {roc_auc:.2f}')
            
            threshold = thresholds[np.argmax(tpr - fpr)]
            print(f'\nOptimal Threshold for Class {self.config.id2label[i]}: {threshold:.2f}')

            self.config.thresholds[self.config.id2label[i]] = threshold

        accuracy = accuracy_score(y, labels)
        print(f'\nAccuracy: {accuracy:.2f}')
        
        matthews_coefficient = matthews_corrcoef(y, labels)
        print(f'\nMatthews Coefficient: {matthews_coefficient:.2f}')
        
        report = classification_report(y, labels, zero_division=0)
        print(f'\nClassification Report: \n{report}')
        
        cm = confusion_matrix(y, labels)
        print(f'Confusion Matrix: \n{cm}\n')
        
        return accuracy, matthews_coefficient, report, cm
    
    
if __name__ == '__main__':

    training = input('\nAre you training (y/n)? ')

    if training == 'y':
                
        # Importing the dataset
        dataset = pd.read_csv(os.path.join(os.getcwd(), './data/examples/voice_assistant.csv'))
        
        # Drop rows with NA values in any column
        dataset = dataset.dropna()
        
        # Reading X and y values
        X = dataset.iloc[:, 0].values.tolist()
        y = dataset.iloc[:, 1].values.tolist()

        # Splitting the dataset into the Training set and Test set
        X_train, X_test, y_train, y_test = stratify_and_split(X, y)

        # Initialize TextClassification Object
        classifier = TextClassification()
                    
        # Training the Text Classification model on the Training set
        classifier.train(
            X_train, y_train, 
            pretrained_model='distilbert-base-uncased',
            trainable=False,
            epochs=5, 
            batch_size=16,
            validation_split=0.10,
            units=768,
            dropout=0.15,
            l2=0.01,
            learning_rate=2e-5
        )
        
        # Evaluating the Test set results
        classifier.evaluate(X_test, y_test)

        # Saving the model after training
        classifier.save('./data/models/voice_assistant/saved_model')
        classifier.save('./data/models/voice_assistant/h5', 'h5')
        classifier.save('./data/models/voice_assistant/tflite', 'tflite')
        classifier.save('./data/models/voice_assistant/onnx', 'onnx')

    # Loading the Text Classification model for prediction
    classifier = TextClassification.load('./data/models/voice_assistant/onnx')

    # Predicting new results
    while True:
        inputs = str(input('\nInputs: ')).strip()
        
        if not inputs or inputs == '' or inputs.isspace(): break
        
        inputs = inputs.split(';')
        
        t = time.time() * 1000
        
        prediction = classifier.predict(inputs)
        
        latency = time.time() * 1000 - t
        
        print(f'Prediction: {prediction}')
        print(f'Latency: {int(latency)} milliseconds')
    