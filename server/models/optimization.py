"""
Optimizer construction shared by all model architectures.

`transformers.create_optimizer` only builds its `AdamWeightDecay` optimizer
(a subclass of `tf.keras.optimizers.legacy.Adam`) when weight decay is
enabled; with `weight_decay_rate == 0` it falls back to the v2.11+
`tf.keras.optimizers.Adam`, which TensorFlow itself warns runs slowly on
Apple Silicon. This drop-in replacement keeps the same warmup/decay schedule
but always routes through `AdamWeightDecay` — with a zero rate the decay op
is a no-op, so it behaves as plain Adam on the fast legacy path.
"""
import tensorflow as tf
from transformers.optimization_tf import AdamWeightDecay, WarmUp


def create_optimizer(
    init_lr,
    num_train_steps,
    num_warmup_steps,
    min_lr_ratio=0.0,
    adam_beta1=0.9,
    adam_beta2=0.999,
    adam_epsilon=1e-8,
    adam_clipnorm=None,
    adam_global_clipnorm=None,
    weight_decay_rate=0.0,
    power=1.0,
    include_in_weight_decay=None,
):
    """Same signature and return value as `transformers.create_optimizer`."""
    lr_schedule = tf.keras.optimizers.schedules.PolynomialDecay(
        initial_learning_rate=init_lr,
        decay_steps=num_train_steps - num_warmup_steps,
        end_learning_rate=init_lr * min_lr_ratio,
        power=power,
    )
    if num_warmup_steps:
        lr_schedule = WarmUp(
            initial_learning_rate=init_lr,
            decay_schedule_fn=lr_schedule,
            warmup_steps=num_warmup_steps,
        )
    optimizer = AdamWeightDecay(
        learning_rate=lr_schedule,
        weight_decay_rate=weight_decay_rate,
        beta_1=adam_beta1,
        beta_2=adam_beta2,
        epsilon=adam_epsilon,
        clipnorm=adam_clipnorm,
        global_clipnorm=adam_global_clipnorm,
        exclude_from_weight_decay=["LayerNorm", "layer_norm", "bias"],
        include_in_weight_decay=include_in_weight_decay,
    )
    return optimizer, lr_schedule
