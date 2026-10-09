"""
Per-epoch training metrics the user can opt into from the training form.

Every architecture used to compile a hard-coded ``accuracy``. On a skewed
intent/entity dataset that is the least informative number available — a model
that never predicts a rare intent still scores well — so the tracked set is now
configurable per run (``parameters['metrics']``) and the extra metrics stream
into the History plot alongside loss and accuracy.

Precision, recall, F1 and MCC are all functions of the class-confusion matrix,
so one streaming accumulator (:class:`ConfusionMatrixMetric`) backs all four
rather than four separate tallies of true/false positives.

Accuracy deliberately keeps its existing implementations
(``SparseCategoricalAccuracy`` / :class:`~.masking.NonPaddingAccuracy`): the
name is already load-bearing for the plot, the live train-accuracy readout and
the early-stopping monitor options, and re-deriving it here would be
numerically identical for no gain.
"""

import tensorflow as tf

from .masking import NonPaddingAccuracy


# Selectable metric names, in the order the training form lists them.
METRIC_NAMES = ('accuracy', 'f1', 'precision', 'recall', 'mcc')

DEFAULT_METRICS = ('accuracy',)

# Metrics where a larger value is better, used to give EarlyStopping an
# explicit direction (see monitor_mode).
MAXIMISED_METRICS = frozenset(METRIC_NAMES)

# Head prefixes Keras prepends to a metric name on a multi-output (joint NLU)
# model, e.g. 'val_intents_f1'.
HEAD_PREFIXES = ('intents_', 'slots_')


class ConfusionMatrixMetric(tf.keras.metrics.Metric):
    """
    Base for metrics derived from a streaming ``num_classes x num_classes``
    confusion matrix, accumulated over an epoch and reduced to a scalar by
    :meth:`reduce`. Rows are true classes, columns predicted.

    Targets are sparse integer class ids and predictions are per-class scores,
    matching every head in this project. With ``masked=True`` the ``-100``
    padding / sub-word positions used by the sequence-labelling heads are
    dropped before counting, mirroring :class:`~.masking.NonPaddingLoss` and
    :class:`~.masking.NonPaddingAccuracy` so the score reflects real tokens
    only. Masking is the *only* difference between the flat and sequence
    variants — flattening handles the extra time axis on its own.
    """

    def __init__(self, num_classes, masked=False, name=None, **kwargs):
        super().__init__(name=name, **kwargs)
        self.num_classes = int(num_classes)
        self.masked = bool(masked)
        self.confusion = self.add_weight(
            name='confusion',
            shape=(self.num_classes, self.num_classes),
            initializer='zeros'
        )

    def update_state(self, y_true, y_pred, sample_weight=None):
        y_true = tf.cast(tf.reshape(y_true, [-1]), tf.int32)
        y_pred = tf.cast(tf.reshape(tf.argmax(y_pred, axis=-1), [-1]), tf.int32)

        if self.masked:
            keep = y_true >= 0
            y_true = tf.boolean_mask(y_true, keep)
            y_pred = tf.boolean_mask(y_pred, keep)

        self.confusion.assign_add(tf.cast(
            tf.math.confusion_matrix(
                y_true, y_pred, num_classes=self.num_classes
            ),
            self.dtype
        ))

    def counts(self):
        """``(true_positives, support, predicted)`` per class."""
        return (
            tf.linalg.diag_part(self.confusion),
            tf.reduce_sum(self.confusion, axis=1),
            tf.reduce_sum(self.confusion, axis=0)
        )

    def macro_average(self, per_class, support):
        """
        Unweighted mean of a per-class score over the classes that actually
        occurred this epoch.

        Averaging over classes with non-zero support rather than over every
        declared class keeps a label that is missing from the validation slice
        from silently dragging the score toward zero — which on a small
        validation split would otherwise look like a regression in the model.
        """
        present = tf.cast(support > 0, self.dtype)
        return tf.math.divide_no_nan(
            tf.reduce_sum(per_class * present),
            tf.reduce_sum(present)
        )

    def reduce(self):
        raise NotImplementedError

    def result(self):
        return self.reduce()

    def reset_state(self):
        self.confusion.assign(tf.zeros_like(self.confusion))

    def get_config(self):
        return {**super().get_config(), 'num_classes': self.num_classes, 'masked': self.masked}


class MacroPrecision(ConfusionMatrixMetric):
    """Mean over classes of ``TP / (TP + FP)``."""

    def __init__(self, num_classes, masked=False, name='precision', **kwargs):
        super().__init__(num_classes, masked=masked, name=name, **kwargs)

    def reduce(self):
        true_positives, support, predicted = self.counts()
        return self.macro_average(
            tf.math.divide_no_nan(true_positives, predicted), support
        )


