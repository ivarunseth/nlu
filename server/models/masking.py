import tensorflow as tf


class NonPaddingLoss(tf.keras.losses.Loss):
    """
    Sparse categorical cross-entropy for a sequence-labelling head (NER tags
    or NLU slots) that ignores padded / sub-word positions and, optionally,
    weights each real token by its class.

    Aligned labels use ``-100`` for special tokens, every non-initial sub-word,
    and (for architectures without sub-word tokenization) sequence padding —
    see each architecture's ``tokenize_and_align``. Those positions are masked
    out so they contribute nothing to the loss, and the remaining per-token
    losses are averaged over the real tokens only. Without the mask, plain
    ``sparse_categorical_crossentropy`` treats ``-100`` as a class index and
    fails ("label value of -100 outside the valid range").

    ``class_weights`` (a 1-D sequence indexed by class id, or ``None`` for
    uniform) is folded in here — the per-token losses are multiplied by their
    class weight *before* the scalar reduction. This is deliberate rather than
    relying on Keras' ``sample_weight``: because this loss reduces to a scalar
    itself, a per-token ``sample_weight`` applied afterward re-averages to
    ``loss * mean(weight)`` — a per-batch constant that leaves the gradient
    direction unweighted. Folding the weights in before reduction makes rare
    classes actually count more. ``None`` reproduces the old unweighted
    behavior exactly (used at load time, where the loss is irrelevant to
    inference).
    """

    def __init__(self, class_weights=None, name='non_padding_loss'):
        super().__init__(name=name)
        self.class_weights = (
            None if class_weights is None
            else tf.constant(list(class_weights), dtype=tf.float32)
        )

    def call(self, y_true, y_pred):
        loss_fn = tf.keras.losses.SparseCategoricalCrossentropy(
            from_logits=False, reduction=tf.keras.losses.Reduction.NONE
        )
        y_true = tf.cast(y_true, tf.int32)
        mask = tf.cast(y_true >= 0, y_pred.dtype)
        # relu() maps the ignored -100 labels to a valid class index; the mask
        # then zeroes their contribution before the loss is reduced.
        safe = tf.nn.relu(y_true)
        per_token = loss_fn(safe, y_pred) * mask
        if self.class_weights is not None:
            per_token = per_token * tf.gather(self.class_weights, safe)
        return tf.reduce_sum(per_token) / tf.maximum(tf.reduce_sum(mask), 1.0)


class NonPaddingAccuracy(tf.keras.metrics.Metric):
    """
    Token accuracy for a sequence-labelling head (NER tags or NLU slots) that
    ignores the ``-100`` padded / sub-word positions, mirroring
    :class:`NonPaddingLoss` so the reported accuracy reflects only the real
    tokens (otherwise the padding, which dominates a max-length sequence, would
    swamp the number).
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
