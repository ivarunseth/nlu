import numpy as np
import tensorflow as tf
from transformers import AutoConfig, AutoTokenizer, TFAutoModelForTokenClassification as AutoModel
from ..optimization import create_optimizer
from .base import BaseNamedEntityRecognition
from . import NonPaddingLoss, NonPaddingAccuracy

PRETRAINED_MODELS = [
    'distilbert/distilbert-base-uncased',
    'distilbert-base-uncased',
    'bert-base-uncased',
    'bert-base-multilingual-cased',
    'ai4bharat/indic-bert',
    'google/muril-base-cased'
]


class BERTNamedEntityRecognition(BaseNamedEntityRecognition):
    """
    BERT-based architecture for Named Entity Recognition (NER).

    A pretrained transformer encoder feeds a token-classification head
    (``Dense`` -> ``Dropout`` -> softmax ``Dense``) built as a Keras functional
    model, trained with a padding-aware loss and a warmup/decay optimizer.
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

    def _get_processor(self):
        """
        Returns the (lazily instantiated) tokenizer for the configured model.
        RoBERTa-family tokenizers need ``add_prefix_space`` to tokenize
        pre-split words, so honour the model type when constructing it.
        """
        if self.processor is None:
            pretrained_model = self.parameters.get('pretrained_model', PRETRAINED_MODELS[0])
            model_type = getattr(self.config, 'model_type', None) if self.config else None
            if model_type == 'roberta':
                self.processor = AutoTokenizer.from_pretrained(
                    pretrained_model, use_fast=True, add_prefix_space=True
                )
            else:
                self.processor = AutoTokenizer.from_pretrained(pretrained_model, use_fast=True)
        return self.processor

    def preprocess_x(self, X):
        """
        Tokenizes text into padded, int32 input tensors for BERT.
        """
        tokenized = self._get_processor()(
            X,
            truncation=True,
            padding='max_length',
            max_length=self.parameters.get('sequence_length', 128),
            return_tensors='np'
        )
        return {k: np.asarray(v).astype(np.int32) for k, v in tokenized.items()}

    def _word_positions(self, X):
        """
        Maps each whitespace token to its first subword's sequence position,
        mirroring the training-time alignment in ``tokenize_and_align``.
        """
        tokenized = self._get_processor()(
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

    def tokenize_and_align(self, X, y):
        """
        Aligns integer word labels with BERT sub-word tokens.

        Only the first sub-word of each word carries its label; special tokens
        and continuation sub-words get ``-100`` so ``NonPaddingLoss`` ignores
        them.
        """
        tokenized_inputs = self._get_processor()(
            X,
            truncation=True,
            padding='max_length',
            max_length=self.parameters.get('sequence_length', 128),
            is_split_into_words=False  # Assuming string inputs
        )

        labels = []
        for i, label in enumerate(y):
            word_ids = tokenized_inputs.word_ids(batch_index=i)
            previous_word_idx = None
            label_ids = []
            for word_idx in word_ids:
                if word_idx is None:
                    label_ids.append(-100)
                elif word_idx != previous_word_idx:
                    label_ids.append(label[word_idx] if word_idx < len(label) else -100)
                else:
                    label_ids.append(-100)
                previous_word_idx = word_idx
            labels.append(label_ids)

        inputs = {k: np.asarray(v).astype(np.int32) for k, v in tokenized_inputs.items()}
        return inputs, np.asarray(labels, dtype=np.int32)

    def _num_train_steps(self):
        """
        Derives the optimizer's decay horizon from the training set when it is
        available (``batches_per_epoch * epochs``), matching the reference
        script, and otherwise falls back to the persisted/default value so the
        architecture can be rebuilt at load time.
        """
        if self.X_train is not None:
            batch_size = max(1, int(self.parameters.get('batch_size', 32)))
            epochs = max(1, int(self.parameters.get('epochs', 10)))
            steps = max(1, (len(self.X_train) // batch_size) * epochs)
            self.parameters['num_train_steps'] = steps
            return steps
        return max(1, int(self.parameters.get('num_train_steps', 1000)))

    def build(self, num_classes, class_weights=None, **kwargs):
        """
        Builds the BERT token-classification model as a Keras functional model:
        a (optionally frozen) pretrained encoder followed by a
        ``Dense -> Dropout -> softmax Dense`` head, compiled with a
        padding-aware loss and a warmup/decay optimizer.
        """
        self.parameters.update({k: v for k, v in kwargs.items() if k != 'callbacks'})

        pretrained_model = self.parameters.get('pretrained_model', PRETRAINED_MODELS[0])
        sequence_length = self.parameters.get('sequence_length', 128)

        id2label = {int(index): tag for index, tag in self.labels.items()} if self.labels else None
        label2id = {tag: int(index) for index, tag in self.labels.items()} if self.labels else None

        config = AutoConfig.from_pretrained(
            pretrained_model, num_labels=num_classes, id2label=id2label, label2id=label2id
        )
        self.config = config

        # Pull the encoder out of the token-classification model and discard its
        # randomly-initialised head; we attach our own below.
        encoder = AutoModel.from_pretrained(pretrained_model, config=config).layers[0]
        encoder.trainable = self.parameters.get('trainable', False)

        input_names = self._get_processor().model_input_names
        inputs = {
            name: tf.keras.layers.Input((sequence_length,), name=name, dtype=tf.int32)
            for name in input_names
        }

        outputs = encoder(inputs)
        sequence_output = outputs.last_hidden_state if hasattr(outputs, 'last_hidden_state') else outputs[0]

        hidden = self._apply_hidden_layers(
            sequence_output,
            default=[{'units': self.parameters.get('units', 768), 'activation': 'tanh'}]
        )
        hidden = tf.keras.layers.Dropout(self.parameters.get('dropout', 0.15))(hidden)
        logits = tf.keras.layers.Dense(
            num_classes,
            activation='softmax',
            kernel_regularizer=tf.keras.regularizers.l2(self.parameters.get('l2', 0.01)),
            name='output'
        )(hidden)

        model = tf.keras.models.Model(inputs=inputs, outputs=logits)

        optimizer, _ = create_optimizer(
            init_lr=self.parameters.get('learning_rate', 2e-5),
            num_train_steps=self._num_train_steps(),
            weight_decay_rate=self.parameters.get('weight_decay_rate', 0.01),
            num_warmup_steps=self.parameters.get('num_warmup_steps', 0)
        )

        model.compile(optimizer=optimizer, loss=NonPaddingLoss(class_weights=class_weights), metrics=[NonPaddingAccuracy()])
        return model

    def save(self, path, save_format='tf'):
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
        instance.config = AutoConfig.from_pretrained(path)
        instance.processor = AutoTokenizer.from_pretrained(path)
        instance.tokenizer = instance.processor

        save_format = instance.parameters.get('save_format', 'tf')
        instance.model = cls._load_model_file(
            path,
            save_format,
            build_model=lambda: instance.build(num_classes=len(instance.labels)),
            use_signature_runner=kwargs.get('use_signature_runner', False)
        )
        return instance
