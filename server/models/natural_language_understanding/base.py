import os

import numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

from ..base import BaseModel
from ..augmentation import augment
from ...utils.dataset import tokenize, tags_to_spans, spans_to_tags

class BaseNaturalLanguageUnderstanding(BaseModel):
    """
    Base class for Natural Language Understanding (Intent + Slots).
    """
    def __init__(self):
        super().__init__()
        self.tags = None
        self.model_type = 'natural_language_understanding'

    def load_data(self, data):
        """
        Natural language understanding reads the authored inline
        ``utterances.csv``: an ``utterances`` column of ``{slot: value}`` markup
        and a ``labels`` intent column. ``X`` is the text; ``y`` a list of
        ``(intent, tags)`` pairs, the tags the space-separated IOB of the slot
        spans (all-``O`` when unannotated).
        """
        rows = self._read_inline(data)
        X = [text for text, _, _ in rows]
        y = [(intent, ' '.join(spans_to_tags(text, spans))) for text, spans, intent in rows]
        return X, y

    def preprocess_y(self, y):
        """
        Maps (intent, slots) pairs to indices.
        y is expected to be a list of tuples/lists: [(intent, slots), ...]
        """
        if self.labels is None or self.tags is None:
            intents = sorted(list(set(intent for intent, _ in y)))
            self.labels = {str(i): intent for i, intent in enumerate(intents)}

            all_tags = []
            for _, slots in y:
                if isinstance(slots, str):
                    all_tags.extend(slots.split())
                else:
                    all_tags.extend(slots)
            unique_tags = sorted(list(set(all_tags)))
            self.tags = {str(i): tag for i, tag in enumerate(unique_tags)}

        inv_labels = {v: int(k) for k, v in self.labels.items()}
        inv_tags = {v: int(k) for k, v in self.tags.items()}

        y_intents = np.array([inv_labels[str(intent)] for intent, _ in y])
        y_slots = []
        for _, slots in y:
            if isinstance(slots, str):
                slots = slots.split()
            y_slots.append([inv_tags[str(tag)] for tag in slots])

        return y_intents, y_slots

    def train(self, data, test_split=0.2, validation_split=0.1, epochs=10, batch_size=32, **kwargs):
        """
        Standard training loop for joint intent and slot filling.

        Reads the data source, holds out a test split (stored on the instance as
        ``X_test``/``y_test``), and trains on the remaining data.
        """
        # The intent → slot → entity map ships beside the dataset (slots.json)
        # and is persisted with the artifact for inference; it never feeds the
        # slot head — self.tags stays the trained tag vocabulary. Read it (and
        # the augmentation catalogue) from the data dir; kwargs.pop keeps any
        # legacy 'slots' kwarg inert.
        kwargs.pop('slots', None)
        if isinstance(data, str) and os.path.isdir(data):
            self.slots = self._read_json(os.path.join(data, 'slots.json'), None) or self.slots
            spec = self._read_json(os.path.join(data, 'entities.json'), {})
        else:
            spec = {}

        X, y = self.load_data(data)
        X_train, X_test, y_train, y_test = self._train_test_split(
            X, y, test_split, kwargs.get('random_state', 101)
        )
        self.X_train, self.y_train = X_train, y_train
        self.X_test, self.y_test = X_test, y_test

        # Expand the TRAIN split only (the held-out test set stays authored),
        # resolving each slot span's entity through the intent → slot → entity
        # map so the catalogue keyed by entity drives substitution.
        # Deterministic (seeded) and idempotent.
        intents_train = [intent for intent, _ in self.y_train]
        tags_train = [tags for _, tags in self.y_train]
        gen_x, gen_tags, gen_intents = augment(
            self.X_train, tags_train, intents_train,
            lambda intent, slot: (self.slots or {}).get(intent, {}).get(slot),
            spec,
        )
        self.X_train = list(self.X_train) + gen_x
        self.y_train = list(self.y_train) + list(zip(gen_intents, gen_tags))
        X, y = self.X_train, self.y_train

        if kwargs.get('pruning', False):
            initial_sparsity = kwargs.get('initial_sparsity', 0)
            final_sparsity = kwargs.get('final_sparsity', 0.5)
            begin_step = kwargs.get('pruning_begin_step', 0)
            end_step = kwargs.get('pruning_end_step', 1000)
            if not 0 <= initial_sparsity < final_sparsity < 1:
                raise ValueError('Pruning sparsity must satisfy 0 <= initial < final < 1.')
            if begin_step < 0 or end_step <= begin_step:
                raise ValueError('Pruning end step must be greater than its begin step.')

        self.parameters.update({
            'validation_split': validation_split,
            'epochs': epochs,
            'batch_size': batch_size,
            **{k: v for k, v in kwargs.items() if k != 'callbacks'}
        })
        y_intents, y_slots = self.preprocess_y(y)
        X_processed, y_slots_aligned = self.tokenize_and_align(X, y_slots)

        intent_class_weights = self._compute_class_weights(y_intents)
        intent_sample_weight = self._compute_sample_weights(y_intents, intent_class_weights)

        flat_slot_labels = np.concatenate([np.asarray(seq) for seq in y_slots])
        slot_class_weights = self._compute_class_weights(flat_slot_labels)

        num_labels = len(self.labels)
        num_tags = len(self.tags)
        slot_class_weight_vector = [slot_class_weights.get(index, 1.0) for index in range(num_tags)]

        self.model = self.build(
            num_labels=num_labels, num_tags=num_tags,
            slot_class_weights=slot_class_weight_vector, **kwargs
        )

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
        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            callbacks.append(tfmot.sparsity.keras.UpdatePruningStep())

        self._fit_data = (X_processed, [y_intents, y_slots_aligned], validation_split)

        self.history = self.model.fit(
            X_processed, [y_intents, y_slots_aligned],
            sample_weight={'intents': intent_sample_weight},
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )

        self.parameters['epochs'] = len(self.history.history.get('loss', []))

        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            self.model = tfmot.sparsity.keras.strip_pruning(self.model)

        return self._history_to_dict(self.history)

    def tokenize_and_align(self, X, y_slots):
        raise NotImplementedError

    def _joint_predictions(self, X, **kwargs):
        """
        Runs the joint model once and returns ``(intent_preds, slot_preds)``
        regardless of runtime: the intent head is the 2-D (batch, labels)
        output, the slot head the 3-D (batch, positions, tags) one, so the
        pair is recovered by shape rather than by output order.
        """
        preds = super().predict(X, **kwargs)
        if hasattr(preds, 'logits'):
            preds = preds.logits.numpy()
        if not isinstance(preds, (list, tuple)):
            preds = [preds]
        arrays = [np.asarray(pred) for pred in preds]
        intent_preds = next((array for array in arrays if array.ndim == 2), arrays[0])
        slot_preds = next((array for array in arrays if array.ndim == 3), arrays[-1])
        return intent_preds, slot_preds

    def _word_positions(self, X):
        """
        Maps each whitespace token of each input to the sequence position
        holding its slot prediction, or ``None`` when it has none (e.g.
        truncated). Tokens map one-to-one onto positions unless a subclass
        overrides (the transformer maps each word to its first subword).
        """
        sequence_length = self.parameters.get('sequence_length', 128)
        return [
            [i if i < sequence_length else None for i in range(len(text.split()))]
            for text in X
        ]

    @staticmethod
    def _to_probabilities(row):
        """
        Normalizes one head's class scores to probabilities, applying a
        softmax unless the model output already is a distribution.
        """
        row = np.asarray(row, dtype='float64')
        if row.min() >= 0 and np.isclose(row.sum(), 1.0, atol=1e-3):
            return row
        exponents = np.exp(row - row.max())
        return exponents / exponents.sum()

    def _rank_intents(self, scores, top):
        """The ``top`` highest-scoring intents as ranked ``{name, score}``."""
        probabilities = self._to_probabilities(scores)
        order = np.argsort(probabilities)[::-1]
        if top:
            order = order[:int(top)]
        return [
            {'name': self.labels[str(int(index))], 'score': float(probabilities[index])}
            for index in order
        ]

    def _word_tags(self, slot_pred, positions):
        """
        Word-level IOB tags and their scores for one input: each whitespace
        token reads the prediction at its aligned sequence position; tokens
        the model never saw (truncated) stay outside.
        """
        tags, scores = [], []
        for position in positions:
            if position is None or position >= len(slot_pred):
                tags.append('O')
                scores.append(0.0)
                continue
            probabilities = self._to_probabilities(slot_pred[position])
            index = int(np.argmax(probabilities))
            tags.append(self.tags[str(index)])
            scores.append(float(probabilities[index]))
        return tags, scores

    def _reconstruct_entities(self, text, tags, scores, slot_entities=None):
        """
        Merges word-level IOB tags back into ``{slot, entity, value, score,
        start, end}`` spans, via the shared ``tags_to_spans`` so inference
        reconstructs exactly the spans training was derived from. The span
        score is the mean of its member tokens' softmax scores.

        ``slot_entities`` is the predicted intent's slot→entity submap from
        the persisted mapping; a predicted slot absent from it reports
        ``entity: None`` (surfaced, never dropped).
        """
        entities = []
        tokens = tokenize(text)
        slot_entities = slot_entities or {}
        for start, end, name in tags_to_spans(text, tags):
            member = [
                score for (_, token_start, token_end), score in zip(tokens, scores)
                if token_start < end and token_end > start
            ]
            entities.append({
                'slot': name,
                'entity': slot_entities.get(name),
                'value': text[start:end],
                'score': float(np.mean(member)) if member else 0.0,
                'start': start,
                'end': end,
            })
        return entities

    def predict(self, X, **kwargs):
        """
        Generates predictions for intent and slots.

        Returns one dict per input, ``{'intents': [...], 'entities': [...]}``:
        the intents ranked by score and cut to ``top`` (an int, or a per-input
        list as sent by the batched serving loop), and the slot predictions
        aligned back to whitespace words and merged into character-offset
        spans over the input — each carrying its ``slot`` (the predicted
        role) and that slot's ``entity``, resolved from the persisted
        intent → slot → entity map through the top-ranked intent.
        """
        top = kwargs.pop('top', 1)
        intent_preds, slot_preds = self._joint_predictions(X, **kwargs)
        tops = top if isinstance(top, (list, tuple)) else [top] * len(X)

        results = []
        for i, (text, positions, k) in enumerate(zip(X, self._word_positions(X), tops)):
            tags, scores = self._word_tags(slot_preds[i], positions)
            intents = self._rank_intents(intent_preds[i], k)
            slot_entities = (self.slots or {}).get(intents[0]['name']) if intents else None
            results.append({
                'intents': intents,
                'entities': self._reconstruct_entities(text, tags, scores, slot_entities)
            })
        return results

    def _entity_metrics(self, X, y_true, y_pred):
        """
        Entity-level slot precision/recall/F1: a predicted span counts only
        when its slot type and both boundaries match a true span exactly.
        Includes a per-slot breakdown keyed by slot name.
        """
        totals = {}
        for text, true_tags, pred_tags in zip(X, y_true, y_pred):
            true_spans = set(tags_to_spans(text, true_tags))
            pred_spans = set(tags_to_spans(text, pred_tags))
            names = {name for _, _, name in true_spans | pred_spans}
            for name in names:
                counts = totals.setdefault(name, {'true': 0, 'pred': 0, 'match': 0})
                true_named = {span for span in true_spans if span[2] == name}
                pred_named = {span for span in pred_spans if span[2] == name}
                counts['true'] += len(true_named)
                counts['pred'] += len(pred_named)
                counts['match'] += len(true_named & pred_named)

        def _prf(counts):
            precision = counts['match'] / counts['pred'] if counts['pred'] else 0.0
            recall = counts['match'] / counts['true'] if counts['true'] else 0.0
            f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
            return {
                'precision': round(precision, 4),
                'recall': round(recall, 4),
                'f1': round(f1, 4),
                'support': counts['true']
            }

        overall = {'true': 0, 'pred': 0, 'match': 0}
        for counts in totals.values():
            for key in overall:
                overall[key] += counts[key]
        metrics = {
            **_prf(overall),
            'slots': {name: _prf(counts) for name, counts in sorted(totals.items())}
        }

        # Optional roll-up by entity via the persisted slot→entity map
        # (slot names are unique per model, so the flattened map is safe):
        # "how well are locations found", regardless of which role they fill.
        if self.slots:
            entity_of = {
                slot: entity
                for submap in self.slots.values()
                for slot, entity in (submap or {}).items()
            }
            by_entity = {}
            for name, counts in totals.items():
                entity = entity_of.get(name)
                if not entity:
                    continue
                rollup = by_entity.setdefault(entity, {'true': 0, 'pred': 0, 'match': 0})
                for key in rollup:
                    rollup[key] += counts[key]
            if by_entity:
                metrics['entities'] = {
                    name: _prf(counts) for name, counts in sorted(by_entity.items())
                }
        return metrics

    def evaluate(self, X, y, **kwargs):
        """
        Evaluates the joint model. Returns a JSON-serializable dictionary.

        Intent metrics are also exposed at the top level (``accuracy``,
        ``report``, ``confusion_matrix``) so History, the version analytics
        and the confusion view read a joint model exactly like a classifier;
        ``slots`` carries the word-aligned token-level view plus the
        entity-level scores (a span counts only when type and boundaries
        match exactly).
        """
        y_intents_true = [str(intent) for intent, _ in y]
        y_slots_true = []
        for _, slots in y:
            y_slots_true.append(slots.split() if isinstance(slots, str) else list(slots))

        intent_preds, slot_preds = self._joint_predictions(X)
        positions = self._word_positions(X)

        y_intents_pred, y_slots_pred = [], []
        for i in range(len(X)):
            y_intents_pred.append(self._rank_intents(intent_preds[i], 1)[0]['name'])
            tags, _ = self._word_tags(slot_preds[i], positions[i])
            y_slots_pred.append(tags)

        # Intent evaluation
        intent_acc = accuracy_score(y_intents_true, y_intents_pred)
        intent_report = classification_report(y_intents_true, y_intents_pred, zero_division=0, output_dict=True)
        intent_matrix = confusion_matrix(y_intents_true, y_intents_pred)

        # Token-level slot evaluation over word-aligned tags; tokens the
        # model produced no tag for count as outside.
        y_slots_true_flat, y_slots_pred_flat = [], []
        for true, pred in zip(y_slots_true, y_slots_pred):
            pred = pred[:len(true)] + ['O'] * max(0, len(true) - len(pred))
            y_slots_true_flat.extend(true)
            y_slots_pred_flat.extend(pred)

        slot_acc = accuracy_score(y_slots_true_flat, y_slots_pred_flat)
        slot_report = classification_report(y_slots_true_flat, y_slots_pred_flat, zero_division=0, output_dict=True)

        return {
            'accuracy': float(intent_acc),
            'report': intent_report,
            'confusion_matrix': intent_matrix.tolist(),
            'intent': {
                'accuracy': float(intent_acc),
                'report': intent_report
            },
            'slots': {
                'accuracy': float(slot_acc),
                'report': slot_report,
                'entity': self._entity_metrics(X, y_slots_true, y_slots_pred)
            }
        }
