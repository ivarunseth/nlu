import numpy as np
import tensorflow as tf
from transformers import AutoConfig, AutoTokenizer, TFAutoModel as AutoModel
from ..optimization import create_optimizer
from .base import BaseNaturalLanguageUnderstanding
from . import NonPaddingLoss
from ..crf import CRFLoss, CRFTransitions, transitions_variable

PRETRAINED_MODELS = [
    'distilbert/distilbert-base-uncased',
    'distilbert-base-uncased',
    'bert-base-uncased',
    'bert-base-multilingual-cased',
    'ai4bharat/indic-bert',
    'google/muril-base-cased'
]


class BERTNaturalLanguageUnderstanding(BaseNaturalLanguageUnderstanding):
    """
    BERT-based architecture for Natural Language Understanding (Joint Intent + Slots).
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
            'intent_loss_weight': 1.0,
            'slot_loss_weight': 2.0,
            'crf': False,
            'learning_rate': 2e-5,
            'num_train_steps': 1000,
            'weight_decay_rate': 0.01,
            'num_warmup_steps': 0
        })

    def preprocess_x(self, X):
        """
        Tokenizes text for BERT.
        """
        if self.processor is None:
            pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
            self.processor = AutoTokenizer.from_pretrained(pretrained_model)
        
        tokenized = self.processor(
            X,
            truncation=True,
            padding='max_length',
            max_length=self.parameters.get('sequence_length', 128),
            return_tensors='np'
        )
        return {k: np.asarray(v).astype(np.int32) for k, v in tokenized.items()}

    def _word_positions(self, X):
        """
        Maps each whitespace token to its first subword's sequences position,
        mirroring the training-time alignment in ``tokenize_and_align`` so
        slot predictions read back at exactly the positions their labels
        were written to.
        """
        if self.processor is None:
            pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
            self.processor = AutoTokenizer.from_pretrained(pretrained_model)

        tokenized = self.processor(
            X,
            truncation=True,
            padding='max_length',
            max_length=self.parameters.get('sequence_length', 128)
        )
        positions = []
        for i, text in enumerate(X):
            first = {}
            for position, word_idx in enumerate(tokenized.word_ids(batch_index=i)):
                if word_idx is not None and word_idx not in first:
                    first[word_idx] = position
            positions.append([first.get(word) for word in range(len(text.split()))])
        return positions

    def tokenize_and_align(self, X, y_slots):
        """
        Aligns slot labels with BERT tokens.
        """
        if self.processor is None:
            pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
            self.processor = AutoTokenizer.from_pretrained(pretrained_model)

        tokenized_inputs = self.processor(
            X, 
            truncation=True, 
            padding='max_length', 
            max_length=self.parameters.get('sequence_length', 128)
        )
        
        aligned_slots = []
        for i, slots in enumerate(y_slots):
            word_ids = tokenized_inputs.word_ids(batch_index=i)
            previous_word_idx = None
            slot_ids = []
            for word_idx in word_ids:
                if word_idx is None:
                    slot_ids.append(-100)
                elif word_idx != previous_word_idx:
                    slot_ids.append(slots[word_idx] if word_idx < len(slots) else -100)
                else:
                    slot_ids.append(-100)
                previous_word_idx = word_idx
            aligned_slots.append(slot_ids)
            
        return {k: np.array(v) for k, v in tokenized_inputs.items()}, np.array(aligned_slots)

    def build(self, num_labels, num_tags, slot_class_weights=None, **kwargs):
        """
        Builds a joint BERT model with Intent and Slot heads.
        """
        self.parameters.update(kwargs)

        pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
        sequence_length = self.parameters.get('sequence_length', 128)
        
        encoder = AutoModel.from_pretrained(pretrained_model).layers[0]
        encoder.trainable = self.parameters.get('trainable', False)
        self.config = AutoConfig.from_pretrained(pretrained_model)

        sample = self.preprocess_x(['Hello, World!', 'Testing 1, 2, 3..', 'This is a sample'])

        inputs = {name: tf.keras.layers.Input((sequence_length,), name=name, dtype=tf.int32) for name in sample}

        outputs = encoder(inputs)

        sequences = outputs.last_hidden_state if hasattr(outputs, 'last_hidden_state') else outputs[0]

        sequences = tf.keras.layers.Dropout(self.parameters.get('dropout', 0.15))(sequences)

        sequences = self._apply_hidden_layers(
            sequences,
            default=[{
                'units': self.parameters.get('units', 768),
                'activation': self.parameters.get('activation', 'relu')
            }]
        )

        sequences = tf.keras.layers.Dropout(self.parameters.get('dropout', 0.15))(sequences)
        
        regularizer = tf.keras.regularizers.l2(self.parameters.get('l2', 0.01))

        # Intent head
        intents = tf.keras.layers.GlobalAveragePooling1D()(sequences)

        intents = tf.keras.layers.Dense(
            num_labels, activation='softmax',
            kernel_regularizer=regularizer, name='intents'
        )(intents)

        # Slot head. Under the CRF it emits raw emission scores and the
        # transition layer carries the head's name, so the dict-keyed loss and
        # metrics still resolve the output.
        crf = self.parameters.get('crf', False)

        slots = tf.keras.layers.Dense(
            num_tags, activation=None if crf else 'softmax',
            kernel_regularizer=regularizer,
            name='slot_emissions' if crf else 'slots'
        )(sequences)

        if crf:
            slots = CRFTransitions(num_tags, name='slots')(slots)

        model = tf.keras.models.Model(inputs=inputs, outputs=[intents, slots])

        optimizer, _ = create_optimizer(
            init_lr=self.parameters.get('learning_rate', 2e-5),
            num_train_steps=self.parameters.get('num_train_steps', 1000),
            weight_decay_rate=self.parameters.get('weight_decay_rate', 0.01),
            num_warmup_steps=self.parameters.get('num_warmup_steps', 0)
        )

        transitions = transitions_variable(model) if crf else None

        loss = {
            'intents': tf.keras.losses.SparseCategoricalCrossentropy(from_logits=False),
            'slots': (
                CRFLoss(transitions) if transitions is not None
                else NonPaddingLoss(class_weights=slot_class_weights)
            )
        }

        # Sparse integer targets against softmax heads: the intent head gets the
        # flat metrics (plain Accuracy compares shapes exactly and fails on
        # (batch,1) vs (batch,num_labels)); the slot head gets the masked
        # variants so -100 padded/sub-word positions are ignored. Keras prefixes
        # each with its head name, so these log as intents_*/slots_*.
        metrics = {
            'intents': self._metrics(num_labels),
            'slots': self._metrics(num_tags, masked=True)
        }
        
        model.compile(
            optimizer=optimizer,
            loss=loss,
            loss_weights={
                'intents': self.parameters.get('intent_loss_weight', 1.0),
                'slots': self.parameters.get('slot_loss_weight', 2.0)
            },
            # The intent sample_weight passed to fit() is meant to weight the
            # loss only; accuracy stays raw. Declaring no weighted metrics
            # also silences Keras' evaluate() warning on the validation pass.
            weighted_metrics=[],
            metrics=metrics
        )

        return model

    def save(self, path, save_format='tf'):
        super().save(path, save_format)
        if self.processor:
            self.processor.save_pretrained(path)
        if self.config:
            self.config.save_pretrained(path)

    @classmethod
    def load(cls, path, **kwargs):
        instance = super().load(path, **kwargs)
        
        # BERT specific loading
        instance.processor = AutoTokenizer.from_pretrained(path)
        instance.tokenizer = instance.processor
        instance.config = AutoConfig.from_pretrained(path)
        
        save_format = instance.parameters.get('save_format', 'tf')
        instance.model = cls._load_model_file(
            path,
            save_format,
            build_model=lambda: instance.build(num_labels=len(instance.labels), num_tags=len(instance.tags)),
            use_signature_runner=kwargs.get('use_signature_runner', False)
        )
        return instance
