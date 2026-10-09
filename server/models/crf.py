"""
Linear-chain CRF for the token-tagging heads (named entity recognition tags,
language understanding slots).

The CRF is deliberately kept *out* of the exported graph. :class:`CRFTransitions`
is a pass-through layer whose only job is to own the transition matrix, so the
saved model still emits plain per-token emission scores and exports to TFLite /
ONNX exactly as it did before; :func:`viterbi_decode` then runs in numpy at
predict time, identically for every runtime. The learned matrix travels beside
the artifact as a ``crf.npy`` sidecar (see :class:`CRFDecoder`), which is what
lets the non-Keras runtimes decode with it at all.

The CRF is **off by default** — it roughly doubles training cost for a gain that
only shows on datasets with enough spans to learn transitions from. Without it
there is no sidecar and no sequence search: :func:`greedy_decode` takes each
position's own best tag and drops the structurally impossible ones (an ``I-X``
that continues nothing becomes ``O``), so the tags a caller sees are always
well-formed IOB either way.

Masked positions are *skipped*, never treated as the end of the sequence: the
transformer aligners label ``[CLS]``, ``[SEP]`` and every non-initial sub-word
``-100``, so masked positions sit between real tokens. Both the likelihood and
the gold-path score walk the chain over the unmasked positions only.
"""
import os

import numpy as np
import tensorflow as tf

# Stands in for -inf in the numpy decode: large enough to never win an argmax.
NEGATIVE_INFINITY = float('-inf')

# `crf_log_norm`'s forward algorithm is a genuine recurrence — each step's alpha
# depends on the last — so it stays a differentiated `tf.while_loop` over the
# sequence, and its cost is per-kernel launch overhead rather than arithmetic.
# It is the CRF's dominant cost on an accelerator; `crf_sequence_score` had the
# same shape but no true dependence between steps, and is vectorized. Making
# the log norm parallel would take an associative scan in the log semiring,
# whose `batch x length x tags x tags` intermediates run to hundreds of
# megabytes at realistic tag counts — not attempted.


class CRFTransitions(tf.keras.layers.Layer):
    """
    Owns the ``(num_tags, num_tags)`` transition matrix, ``transitions[i, j]``
    scoring a move from tag ``i`` to tag ``j``.

    The forward pass returns its input unchanged: the layer exists only so the
    matrix is a trainable weight of the model — gradients reach it through
    :class:`CRFLoss`, which reads it — without adding an op to the exported
    graph.
    """

    def __init__(self, num_tags, **kwargs):
        super().__init__(**kwargs)
        self.num_tags = int(num_tags)

    def build(self, input_shape):
        self.transitions = self.add_weight(
            name='transitions',
            shape=(self.num_tags, self.num_tags),
            initializer='zeros',
            trainable=True,
        )
        super().build(input_shape)

    def call(self, inputs):
        return inputs

    def get_config(self):
        return {**super().get_config(), 'num_tags': self.num_tags}


def transitions_variable(model):
    """
    The transition weight owned by ``model``'s :class:`CRFTransitions` layer, or
    ``None`` when it has none.

    Always read this off the *final* model: pruning rebuilds the graph through
    ``clone_model``, which constructs a fresh layer with a fresh weight, so a
    reference captured before that would be orphaned — the loss would train a
    variable the saved model never sees.
    """
    for layer in getattr(model, 'layers', []):
        if isinstance(layer, CRFTransitions):
            return layer.transitions
    return None


def _gold_and_mask(y_true, dtype):
    """
    Gold tag ids and the float mask of real positions, following the same
    ``-100`` contract as ``NonPaddingLoss``: relu() maps the ignored labels to a
    valid index and the mask zeroes their contribution.
    """
    y_true = tf.cast(y_true, tf.int32)
    mask = tf.cast(y_true >= 0, dtype)
    return tf.nn.relu(y_true), mask