class MacroRecall(ConfusionMatrixMetric):
    """Mean over classes of ``TP / (TP + FN)``."""

    def __init__(self, num_classes, masked=False, name='recall', **kwargs):
        super().__init__(num_classes, masked=masked, name=name, **kwargs)

    def reduce(self):
        true_positives, support, _ = self.counts()
        return self.macro_average(
            tf.math.divide_no_nan(true_positives, support), support
        )


class MacroF1(ConfusionMatrixMetric):
    """
    Mean over classes of the per-class F1.

    This is macro-F1 proper (the average of the per-class harmonic means), not
    the harmonic mean of macro-precision and macro-recall — the two differ
    whenever precision and recall are unevenly distributed across classes, and
    the former is what sklearn's ``f1_score(average='macro')`` reports.
    """

    def __init__(self, num_classes, masked=False, name='f1', **kwargs):
        super().__init__(num_classes, masked=masked, name=name, **kwargs)

    def reduce(self):
        true_positives, support, predicted = self.counts()
        precision = tf.math.divide_no_nan(true_positives, predicted)
        recall = tf.math.divide_no_nan(true_positives, support)
        per_class = tf.math.divide_no_nan(2.0 * precision * recall, precision + recall)
        return self.macro_average(per_class, support)


class MatthewsCorrelationCoefficient(ConfusionMatrixMetric):
    """
    Multi-class Matthews correlation coefficient (Gorodkin's R_K), which
    reduces to the familiar binary MCC when there are two classes.

    Unlike accuracy it stays honest on skewed data: a model that always
    predicts the majority class scores 0, not 1 - minority_rate. The value
    ranges over [-1, 1]. ``divide_no_nan`` yields 0 for the degenerate case
    where the matrix has a single occupied row or column, matching sklearn.
    """

    def __init__(self, num_classes, masked=False, name='mcc', **kwargs):
        super().__init__(num_classes, masked=masked, name=name, **kwargs)

    def reduce(self):
        true_positives, support, predicted = self.counts()
        total = tf.reduce_sum(self.confusion)
        correct = tf.reduce_sum(true_positives)

        covariance = correct * total - tf.reduce_sum(predicted * support)
        spread = tf.sqrt(
            (total * total - tf.reduce_sum(predicted * predicted))
            * (total * total - tf.reduce_sum(support * support))
        )
        return tf.math.divide_no_nan(covariance, spread)


# name -> factory(num_classes, masked)
METRIC_FACTORIES = {
    'accuracy': lambda num_classes, masked: (
        NonPaddingAccuracy() if masked
        else tf.keras.metrics.SparseCategoricalAccuracy(name='accuracy')
    ),
    'f1': lambda num_classes, masked: MacroF1(num_classes, masked=masked),
    'precision': lambda num_classes, masked: MacroPrecision(num_classes, masked=masked),
    'recall': lambda num_classes, masked: MacroRecall(num_classes, masked=masked),
    'mcc': lambda num_classes, masked: MatthewsCorrelationCoefficient(num_classes, masked=masked)
}


def normalize_metrics(value):
    """
    Coerces the ``metrics`` training parameter into a tuple of known names.

    Training kwargs travel unvalidated from the request body through Celery
    into ``build()``, so an unknown name is dropped here rather than surfacing
    as a crash inside ``compile()`` several minutes into a run. An empty or
    unusable selection falls back to accuracy so a run always tracks something.
    """
    if isinstance(value, str):
        value = [value]
    if not value:
        return DEFAULT_METRICS

    names = tuple(
        name for name in METRIC_NAMES
        if name in {str(entry) for entry in value}
    )
    return names or DEFAULT_METRICS


def build_metrics(names, num_classes, masked=False):
    """Builds the Keras metric objects for one head."""
    return [
        METRIC_FACTORIES[name](num_classes, masked)
        for name in normalize_metrics(names)
    ]


def monitor_mode(monitor):
    """
    Direction for ``EarlyStopping``/``ReduceLROnPlateau`` on ``monitor``.

    Keras only infers "higher is better" for names containing ``acc`` or
    starting with ``fmeasure``, so ``f1``, ``precision``, ``recall`` and ``mcc``
    would each be *minimised* — stopping the run exactly when the model started
    improving. Returning an explicit mode avoids that. Anything unrecognised is
    left to Keras as ``'auto'``.
    """
    name = str(monitor or '')
    if name.startswith('val_'):
        name = name[len('val_'):]
    for prefix in HEAD_PREFIXES:
        if name.startswith(prefix):
            name = name[len(prefix):]
            break

    if name in MAXIMISED_METRICS:
        return 'max'
    if name == 'loss':
        return 'min'
    return 'auto'
