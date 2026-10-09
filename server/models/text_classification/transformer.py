import os
import numpy as np
import tensorflow as tf
from transformers import AutoConfig, AutoTokenizer, TFAutoModel as AutoModel
from ..optimization import create_optimizer
from .base import BaseTextClassification

PRETRAINED_MODELS = [
    'distilbert/distilbert-base-uncased',
    'distilbert-base-uncased',
    'bert-base-uncased',
    'bert-base-multilingual-cased',
    'ai4bharat/indic-bert',
    'google/muril-base-cased'
]

class BERTTextClassification(BaseTextClassification):
    """
    BERT-based architecture for Text Classification.
    Uses Hugging Face Transformers.
    """
    def __init__(self):
        super().__init__()
        self.architecture = 'transformer'
        self.parameters.update({
            'pretrained_model': PRETRAINED_MODELS[0],
            'sequence_length': 128,
            'trainable': False,
            'units': 768,
            'dropout': 0.15,
            'l2': 0.01,
            'learning_rate': 2e-5,
            'num_train_steps': 1000,
            'weight_decay_rate': 0.01,
            'num_warmup_steps': 0
        })

    def preprocess_x(self, X):
        """
        Tokenizes text using the BERT tokenizer.
        """
        cleaned = [str(text).strip() for text in X]
        
        if self.processor is None:
            pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
            self.processor = AutoTokenizer.from_pretrained(pretrained_model)
        
        sequence_length = self.parameters.get('sequence_length', 128)
        tokenized = self.processor(
            cleaned,
            truncation=True,
            padding='max_length',
            max_length=sequence_length,
            return_tensors='np'
        )
        return {key: np.asarray(tokenized[key]).astype(np.int32) for key in ['input_ids', 'attention_mask']}

    def build(self, num_classes, **kwargs):
        """
        Builds the BERT model with a classification head.
        """
        self.parameters.update(kwargs)
        pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
        sequence_length = self.parameters.get('sequence_length', 128)
        units = self.parameters.get('units', 768)
        dropout = self.parameters.get('dropout', 0.15)
        activation = self.parameters.get('activation', 'relu')
        
        self.config = AutoConfig.from_pretrained(pretrained_model, num_labels=num_classes)
        encoder = AutoModel.from_pretrained(pretrained_model, config=self.config).layers[0]
        encoder.trainable = self.parameters.get('trainable', False)

        # Must mirror the keys preprocess_x returns, which it filters to
        # exactly this pair regardless of tokenizer.
        input_names = ['input_ids', 'attention_mask']
        inputs = {name: tf.keras.layers.Input((sequence_length,), name=name, dtype=tf.int32) for name in input_names}
        
        outputs = encoder(inputs)

        outputs = outputs.last_hidden_state if hasattr(outputs, 'last_hidden_state') else outputs[0]        
        outputs = tf.keras.layers.GlobalAveragePooling1D()(outputs)
        outputs = tf.keras.layers.Dropout(dropout)(outputs)
        outputs = self._apply_hidden_layers(
            outputs, default=[{'units': units, 'activation': activation}]
        )
        outputs = tf.keras.layers.Dense(
            num_classes,
            activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(self.parameters.get('l2', 0.01)),
            name='labels'
        )(outputs)
        
        model = tf.keras.models.Model(inputs=inputs, outputs=outputs)

        if self.parameters.get('pruning', False):
            model = self._prune_model(model)        

        optimizer, _ = create_optimizer(
            init_lr=self.parameters.get('learning_rate', 2e-5),
            num_train_steps=self.parameters.get('num_train_steps', 1000),
            weight_decay_rate=self.parameters.get('weight_decay_rate', 0.01),
            num_warmup_steps=self.parameters.get('num_warmup_steps', 0)
        )

        model.compile(
            optimizer=optimizer,
            loss='sparse_categorical_crossentropy',
            metrics=self._metrics(num_classes)
        )
        return model

    def save(self, path, save_format='tf'):
        """
        Saves model and BERT-specific tokenizer/config.
        """
        super().save(path, save_format)
        if self.processor:
            self.processor.save_pretrained(path)
        if self.config:
            self.config.save_pretrained(path)

    @classmethod
    def load(cls, path, **kwargs):
        """
        Loads BERT model and tokenizer.
        """
        instance = super().load(path, **kwargs)
        
        # BERT specific loading
        instance.processor = AutoTokenizer.from_pretrained(path)
        instance.tokenizer = instance.processor
        instance.config = AutoConfig.from_pretrained(path)
        
        save_format = instance.parameters.get('save_format', 'tf')
        instance.model = cls._load_model_file(
            path,
            save_format,
            build_model=lambda: instance.build(num_classes=len(instance.labels)),
            use_signature_runner=kwargs.get('use_signature_runner', False)
        )
        return instance