def crf_sequence_score(emissions, tags, mask, transitions):
    """
    Unnormalized score of the gold tag sequence: the emission of each real
    token plus the transition from the previous *real* token (masked positions
    in between are skipped, not scored).

    Vectorized: each position's previous real token is found with a masked
    maximum over earlier positions, so the whole score is a fixed handful of
    batched ops. The per-position ``tf.while_loop`` this replaces — and, worse,
    its differentiated backward pass — was hundreds of sequential tiny kernels,
    which on accelerators with slow kernel launches dominated the whole loss.
    The ``batch x length x length`` intermediate is the price; at these
    sequence lengths it is a few megabytes.
    """
    num_tags = tf.shape(emissions)[-1]
    one_hot = tf.one_hot(tags, num_tags, dtype=emissions.dtype)
    unary = tf.reduce_sum(emissions * one_hot, axis=-1) * mask
    score = tf.reduce_sum(unary, axis=-1)

    # previous[b, i]: position of the last real token strictly before i, or
    # -1 when there is none (i sits in leading padding, or is the first real
    # token). A masked position's own entry is -1, so gaps are skipped over.
    length = tf.shape(emissions)[1]
    positions = tf.range(length)
    real = tf.cast(mask > 0, positions.dtype)
    marked = positions * real - (1 - real)             # j where real, else -1
    earlier = positions[:, None] > positions[None, :]  # [i, j] = j before i
    previous = tf.reduce_max(
        tf.where(earlier[None, :, :], marked[:, None, :], -1), axis=-1
    )

    # Transition into each real position from that previous token's tag.
    # Positions with no previous real token gather a clamped index and are
    # zeroed by ``started`` — the first real token pays no transition, matching
    # the ``started`` gate in the log norm.
    started = tf.cast(previous >= 0, emissions.dtype)
    previous_tags = tf.gather(tags, tf.maximum(previous, 0), batch_dims=1)
    pair = tf.gather_nd(transitions, tf.stack([previous_tags, tags], axis=-1))
    return score + tf.reduce_sum(pair * mask * started, axis=-1)


def crf_log_norm(emissions, mask, transitions):
    """
    Log partition function over every tag sequence, by the forward algorithm.
    ``started`` keeps the first real token from paying a transition, so a
    sequence whose leading positions are masked (``[CLS]``) scores the same as
    one without them.
    """
    batch = tf.shape(emissions)[0]
    num_tags = tf.shape(emissions)[-1]

    def step(index, alpha, started):
        emit = emissions[:, index]
        transitioned = tf.reduce_logsumexp(
            tf.expand_dims(alpha, 2) + tf.expand_dims(transitions, 0), axis=1
        ) + emit
        opened = tf.expand_dims(started, 1)
        candidate = opened * transitioned + (1 - opened) * emit
        current = tf.expand_dims(mask[:, index], 1)
        alpha = current * candidate + (1 - current) * alpha
        return index + 1, alpha, tf.maximum(started, mask[:, index])

    _, alpha, started = tf.while_loop(
        lambda index, *_: index < tf.shape(emissions)[1],
        step,
        (
            tf.constant(0),
            tf.zeros((batch, num_tags), dtype=emissions.dtype),
            tf.zeros((batch,), dtype=emissions.dtype),
        ),
    )
    # A row with no real token contributes nothing rather than log(num_tags).
    return tf.reduce_logsumexp(alpha, axis=-1) * started


def crf_log_likelihood(emissions, tags, mask, transitions):
    """Log-likelihood of the gold sequence under the CRF, per sequence."""
    return (
        crf_sequence_score(emissions, tags, mask, transitions)
        - crf_log_norm(emissions, mask, transitions)
    )


