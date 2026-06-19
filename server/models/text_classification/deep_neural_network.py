import os
import re
import string
import pickle
import tensorflow as tf
from .base import BaseTextClassification

class DNNTextClassification(BaseTextClassification):
    """
    DNN-based architecture for Text Classification.
    Uses TextVectorization and standard Dense layers.
    """
    def __init__(self):
        super().__init__()
        self.processor = None # Will hold TextVectorization layer
        self.architecture = 'deep_neural_network'
        self.parameters.update({
            'max_tokens': 10000,
            'sequence_length': 100,
            'embedding_dims': 64,
            'dropout': 0.2
        })

    def preprocess_x(self, X, progress=False):
        """
        Cleans text and applies vectorization.
        """
        cleaned = []
        for text in X:
            text = str(text).strip().lower()
            text = re.sub('<.*?>', ' ', text)
            text = re.sub('[%s]' % re.escape(string.punctuation), ' ', text)
            cleaned.append(text)
        
        if self.processor is None:
            # This is a bit of a hack because adapt() needs data.
            # In a real scenario, we'd handle this more gracefully.
            max_tokens = self.parameters.get('max_tokens', 10000)
            seq_len = self.parameters.get('sequence_length', 100)
            self.processor = tf.keras.layers.TextVectorization(
                max_tokens=max_tokens,
                output_mode='int',
                output_sequence_length=seq_len
            )
            self.processor.adapt(cleaned)
        
        return self.processor(cleaned).numpy()

    def build(self, num_classes, **kwargs):
        """
        Builds the DNN model.
        """
        self.parameters.update(kwargs)
        embedding_dims = self.parameters.get('embedding_dims', 64)
        dropout = self.parameters.get('dropout', 0.2)
        vocab_size = len(self.processor.get_vocabulary())

        model = tf.keras.models.Sequential([
            tf.keras.layers.Embedding(vocab_size, embedding_dims),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.GlobalAveragePooling1D(),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.Dense(num_classes, activation='softmax', name="dense_output")
        ])

        model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
        return model

    def save(self, path, save_format='tf'):
        """
        Saves model, labels, parameters, and vectorizer vocabulary.
        """
        super().save(path, save_format)
        
        # Save vectorizer weights/vocab specifically for DNN
        vocab = self.processor.get_vocabulary()
        with open(os.path.join(path, 'vocab.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(vocab))
            
        weights = self.processor.get_weights()
        with open(os.path.join(path, 'vectorizer.pkl'), 'wb') as f:
            pickle.dump(weights, f)

    @classmethod
    def load(cls, path, **kwargs):
        """
        Loads model and recreates the processor.
        """
        instance = super().load(path, **kwargs)
        
        # Recreate TextVectorization
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
                weights = pickle.load(f)
                instance.processor.set_weights(weights)

        save_format = instance.parameters.get('save_format', 'tf')
        instance.model = cls._load_model_file(
            path,
            save_format,
            build_model=lambda: instance.build(num_classes=len(instance.labels)),
            use_signature_runner=kwargs.get('use_signature_runner', False)
        )
        return instance
