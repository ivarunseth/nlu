# Score thresholds from ROC and precision–recall curves

Date: 2026-07-26
Status: approved

## Problem

Every head already emits a score. The ranked classification head returns
`{name, score}` per label; annotations return `{slot|entity, value, start, end,
score}` where the score is the mean of the per-word probabilities in the merged
run. Nothing anywhere reads them.

`predict()` returns the argmax label and every merged annotation regardless of
score — there is no `threshold` in `server/` at all. The only threshold-shaped
thing in the product is a client-side slider in Analyse → Traffic that reads a
histogram ("N of M below 0.5") and changes nothing.

That leaves no way to trade recall for precision at serve time. On voice
assistant v0.6 the slot head scored precision 0.29 against recall 0.87: it finds
almost everything and is wrong most of the time it fires. The scores needed to
suppress the bad predictions are computed and discarded.

## Choice of curve

ROC for the label head, precision–recall for annotations. They are not
interchangeable here.

For the **label head** the binary question is "was the top-1 prediction
correct?". Both ROC denominators are real populations — correct predictions and
incorrect ones — so TPR, FPR and AUC all mean what they normally mean.

For **annotations** there are no true negatives. Raising the threshold only ever
removes predicted annotations; the model never emits a scored candidate for an
annotation it correctly declined to predict. Forcing a ROC by labelling unmatched
predictions as the negative class makes FPR's denominator "however many spurious
annotations this model happened to emit", so the AUC drifts with over-tagging rate
rather than ranking quality — and over-tagging is exactly the pathology being
measured. Precision–recall has no such dependence: **average precision** is the
summary number and max F1 is the operating point.

## Canonical vocabulary

Extends the table in `2026-07-26-annotation-metrics-and-entity-slots-design.md`
by one row.

| concept | canonical term |
| --- | --- |
| the ranked output of a classification head | **label** (text classification `labels`, language understanding `intents`) |

`label_threshold` gates that head; `annotation_threshold` gates annotations.
Named entity recognition's internal `self.labels` holds tags rather than
classification labels, but it has no classification head, so `label_threshold`
never applies there and the two meanings never meet in one place.

## Design

### 1. Computing — new `server/models/thresholds.py`

A module beside `crf.py` and `metrics.py`: pure functions, no model dependency,
testable standalone. sklearn is already a dependency.

- **`label_curve(correct, scores)`** — binarizes `correct[i] = (predicted[i] ==
  true[i])` and sweeps the top-1 score. Returns
  `{auc, threshold, operating, curve}`, the operating point at **Youden's J**
  (max TPR − FPR).
- **`annotation_curve(gold, predicted)`** — `gold` is a set of
  `(start, end, name)` per input, `predicted` a list of
  `(start, end, name, score)`. At each `t`: keep predictions scoring ≥ `t`, then
  `TP = |kept ∩ gold|`, `FP = |kept| − TP`, `FN = |gold| − TP`. Returns
  `{average_precision, threshold, operating, curve}`, the operating point at
  **max F1**, ties broken toward the higher threshold.

`operating` carries the chosen point's own coordinates, not just its threshold,
because the chart marks that position. The threshold is a six-decimal value off
the raw scores while the curve is a two-decimal grid, so a consumer trying to
find the point back on the grid by matching thresholds would essentially never
hit one.

The sweep is a single ranked walk over the predictions rather than a re-scoring
of every input at every candidate cutoff. The naive form is
O(predictions × inputs): measured at 9 seconds for 4 000 inputs and rising 4×
per doubling, on the *augmented* train split, which would have added minutes to
every training run with no progress to show for it.

Curves report on a fixed **101-point grid** (0.00 → 1.00 step 0.01): the payload
is bounded regardless of dataset size, comparable across versions, and directly
plottable and exportable. AUC and average precision are computed from the raw
scores rather than off the grid, so the summary number carries no grid error.

