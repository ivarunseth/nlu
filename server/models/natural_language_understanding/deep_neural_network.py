import os
import pickle
import numpy as np
import tensorflow as tf
from ..optimization import create_optimizer
from .base import BaseNaturalLanguageUnderstanding
from . import NonPaddingLoss
from ..crf import CRFLoss, CRFTransitions, transitions_variable

class DNNNaturalLanguageUnderstanding(BaseNaturalLanguageUnderstanding):
    """
    DNN-based architecture for Natural Language Understanding (joint intent +
    slots). Uses TextVectorization, an Embedding, and Dense heads for the
    intent and slot predictions.
    """
    def __init__(self):
        super().__init__()
        self.processor = None # Will hold TextVectorization layer
        self.architecture = 'deep_neural_network'
        self.parameters.update({
            'max_tokens': 10000,
            'sequence_length': 100,
            'embedding_dims': 128,
            'units': 128,
            'dropout': 0.3,
            'learning_rate': 1e-3,
            'weight_decay_rate': 1e-5,
            'num_warmup_steps': 0,
            'intent_loss_weight': 1.0,
            'slot_loss_weight': 2.0,
            'crf': False,
            'hidden_layers': [{'type': 'dense', 'units': 64, 'activation': 'relu'}],
        })

    def preprocess_x(self, X):
        """
        Vectorizes text into padded integer token ids.

        TextVectorization's default standardization (lowercase + strip
        punctuation) with whitespace splitting emits one token per whitespace
        word, so the word-level slot labels aligned in ``tokenize_and_align``
        line up with the model's per-position slot outputs.
        """
        cleaned = [str(text) for text in X]
        if self.processor is None:
            self.processor = tf.keras.layers.TextVectorization(
                max_tokens=self.parameters.get('max_tokens', 10000),
                output_mode='int',
                output_sequence_length=self.parameters.get('sequence_length', 100)
            )
            self.processor.adapt(cleaned)
        return self.processor(cleaned).numpy().astype(np.int32)

    def tokenize_and_align(self, X, y_slots):
        """
        Vectorizes ``X`` and pads/truncates each word-level slot-label list to
        ``sequence_length``. Token ``i`` corresponds to whitespace-word ``i``
        (see ``preprocess_x``), so padded / truncated positions are labelled
        ``-100`` and masked out by ``NonPaddingLoss`` / ``NonPaddingAccuracy``.
        """
        X_processed = self.preprocess_x(X)
        sequence_length = self.parameters.get('sequence_length', 100)
        y_aligned = []
        for labels in y_slots:
            labels = list(labels[:sequence_length])
            labels += [-100] * (sequence_length - len(labels))
            y_aligned.append(labels)
        return X_processed, np.array(y_aligned)

    def _word_positions(self, X):
        """
        Maps each whitespace token to its slot-prediction position — the
        identity, since the vectorizer emits one token per word — or ``None``
        past ``sequence_length``. Overrides the base, which reads ``sequence_length``.
        """
        sequence_length = self.parameters.get('sequence_length', 100)
        return [
            [i if i < sequence_length else None for i in range(len(text.split()))]
            for text in X
        ]

    def build(self, num_labels, num_tags, slot_class_weights=None, **kwargs):
    
        self.parameters.update(kwargs)
    
        if self.processor is None:
            raise RuntimeError(
                "TextVectorization has not been adapted yet."
            )
    
        vocab_size = len(self.processor.get_vocabulary())
    
        embedding_dims = self.parameters["embedding_dims"]
        units = self.parameters["units"]
        dropout = self.parameters["dropout"]
        sequence_length = self.parameters["sequence_length"]
        
        inputs = tf.keras.layers.Input(
            shape=(sequence_length,),
            dtype=tf.int32,
            name="input_ids"
        )
    
        x = tf.keras.layers.Embedding(
            vocab_size,
            embedding_dims,
            mask_zero=True,
            name="embedding"
        )(inputs)

        x = tf.keras.layers.Dropout(dropout)(x)
    
        x = tf.keras.layers.Bidirectional(
            tf.keras.layers.LSTM(
                units,
                return_sequences=True,
                dropout=dropout,
                recurrent_dropout=0.0,
            ),
            name=f"bidirectional_lstm",
        )(x)
    
        x = tf.keras.layers.Dropout(dropout)(x)

        x = self._apply_hidden_layers(x)

        intents = tf.keras.layers.GlobalAveragePooling1D()(x)
    
        intents = tf.keras.layers.Dense(
            num_labels,
            activation="softmax",
            name="intents"
        )(intents)
    
        # Under the CRF the slot head emits raw emission scores; the transition
        # layer carries the head's name so the dict-keyed loss and metrics still
        # resolve the output. `_to_probabilities` softmaxes logits at decode
        # time, so the reported scores keep their meaning either way.
        crf = self.parameters.get("crf", False)

        slots = tf.keras.layers.Dense(
            num_tags,
            activation=None if crf else "softmax",
            name="slot_emissions" if crf else "slots"
        )(x)

        if crf:
            slots = CRFTransitions(num_tags, name="slots")(slots)

        model = tf.keras.Model(inputs=inputs, outputs=[intents, slots])

        if self.parameters.get("pruning", False):
            model = self._prune_model(model)

        optimizer, _ = create_optimizer(
            init_lr=self.parameters["learning_rate"],
            num_train_steps=self.parameters.get("num_train_steps", 1000),
            weight_decay_rate=self.parameters["weight_decay_rate"],
            num_warmup_steps=self.parameters["num_warmup_steps"],
        )

        # Read the transition weight off the final model: pruning clones the
        # graph, so a reference taken above would train an orphaned variable.
        transitions = transitions_variable(model) if crf else None

        loss = {
            "intents": tf.keras.losses.SparseCategoricalCrossentropy(),
            "slots": (
                CRFLoss(transitions) if transitions is not None
                else NonPaddingLoss(class_weights=slot_class_weights)
            ),
        }
    
        metrics = {
            "intents": self._metrics(num_labels),
            "slots": self._metrics(num_tags, masked=True),
        }
    
        model.compile(
            optimizer=optimizer,
            loss=loss,
            loss_weights={
                "intents": self.parameters.get(
                    "intent_loss_weight", 1.0
                ),
                "slots": self.parameters.get(
                    "slot_loss_weight", 2.0
                ),
            },
            # The intent sample_weight passed to fit() is meant to weight the
            # loss only; accuracy stays raw. Declaring no weighted metrics
            # also silences Keras' evaluate() warning on the validation pass.
            weighted_metrics=[],
            metrics=metrics,
        )
    
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
            build_model=lambda: instance.build(
                num_labels=len(instance.labels),
                num_tags=len(instance.tags)
            ),
            use_signature_runner=kwargs.get('use_signature_runner', False)
        )
        return instance
