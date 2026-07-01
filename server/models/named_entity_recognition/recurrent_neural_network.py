import os
import pickle
import numpy as np
import tensorflow as tf
from .base import BaseNamedEntityRecognition

class RNNNamedEntityRecognition(BaseNamedEntityRecognition):
    """
    RNN-based architecture for Named Entity Recognition (NER).
    Uses Bi-LSTM and Global Average Pooling.
    """
    def __init__(self):
        super().__init__()
        self.architecture = 'recurrent_neural_network'
        self.parameters.update({
            'max_tokens': 10000,
            'sequence_length': 128,
            'embedding_dims': 64,
            'lstm_dims': 100,
            'dropout': 0.2
        })

    def preprocess_x(self, X):
        """
        Cleans and vectorizes text.
        """
        # Simplification for refactoring
        if self.processor is None:
            self.processor = tf.keras.layers.TextVectorization(
                max_tokens=self.parameters.get('max_tokens', 10000),
                output_mode='int',
                output_sequence_length=self.parameters.get('sequence_length', 128)
            )
            self.processor.adapt(X)
        return self.processor(X).numpy().astype(np.int32)

    def tokenize_and_align(self, X, y):
        """
        Standard padding/truncation for RNN.
        """
        X_processed = self.preprocess_x(X)
        seq_len = self.parameters.get('sequence_length', 128)
        
        y_padded = []
        for labels in y:
            if len(labels) > seq_len:
                y_padded.append(labels[:seq_len])
            else:
                y_padded.append(labels + [0] * (seq_len - len(labels)))
        return X_processed, np.array(y_padded)

    def build(self, num_classes, **kwargs):
        """
        Builds the Bi-LSTM model.
        """
        self.parameters.update(kwargs)
        vocab_size = len(self.processor.get_vocabulary())
        embedding_dims = self.parameters.get('embedding_dims', 64)
        lstm_dims = self.parameters.get('lstm_dims', 100)
        dropout = self.parameters.get('dropout', 0.2)
        sequence_length = self.parameters.get('sequence_length', 128)

        model = tf.keras.Sequential([
            tf.keras.layers.Input(shape=(sequence_length,), dtype=tf.int32),
            tf.keras.layers.Embedding(input_dim=vocab_size, output_dim=embedding_dims),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.Bidirectional(tf.keras.layers.LSTM(lstm_dims, return_sequences=True)),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.Dense(num_classes, activation='softmax', name='dense_output')
        ])

        model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
        return model

    def save(self, path, save_format='tf'):
        super().save(path, save_format)

        vocab = self.processor.get_vocabulary()
        with open(os.path.join(path, 'vocab.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(vocab))

        with open(os.path.join(path, 'vectorizer.pkl'), 'wb') as f:
            pickle.dump(self.processor.get_weights(), f)

    @classmethod
    def load(cls, path, **kwargs):
        instance = super().load(path, **kwargs)

        vocab_path = os.path.join(path, 'vocab.txt')
        if os.path.exists(vocab_path):
            with open(vocab_path, 'r', encoding='utf-8') as f:
                vocab = f.read().split('\n')
        else:
            vocab = []

        instance.processor = tf.keras.layers.TextVectorization(
            max_tokens=instance.parameters.get('max_tokens'),
            output_mode='int',
            output_sequence_length=instance.parameters.get('sequence_length')
        )
        if vocab:
            instance.processor.set_vocabulary(vocab)

        vectorizer_path = os.path.join(path, 'vectorizer.pkl')
        if os.path.exists(vectorizer_path):
            with open(vectorizer_path, 'rb') as f:
                instance.processor.set_weights(pickle.load(f))

        save_format = instance.parameters.get('save_format', 'tf')
        instance.model = cls._load_model_file(
            path,
            save_format,
            build_model=lambda: instance.build(num_classes=len(instance.labels)),
            use_signature_runner=kwargs.get('use_signature_runner', False)
        )
        return instance
