import os
import math

import numpy as np

from sklearn.metrics import confusion_matrix, accuracy_score, classification_report

from ..base import BaseModel
from ..augmentation import augment
from ..crf import CRFDecoder
from ..thresholds import gate_annotations
from ...utils.dataset import spans_to_tags, tags_to_spans, tokenize

class BaseNamedEntityRecognition(CRFDecoder, BaseModel):
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
        runs merged into ``{entity, value, start, end, score}`` annotations
        with character offsets into the input.

        ``annotation_threshold`` (default 0, meaning off) drops entities
        scoring below the cutoff and resets the tags they covered to ``O``.
        """
        threshold = kwargs.pop('annotation_threshold', 0.0)
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]
        if hasattr(preds, 'logits'):
            preds = preds.logits.numpy()

        thresholds = self._per_input(threshold, len(X))

        results = []
        for i, positions in enumerate(self._word_positions(X)):
            # The CRF Viterbi pass over the aligned word sequence, under the IOB
            # legality mask — or, for a model trained without the CRF (the
            # default), per-token argmax with the illegal tags repaired to `O`.
            tags, scores = self._decode_tags(preds[i], positions, self.labels)
            entities, tags = gate_annotations(
                self._merge_entities(X[i], tags, scores),
                tags,
                thresholds[i],
                tokenize(X[i]),
            )
            results.append({'tags': tags, 'entities': entities})
        return results

    def save(self, path, save_format='tf'):
        """Saves the artifact plus the CRF transitions sidecar."""
        super().save(path, save_format)
        self._save_transitions(path)

    @classmethod
    def load(cls, path, **kwargs):
        """Loads the artifact and, when present, its CRF transitions."""
        instance = super().load(path, **kwargs)
        instance._load_transitions(path)
        return instance

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

    def _merge_entities(self, text, tags, scores):
        """
        The predicted entities of one input, as ``{entity, value, start, end,
        score}``. Delegates to the shared annotation builder, so an entity
        returned here is the same object the metrics and the threshold curve
        score.
        """
        return [{
            'entity': name,
            'value': text[start:end],
            'start': start,
            'end': end,
            'score': score,
        } for start, end, name, score in self._scored_annotations(text, tags, scores)]

    def evaluate(self, X, y, **kwargs):
        """
        Evaluates model performance on a test set.
        Returns a JSON-serializable dictionary.

        ``entities`` carries the exact-match scores — an annotation counts only
        when its entity and both boundaries match — overall and per entity under
        ``labels``, with the token view under ``entities['tokens']``. The
        top-level ``accuracy``/``report``/``confusion_matrix`` stay token-level,
        since the trainings list and the version analytics read them.
        """
        y_true = []
        for tags in y:
            if isinstance(tags, str):
                y_true.append(tags.split())
            else:
                y_true.append(tags)

        # predict() already merged and scored the annotations, so the curve
        # reads those rather than rebuilding them: what it sweeps is then
        # literally what serving returns.
        #
        # This call must stay ungated. It relies on annotation_threshold
        # defaulting to off, so the scores below span the model's whole output
        # distribution — the very thing the curve exists to sweep. Giving
        # predict() a default cutoff from parameters.json would silently fit
        # this curve on a truncated distribution while language understanding,
        # which rebuilds from the raw heads, kept fitting on the full one.
        predictions = self.predict(X)
        y_pred_all = [result['tags'] for result in predictions]
        gold = [tags_to_spans(text, tags) for text, tags in zip(X, y_true)]
        predicted = [
            [
                (item['start'], item['end'], item['entity'], item['score'])
                for item in result['entities']
            ]
            for result in predictions
        ]

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
            'report': report,
            'entities': {
                **self._annotation_metrics(X, y_true, y_pred_all),
                'tokens': {
                    'accuracy': float(acc),
                    'report': report,
                    'confusion_matrix': cm.tolist()
                }
            },
            'thresholds': {
                'annotation': self._annotation_threshold(gold, predicted),
            }
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

        # Reserve the validation rows from the AUTHORED train split *before*
        # augmenting. model.fit's validation_split holds out the last fraction of
        # the array, so if generated rows landed in that tail the model would be
        # validated on synthetic rows derived from its own training data — a leak
        # that also pins the val metrics to that slice. Augment only the leading
        # ``cut`` rows and keep every authored row after them untouched.
        spec = self._read_json(os.path.join(data, 'entities.json'), {}) \
            if isinstance(data, str) and os.path.isdir(data) else {}
        num_train = len(self.X_train)
        cut = int(num_train * (1 - validation_split))

        # Expand the fit portion only, substituting entity value/synonym terms
        # and, for open-list entities, UNK generalizations. Deterministic
        # (seeded) and idempotent — derives only from the authored rows, from the
        # catalogue shipped in the data dir (entities.json); the entity of a
        # named entity recognition span is its tag suffix, so the resolver is the
        # identity.
        gen_x, gen_y, _ = augment(
            self.X_train[:cut], self.y_train[:cut], [None] * cut,
            lambda intent, name: name, spec,
        )
        # Generated rows first, authored rows last: fit()'s validation_split tail
        # is then always authored data the generators never saw, and split-point
        # rounding can only ever move an authored row across the boundary — never
        # a synthetic one into validation.
        self.X_train = gen_x + list(self.X_train)
        self.y_train = gen_y + list(self.y_train)
        X, y = self.X_train, self.y_train

        # Size the split so fit() reserves exactly those held-out authored rows,
        # regardless of how many rows augmentation generated above.
        num_val = num_train - cut
        fit_validation_split = num_val / len(X) if num_val else 0.0

        self.parameters.update({
            'validation_split': validation_split,
            'epochs': epochs,
            'batch_size': batch_size,
            **{k: v for k, v in kwargs.items() if k != 'callbacks'}
        })
        y_encoded = self.preprocess_y(y)
        X_processed, y_aligned = self.tokenize_and_align(X, y_encoded)

        flat_labels = np.concatenate([np.asarray(seq) for seq in y_encoded])
        class_weights = self._compute_class_weights(flat_labels)

        train_samples = max(1, len(y_encoded) - num_val)
        kwargs['num_train_steps'] = max(1, math.ceil(train_samples / batch_size) * epochs)

        num_classes = len(self.labels)
        class_weight_vector = [class_weights.get(index, 1.0) for index in range(num_classes)]
        self.model = self.build(num_classes=num_classes, class_weights=class_weight_vector, **kwargs)
        
        summary = self._get_summary()
        if summary:
            print(summary)
        
        callbacks = kwargs.get('callbacks', [])
        if kwargs.get('early_stopping', True):
            import tensorflow as tf
            from ..metrics import monitor_mode
            monitor = kwargs.get('monitor', 'val_loss')
            callbacks.append(tf.keras.callbacks.EarlyStopping(
                monitor=monitor,
                # Keras only infers "higher is better" from names containing
                # 'acc', so f1/precision/recall/mcc would be minimised — the run
                # would stop exactly when the model started improving.
                mode=monitor_mode(monitor),
                patience=kwargs.get('patience', 3),
                restore_best_weights=True
            ))
        
        self._fit_data = (X_processed, y_aligned, fit_validation_split)
        self.history = self.model.fit(
            X_processed, y_aligned,
            validation_split=fit_validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )
        
        # Keep the learned transitions on the instance: evaluate() runs before
        # save(), so without this the post-training metrics would decode with
        # uniform transitions and understate the CRF.
        self.transitions = self._trained_transitions()

        self.parameters['epochs'] = len(self.history.history.get('loss', []))
        return self._history_to_dict(self.history)

    def tokenize_and_align(self, X, y):
        """
        To be implemented by subclasses to handle tokenizer-specific alignment.
        """
        raise NotImplementedError
