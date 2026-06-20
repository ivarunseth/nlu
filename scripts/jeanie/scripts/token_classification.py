import os

os.environ['TOKENIZERS_PARALLELISM'] = 'true'
os.environ['TF_FORCE_GPU_ALLOW_GROWTH'] = 'true'

import shutil
import time

import pandas as pd
import numpy as np
import string
import json
import re

from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, confusion_matrix, classification_report

import tensorflow as tf

gpus = tf.config.list_physical_devices('GPU')

from transformers import AutoConfig, AutoTokenizer, TFAutoModelForTokenClassification as AutoModel, create_optimizer

import tf2onnx

from onnxruntime.transformers.optimizer import optimize_model
from onnxruntime.quantization import quant_pre_process, quantize_dynamic

from onnxruntime import InferenceSession


def stratify_and_split(X, y, test_size=0.2, random_state=42):
    return train_test_split(X_filtered, y_filtered, test_size=test_size, random_state=random_state, stratify=[len(x.split()) for x in X])


class NonPaddingLoss(tf.keras.losses.Loss):
    
    
    def __init__(self, name="non_padding_loss"):
        super().__init__(name=name)

    
    def call(self, y_true, y_pred):
        loss_fn = tf.keras.losses.SparseCategoricalCrossentropy(from_logits=False, reduction=tf.keras.losses.Reduction.NONE)
        unmasked_loss = loss_fn(tf.nn.relu(y_true), y_pred)
        loss_mask = tf.cast(y_true >= 0, dtype=unmasked_loss.dtype)
        masked_loss = unmasked_loss * loss_mask
        reduced_masked_loss = tf.reduce_sum(masked_loss) / tf.reduce_sum(loss_mask)
        return tf.reshape(reduced_masked_loss, (1,))