**The operating point is chosen off the raw scores, not the grid.** The grid is
a display resolution, and using it to pick the cutoff fails on exactly the
distribution this product produces most often: a confident classifier whose
softmax scores all sit inside one grid step. Measured on saturated scores
(0.9986–0.9995) the grid yields AUC 1.0 — a perfect ranking — alongside a
recommended threshold of 1.0 at which the true-positive rate is 0, so applying
the recommendation would reject every prediction. Sweeping the distinct observed
scores instead always yields an achievable cutoff, and has the second benefit
that tied scores are admitted as a unit: no threshold can separate predictions
that share a score, so scoring them individually would make the result depend on
their arbitrary order. Average precision groups ties for the same reason —
ungrouped, the same predictions in a different order scored 0.5 or 0.25.

A threshold chosen this way needs more than two decimals, so it is stored to six
(rounded **down**, so it never excludes the score it was derived from) and the
Publish field accepts any value rather than stepping by 0.01.

**Degenerate inputs return `None`, never a fabricated number.** ROC is undefined
when every prediction is correct or every one is wrong; precision–recall is
undefined with no gold annotations. Small datasets hit both routinely.

Per-class curves run the same functions over each label's and each slot's subset,
stored as `labels: {name: {auc|average_precision, threshold, support}}` — the
summary triple only, no per-class curve points. Reported for diagnosis; only the
two global scalars are enforced. Per-class *enforcement* was considered and
rejected: on this dataset most classes would fit their cutoff on single-digit
support, which is noise rather than signal.

Both `evaluate()` methods already compute the required scores and discard them —
named entity recognition takes `result['tags']` and drops `result['entities']`;
language understanding does `tags, _ = self._word_tags(...)` and reads
`_rank_intents(...)[0]['name']`. No extra forward pass is needed.

### 2. Storing

A `thresholds` block on each split, beside the existing metrics:

```
evaluation.<split>.thresholds = {
  'label':      { auc, threshold, operating, curve, labels },
  'annotation': { average_precision, threshold, operating, curve, labels }
}
```

`label` covers language understanding intents and text classification labels;
`annotation` covers language understanding slots and named entity recognition
entities. A model type without a given head omits that key.

The recommendation is **fitted on the test split**. Train curves are computed and
shown too, but train scores are inflated by memorization, so a threshold fitted
there sits too high. Fitting on test is mildly optimistic — the same rows produce
the reported metrics — but a single scalar is low-variance, so this is disclosed
in the UI rather than answered with a fourth split.

### 3. Applying

The thresholds ride the rails `top` already uses.

- `Instance.default_options` gains `label_threshold: 0.0` and
  `annotation_threshold: 0.0`. **0.0 means off**, so every existing deployment is
  unchanged. `Instance.clean` validates `0.0 ≤ x ≤ 1.0`; both join
  `Instance.options()` and `Route`.
- The infer view reads them off the route with a query-arg override, exactly as
  it does for `top`, and pushes them on the input envelope so the serving loop
  collects them per-input into lists.
- **They must join the cache key.** `server/views/triton/inference.py` hashes
  `f'{top}:{query}'`; without the thresholds a response cached at one threshold
  is served at another. Because they are in the key, a config change yields new
  keys on its own and stale entries expire on `output_ttl` — no purge path is
  needed.
- The gate is applied inside `predict()`, where `top` is applied, so the Test
  page and any direct `model.predict` call are covered, not just the serving
  loop.

Behavior below the cutoff:

- **Annotations** scoring below `annotation_threshold` are dropped from
  `entities`, and their tags are reset to `O` so `tags` and `entities` stay
  consistent.
- **The label head**: if the top-ranked entry scores below `label_threshold` its
  `name` becomes `None`. Lower-ranked entries are returned unchanged as
  alternatives.
- **Language understanding ordering**: slot → entity resolution keys off
  `intents[0]['name']`, so entities are resolved **before** the name is nulled.
  The two heads are thresholded independently, and a slot that cleared its own
  bar should not lose its entity name because the other head was uncertain.

### 4. Cleanup, in scope

`_merge_entities` in `server/models/named_entity_recognition/base.py` is a
line-for-line duplicate of `tags_to_spans` plus score averaging — same `\S+`
tokenizer, identical merge rule, verified identical. Language understanding's
`_reconstruct_entities` already delegates to the shared builder. Since the sweep
must score exactly the annotations serving emits, named entity recognition folds
onto the shared builder too. No behavior change; it removes the second definition
of "what an annotation is" before anything starts scoring against it.

