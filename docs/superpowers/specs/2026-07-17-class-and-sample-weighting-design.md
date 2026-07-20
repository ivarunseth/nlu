# Class weighting for text classification, sample weighting for NER/NLU — design

**Date:** 2026-07-17
**Status:** Approved design, pending implementation plan

## Problem

`server/models` should account for class imbalance during training: text
classification should weight the loss by class frequency, and the
sequence-labelling model types (NER, and NLU's slot head) should apply
per-position sample weights. Investigation before writing this spec found
the codebase in a more nuanced state than the request implied:

- `text_classification/base.py` already computes a balanced `class_weight`
  dict inline (via `sklearn.utils.class_weight.compute_class_weight`) and
  passes it to `model.fit`. Functionally done, but duplicated logic.
- `named_entity_recognition/base.py` already computes a `sample_weight`
  array inline and passes it to `model.fit`, but with a real bug: it never
  masks the `-100` sentinel the transformer architecture uses for special /
  continuation-subword tokens. `dict.get(-100)` returns `None`, and
  `np.array(..., dtype=object).astype(np.float32)` silently turns those
  `None`s into `NaN` (verified in a REPL) — every transformer-NER training
  run currently feeds `NaN` sample weights into `model.fit`, corrupting the
  loss on any batch touching a `-100` position (i.e. every batch).
- The RNN NER architecture pads label sequences with `0` instead of `-100`
  (`recurrent_neural_network.py`) — `0` is a real tag id (first
  alphabetically), not a dedicated padding sentinel, so padded positions are
  silently trained on (and would be weighted) as if they were real tokens of
  whatever class happens to be id 0.
- `BaseModel` (`server/models/base.py`) already has two **unused** helper
  methods, `_compute_class_weights` and `_compute_sample_weights`, built to
  replace the duplicated inline logic above. `_compute_sample_weights`
  explicitly supports both `(batch,)` and `(batch, sequence_length)` shapes
  with an `ignore_value` mask — clearly built to also cover NLU's joint
  intent (`(batch,)`) and slot (`(batch, seq_len)`) heads.
- `natural_language_understanding/base.py` (joint intent + slot model) has
  **no** class/sample weighting on either head at all, despite being the
  model type most exposed to imbalance (the `O` slot tag dominates, and
  intents can be skewed too).

Confirmed via user decision: this work covers all three model types
(including NLU), and includes fixing RNN NER's padding to be consistent
with the transformer's `-100` convention rather than leaving it for a
separate task.

## Decisions

1. **Consolidate onto the existing `BaseModel` helpers** rather than
   inventing new ones. `_compute_class_weights(labels)` → `{class_id:
   weight}` via sklearn's `"balanced"` scheme; `_compute_sample_weights
   (labels, class_weights, ignore_value=None)` → same-shaped array with
   `ignore_value` positions forced to weight `0`. Both already exist and
   are already correct; the work is wiring callers to them and deleting the
   duplicate inline implementations.
2. **Text classification keeps using Keras' native `class_weight`.** It is
   a single-output model, which Keras supports natively and simply —
   converting to a `sample_weight` array would be a pure regression in
   clarity for no benefit.
3. **NER and NLU use `sample_weight`, not `class_weight`.** Keras does not
   support `class_weight` for sequence-shaped outputs or multi-output
   models at all (raises when attempted), so per-position `sample_weight`
   arrays are the only mechanism available — this is exactly what
   `_compute_sample_weights`'s two supported shapes are for.
4. **Class weights are computed on the post-split, post-augmentation train
   set**, matching existing (pre-refactor) TC/NER behavior. Augmentation
   substitutes entity *values* within spans; it does not change the
   tag/intent distribution, so this remains the representative distribution
   for what the model actually trains on.
5. **`-100` is the one padding/ignore sentinel across NER and NLU**,
   matching the convention NLU's architectures and NER's transformer
   architecture already use. RNN NER is brought in line rather than
   special-cased.
6. **No new configuration surface.** Weighting stays hardcoded on, matching
   the existing TC/NER convention — there is no existing `class_weight=True
   /False`-style kwarg anywhere in `train()`, and none was requested.

## Changes

### `text_classification/base.py`

Replace the inline block (`np.unique` + `compute_class_weight` +
`dict(zip(...))`, lines ~72–80) with:

```python
class_weight = self._compute_class_weights(y_encoded)
```

Drop the now-unused `from sklearn.utils.class_weight import
compute_class_weight` import. Output is bit-for-bit identical to today —
pure de-duplication.

### `named_entity_recognition/base.py`

Replace the inline block (lines ~214–226) with:

```python
class_weights = self._compute_class_weights(flat_labels)
sample_weight = self._compute_sample_weights(y_aligned, class_weights, ignore_value=-100)
```

This is the fix for the `NaN`-weight bug: `-100` positions now resolve to
weight `0` instead of `NaN`. Drop the now-unused `compute_class_weight`
import.

### `server/models/masking.py` (new) — shared `NonPaddingLoss`/`NonPaddingAccuracy`

`NonPaddingLoss` and `NonPaddingAccuracy` currently exist as two
byte-identical copies: a pair in `natural_language_understanding/__init__.py`
and a lone `NonPaddingLoss` local to `named_entity_recognition/transformer.py`.
Extract a single canonical definition into a new `server/models/masking.py`
(masked sparse categorical cross-entropy / token accuracy over positions
where `y_true >= 0`) and route **both** packages through it rather than
mirroring a third copy into the NER package (user decision — the cleaner
single-source-of-truth option over the design's original "mirror the NLU
pattern" plan).

### `named_entity_recognition/__init__.py`

Re-export from the shared module: `from ..masking import NonPaddingLoss,
NonPaddingAccuracy`, placed above the `from .base` / `from
.recurrent_neural_network` / `from .transformer` submodule imports so the
intra-package form `from . import NonPaddingLoss, NonPaddingAccuracy`
those submodules already use keeps resolving.

### `natural_language_understanding/__init__.py`

Delete the two local class definitions (and the now-unused `import
tensorflow as tf`); replace with `from ..masking import NonPaddingLoss,
NonPaddingAccuracy` above the submodule imports. Its architecture modules
(`transformer.py`, `deep_neural_network.py`) already do `from . import
NonPaddingLoss, NonPaddingAccuracy` and keep working unchanged.

### `named_entity_recognition/transformer.py`

Remove the local `NonPaddingLoss` class (now in the shared module); import
`NonPaddingLoss, NonPaddingAccuracy` from the package `__init__` (which
re-exports the shared classes). Add `NonPaddingAccuracy()` to
`model.compile(...)`'s `metrics` — currently missing entirely, so this
architecture reports no accuracy metric today.

### `named_entity_recognition/recurrent_neural_network.py`

- `tokenize_and_align`: pad with `-100` instead of `0`.
- `build`: compile with `loss=NonPaddingLoss()`,
  `metrics=[NonPaddingAccuracy()]` instead of the plain
  `'sparse_categorical_crossentropy'` / `['accuracy']` (which would
  otherwise treat `-100` as a literal class index against the new padding
  value, the same failure mode `NonPaddingLoss`'s docstring already
  describes for the transformer case).

### `natural_language_understanding/base.py`

After `y_intents, y_slots = self.preprocess_y(y)` and
`X_processed, y_slots_aligned = self.tokenize_and_align(X, y_slots)`, add:

```python
intent_class_weights = self._compute_class_weights(y_intents)
intent_sample_weight = self._compute_sample_weights(y_intents, intent_class_weights)

flat_slot_labels = np.concatenate([np.asarray(seq) for seq in y_slots])
slot_class_weights = self._compute_class_weights(flat_slot_labels)
slot_sample_weight = self._compute_sample_weights(
    y_slots_aligned, slot_class_weights, ignore_value=-100
)
```

Pass `sample_weight={'intents': intent_sample_weight, 'slots':
slot_sample_weight}` to `model.fit`. Both architectures
(`transformer.py`, `deep_neural_network.py`) name their `Dense` output
layers `'intents'` / `'slots'`, so the dict-keyed form resolves correctly
regardless of the `outputs=[...]` list order in `tf.keras.Model(...)`.

## Edge cases

- **Single-class labels** (e.g. every example shares one intent, or a tiny
  dataset has only one NER tag): `compute_class_weight("balanced", ...)`
  returns weight `1.0` for the sole class — verified in a REPL, no crash,
  no special-casing needed.
- **RNN NER padding change is self-contained.** `evaluate()` and `predict()`
  never read the padded `y_aligned` array directly — `evaluate()`'s
  `y_true` comes from the original (unaligned) tag strings passed by the
  caller, and `predict()` never sees `y` at all. The only consumer of the
  new `-100` padding is the compiled loss/metric and the new
  `sample_weight` computation.
- **`StatusCallback._initial_metrics`** (`server/models/callbacks.py`) calls
  `model.evaluate(...)` on `_fit_data` without passing `sample_weight`, for
  all three model types, today. This is unaffected by this change — for
  NER/NLU, the compiled `NonPaddingLoss`/`NonPaddingAccuracy` already mask
  `-100` at the loss/metric level regardless of `sample_weight`, so the
  epoch-0 baseline stays correct without needing the callback touched.

## Testing / verification

- `python -m py_compile` across all touched files.
- A throwaway (uncommitted) smoke script building each architecture
  (text classification's architectures, NER × `{recurrent_neural_network,
  transformer}`, NLU × `{deep_neural_network, transformer}`) against a
  tiny synthetic dataset for one epoch, to catch `sample_weight`
  shape/broadcast errors that `py_compile` cannot. The transformer-backed
  architectures pull a pretrained encoder (e.g. `distilbert-base-uncased`)
  — slower, but necessary since that is exactly the code path with the
  bug being fixed.

## Rejected alternatives

- **New standalone weighting utility module** — `BaseModel` already has
  the two helpers this needs; adding a parallel module would just be more
  duplication in the other direction. (Note: this rejection is about the
  *weight-computation* helpers, not the loss/metric classes — those DO get
  a shared `masking.py`, since today they are literally duplicated across
  the NER and NLU packages.)
- **Mirror `NonPaddingLoss`/`NonPaddingAccuracy` into the NER package**
  (the design's first draft) — rejected by the user in favour of a single
  shared `server/models/masking.py`, so no third copy is introduced.
- **Converting text classification to `sample_weight` for consistency with
  NER/NLU** — Keras supports `class_weight` natively for single-output
  models; there is no bug or limitation it would fix, only churn.
- **Leaving RNN NER's `0`-padding alone** — considered, but rejected per
  user decision: it silently trains on and would incorrectly weight padded
  positions as real tokens of class `0`, undermining the sample-weighting
  work for that architecture specifically.
- **Configurable weighting (on/off kwarg)** — no existing precedent in
  `train()`'s kwargs for this kind of toggle, and not requested.

## Correction (post-implementation): token/slot weighting must be folded into the loss

The final whole-branch review found — and it was empirically confirmed in the
venv — that the design's plan of feeding a per-position `sample_weight` to the
token/slot heads is **inert**. `NonPaddingLoss` reduces to a scalar itself, and
Keras applies `sample_weight` *after* the loss's `call()` returns, so
`scalar_loss × sample_weight` re-averages to `loss × mean(weight)` — a per-batch
constant that leaves the gradient direction identical to the unweighted loss.
Proof: two sample-weights with equal total but different per-token distribution
produce a byte-identical loss.

Text-classification weighting (Keras-native `class_weight`) and NLU-**intent**
weighting (standard per-sample cross-entropy + `(batch,)` `sample_weight`) are
correct and unaffected — only the NER-tag and NLU-slot heads were inert.

**Fix (implemented as Task 7):** fold the per-class weights directly into
`NonPaddingLoss` — `NonPaddingLoss(class_weights=<1-D vector indexed by class
id>)` multiplies each real token's loss by its class weight *before* the scalar
reduction, preserving the "mean over real tokens" normalization. The token/slot
heads stop passing `sample_weight` (the NER `fit` drops it entirely; the NLU
`fit` keeps only `{'intents': intent_sample_weight}`, since the intent head's
`sample_weight` genuinely works). `NonPaddingLoss()` with no argument reproduces
the old unweighted behavior exactly, which is what load-time architecture
rebuilds use (the loss is irrelevant to inference). This supersedes the
`_compute_sample_weights(..., ignore_value=-100)` usage for the NER-tag head and
the `'slots'` entry of the NLU `sample_weight` dict.
