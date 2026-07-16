import tensorflow as tf


class NonPaddingLoss(tf.keras.losses.Loss):
    """
    Sparse categorical cross-entropy for the slot head that ignores padded /
    sub-word positions.

    Aligned slot labels use ``-100`` for special tokens and every non-initial
    sub-word (see each architecture's ``tokenize_and_align``). Those positions
    are masked out so they contribute nothing to the loss, and the remaining
    per-token losses are averaged over the real tokens only. Without this, plain
    ``sparse_categorical_crossentropy`` treats ``-100`` as a class index and
    fails ("label value of -100 outside the valid range").
    """

    def __init__(self, name='non_padding_loss'):
        super().__init__(name=name)

    def call(self, y_true, y_pred):
        loss_fn = tf.keras.losses.SparseCategoricalCrossentropy(
            from_logits=False, reduction=tf.keras.losses.Reduction.NONE
        )
        y_true = tf.cast(y_true, tf.int32)
        mask = tf.cast(y_true >= 0, y_pred.dtype)
        # relu() maps the ignored -100 labels to a valid class index; the mask
        # then zeroes their contribution before the loss is reduced.
        per_token = loss_fn(tf.nn.relu(y_true), y_pred) * mask
        return tf.reduce_sum(per_token) / tf.maximum(tf.reduce_sum(mask), 1.0)


class NonPaddingAccuracy(tf.keras.metrics.Metric):
    """
    Token accuracy for the slot head that ignores the ``-100`` padded /
    sub-word positions, mirroring :class:`NonPaddingLoss` so the reported slot
    accuracy reflects only the real tokens (otherwise the padding, which
    dominates a max-length sequence, would swamp the number).
    """

    def __init__(self, name='accuracy', **kwargs):
        super().__init__(name=name, **kwargs)
        self.correct = self.add_weight(name='correct', initializer='zeros')
        self.total = self.add_weight(name='total', initializer='zeros')

    def update_state(self, y_true, y_pred, sample_weight=None):
        y_true = tf.cast(tf.reshape(y_true, [-1]), tf.int32)
        y_pred = tf.cast(tf.reshape(tf.argmax(y_pred, axis=-1), [-1]), tf.int32)
        mask = tf.cast(y_true >= 0, tf.float32)
        matches = tf.cast(tf.equal(y_true, y_pred), tf.float32) * mask
        self.correct.assign_add(tf.reduce_sum(matches))
        self.total.assign_add(tf.reduce_sum(mask))

    def result(self):
        return tf.math.divide_no_nan(self.correct, self.total)

    def reset_state(self):
        self.correct.assign(0.0)
        self.total.assign(0.0)


from .base import BaseNaturalLanguageUnderstanding
from .transformer import BERTNaturalLanguageUnderstanding
from .deep_neural_network import DNNNaturalLanguageUnderstanding


class NaturalLanguageUnderstanding:
    """
    Factory class for Natural Language Understanding models.
    """
    _architectures = {
        'base': BaseNaturalLanguageUnderstanding,
        'transformer': BERTNaturalLanguageUnderstanding,
        'deep_neural_network': DNNNaturalLanguageUnderstanding
    }

    @staticmethod
    def _get_architecture_class(architecture):
        """
        Returns the architecture class for the specified architecture.
        """
        architecture_class = NaturalLanguageUnderstanding._architectures.get(str(architecture).lower())
        if not architecture_class:
            raise ValueError(f"Unknown Natural Language Understanding model: {architecture}. "
                             f"Available: {list(NaturalLanguageUnderstanding._architectures.keys())}")
        return architecture_class

    @staticmethod
    def create(architecture='base'):
        """
        Creates an instance of the specified model.
        """
        return NaturalLanguageUnderstanding._get_architecture_class(architecture)()

    @staticmethod
    def load(path, **kwargs):
        """
        Loads a model from a path by determining its architecture from parameters.json.
        """
        architecture = BaseNaturalLanguageUnderstanding._get_architecture_type(path)
        return NaturalLanguageUnderstanding._get_architecture_class(architecture).load(path, **kwargs)
