import math
import os

import numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

from ..base import BaseModel
from ..augmentation import augment
from ..crf import CRFDecoder
from ..thresholds import gate_annotations, gate_labels, label_curve, label_curves_by_name, with_labels
from ...utils.dataset import tokenize, tags_to_spans, spans_to_tags

class BaseNaturalLanguageUnderstanding(CRFDecoder, BaseModel):
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

        # Reserve the validation rows from the AUTHORED train split *before*
        # augmenting. model.fit's validation_split holds out the last fraction of
        # the array, so if generated rows landed in that tail the model would be
        # validated on synthetic rows derived from its own training data — a leak
        # that also pins the val metrics to that slice. Augment only the leading
        # ``cut`` rows and keep every authored row after them untouched.
        num_train = len(self.X_train)
        cut = int(num_train * (1 - validation_split))
        X_fit, y_fit = self.X_train[:cut], self.y_train[:cut]

        # Expand the fit portion only (the held-out test and val rows stay
        # authored), resolving each slot span's entity through the intent → slot
        # → entity map so the catalogue keyed by entity drives substitution.
        # Deterministic (seeded) and idempotent.
        gen_x, gen_tags, gen_intents = augment(
            X_fit,
            [tags for _, tags in y_fit],
            [intent for intent, _ in y_fit],
            lambda intent, slot: (self.slots or {}).get(intent, {}).get(slot),
            spec,
        )
        # Generated rows first, authored rows last: fit()'s validation_split tail
        # is then always authored data the generators never saw, and split-point
        # rounding can only ever move an authored row across the boundary — never
        # a synthetic one into validation.
        self.X_train = gen_x + list(self.X_train)
        self.y_train = list(zip(gen_intents, gen_tags)) + list(self.y_train)
        X, y = self.X_train, self.y_train

        # Size the split so fit() reserves exactly those held-out authored rows,
        # regardless of how many rows augmentation generated above.
        num_val = num_train - cut
        fit_validation_split = num_val / len(X) if num_val else 0.0

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

        # Match the LR-decay horizon to the real run: create_optimizer's
        # PolynomialDecay glides to zero over num_train_steps, so it must equal
        # the actual optimizer-step count or the LR dies mid-training (it
        # defaults to 1000). Same computation as the other model types.
        kwargs['num_train_steps'] = max(1, math.ceil((len(X) - num_val) / batch_size) * epochs)

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
        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            callbacks.append(tfmot.sparsity.keras.UpdatePruningStep())

        self._fit_data = (X_processed, [y_intents, y_slots_aligned], fit_validation_split)

        self.history = self.model.fit(
            X_processed, [y_intents, y_slots_aligned],
            sample_weight={'intents': intent_sample_weight},
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
        Word-level IOB tags and their scores for one input.

        Decoding is the CRF Viterbi pass over the aligned word sequence, under
        the IOB legality mask — or, for a model carrying no ``crf.npy`` (trained
        without the CRF, which is the default, or before it existed), per-token
        argmax with the structurally illegal tags repaired to ``O``.
        """
        return self._decode_tags(slot_pred, positions, self.tags)

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

    def _reconstruct_entities(self, text, tags, scores, slot_entities=None):
        """
        Merges word-level IOB tags back into ``{slot, entity, value, score,
        start, end}`` annotations, via the shared ``_scored_annotations`` so
        inference reconstructs exactly the annotations training was derived
        from and the threshold curve scores.

        ``slot_entities`` is the predicted intent's slot→entity submap from
        the persisted mapping; a predicted slot absent from it reports
        ``entity: None`` (surfaced, never dropped).
        """
        slot_entities = slot_entities or {}
        return [{
            'slot': name,
            'entity': slot_entities.get(name),
            'value': text[start:end],
            'score': score,
            'start': start,
            'end': end,
        } for start, end, name, score in self._scored_annotations(text, tags, scores)]

    def predict(self, X, **kwargs):
        """
        Generates predictions for intent and slots.

        Returns one dict per input, ``{'intents': [...], 'entities': [...]}``:
        the intents ranked by score and cut to ``top`` (an int, or a per-input
        list as sent by the batched serving loop), and the slot predictions
        aligned back to whitespace words and merged into character-offset
        annotations over the input — each carrying its ``slot`` (the
        predicted role) and that slot's ``entity``, resolved from the
        persisted intent → slot → entity map through the top-ranked intent.

        ``label_threshold`` clears the top intent's ``name`` below its cutoff
        and ``annotation_threshold`` drops low-scoring slots; both default to
        0, meaning off. Entities are resolved through the top intent before it
        is gated, so a rejected intent does not strip entity names from slots
        that passed their own cutoff.
        """
        top = kwargs.pop('top', 1)
        label_threshold = kwargs.pop('label_threshold', 0.0)
        annotation_threshold = kwargs.pop('annotation_threshold', 0.0)
        intent_preds, slot_preds = self._joint_predictions(X, **kwargs)
        tops = top if isinstance(top, (list, tuple)) else [top] * len(X)
        label_thresholds = self._per_input(label_threshold, len(X))
        annotation_thresholds = self._per_input(annotation_threshold, len(X))

        results = []
        for i, (text, positions, k) in enumerate(zip(X, self._word_positions(X), tops)):
            tags, scores = self._word_tags(slot_preds[i], positions)
            intents = self._rank_intents(intent_preds[i], k)
            # Entities are resolved through the top intent *before* it is
            # gated. The two heads are thresholded independently, so a slot
            # that cleared its own cutoff should not lose its entity name
            # because the intent head happened to be uncertain.
            slot_entities = (self.slots or {}).get(intents[0]['name']) if intents else None
            entities, _ = gate_annotations(
                self._reconstruct_entities(text, tags, scores, slot_entities),
                tags,
                annotation_thresholds[i],
                tokenize(text),
            )
            results.append({
                'intents': gate_labels(intents, label_thresholds[i]),
                'entities': entities,
            })
        return results

    def _slot_metrics(self, X, y_true, y_pred):
        """
        Exact-match slot metrics, plus the roll-up by entity.

        ``labels`` is keyed by slot — the name a language understanding
        annotation trains under. ``entities`` re-tallies the same annotations
        through the persisted intent → slot → entity map (slot names are unique
        per model, so the flattened map is safe), answering "how well are
        locations found, whatever role they fill".
        """
        tallies = self._annotation_tallies(X, y_true, y_pred)
        metrics = self._metrics_from_tallies(tallies)
        if not self.slots:
            return metrics

        entity_of = {
            slot: entity
            for submap in self.slots.values()
            for slot, entity in (submap or {}).items()
        }
        by_entity = {}
        for name, counts in tallies.items():
            entity = entity_of.get(name)
            if not entity:
                continue
            rollup = by_entity.setdefault(entity, {'true': 0, 'pred': 0, 'match': 0})
            for key in rollup:
                rollup[key] += counts[key]
        if by_entity:
            metrics['entities'] = {
                name: self._prf(counts) for name, counts in sorted(by_entity.items())
            }
        return metrics

    def evaluate(self, X, y, **kwargs):
        """
        Evaluates the joint model. Returns a JSON-serializable dictionary.

        Intent metrics are also exposed at the top level (``accuracy``,
        ``report``, ``confusion_matrix``) so History, the version analytics
        and the confusion view read a joint model exactly like a classifier.

        ``slots`` carries the exact-match scores — overall, per slot under
        ``labels``, and rolled up per entity under ``entities`` — with the
        word-aligned token view demoted to ``slots['tokens']``, which keeps its
        report and confusion matrix for the tag-level diagnostic view.
        """
        y_intents_true = [str(intent) for intent, _ in y]
        y_slots_true = []
        for _, slots in y:
            y_slots_true.append(slots.split() if isinstance(slots, str) else list(slots))

        intent_preds, slot_preds = self._joint_predictions(X)
        positions = self._word_positions(X)

        # The scores are kept, not dropped: they are what the threshold curves
        # sweep, and recomputing them would mean a second forward pass.
        y_intents_pred, y_intents_score = [], []
        y_slots_pred, y_slots_score = [], []
        for i in range(len(X)):
            ranked = self._rank_intents(intent_preds[i], 1)[0]
            y_intents_pred.append(ranked['name'])
            y_intents_score.append(ranked['score'])
            tags, scores = self._word_tags(slot_preds[i], positions[i])
            y_slots_pred.append(tags)
            y_slots_score.append(scores)

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
        # Tag-level, so it lines up row-for-row with `slot_report` exactly the
        # way the intent matrix lines up with `intent_report` — both index the
        # sorted label set sklearn derives from the true/predicted values, which
        # is what the History matrix view reads its axis labels from.
        slot_matrix = confusion_matrix(y_slots_true_flat, y_slots_pred_flat)

        # Both heads are scored on the same predictions the metrics above used,
        # so the operating points and the reported numbers cannot drift apart.
        intents_correct = [
            predicted == truth
            for predicted, truth in zip(y_intents_pred, y_intents_true)
        ]
        slot_gold = [tags_to_spans(text, tags) for text, tags in zip(X, y_slots_true)]
        slot_predicted = [
            self._scored_annotations(text, tags, scores)
            for text, tags, scores in zip(X, y_slots_pred, y_slots_score)
        ]

        return {
            'accuracy': float(intent_acc),
            'report': intent_report,
            'confusion_matrix': intent_matrix.tolist(),
            'intent': {
                'accuracy': float(intent_acc),
                'report': intent_report
            },
            'slots': {
                **self._slot_metrics(X, y_slots_true, y_slots_pred),
                'tokens': {
                    'accuracy': float(slot_acc),
                    'report': slot_report,
                    'confusion_matrix': slot_matrix.tolist()
                }
            },
            'thresholds': {
                'label': with_labels(
                    label_curve(intents_correct, y_intents_score),
                    label_curves_by_name(y_intents_pred, intents_correct, y_intents_score),
                ),
                'annotation': self._annotation_threshold(slot_gold, slot_predicted),
            }
        }
