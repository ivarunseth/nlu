# Configurable training metrics + decluttered history plot toolbar

## Problem

Every architecture compiles a hard-coded `accuracy` metric, so the per-epoch
history streamed to the History plot only ever carries loss and accuracy. On an
imbalanced intent/entity dataset accuracy is the least informative of the
available metrics — a model that never predicts a rare intent still scores well.
Users want to choose what is tracked per run: accuracy (default), F1, precision,
recall, and Matthews correlation coefficient.

Adding metrics multiplies the number of series on the plot (5 metrics × train/val
× 2 heads for NLU = 20), which makes the already-busy plot toolbar worse. The
metric selector is already a dropdown; the remaining display controls
(smoothing, points, log-Y) are still inline and need the same treatment.

## Scope

In: which metrics Keras computes per epoch, how they reach the plot, how early
stopping monitors them, and the plot toolbar layout.

Out: the final `evaluate()` report (sklearn `classification_report`, already
reports per-class precision/recall/F1 on the test split) and entity-level
(seqeval) scoring for NER.

## Backend

### New module `server/models/metrics.py`

The four new metrics all derive from a class-confusion matrix, so a single
streaming `tf.math.confusion_matrix` accumulator backs all of them rather than
four separate TP/FP/FN implementations.

```
MetricRegistry: 'accuracy' | 'f1' | 'precision' | 'recall' | 'mcc'
build_metrics(names, num_classes, masked=False) -> list[tf.keras.metrics.Metric]
normalize_metrics(value) -> tuple[str, ...]
monitor_mode(monitor) -> 'max' | 'min' | 'auto'
```

`masked=True` selects the sequence-labelling variant, which drops the `-100`
padding / sub-word positions exactly as `NonPaddingLoss` and `NonPaddingAccuracy`
already do. Masking is the only difference between the two variants — the
confusion matrix is built from the surviving positions either way.

**Accuracy is deliberately left alone.** It keeps using
`SparseCategoricalAccuracy` (flat) and `NonPaddingAccuracy` (masked). Those are
in use today, the metric name `accuracy` is already load-bearing for the plot,
the `MetricStrip` live train-accuracy readout, and the existing `monitor`
options. Re-deriving it from the confusion matrix would be numerically identical
but adds regression risk for no gain.

**Averaging.** Precision, recall and F1 are macro-averaged — the unweighted mean
of the per-class scores — which is what makes them worth tracking on a skewed
dataset, and matches the project's existing class-weighting philosophy. The mean
is taken over classes with non-zero support in the epoch rather than over all
declared classes, so a label absent from the validation slice does not silently
drag the score toward zero.

**MCC** uses the multi-class (Gorodkin R_K) generalisation, which reduces to the
standard binary MCC for two classes:

```
MCC = (N·Tr(C) − Σ p_k t_k) / sqrt((N² − Σ p_k²)(N² − Σ t_k²))
```

with `t_k` the true counts, `p_k` the predicted counts, `N` the total. The
denominator is guarded with `divide_no_nan`, which yields 0 for the degenerate
single-class case — the convention sklearn uses.

### Wiring

`BaseModel._metrics(num_classes, masked=False)` reads `parameters['metrics']`
(already populated before `build()` runs, same as `intent_loss_weight`) and
returns the built list. The seven compile sites each swap their literal for a
call:

| Site | Call |
|---|---|
| `text_classification/{deep_neural_network,recurrent_neural_network,transformer}` | `self._metrics(num_classes)` |
| `named_entity_recognition/{recurrent_neural_network,transformer}` | `self._metrics(num_classes, masked=True)` |
| `natural_language_understanding/{deep_neural_network,transformer}` | `{'intents': self._metrics(num_labels), 'slots': self._metrics(num_tags, masked=True)}` |

`normalize_metrics` drops unknown names and falls back to `('accuracy',)` when
empty. Training kwargs travel unvalidated from the request body through Celery
into `build()`, so a bad name must not surface as a crash inside `compile()`.

### Early-stopping mode (bug fix)

`EarlyStopping` infers direction from the monitor name: it only treats a metric
as "higher is better" when the name contains `acc` or starts with `fmeasure`.
`f1`, `precision`, `recall` and `mcc` all fail that test and would be minimised —
early stopping would fire precisely when the model improved. Each `train()` now
passes an explicit `mode=monitor_mode(monitor)`, which strips any `val_` prefix
and `intents_`/`slots_` head prefix before classifying.

## Frontend

### Metric selection

A new `checks` control in the existing declarative parameter registry:

```
metrics: { control: 'checks', tab: 'metrics', default: ['accuracy'], options: METRIC_OPTIONS }
```

It gets its own **Metrics** tab, placed between Schedule and Callbacks: the
selection determines what early stopping is able to monitor, so the tabs read
left to right in dependency order. The field is still *declared* immediately
before `early_stopping` in the registry, because `getTrainingStartParameters`
walks the registry in order and `monitor` must be clamped against an already
resolved `metrics` — declaration order and tab placement are independent.

`checks` extends `clampParameterValue` (filter to known names, empty falls back
to the default) and gets a `renderChecksControl` renderer alongside the existing
slider/select/switch/layers renderers.

### Monitor options follow the selection

`monitor` currently holds a static array. Registry `options` may now also be a
function of the current parameters, resolved through an `optionsFor` helper used
by both the select renderer and `clampParameterValue`. Options become
`loss`/`val_loss` plus each selected metric and its `val_` twin. This also
retires the `NLU_MONITOR_OPTIONS` special case: the NLU generator emits the
per-head `intents_*`/`slots_*` names that the joint models actually log, so the
NLU monitor is no longer restricted to loss.

Deselecting a metric that `monitor` points at leaves the select dangling, so
`updateParameter` re-validates `monitor` against the new option set and falls
back to `val_loss`.

### Plot toolbar

Smoothing, Points and Log Y move into a "Display" dropdown next to the existing
Metrics dropdown, leaving the toolbar as: Metrics ▾ | Display ▾ | reset-zoom,
CSV, PNG. Both dropdowns use `autoClose="outside"` so several toggles can be
flipped in one visit. No behaviour changes — the same state, relocated.

## Verification

No meaningful test suite exists (per CLAUDE.md), so: `python -m py_compile` over
the touched Python, `npm run build` for the frontend, and a standalone
correctness harness that checks the new Keras metrics against sklearn's
`f1_score`/`precision_score`/`recall_score`/`matthews_corrcoef` on random
multi-class data, in both flat and masked forms.