class CRFLoss(tf.keras.losses.Loss):
    """
    Negative CRF log-likelihood for a sequence-labelling head, averaged over
    real tokens.

    Normalizing by token count rather than by sequence keeps the loss on the
    same scale as ``NonPaddingLoss``, so the head's entry in ``loss_weights``
    keeps its meaning when a model switches the CRF on.

    Unlike ``NonPaddingLoss`` this takes no class weights: the CRF scores a whole
    sequence, so there is no per-token weight to fold in. Rare-tag balance comes
    from the transition structure instead.
    """

    def __init__(self, transitions, name='crf_loss'):
        super().__init__(name=name)
        self.transitions = transitions

    def call(self, y_true, y_pred):
        tags, mask = _gold_and_mask(y_true, y_pred.dtype)
        # Read the weight into a dense tensor *before* scoring. `tf.cast` alone
        # does not do it: casting a variable to its own dtype returns the
        # variable itself, so `crf_sequence_score` would gather straight off the
        # resource (`ResourceGatherNd`, which has a CPU-only kernel) while the
        # optimizer keeps the variable and its Adam slots on the GPU. That
        # colocation cannot be satisfied and training dies at graph
        # construction on any GPU backend. Reading once also keeps the log
        # norm's loop from re-reading the weight on every iteration.
        transitions = tf.cast(tf.convert_to_tensor(self.transitions), y_pred.dtype)
        likelihood = crf_log_likelihood(y_pred, tags, mask, transitions)
        return -tf.reduce_sum(likelihood) / tf.maximum(tf.reduce_sum(mask), 1.0)


def iob_transition_mask(vocabulary):
    """
    Legality masks over a tag vocabulary (``{index: name}``), as
    ``(start, pairs)``: ``start[j]`` is whether tag ``j`` may open a sequence and
    ``pairs[i, j]`` whether ``j`` may follow ``i``.

    The one rule is that ``I-X`` continues a span, so it may only follow ``B-X``
    or ``I-X`` and may never start one. Everything else is permitted — this
    removes structurally impossible tags, it does not encode preferences.
    """
    names = [vocabulary[str(index)] for index in range(len(vocabulary))]
    size = len(names)
    start = np.ones(size, dtype=bool)
    pairs = np.ones((size, size), dtype=bool)
    for j, name in enumerate(names):
        if not name.startswith('I-'):
            continue
        start[j] = False
        for i, previous in enumerate(names):
            pairs[i, j] = (
                previous.startswith(('B-', 'I-')) and previous[2:] == name[2:]
            )
    return start, pairs


def outside_index(vocabulary):
    """
    Index of the ``O`` tag in ``vocabulary`` (``{index: name}``), or ``None``
    when the vocabulary has none — in which case there is nothing to demote an
    illegal tag *to* and :func:`greedy_decode` leaves the sequence alone.
    """
    for index in range(len(vocabulary)):
        if vocabulary[str(index)] == 'O':
            return index
    return None


def greedy_decode(emissions, legal=None, outside=None):
    """
    Per-token argmax over one input's ``(tokens, tags)`` emissions, repaired
    against the IOB legality masks.

    This is the no-CRF path. Each position keeps the tag the model itself
    scored highest; a tag that cannot legally sit there — an ``I-X`` opening
    the sequence, or one following anything but ``B-X``/``I-X`` — is demoted to
    ``O``. Demoting is deliberate: Viterbi would instead license the orphan by
    rewriting the token before it as a ``B-X`` the model never predicted, which
    invents a span out of a single stray tag. Without the CRF's learned
    transitions there is no evidence for that rewrite, so the orphan is dropped.

    The repair walks left to right over the tags it has already fixed, so it
    cascades: once a position becomes ``O`` the ``I-X`` after it is illegal in
    turn and the whole orphaned run collapses.
    """
    emissions = np.asarray(emissions, dtype='float64')
    length, _ = emissions.shape
    if length == 0:
        return np.zeros(0, dtype=int)

    path = np.argmax(emissions, axis=-1).astype(int)
    if legal is None or outside is None:
        return path

    start_legal, pair_legal = legal
    for step in range(length):
        tag = path[step]
        legal_here = (
            start_legal[tag] if step == 0 else pair_legal[path[step - 1], tag]
        )
        if not legal_here:
            path[step] = outside
    return path


