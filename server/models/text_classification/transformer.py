import os
import numpy as np
import tensorflow as tf
from transformers import AutoConfig, AutoTokenizer, TFAutoModel as AutoModel, create_optimizer
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
            'max_seq_len': 128,
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
        
        max_seq_len = self.parameters.get('max_seq_len', 128)
        tokenized = self.processor(
            cleaned,
            truncation=True,
            padding='max_length',
            max_length=max_seq_len,
            return_tensors='np'
        )
        return {key: np.asarray(tokenized[key]).astype(np.int32) for key in ['input_ids', 'attention_mask']}

    def build(self, num_classes, **kwargs):
        """
        Builds the BERT model with a classification head.
        """
        self.parameters.update(kwargs)
        pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
        max_seq_len = self.parameters.get('max_seq_len', 128)
        
        config = AutoConfig.from_pretrained(pretrained_model, num_labels=num_classes)
        self.config = config
        base = AutoModel.from_pretrained(pretrained_model, config=config).layers[0]
        base.trainable = self.parameters.get('trainable', False)

        input_ids = tf.keras.layers.Input((max_seq_len,), name='input_ids', dtype=tf.int32)
        attention_mask = tf.keras.layers.Input((max_seq_len,), name='attention_mask', dtype=tf.int32)
        
        outputs = base({'input_ids': input_ids, 'attention_mask': attention_mask})
        pooled_output = tf.keras.layers.GlobalAveragePooling1D()(outputs.last_hidden_state)
        
        dropout = tf.keras.layers.Dropout(self.parameters.get('dropout', 0.15))(pooled_output)
        dense_layer = tf.keras.layers.Dense(self.parameters.get('units', 768), activation='relu')
        output_layer = tf.keras.layers.Dense(
            num_classes,
            activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(self.parameters.get('l2', 0.01)),
            name='output'
        )
        if self.parameters.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            schedule = tfmot.sparsity.keras.PolynomialDecay(
                initial_sparsity=self.parameters.get('initial_sparsity', 0),
                final_sparsity=self.parameters.get('final_sparsity', 0.5),
                begin_step=self.parameters.get('pruning_begin_step', 0),
                end_step=self.parameters.get('pruning_end_step', 1000),
                frequency=self.parameters.get('pruning_frequency', 100)
            )
            dense_layer = tfmot.sparsity.keras.prune_low_magnitude(dense_layer, pruning_schedule=schedule)
            output_layer = tfmot.sparsity.keras.prune_low_magnitude(output_layer, pruning_schedule=schedule)

        dense = dense_layer(dropout)
        logits = output_layer(dense)

        model = tf.keras.models.Model(inputs=[input_ids, attention_mask], outputs=logits)
        
        # Use transformers optimizer
        optimizer, _ = create_optimizer(
            init_lr=self.parameters.get('learning_rate', 2e-5),
            num_train_steps=self.parameters.get('num_train_steps', 1000),
            weight_decay_rate=self.parameters.get('weight_decay_rate', 0.01),
            num_warmup_steps=self.parameters.get('num_warmup_steps', 0)
        )

        model.compile(optimizer=optimizer, loss='sparse_categorical_crossentropy', metrics=['accuracy'])
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