class TokenClassification:
    
    
    def preprocess_X(self, X):
        """
        Preprocess the input text data by cleaning and normalizing it.
        """
        for i, text in enumerate(X):
            text = str(text).strip()
            # text = re.sub('[%s]' % re.escape(string.punctuation), '', text)
            text = re.sub('\s+', ' ', text)
            text = text.lower()
            X[i] = text.split()
        return X

    
    def preprocess_y(self, y):
        """
        Convert labels to their corresponding indices using the configuration.
        """
        for i, tags in enumerate(y):
            tags = str(tags).strip().split()
            for j, tag in enumerate(tags):
                tags[j] = self.config.label2id[tag]
            y[i] = tags
        return y
    
    
    def tokenize(self, X, return_tensors='tf'):
        X = self.tokenizer(
            X, 
            truncation=True, 
            padding='max_length',
            max_length=self.parameters['max_seq_len'],
            is_split_into_words=True, 
            return_tensors=return_tensors
        )
        return {k: v.astype(np.int32) for k, v in X.items()} if return_tensors=='np' else dict(X), X.word_ids


    def tokenize_and_align(self, X, y):
        X, word_ids = self.tokenize(self.preprocess_X(X))
        y = self.preprocess_y(y)
        for i, label in enumerate(y):
            labels = []
            prev = None
            for index in word_ids(batch_index=i):
                if index is None or index == prev:
                    labels.append(-100)
                else:
                    labels.append(label[index])
                prev = index
            y[i] = labels
        return X, tf.convert_to_tensor(y)
    
    
    def build(self):
        """
        Build the text classification model using a pre-trained transformer model.
        """
        sample, _ = self.tokenize(self.preprocess_X(['Hello, World!', 'This is a sample...', 'Testing #1 #2 #3']))

        base = AutoModel.from_pretrained(self.config._name_or_path).layers[0]
        
        base._trainable = self.parameters['trainable']
        
        inputs = [tf.keras.layers.Input((self.parameters['max_seq_len'],), name=k, dtype=tf.int32) for k in sample.keys()]
        
        output = base(inputs).last_hidden_state
        
        output = tf.keras.layers.Dense(self.parameters['units'])(output)
    
        output = tf.keras.layers.Dropout(self.parameters['dropout'])(output)
        
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
            num_warmup_steps=self.parameters['num_warmup_steps'],
        )
        
        model.compile(optimizer=optimizer, loss=NonPaddingLoss())
        
        model.summary()
        
        return model

    
    def train(self, X, y, 
              pretrained_model='distilbert/distilbert-base-uncased', trainable=False, \
              epochs=5, batch_size=16, validation_split=0.1, \
              units=768, dropout=0.15, l2=0.01, learning_rate=1e-2, weight_decay_rate=0.01, num_warmup_steps=0, \
              early_stopping=True, monitor='val_loss', patience=3, min_delta=0.001, \
              callbacks=[]):
        """
        Train the text classification model with the given parameters.
        """
        num_samples = len(X)
        
        max_seq_len = max([len(x) for x in X])
        
        id2label = {i: label for i, label in enumerate(set(tag for tags in y for tag in tags.split()))}
        
        label2id = {label: i for i, label in id2label.items()}
        
        num_labels = len(id2label)
        
        if num_labels < 2: raise ValueError('The dataset must contain atleast two labels.')
        
        self.parameters = {
            'num_samples': num_samples,
            'max_seq_len': max_seq_len,
            'trainable': trainable,
            'epochs': epochs, 
            'batch_size': batch_size, 
            'num_train_steps': (num_samples // batch_size) * epochs,
            'validation_split': validation_split,
            'units': units, 
            'dropout': dropout, 
            'l2': l2, 
            'learning_rate': learning_rate,
            'weight_decay_rate': weight_decay_rate,
            'num_warmup_steps': num_warmup_steps
        }
        
        self.config = AutoConfig.from_pretrained(pretrained_model, id2label=id2label, label2id=label2id, num_labels=num_labels)
                
        if self.config.model_type == 'roberta':
            self.tokenizer = AutoTokenizer.from_pretrained(pretrained_model, use_fast=True, add_prefix_space=True)
        else:
            self.tokenizer = AutoTokenizer.from_pretrained(pretrained_model, use_fast=True)
        
        X, y = self.tokenize_and_align(X, y)
        
        if len(gpus) > 1:
            strategy = tf.distribute.MirroredStrategy()
            
            with strategy.scope(): 
                self.model = self.build()
                
        else:   
            self.model = self.build()
                
        if early_stopping:
            callbacks.append(tf.keras.callbacks.EarlyStopping(monitor, min_delta, patience, restore_best_weights=True))
            
        history = self.model.fit(
            X, y,
            validation_split=validation_split, 
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks
        )
        
        return history
    
    
    def save(self, path, save_format='saved_model'):
        """
        Save the trained model and tokenizer to the specified path.
        """
        if os.path.exists(path): shutil.rmtree(path)
        
        os.makedirs(path, exist_ok=True)
        
        if save_format in {'saved_model', 'tf', 'pb'}:
            self.model.save(path, include_optimizer=False)

        elif save_format in {'weights', 'h5'}:
            self.model.save_weights(os.path.join(path, 'tf_model.h5'))
        
        elif save_format == 'tflite':
            converter = tf.lite.TFLiteConverter.from_keras_model(self.model)
                        
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
        
        self.config.update({'_name_or_path': path})
        
        self.config.save_pretrained(path)
        
        self.parameters['save_format'] = save_format
        
        with open(os.path.join(path, 'parameters.json'), 'w') as parameters_file:
            parameters_file.write(json.dumps(self.parameters, indent=4))
        
    
    @classmethod
    def load(cls, path, **kwargs):
        """
        Load the trained model and tokenizer from the specified path.
        """
        self = cls()
        
        with open(os.path.join(path, 'parameters.json')) as parameters_file:
            self.parameters = json.loads(parameters_file.read())
        
        self.config = AutoConfig.from_pretrained(path)
        
        if self.config.model_type == 'roberta':
            self.tokenizer = AutoTokenizer.from_pretrained(path, use_fast=True, add_prefix_space=True)
        else:
            self.tokenizer = AutoTokenizer.from_pretrained(path, use_fast=True)

        if self.parameters['save_format'] in {'saved_model', 'tf', 'pb'}:
            self.model = tf.keras.models.load_model(path, compile=False)
            self.model.summary()

        elif self.parameters['save_format'] in {'weights', 'h5'}:
            self.model = self.build()
            self.model.load_weights(os.path.join(path, 'tf_model.h5'))

        elif self.parameters['save_format'] == 'tflite':
            self.model = tf.lite.Interpreter(os.path.join(path, 'model.tflite'))
            self.model.allocate_tensors()

            if kwargs.get('use_signature_runner', False):
                self.model = self.model.get_signature_runner(*self.model.get_signature_list())
        
        elif self.parameters['save_format'] == 'onnx':
            providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
            self.model = InferenceSession(os.path.join(path, 'model.onnx'), providers=providers)
        
        else:
            raise ValueError('Invalid value for save_format argument: %s.' % self.parameters['save_format'])
        
        return self
    
    
    def postprocess(self, X, word_ids, outputs):
        """
        Postprocess the predictions to human readable labels and scores.
        """
        predictions = []
        
        for i, output in enumerate(np.argmax(outputs, axis=2)):
            
            indices = word_ids(batch_index=i)
            
            prev = [None, None]
            
            labels = []
            
            for j, prediction in enumerate(output):
                
                index = indices[j]
                
                if index is None or index == prev[0]:
                    continue
                
                label, score = self.config.id2label[prediction], float(outputs[i][j][prediction])
                
                labels.append((label, score))
                
                prev = [index, label]
            
            predictions.append(labels)
        
        return predictions
    
    
    def predict(self, X):
        """
        Predict labels for the given input text.
        """
        inputs, word_ids = self.tokenize(self.preprocess_X(X), return_tensors='np')
        
        if isinstance(self.model, tf.keras.models.Model):
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
        
        elif isinstance(self.model, InferenceSession):            
            outputs = self.model.run(output_names=None, input_feed=inputs)[0]
        
        else:
            outputs = self.model(**inputs)['output']
        
        return self.postprocess(X, word_ids, outputs)
    
    
    def evaluate(self, X, y):
        """
        Evaluate the model on the given test data and print the metrics.
        """
        y_pred = [pred[0] for prediction in self.predict(X) for pred in prediction]
        
        y_true = [_ for _y in y for _ in _y.split()]
        
        accuracy = accuracy_score(y_true, y_pred)
        print(f'\nAccuracy: {accuracy:.2f}')
                
        report = classification_report(y_true, y_pred, zero_division=0)
        print(f'\nClassification Report: \n{report}')
        
        cm = confusion_matrix(y_true, y_pred)
        print(f'Confusion Matrix: \n{cm}\n')
        
        return accuracy, report, cm
    
    
if __name__ == '__main__':

    training = input('\nAre you training (y/n)? ')

    if training == 'y':
                
        # Importing the dataset
        dataset = pd.read_csv(os.path.join(os.getcwd(), './data/examples/voice_assistant.csv'))
        
        # Drop rows with NA values in any column
        dataset = dataset.dropna()
        
        # Reading X and y values
        X = dataset.iloc[:, 0].values.tolist()
        y = dataset.iloc[:, 2].values.tolist()
        
        # Splitting the dataset into the Training set and Test set
        X_train, X_test, y_train, y_test = stratify_and_split(X, y)

        # Initialize TextClassification Object
        classifier = TokenClassification()
                    
        # Training the Text Classification model on the Training set
        classifier.train(
            X_train, y_train, 
            pretrained_model='distilbert-base-uncased',
            trainable=True,
            epochs=100, 
            batch_size=32,
            validation_split=0.10,
            units=768,
            dropout=0.15,
            l2=0.01,
            learning_rate=1e-5
        )
        
        # Evaluating the Test set results
        classifier.evaluate(X_test, y_test)

        # Saving the model after training
        classifier.save('./data/models/voice_assistant/saved_model')
        classifier.save('./data/models/voice_assistant/h5', 'h5')
        classifier.save('./data/models/voice_assistant/tflite', 'tflite')
        classifier.save('./data/models/voice_assistant/onnx', 'onnx')

    # Loading the Text Classification model for prediction
    classifier = TokenClassification.load('./data/models/voice_assistant/onnx')

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
    