def viterbi_decode(emissions, transitions=None, legal=None):
    """
    Highest-scoring tag sequence for one input's ``(tokens, tags)`` emissions.

    ``transitions`` of ``None`` (an artifact trained before the CRF, or with it
    switched off) scores every move equally, so with ``legal`` supplied this
    degrades exactly to constrained decoding — the same code path, minus the
    learned preferences. The no-CRF artifacts do not take that route any more,
    though: :meth:`CRFDecoder._decode_tags` sends them to
    :func:`greedy_decode`, which repairs rather than reinterprets.
    """
    emissions = np.asarray(emissions, dtype='float64')
    length, size = emissions.shape
    if length == 0:
        return np.zeros(0, dtype=int)

    transitions = (
        np.zeros((size, size)) if transitions is None
        else np.asarray(transitions, dtype='float64')
    )
    start_legal, pair_legal = legal if legal is not None else (None, None)

    score = emissions[0].copy()
    if start_legal is not None:
        score = np.where(start_legal, score, NEGATIVE_INFINITY)

    backpointers = np.zeros((length, size), dtype=int)
    for step in range(1, length):
        candidates = score[:, None] + transitions
        if pair_legal is not None:
            candidates = np.where(pair_legal, candidates, NEGATIVE_INFINITY)
        best = np.argmax(candidates, axis=0)
        backpointers[step] = best
        score = candidates[best, np.arange(size)] + emissions[step]

    path = [int(np.argmax(score))]
    for step in range(length - 1, 0, -1):
        path.append(int(backpointers[step][path[-1]]))
    path.reverse()
    return np.array(path, dtype=int)


class CRFDecoder:
    """
    The CRF's inference-side half, mixed into the token-tagging base classes.

    Holds the transition matrix loaded from the artifact sidecar, caches the
    legality masks derived from the tag vocabulary, and turns one input's
    emissions into word-level tags. Kept separate from the Keras layer so that
    decoding never depends on the training graph — which is what lets the TFLite
    and ONNX runtimes decode through the identical path.
    """

    SIDECAR = 'crf.npy'

    transitions = None

    def _tag_rules(self, vocabulary):
        """
        Cached ``(legality masks, O index)`` for ``vocabulary`` — everything
        both decoders need to keep the IOB structure well-formed.
        """
        cached = getattr(self, '_rules', None)
        if cached is None or cached[0] != len(vocabulary):
            self._rules = (
                len(vocabulary),
                iob_transition_mask(vocabulary),
                outside_index(vocabulary),
            )
        return self._rules[1], self._rules[2]

    def _save_transitions(self, path):
        """Writes the learned matrix beside the artifact, when there is one."""
        transitions = self._trained_transitions()
        if transitions is not None:
            np.save(os.path.join(path, self.SIDECAR), transitions)

    def _trained_transitions(self):
        """
        The transition matrix held by the model's ``CRFTransitions`` layer, or
        ``None`` when this run trained without the CRF.
        """
        model = getattr(self, 'model', None)
        if not isinstance(model, tf.keras.Model):
            return self.transitions
        variable = transitions_variable(model)
        return self.transitions if variable is None else variable.numpy()

    def _load_transitions(self, path):
        """Reads the sidecar, leaving ``transitions`` at ``None`` when absent."""
        sidecar = os.path.join(path, self.SIDECAR)
        if os.path.exists(sidecar):
            self.transitions = np.load(sidecar)

    def _decode_tags(self, emissions, positions, vocabulary):
        """
        Word-level tags and their scores for one input.

        Each whitespace word reads the position ``_word_positions`` aligned it
        to; gathering those gives the word sequence IOB legality is defined
        over, which is what Viterbi runs on. Words the model never saw (past the
        sequence length) stay outside as ``O``.
        """
        aligned = [
            (word, position) for word, position in enumerate(positions)
            if position is not None and position < len(emissions)
        ]
        tags = ['O'] * len(positions)
        scores = [0.0] * len(positions)
        if not aligned:
            return tags, scores

        rows = np.asarray([emissions[position] for _, position in aligned])
        legal, outside = self._tag_rules(vocabulary)
        # No sidecar means no CRF (switched off for this run, or an artifact
        # predating it): decode each position on its own and repair the IOB
        # structure afterwards. Viterbi is only for artifacts that actually
        # learned transitions to search with.
        path = (
            greedy_decode(rows, legal, outside) if self.transitions is None
            else viterbi_decode(rows, self.transitions, legal)
        )
        for (word, _), row, choice in zip(aligned, rows, path):
            tags[word] = vocabulary[str(int(choice))]
            scores[word] = float(self._to_probabilities(row)[int(choice)])
        return tags, scores
