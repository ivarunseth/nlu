import os
import re

import numpy as np

from sklearn.metrics import confusion_matrix, accuracy_score, classification_report
from sklearn.utils.class_weight import compute_class_weight

from ..base import BaseModel
from ..augmentation import augment
from ...utils.dataset import spans_to_tags

class BaseNamedEntityRecognition(BaseModel):
    """
    Base class for Named Entity Recognition (NER).
    Handles label alignment and sequence-level evaluation.
    """
    def __init__(self):
        super().__init__()
        self.model_type = 'named_entity_recognition'

    def load_data(self, data):
        """
        Named entity recognition reads the authored inline ``utterances.csv``:
        ``X`` is the utterance text, ``y`` the space-separated IOB tags derived
        from its ``{entity: value}`` spans (all-``O`` when unannotated).
        """
        rows = self._read_inline(data)
        X = [text for text, _, _ in rows]
        y = [' '.join(spans_to_tags(text, spans)) for text, spans, _ in rows]
        return X, y

    def predict(self, X, **kwargs):
        """
        Generates predictions for the given input.

        Returns one dict per input, ``{'tags': [...], 'entities': [...]}``:
        an IOB tag per whitespace token of the input, and the ``B-``/``I-``
        runs merged into ``{entity, value, start, end, score}`` spans with
        character offsets into the input.
        """
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]
        if hasattr(preds, 'logits'):
            preds = preds.logits.numpy()

        results = []
        for i, positions in enumerate(self._word_positions(X)):
            tags, scores = [], []
            for position in positions:
                if position is None or position >= len(preds[i]):
                    # Tokens the model never saw (e.g. truncated) stay outside.
                    tags.append('O')
                    scores.append(0.0)
                    continue
                probabilities = self._to_probabilities(preds[i][position])
                index = int(np.argmax(probabilities))
                tags.append(self.labels[str(index)])
                scores.append(float(probabilities[index]))
            results.append({
                'tags': tags,
                'entities': self._merge_entities(X[i], tags, scores)
            })
        return results

    def _word_positions(self, X):
        """
        Maps each whitespace token of each input to the sequence position
        holding its prediction, or ``None`` when it has none (e.g. truncated).
        Tokens map one-to-one onto positions unless a subclass overrides.
        """
        sequence_length = self.parameters.get('sequence_length', 128)
        return [
            [i if i < sequence_length else None for i in range(len(text.split()))]
            for text in X
        ]

    @staticmethod
    def _to_probabilities(row):
        """
        Normalizes one position's class scores to probabilities, applying a
        softmax unless the model output already is a distribution.
        """
        row = np.asarray(row, dtype='float64')
        if row.min() >= 0 and np.isclose(row.sum(), 1.0, atol=1e-3):
            return row
        exponents = np.exp(row - row.max())
        return exponents / exponents.sum()

    @staticmethod
    def _merge_entities(text, tags, scores):
        """
        Merges word-level ``B-``/``I-`` runs into entity spans with character
        offsets into ``text``. An ``I-`` without a matching open span starts
        one, so imperfect sequences still yield usable entities.
        """
        entities, current = [], None
        words = [match.span() for match in re.finditer(r'\S+', text)]
        for (start, end), tag, score in zip(words, tags, scores):
            name = tag[2:] if tag[:2] in ('B-', 'I-') else None
            if name and tag.startswith('I-') and current and current['entity'] == name:
                current['end'] = end
                current['scores'].append(score)
            elif name:
                current = {'entity': name, 'start': start, 'end': end, 'scores': [score]}
                entities.append(current)
            else:
                current = None
        return [{
            'entity': entity['entity'],
            'value': text[entity['start']:entity['end']],
            'start': entity['start'],
            'end': entity['end'],
            'score': float(np.mean(entity['scores']))
        } for entity in entities]

    def evaluate(self, X, y, **kwargs):
        """
        Evaluates model performance on a test set.
        Returns a JSON-serializable dictionary.
        """
        y_true = []
        for tags in y:
            if isinstance(tags, str):
                y_true.append(tags.split())
            else:
                y_true.append(tags)

        y_pred_all = [result['tags'] for result in self.predict(X)]

        # Flatten and align for evaluation (similar to LU slots); tokens the
        # model produced no tag for count as outside.
        y_true_flat = [tag for sublist in y_true for tag in sublist]
        y_pred_flat = []
        for pred, true in zip(y_pred_all, y_true):
            pred = pred[:len(true)]
            y_pred_flat.extend(pred + ['O'] * (len(true) - len(pred)))

        acc = accuracy_score(y_true_flat, y_pred_flat)
        report = classification_report(y_true_flat, y_pred_flat, zero_division=0, output_dict=True)
        cm = confusion_matrix(y_true_flat, y_pred_flat)

        return {
            'accuracy': float(acc),
            'confusion_matrix': cm.tolist(),
            'report': report
        }

    def preprocess_y(self, y):
        """
        Maps token-level string labels to integer indices.
        y is expected to be a list of lists (or space-separated strings).
        """
        if self.labels is None:
            all_tags = []
            for tags in y:
                if isinstance(tags, str):
                    all_tags.extend(tags.split())
                else:
                    all_tags.extend(tags)
            unique_tags = sorted(list(set(all_tags)))
            self.labels = {str(i): tag for i, tag in enumerate(unique_tags)}
        
        inv_labels = {v: int(k) for k, v in self.labels.items()}
        
        processed_y = []
        for tags in y:
            if isinstance(tags, str):
                tags = tags.split()
            processed_y.append([inv_labels[str(tag)] for tag in tags])
        return processed_y

    def train(self, data, test_split=0.2, validation_split=0.1, epochs=10, batch_size=32, **kwargs):
        """
        Standard training loop for token classification.

        Reads the data source, holds out a test split (stored on the instance as
        ``X_test``/``y_test``), and trains on the remaining data.
        """
        X, y = self.load_data(data)
        X_train, X_test, y_train, y_test = self._train_test_split(
            X, y, test_split, kwargs.get('random_state', 101)
        )
        self.X_train, self.y_train = X_train, y_train
        self.X_test, self.y_test = X_test, y_test

        # Expand the TRAIN split only (the held-out test set stays authored),
        # substituting entity value/synonym terms and, for open-list entities,
        # UNK generalizations. Deterministic (seeded) and idempotent — derives
        # only from the authored rows, from the catalogue shipped in the data
        # dir (entities.json); the entity of a named entity recognition span is
        # its tag suffix, so the resolver is the identity.
        spec = self._read_json(os.path.join(data, 'entities.json'), {}) \
            if isinstance(data, str) and os.path.isdir(data) else {}
        gen_x, gen_y, _ = augment(
            self.X_train, self.y_train, [None] * len(self.X_train),
            lambda intent, name: name, spec,
        )
        self.X_train = list(self.X_train) + gen_x
        self.y_train = list(self.y_train) + gen_y
        X, y = self.X_train, self.y_train

        self.parameters.update({
            'validation_split': validation_split,
            'epochs': epochs,
            'batch_size': batch_size,
            **{k: v for k, v in kwargs.items() if k != 'callbacks'}
        })
        y_encoded = self.preprocess_y(y)
        X_processed, y_aligned = self.tokenize_and_align(X, y_encoded)


        flat_labels = np.concatenate([np.asarray(seq) for seq in y_encoded])

        classes = np.unique(flat_labels)

        weights = compute_class_weight(
            class_weight="balanced",
            classes=classes,
            y=flat_labels,
        )

        class_weight = dict(zip(classes, weights))

        sample_weight = np.vectorize(class_weight.get)(y_aligned).astype(np.float32)
        
        num_classes = len(self.labels)
        self.model = self.build(num_classes=num_classes, **kwargs)
        
        summary = self._get_summary()
        if summary:
            print(summary)
        
        callbacks = kwargs.get('callbacks', [])
        if kwargs.get('early_stopping', True):
            import tensorflow as tf
            callbacks.append(tf.keras.callbacks.EarlyStopping(
                monitor=kwargs.get('monitor', 'val_loss'),
                patience=kwargs.get('patience', 3),
                restore_best_weights=True
            ))
        
        self._fit_data = (X_processed, y_aligned, validation_split)
        self.history = self.model.fit(
            X_processed, y_aligned,
            sample_weight=sample_weight,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )
        
        self.parameters['epochs'] = len(self.history.history.get('loss', []))
        return self._history_to_dict(self.history)

    def tokenize_and_align(self, X, y):
        """
        To be implemented by subclasses to handle tokenizer-specific alignment.
        """
        raise NotImplementedError
