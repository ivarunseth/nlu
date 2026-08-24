# Training hyperparameter defaults & slider ranges

Date: 2026-07-25
Status: approved

## Problem

Two issues surfaced while tuning the first models trained through the app:

1. **Broken slider range.** `weight_decay_rate` is a *linear* slider with
   `step: 0.001`, so its only reachable values are `0, 0.001, 0.002, …`. A
   useful decay like `1e-4` cannot be set. The transformer's `l2` field has the
   same coarse-step bug. `learning_rate` already avoids this with `scale: 'log'`.
2. **Weak out-of-box defaults.** The from-scratch text models default to
   `embedding_dims = 64` / `units = 64` with no regularization
   (`weight_decay_rate = 0`) and no shared hidden layer for the NLU joint trunk.
   Empirically (voice-assistant NLU DNN), raising capacity to 128, adding one
   `relu` hidden layer, and weighting the slot head 2:1 roughly doubled slot
   accuracy; the added capacity then needed more dropout to control intent
   overfitting.

Scope chosen: apply sensible default changes across every architecture where they
generalize (Approach B, "Balanced"), and align the backend `__init__` defaults so
form-less trainings behave identically.

## Design

Pure data change — no control-flow changes. Two sources of truth are updated
together: the frontend form registry (`src/routes/model/routes/history/History.jsx`)
and each model's backend `__init__` (`self.parameters`).

### 1. Range fixes (all model types)

| field | from | to |
| --- | --- | --- |
| `weight_decay_rate` | linear, `min 0`, `max 0.1`, `step 0.001`, `default 0` | `scale:'log'`, `min 1e-6`, `max 0.1`, `default 1e-5` |
| `l2` (transformer) | linear, `min 0`, `max 0.1`, `step 0.001` | `scale:'log'`, `min 1e-6`, `max 0.1`, `default 0.01` |

Log sliders cannot represent exactly `0`; `1e-6` is the effective "off" floor, so
the "Zero disables it" note is dropped from the weight-decay help text. The
transformer's `weight_decay_rate` default stays `0.01` (its existing override).

### 2. Capacity + regularization defaults (Approach B)

| field | scope | from → to |
| --- | --- | --- |
| `embedding_dims` | DNN + RNN (all types) | 64 → 128 |
| `units` | tc-RNN, NLU-DNN | 64 → 128 |
| `lstm_dims` | NER-RNN | 100 → 128 |
| `dropout` | DNN + RNN (all types) | 0.2 → 0.3 |
| `weight_decay_rate` default | from-scratch models | 0 → 1e-5 |
| `hidden_layers` | NLU-DNN only | `[]` → `[{dense, relu, 64}]` |

`recurrent_dropout` stays 0.2. Transformers keep encoder-driven sizing,
`dropout 0.15`, `l2 0.01`.

### 3. NLU joint-loss default

| field | scope | from → to |
| --- | --- | --- |
| `slot_loss_weight` | NLU DNN + NLU transformer | 1 → 2 |

### 4. Backend alignment

`__init__` `self.parameters` dicts updated in: `text_classification/{deep_neural_network,
recurrent_neural_network}.py`, `named_entity_recognition/recurrent_neural_network.py`,
`natural_language_understanding/{deep_neural_network,transformer}.py`. Inline
`build()` `.get(key, default)` fallbacks are updated in lockstep with the
`__init__` values so the two never disagree (they are defensive — `__init__`
always populates the key — but kept in sync for readability). `tc-RNN`'s `units`
lives only as an inline default and is updated there, matching that file's
existing convention.

## Non-goals / risks

- Existing trained models are unaffected — they load from their saved
  `parameters.json`, not these defaults. Only *new* trainings pick up the change.
- Larger default models train slower and can overfit very small datasets; the
  `dropout 0.3` / `weight_decay 1e-5` bumps and default-on early stopping hedge
  this.

## Verification

- `python -m py_compile` the 5 backend files.
- `npm run build` for the frontend.