### 5. History — a Thresholds tab

An eighth inspector pane after `matrix`, following the Reports/Matrix pattern:

- The same toolbar — **Train | Test**, and **Intent | Slots** where both heads
  exist, reusing `hasSlotMetrics`.
- A recharts line chart: ROC with the chance diagonal for the label head,
  precision–recall for the annotation head. The operating point is marked and the
  header carries AUC or average precision plus the recommended threshold.
- A per-class table below — name, AUC or average precision, that class's own best
  threshold, support — sorted by support. This is where a class that disagrees
  badly with the global cutoff becomes visible.
- `DownloadButton` exports the curve on screen; `trainingDownloads.js` gains
  `curveCsv`. The existing `mountOnEnter` keeps recharts unmounted until the tab
  is selected.
- A one-line note that the threshold was fitted on the test split.

Versions trained before this change carry no `thresholds` block and render the
existing empty state. Stored evaluations are never rewritten.

### 6. Publish — two fields and the recommendation

`Publish.jsx` already holds the deployment config form and builds the curl
example.

- Two numeric fields bounded `0.0`–`1.0`, with `0.0` labelled as off. They accept
  any value rather than stepping by `0.01`: the operating point is chosen off the
  raw scores, so a useful cutoff can be `0.9988`.
- Each control is shown only for a model type that has that head — a classifier
  discards `annotation_threshold` and a named entity recognition model discards
  `label_threshold`, so offering the inert one invites an operator to set a value
  that silently does nothing. Both fields stay in the submitted config at their
  `0.0` default either way; this hides the control, not the field.
- Beside each, the recommended value from the version being published, with a
  "use recommended" action. **Never applied silently**: enforcement is a
  deliberate act, and the recommendation is per-version, so it would otherwise
  shift underneath the user on republish.
- The curl snippet gains the query params when either is non-zero.

### 7. Analyse — Traffic

The confidence histogram's slider seeds from the deployed threshold and the chart
draws a reference line at it, so the low-confidence readout ("N of M below X")
reads against what is actually enforced rather than an arbitrary starting value.
The x axis is categorical — one tick per 0.1-wide bin — so the line marks the bin
the cutoff falls inside rather than claiming a precision the axis cannot show;
the readout carries the exact value.

Only the label head seeds the slider. `gate_labels` keeps a rejected label's
score and clears only its name, so those predictions still reach telemetry and
the count is real. Annotations below their cutoff are dropped inside `predict()`
and never reach telemetry at all, so that histogram holds only survivors —
seeding from that cutoff would report "0 below it", which reads as "the gate is
dropping nothing", the opposite of the truth. For that head the readout says so
explicitly instead.

## Verification

The load-bearing check is that **the precision–recall sweep at `t = 0`
reproduces `_annotation_metrics` exactly**. If it does not, the curve and the
metrics table disagree about what an annotation is, and every number downstream
is suspect.

Beyond that:

- `label_curve` against separable data (AUC 1.0) and shuffled scores (≈0.5).
- Degenerate inputs — all-correct, all-wrong, no gold annotations — return `None`
  rather than raising.
- A model trained, evaluated, saved, reloaded and served with a non-zero
  threshold drops exactly what the curve predicts.
- Two infer requests differing only in threshold do not collide in cache.
- `python -m py_compile` on touched backend files; `npm run build`.

There is no meaningful test suite in this repo, so these run as scripts.

## Risks

Enforcing a threshold trades recall for precision by construction. On v0.6's slot
numbers — precision 0.29, recall 0.87 — a max-F1 cutoff will drop a substantial
share of annotations. That is the intent, but the headline recall will fall and
the change must be judged on F1, not recall.

Small datasets will produce null curves often, so the empty state must read as
"not enough held-out data" rather than as a failure.

The recommendation is fitted on the same split that reports the metrics, which is
mildly optimistic. Disclosed in the UI; not otherwise mitigated.
