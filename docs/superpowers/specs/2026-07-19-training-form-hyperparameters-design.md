# Training form: full hyperparameter exposure, sliders, and configurable hidden layers — design

**Date:** 2026-07-19
**Status:** Approved design, pending implementation plan

## Problem

The training configuration modal in
`src/routes/model/routes/history/History.jsx` drifted out of sync with what
the backend architectures in `server/models/` actually consume:

**Frontend under-exposes the backend:**

- Text classification's `recurrent_neural_network` architecture exists in the
  backend factory but is missing from `ARCHITECTURES_BY_MODEL` — it cannot be
  selected at all. Its parameters (`recurrent_layer` lstm/gru, `bidirectional`,
  `units`, `activation`, `recurrent_dropout`) are therefore also unexposed.
- NLU DNN's `units` (LSTM size), `intent_loss_weight`, `slot_loss_weight`, and
  `pruning` are implemented but not rendered (pruning is UI-gated to
  text classification only, yet NLU DNN's build calls `_prune_model`).
- `l2` has slider metadata but is never rendered; `activation` is consumed by
  TC RNN, TC transformer, and NLU transformer but has no control.
- NER transformer's `units` and `dropout` are hidden by stale
  `model?.kind === 'named_entity_recognition'` special-cases even though the
  backend build consumes both (plus `l2`).

**Frontend over-promises (params the backend silently ignores):**

- NER RNN compiles with a hardcoded `'adam'` optimizer, so the
  `learning_rate`, `weight_decay_rate`, and `num_warmup_steps` controls shown
  for it do nothing.
- NLU transformer ignores `intent_loss_weight`/`slot_loss_weight` (only NLU
  DNN wires `loss_weights`) and applies no `l2`.
- NLU pruning is half-implemented: the DNN build wraps the model with
  `_prune_model`, but NLU base `train` never appends `UpdatePruningStep` (fit
  would fail) nor calls `strip_pruning`.

**Default drift:** e.g. frontend `lstm_dims` default 96 vs backend 100.

**UX:** most numerics are `<input type="number">` counters; the user wants
sliders.

**New capability (user request):** a `hidden_layers` parameter letting users
stack extra Dense layers — per-layer units and activation — supported by all
three model types.

Confirmed via user decisions: backend fixes are in scope (not a
frontend-only reconciliation); `hidden_layers` is a plain list — no separate
`num_hidden_layers` parameter, the count is `hidden_layers.length`.

## Decisions

1. **Backend consistency fixes are in scope.** Every architecture honors the
   same optimizer parameters; NLU transformer honors loss weights and `l2`;
   NLU pruning gets finished. NER gains no pruning (neither NER build supports
   it today — that would be new feature work, not consistency).
2. **`hidden_layers` is the single source of truth for the hidden Dense
   stack**: a list of `{"units": int, "activation": str}` dicts, applied in
   order immediately before the output head(s). No `num_hidden_layers`.
3. **One shared backend helper** `BaseModel._apply_hidden_layers(x)` applies
   the stack. Keras `Dense` acts on the last axis, so the same helper serves
   2-D features (classification) and 3-D sequence features (NER/NLU tokens).
4. **Legacy fallback for architectures with a hardcoded hidden dense today**
   (TC transformer, NER transformer, NLU transformer, TC RNN): their builds
   use `hidden_layers` when present, defaulting to a one-element list
   replicating the current layer; when `hidden_layers` is absent from
   persisted parameters (old artifacts rebuilt at load time, restarts replaying
   old kwargs) they fall back to the legacy `units`/`activation` values. The
   UI stops rendering the legacy fields for these architectures — the stack is
   the one concept.
   - NLU DNN's `units` is its **LSTM size**, not a hidden dense — it stays a
     first-class parameter (labelled "LSTM units") and is unaffected.
5. **Declarative per-(model type, architecture) parameter registry in the
   frontend.** Base metadata per architecture composed with small per-type
   overrides; each entry carries `default/min/max/step/scale/options/tab`.
   The form renders from the registry — the `model?.kind` special-case JSX
   that caused the staleness is deleted.
6. **All bounded numerics become sliders** (existing `renderSliderControl`
   pattern: track + live monospace value label). `learning_rate` uses a
   **log-scale slider** (linear slider position mapped exponentially between
   min/max). Values carried in from a previous training's kwargs that fall
   outside a slider's range are clamped.
7. **Validation shrinks to cross-field checks only** (pruning end step >
   begin step, `0 <= initial_sparsity < final_sparsity < 1`), since sliders
   cannot go out of range.

## Backend changes

### `server/models/base.py`

New helper:

```python
def _apply_hidden_layers(self, x):
    for layer in self.parameters.get('hidden_layers', []):
        x = tf.keras.layers.Dense(layer['units'], activation=layer['activation'])(x)
    return x
```

### `server/models/named_entity_recognition/recurrent_neural_network.py`

- Parameters gain `learning_rate: 1e-3`, `weight_decay_rate: 0`,
  `num_warmup_steps: 0`.
- `build` compiles with `create_optimizer(...)` (same call shape as every
  other architecture) instead of the hardcoded `'adam'`.
- Hidden stack inserted between the post-LSTM dropout and the softmax head
  (additive; default `hidden_layers: []` keeps the graph identical to today).

### `server/models/named_entity_recognition/base.py`

- `train` computes `kwargs['num_train_steps'] = max(1,
  ceil(train_samples / batch_size) * epochs)` before `build`, mirroring TC
  base. (NER transformer's `_num_train_steps` still derives its own value
  from `X_train`; the kwarg is simply its fallback.)

### `server/models/natural_language_understanding/transformer.py`

- Parameters gain `intent_loss_weight: 1.0`, `slot_loss_weight: 1.0`,
  `l2: 0.01`, and `hidden_layers: [{'units': 768, 'activation': 'relu'}]`.
- `compile` gains `loss_weights={'intents': ..., 'slots': ...}`.
- `l2` kernel regularizer applied to the intent and slot output heads
  (mirroring where TC/NER transformers apply it).
- The hardcoded `Dense(units, activation)` trunk layer is replaced by the
  hidden stack (legacy `units`/`activation` fallback per Decision 4), applied
  to the shared sequence features so both heads benefit.

### `server/models/natural_language_understanding/base.py`

- `train` appends `tfmot.sparsity.keras.UpdatePruningStep()` when
  `pruning=True` and calls `strip_pruning` after fit, mirroring TC base.

### `server/models/natural_language_understanding/deep_neural_network.py`

- Hidden stack inserted on the shared trunk after the post-LSTM dropout,
  before the heads (additive; default `[]`).

### `server/models/text_classification/deep_neural_network.py`

- Hidden stack inserted after the post-pooling dropout, before the softmax
  head (additive; default `[]`).

### `server/models/text_classification/recurrent_neural_network.py`

- Today `units` sizes **both** the recurrent layer and the hidden
  `Dense(units, activation)`. After this change `units` stays first-class as
  the recurrent layer size only (labelled "Recurrent units" in the UI), and
  the hidden dense generalizes into the stack, default
  `[{'units': 64, 'activation': 'relu'}]`, legacy fallback per Decision 4.

### `server/models/text_classification/transformer.py`

- The hardcoded `Dense(units, activation)` becomes the hidden stack, default
  `[{'units': 768, 'activation': 'relu'}]`, legacy fallback per Decision 4.

### `server/models/named_entity_recognition/transformer.py`

- The hardcoded `Dense(units, activation='tanh')` becomes the hidden stack,
  default `[{'units': 768, 'activation': 'tanh'}]`, legacy fallback per
  Decision 4. Dropout placement unchanged (after the stack, before the head).

## Frontend changes — `src/routes/model/routes/history/History.jsx`

### Parameter registry

`ARCHITECTURE_DEFAULTS` (keyed by architecture only) is replaced by a
composed registry keyed by `(model type, architecture)`:

- `COMMON_PARAMETERS`: `test_split`, `validation_split`, `epochs`,
  `batch_size`, `early_stopping`, `monitor`, `patience`, `save_format` —
  honored by all base `train()` implementations.
- `ARCHITECTURE_PARAMETERS[arch]`: the architecture's own fields with slider
  metadata.
- `TYPE_OVERRIDES[modelType][arch]`: small patches — e.g. NER RNN's
  `lstm_dims` (default 100), NLU's `intent_loss_weight`/`slot_loss_weight`
  (both architectures), NLU DNN's `units` ("LSTM units"), pruning present for
  TC (all archs) + NLU DNN only, no `max_tokens`/`embedding_dims` for
  transformers, TC RNN's `recurrent_layer`/`bidirectional`/
  `recurrent_dropout`/`units` ("Recurrent units").

Each field entry: `{ default, min, max, step, scale?: 'log', options?: [...],
control: 'slider' | 'select' | 'switch' | 'layers', tab, label, help }`. The
modal's tabs render whatever the resolved registry contains for the selected
architecture — no `model?.kind` conditionals in JSX.

`ARCHITECTURES_BY_MODEL.text_classification` gains
`recurrent_neural_network`.

### Controls

- `renderSliderControl` becomes the only numeric control; it gains log-scale
  support (`scale: 'log'`: slider tracks `log10(value)` internally, label
  shows the real value, e.g. `2e-5`) and clamps incoming out-of-range values.
- `renderNumberControl` is deleted along with the per-field range validation
  and the `PARAMETER_TABS` jump-to-invalid machinery for range errors;
  cross-field pruning checks remain.
- New `HiddenLayersControl` (rendered where the registry says
  `control: 'layers'`): a list of rows, one per layer — units slider
  (16–1024, step 16) + activation select (`relu`, `tanh`, `gelu`, `elu`) + a
  remove button — and an "add layer" button (max 6 layers). New rows default
  to `{units: 64, activation: 'relu'}`. An empty list is valid (no hidden
  layers). Value stored directly as the `hidden_layers` array.
- New select: `recurrent_layer` (LSTM/GRU) for TC RNN. There is no standalone
  `activation` control — after the backend change, activation is only
  meaningful per-layer inside the stack.
- Loss-weight sliders (`intent_loss_weight`, `slot_loss_weight`): 0–5,
  step 0.1.
- `l2` slider: 0–0.1, step 0.001.

### Summary + migration

- The start-confirmation summary formats `hidden_layers` compactly
  (`128·relu → 64·relu`, or `none`).
- `getTrainingStartParameters` continues to merge a previous training's
  kwargs over the resolved defaults; unknown/legacy keys (`units`,
  `activation` from transformer runs, `max_seq_len`) are dropped or mapped,
  and a legacy `units`/`activation` pair on a transformer/TC-RNN run maps to
  `hidden_layers: [{units, activation}]` so restarted configurations carry
  forward faithfully.

## Edge cases

- **Old artifacts / old kwargs**: builds fall back to legacy
  `units`/`activation` when `hidden_layers` is absent (Decision 4), so
  load-time rebuilds and API-level restarts with stored kwargs keep working.
- **Empty `hidden_layers`** on architectures whose default is one layer:
  legal — the trunk connects straight to the head(s).
- **Slider clamping**: a previous run's out-of-range value (e.g. epochs 2000)
  renders clamped to the slider max; the summary shows the clamped value that
  will actually be sent.
- **Activation names** are limited to Keras-known strings offered by the
  select; the backend passes them through to `Dense(activation=...)`.

## Testing / verification

- `python -m py_compile` across all touched backend files (venv python,
  `PYTHONPATH=.`).
- `npm run build` for the frontend (no meaningful JS test suite exists).
- A throwaway smoke script training each of the seven (type, architecture)
  combinations for one epoch on a tiny synthetic dataset, with a non-default
  `hidden_layers` stack, verifying: the graph contains the expected Dense
  layers, NER RNN's optimizer honors `learning_rate`, NLU transformer's
  compiled `loss_weights`, and NLU DNN pruning completes (callback + strip).
- Per user preference: no browser preview; the user tests the UI themselves.

## Rejected alternatives

- **Frontend-only reconciliation** (hide what the backend ignores) — rejected
  by user in favour of fixing the backend inconsistencies.
- **`num_hidden_layers` count parameter** — rejected by user; the list length
  is the count.
- **Hybrid slider + number inputs** — more chrome for little gain; pure
  sliders with a live value label match the existing pattern.
- **Adding pruning to NER** — neither NER build supports pruning today;
  wiring it is new feature work, out of scope.
- **Renaming NLU DNN's `units` to `lstm_dims`** for cross-type naming
  consistency — parameter renames ripple through persisted artifacts and
  stored kwargs; labelling it "LSTM units" in the UI achieves the clarity
  without the migration.
