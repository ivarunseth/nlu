# Score Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive a confidence threshold for each head from a ROC curve (labels) and a precision–recall curve (annotations), report both in History, and enforce them at serve time as deployment options.

**Architecture:** A new pure-Python module `server/models/thresholds.py` owns the curve maths and the two gate functions. `evaluate()` on each model type stores a `thresholds` block per split; `predict()` on each model type applies the gates. The thresholds travel to the serving worker exactly as `top` does — deployment option → `Route` → infer view → input envelope → `predict` kwargs — and they join the cache key. The frontend reads the stored block through one normaliser and renders a Thresholds tab, two Publish fields, and a reference line on the Traffic histogram.

**Tech Stack:** Python 3.11 (`./venv/bin/python`), TensorFlow/Keras, scikit-learn (already a dependency), NumPy, Flask, React 19 + Vite, React-Bootstrap, recharts.

## Global Constraints

- **No commits.** Do not run `git commit` or `git add` at any point. The repository owner commits their own work. This overrides the writing-plans skill's default commit steps.
- **No test suite.** Per `CLAUDE.md`: the Jest config exists but there are no meaningful tests. Verify Python with `./venv/bin/python -m py_compile` and the frontend with `npm run build`. Behavioural checks in this plan are standalone scripts, matching how the CRF work was verified.
- **Python is `./venv/bin/python`** (3.11.14). Plain `python` is not on PATH.
- **Scratch directory** for verification scripts — referred to below as `$SCRATCH`:
  `/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/45d239bc-64c4-4a52-9d00-4db3f8e9ce78/scratchpad`
  Export it once per shell: `export SCRATCH=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/45d239bc-64c4-4a52-9d00-4db3f8e9ce78/scratchpad`
- **Scripts need `PYTHONPATH=.`** and must run from the repo root.
- **Canonical vocabulary** (from `2026-07-26-annotation-metrics-and-entity-slots-design.md`, extended by this spec). Use these exact words in code, JSON keys and UI copy:
  - **entity** — the reusable named-entity-recognition type
  - **slot** — the intent-scoped language-understanding role
  - **annotation** — a labelled region of text
  - **tag** — a per-token IOB label, this meaning only
  - **label** — the ranked output of a classification head (text classification `labels`, language understanding `intents`)
  - Never write "span" in anything this plan touches.
- **Config field names are exactly** `label_threshold` and `annotation_threshold`.
- **`0.0` means off.** Both thresholds default to `0.0`, and a `0.0` threshold must be a no-op so existing deployments are unchanged.
- **Never fabricate a metric.** Degenerate inputs return `None`, not `0.0` and not a guess.

## File Structure

| File | Responsibility |
| --- | --- |
| `server/models/thresholds.py` (new) | Curve maths and the two gate functions. Pure; no TensorFlow, no model imports. |
| `server/models/base.py` | Gains `_scored_annotations` — the single definition of "an annotation with a score". |
| `server/models/named_entity_recognition/base.py` | `_merge_entities` delegates; `predict` gates; `evaluate` stores thresholds. |
| `server/models/natural_language_understanding/base.py` | `_reconstruct_entities` delegates; `predict` gates both heads; `evaluate` stores thresholds. |
| `server/models/text_classification/base.py` | `predict` gates the label head; `evaluate` stores the label threshold. |
| `server/database/instance.py` | Two new deployment options, validated. |
| `server/utils/registry.py` | Two new `Route` fields. |
| `server/views/triton/inference.py` | Reads the thresholds, puts them in the cache key and the input envelope. |
| `src/shared/utils/training.js` | `getThresholds` — the one place the stored shape is read. |
| `src/shared/utils/trainingDownloads.js` | `curveCsv`. |
| `src/routes/model/routes/history/ThresholdsPanel.jsx` (new) | The Thresholds tab's chart and per-class table. A sibling module, matching how `diffLines.js` sits beside `History.jsx`; `History.jsx` is already ~2950 lines and must not absorb this. |
| `src/routes/model/routes/history/History.jsx` | Exports the three shared pieces the panel needs, and mounts the tab. |
| `src/routes/model/routes/publish/Publish.jsx` | Two config fields, the recommendation, the curl snippet. |
| `src/routes/model/routes/analyse/components/Traffic.jsx` | Seeds the slider from the deployed threshold and draws it. |

---

### Task 1: The threshold module

**Files:**
- Create: `server/models/thresholds.py`
- Verify: `$SCRATCH/check_thresholds.py`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `THRESHOLD_GRID: list[float]` — 101 values, `0.0` to `1.0` step `0.01`.
  - `label_curve(correct: Sequence[bool], scores: Sequence[float]) -> dict | None` — `{'auc': float, 'threshold': float, 'curve': [{'threshold','tpr','fpr'}]}`.
  - `annotation_curve(gold: Sequence[Iterable[tuple]], predicted: Sequence[Iterable[tuple]]) -> dict | None` — `{'average_precision': float, 'threshold': float, 'curve': [{'threshold','precision','recall','f1'}]}`. `gold` items are `(start, end, name)`; `predicted` items are `(start, end, name, score)`.
  - `label_curves_by_name(names, correct, scores) -> dict[str, dict]` — `{name: {'auc', 'threshold', 'support'}}`.
  - `annotation_curves_by_name(gold, predicted) -> dict[str, dict]` — `{name: {'average_precision', 'threshold', 'support'}}`.
  - `with_labels(curve: dict | None, labels: dict) -> dict | None`.
  - `gate_labels(ranked: list[dict], threshold: float) -> list[dict]`.
  - `gate_annotations(annotations: list[dict], tags: list[str], threshold: float, tokens: list[tuple]) -> tuple[list[dict], list[str]]`. `tokens` is `utils.dataset.tokenize` output, `(text, start, end)`.

- [ ] **Step 1: Create the module**

Create `server/models/thresholds.py`:

```python
"""
Operating points for the confidence scores every head already emits.

Two curves, because the two heads support different ones. The label head
answers a real binary question — "was the top-1 prediction correct?" — so both
ROC denominators are genuine populations and the AUC means what it usually
means. Annotations have no true negatives: raising the threshold only ever
removes predicted annotations, and the model never emits a scored candidate for
an annotation it correctly declined to predict. A ROC built by calling
unmatched predictions "negative" would put the model's own over-tagging rate in
the false-positive denominator, which is the very pathology being measured — so
annotations get a precision-recall curve and average precision instead.

Curves report on a fixed grid, so the stored payload is bounded whatever the
dataset size and comparable across versions. The summary numbers (AUC, average
precision) are computed from the raw scores rather than off the grid, so they
carry no grid error.
"""

import math

import numpy as np

# 0.00 to 1.00 inclusive, step 0.01. Rounded because a float range accumulates
# error that would show up in stored JSON and in the axis labels.
#
# This is a *display* resolution only. The operating point is chosen off the
# raw scores (see ``_operating_point``), because a confident classifier's
# scores can all land inside one grid step — where every grid threshold either
# accepts everything or nothing, and the "best" of them captures no recall.
THRESHOLD_GRID = [round(step / 100, 2) for step in range(101)]


def _candidates(scores):
    """
    The thresholds actually achievable on this data: the distinct scores,
    highest first.

    Sweeping these rather than the grid guarantees the chosen cutoff admits at
    least one prediction, and admits tied predictions as a unit — no threshold
    can separate two predictions sharing a score, so treating them separately
    would make the answer depend on their arbitrary order.
    """
    return sorted({float(score) for score in scores}, reverse=True)


def _operating_point(points, metric):
    """
    The best of ``points`` by ``metric``, ties broken toward the higher
    threshold — the stricter cutoff, which is the safer default when two are
    equally good.

    Returns the whole point rather than just its threshold, because the chart
    marks this position. The threshold comes off the raw scores and is floored
    to six decimals, while the stored curve is sampled on a two-decimal grid,
    so anything trying to find this point back on the grid by matching
    thresholds would almost never hit one.

    Flooring rather than rounding means the stored value can never exclude the
    very score it was derived from.
    """
    best = max(points, key=lambda point: (metric(point), point['threshold']))
    return {**best, 'threshold': math.floor(best['threshold'] * 1e6) / 1e6}


def label_curve(correct, scores):
    """
    ROC over the "is the top-1 prediction correct?" binarization.

    ``correct[i]`` is whether input *i*'s top-ranked label was right, and
    ``scores[i]`` that label's score. The operating point is Youden's J
    (max TPR - FPR), ties broken toward the higher threshold.

    Returns ``None`` when every prediction is correct or every one is wrong:
    ROC needs both classes to have a denominator, and a small dataset hits
    this routinely. A caller must render an empty state, never a zero.
    """
    from sklearn.metrics import roc_auc_score

    correct = np.asarray(correct, dtype=bool)
    scores = np.asarray(scores, dtype='float64')
    if correct.size == 0 or bool(correct.all()) or not bool(correct.any()):
        return None

    positives = int(correct.sum())
    negatives = int(correct.size) - positives

    def point(threshold):
        accepted = scores >= threshold
        return {
            'threshold': threshold,
            'tpr': round(float((accepted & correct).sum()) / positives, 6),
            'fpr': round(float((accepted & ~correct).sum()) / negatives, 6),
        }

    operating = _operating_point(
        [point(threshold) for threshold in _candidates(scores)],
        lambda item: item['tpr'] - item['fpr'],
    )
    return {
        'auc': float(roc_auc_score(correct, scores)),
        'threshold': operating['threshold'],
        'operating': operating,
        'curve': [point(threshold) for threshold in THRESHOLD_GRID],
    }


def _annotation_sweep(gold, predicted, total_gold):
    """
    One ranked pass over the predictions, yielding both the average precision
    and the max-F1 operating point.

    Re-scoring every input at every distinct observed score is
    O(predictions x inputs), which on a mid-size augmented train split costs
    minutes per evaluation. The ranking carries the same information: admitting
    predictions highest-score-first accumulates exactly the tallies each
    candidate cutoff would have produced, so one sorted walk replaces the
    nested sweep.

    Recall's denominator stays the full gold count, so annotations the model
    never predicted are missed at every cutoff — that is what makes the area
    comparable between models emitting different numbers of candidates.
    """
    ranked = sorted(
        (
            (score, (start, end, name) in truth)
            for truth, candidates in zip(gold, predicted)
            for start, end, name, score in candidates
        ),
        key=lambda item: -item[0],
    )

    matched = kept = 0
    previous_recall = 0.0
    area = 0.0
    best = None
    index = 0
    while index < len(ranked):
        score = ranked[index][0]
        # Tied predictions are admitted as one group. No cutoff can separate
        # them, so admitting them one at a time would make both the area and
        # the operating point depend on their arbitrary order — the same
        # predictions reordered scored 0.5 or 0.25 before this was grouped.
        while index < len(ranked) and ranked[index][0] == score:
            kept += 1
            matched += int(ranked[index][1])
            index += 1

        precision = matched / kept
        recall = matched / total_gold
        area += (recall - previous_recall) * precision
        previous_recall = recall

        total = precision + recall
        f1 = round(2 * precision * recall / total, 6) if total else 0.0
        # The walk visits scores in descending order, so requiring a strict
        # improvement leaves the highest cutoff holding any tie — the stricter
        # of two equally good choices.
        if best is None or f1 > best['f1']:
            best = {
                'threshold': score,
                'precision': round(precision, 6),
                'recall': round(recall, 6),
                'f1': f1,
            }

    return float(area), best


def _annotation_scores(gold, predicted):
    """
    Average precision and the operating point, without the display curve.

    The per-name breakdown wants only these, and building a 101-point curve per
    name would be most of the work for a chart nothing renders.
    """
    total_gold = sum(len(item) for item in gold)
    if not total_gold:
        return None

    area, best = _annotation_sweep(gold, predicted, total_gold)
    operating = None if best is None else {
        **best, 'threshold': math.floor(best['threshold'] * 1e6) / 1e6
    }
    return {
        'average_precision': area,
        # A model that predicted nothing has no achievable cutoff; 0 is the
        # honest answer there, and it is also a no-op, which is correct.
        'threshold': operating['threshold'] if operating else 0.0,
        'operating': operating,
    }


def annotation_curve(gold, predicted):
    """
    Precision-recall over exact annotation matches.

    ``gold`` is one iterable of ``(start, end, name)`` per input; ``predicted``
    one iterable of ``(start, end, name, score)``. At each threshold the
    predictions scoring at least that much are kept and matched against that
    input's gold set — an annotation counts only when its name and both
    boundaries match. The operating point is max F1, ties broken toward the
    higher threshold (prefer the stricter cutoff).

    Returns ``None`` when there are no gold annotations at all, which leaves
    recall undefined.
    """
    gold = [set(item) for item in gold]
    predicted = [list(item) for item in predicted]

    scores = _annotation_scores(gold, predicted)
    if scores is None:
        return None

    total_gold = sum(len(item) for item in gold)

    def point(threshold):
        matched = kept = 0
        for truth, candidates in zip(gold, predicted):
            surviving = {
                (start, end, name)
                for start, end, name, score in candidates
                if score >= threshold
            }
            kept += len(surviving)
            matched += len(surviving & truth)
        precision = matched / kept if kept else 0.0
        recall = matched / total_gold
        total = precision + recall
        return {
            'threshold': threshold,
            'precision': round(precision, 6),
            'recall': round(recall, 6),
            'f1': round(2 * precision * recall / total, 6) if total else 0.0,
        }

    return {**scores, 'curve': [point(threshold) for threshold in THRESHOLD_GRID]}


def label_curves_by_name(names, correct, scores):
    """
    Per-label operating points, for diagnosis rather than enforcement.

    Each label's curve is fitted over only the inputs the model assigned to it,
    answering "when this model says ``greet``, how well does the score separate
    right from wrong?". Only the summary triple is kept: storing 101 curve
    points per label would multiply the payload by the size of the label set
    for a chart nothing renders.

    A label whose subset is degenerate — all correct or all wrong, which is the
    common case for a rare label — is omitted rather than scored.
    """
    buckets = {}
    for name, is_correct, score in zip(names, correct, scores):
        bucket = buckets.setdefault(name, {'correct': [], 'scores': []})
        bucket['correct'].append(is_correct)
        bucket['scores'].append(score)

    curves = {}
    for name, bucket in sorted(buckets.items()):
        curve = label_curve(bucket['correct'], bucket['scores'])
        if curve:
            curves[name] = {
                'auc': curve['auc'],
                'threshold': curve['threshold'],
                'support': len(bucket['correct']),
            }
    return curves


def annotation_curves_by_name(gold, predicted):
    """
    Per-name annotation operating points, for diagnosis rather than
    enforcement.

    Each name is scored over its own annotations only, so a slot whose best
    cutoff sits far from the global one is visible. A name that appears only in
    predictions and never in the gold data has no recall denominator, so
    ``annotation_curve`` declines it and it is omitted.
    """
    names = sorted(
        {name for truth in gold for _, _, name in truth}
        | {name for candidates in predicted for _, _, name, _ in candidates}
    )

    curves = {}
    for name in names:
        subset_gold = [{item for item in truth if item[2] == name} for truth in gold]
        subset_predicted = [
            [item for item in candidates if item[2] == name] for candidates in predicted
        ]
        curve = annotation_curve(subset_gold, subset_predicted)
        if curve:
            curves[name] = {
                'average_precision': curve['average_precision'],
                'threshold': curve['threshold'],
                'support': sum(len(truth) for truth in subset_gold),
            }
    return curves


def with_labels(curve, labels):
    """
    Attaches per-name summaries to a curve, passing a declined curve through.

    A head with no overall curve has nothing to hang the per-name breakdown
    off, so ``None`` stays ``None`` rather than becoming a dict with only a
    ``labels`` key that every reader would then have to special-case.
    """
    return None if curve is None else {**curve, 'labels': labels}


def gate_labels(ranked, threshold):
    """
    Rejects the top-ranked label when it scores below ``threshold``.

    The entry keeps its place and its score — a caller still wants to see how
    close the model came, and the score feeds the confidence telemetry — but
    its ``name`` is cleared to signal that nothing was confidently predicted.
    Lower-ranked entries are alternatives rather than the answer, so they are
    returned untouched.
    """
    if not threshold or not ranked or ranked[0]['score'] >= threshold:
        return ranked
    return [{**ranked[0], 'name': None}, *ranked[1:]]


def gate_annotations(annotations, tags, threshold, tokens):
    """
    Drops annotations scoring below ``threshold`` and clears the tags they
    covered back to ``O``.

    Both halves matter: a caller reads the annotation's ``value`` as the
    extracted text, so a low-confidence annotation is an actively wrong value
    rather than a merely uncertain one — and leaving its tags behind would let
    ``tags`` and the annotation list disagree about what the model returned.
    """
    if not threshold:
        return annotations, tags

    kept, tags = [], list(tags)
    for annotation in annotations:
        if annotation['score'] >= threshold:
            kept.append(annotation)
            continue
        for index, (_, token_start, token_end) in enumerate(tokens):
            if index < len(tags) and token_start < annotation['end'] and token_end > annotation['start']:
                tags[index] = 'O'
    return kept, tags
```

- [ ] **Step 2: Compile it**

```bash
./venv/bin/python -m py_compile server/models/thresholds.py
```

Expected: no output, exit 0.

- [ ] **Step 3: Write the verification script**

Create `$SCRATCH/check_thresholds.py`:

```python
"""Checks the threshold curve maths against cases with known answers."""

import sys

from server.models.thresholds import (
    THRESHOLD_GRID, annotation_curve, annotation_curves_by_name, gate_annotations,
    gate_labels, label_curve, label_curves_by_name, with_labels,
)

failures = []


def check(name, actual, expected):
    if actual != expected:
        failures.append('%s: expected %s, got %s' % (name, expected, actual))


# Curve values are deliberately rounded to 6 decimals so the stored payload
# stays small, so the tolerance has to admit that rounding — an exact
# comparison against a value like 2/3 could never pass.
def close(name, actual, expected, tolerance=1e-6):
    if actual is None or abs(actual - expected) > tolerance:
        failures.append('%s: expected %s, got %s' % (name, expected, actual))


check('grid size', len(THRESHOLD_GRID), 101)
check('grid ends', (THRESHOLD_GRID[0], THRESHOLD_GRID[-1]), (0.0, 1.0))

# Perfectly separable: every correct prediction outscores every wrong one.
separable = label_curve([True, True, False, False], [0.9, 0.8, 0.2, 0.1])
close('separable auc', separable['auc'], 1.0)

# Perfectly inverted ranking is the mirror image.
inverted = label_curve([True, True, False, False], [0.1, 0.2, 0.8, 0.9])
close('inverted auc', inverted['auc'], 0.0)

# Interleaved: one wrong prediction outranks one correct one.
interleaved = label_curve([True, False, True, False], [0.9, 0.8, 0.7, 0.6])
close('interleaved auc', interleaved['auc'], 0.75)

# Every curve point must be a valid rate.
for point in separable['curve']:
    if not (0.0 <= point['tpr'] <= 1.0 and 0.0 <= point['fpr'] <= 1.0):
        failures.append('rate out of range: %s' % point)

# At threshold 0 everything is accepted, so both rates are 1.
check('label t=0', (separable['curve'][0]['tpr'], separable['curve'][0]['fpr']), (1.0, 1.0))

# Degenerate: ROC is undefined with a single outcome class.
check('all correct', label_curve([True, True], [0.9, 0.8]), None)
check('all wrong', label_curve([False, False], [0.9, 0.8]), None)
check('empty labels', label_curve([], []), None)

# Annotations. Two gold, two predicted, one of them a match.
gold = [{(0, 3, 'city')}, {(4, 9, 'date')}]
predicted = [[(0, 3, 'city', 0.9)], [(4, 8, 'date', 0.4)]]
annotations = annotation_curve(gold, predicted)

# At threshold 0 both predictions survive: 1 of 2 right, 1 of 2 found.
first = annotations['curve'][0]
close('annotation t=0 precision', first['precision'], 0.5)
close('annotation t=0 recall', first['recall'], 0.5)
close('annotation t=0 f1', first['f1'], 0.5)

# Above 0.4 only the correct one survives: perfect precision, half recall.
at_half = next(p for p in annotations['curve'] if p['threshold'] == 0.5)
close('annotation t=0.5 precision', at_half['precision'], 1.0)
close('annotation t=0.5 recall', at_half['recall'], 0.5)
close('annotation t=0.5 f1', at_half['f1'], 2 / 3)

# Max F1 is 2/3 at 0.5; the tie among every threshold in (0.4, 0.9] must
# resolve to the highest, 0.9.
check('annotation operating point', annotations['threshold'], 0.9)

# AP walks the ranking: the 0.9 hit gives precision 1 at recall 0.5, the 0.4
# miss adds no recall, so the area is 0.5.
close('average precision', annotations['average_precision'], 0.5)

# Degenerate: no gold annotations leaves recall undefined.
check('no gold', annotation_curve([set(), set()], [[], []]), None)

# A model that predicts nothing still has a defined curve — all zeros.
empty = annotation_curve([{(0, 3, 'city')}], [[]])
close('nothing predicted', empty['curve'][0]['recall'], 0.0)
close('nothing predicted ap', empty['average_precision'], 0.0)

# The operating point must come off the raw scores, not the grid. A confident
# classifier's scores all sit inside one grid step, where every grid threshold
# accepts everything or nothing — the grid's "best" point captured no recall at
# all, so applying it would have rejected every prediction.
saturated_correct = [True] * 8 + [False] * 2
saturated_scores = [
    0.9995, 0.9994, 0.9993, 0.9992, 0.9991, 0.9990, 0.9989, 0.9988, 0.9987, 0.9986,
]
saturated = label_curve(saturated_correct, saturated_scores)
close('saturated auc', saturated['auc'], 1.0)
close('saturated threshold', saturated['threshold'], 0.9988)
accepted = [
    is_correct for is_correct, score in zip(saturated_correct, saturated_scores)
    if score >= saturated['threshold']
]
check('saturated threshold accepts every correct prediction', (len(accepted), all(accepted)), (8, True))

# Average precision must not depend on the order of tied predictions: no
# threshold can separate two predictions sharing a score.
tied_gold = [{(0, 3, 'a')}, {(4, 7, 'b')}]
hit_first = annotation_curve(tied_gold, [[(0, 3, 'a', 0.5)], [(4, 7, 'x', 0.5)]])
miss_first = annotation_curve(tied_gold, [[(0, 3, 'x', 0.5)], [(4, 7, 'b', 0.5)]])
close('tied ap is order independent',
      hit_first['average_precision'], miss_first['average_precision'])
close('tied ap value', hit_first['average_precision'], 0.25)

# A model that predicted nothing has no achievable cutoff, so 0 (a no-op).
check('nothing predicted threshold', empty['threshold'], 0.0)
check('nothing predicted has no operating point', empty['operating'], None)

# The operating point must carry its own coordinates, because the chart marks
# it and its threshold will almost never coincide with a grid point.
check('saturated operating threshold', saturated['operating']['threshold'], saturated['threshold'])
check('saturated operating is a real point',
      (saturated['operating']['tpr'], saturated['operating']['fpr']), (1.0, 0.0))
check('annotation operating fields', sorted(annotations['operating']),
      ['f1', 'precision', 'recall', 'threshold'])
check('operating threshold is off-grid in general',
      any(point['threshold'] == saturated['threshold'] for point in saturated['curve']), False)

# Per-name breakdowns. 'greet' has one right and one wrong prediction so it
# scores; 'bye' is all-correct, which is degenerate, so it must be omitted
# rather than given a fabricated 1.0.
by_label = label_curves_by_name(
    ['greet', 'greet', 'bye', 'bye'],
    [True, False, True, True],
    [0.9, 0.4, 0.8, 0.7],
)
check('per-label names', sorted(by_label), ['greet'])
check('per-label support', by_label['greet']['support'], 2)
close('per-label auc', by_label['greet']['auc'], 1.0)

by_annotation = annotation_curves_by_name(gold, predicted)
check('per-annotation names', sorted(by_annotation), ['city', 'date'])
check('per-annotation support', by_annotation['city']['support'], 1)
close('per-annotation city ap', by_annotation['city']['average_precision'], 1.0)
# 'date' was predicted with the wrong boundary, so it never matches.
close('per-annotation date ap', by_annotation['date']['average_precision'], 0.0)

# A name that only ever appears in predictions has no recall denominator.
check('predicted-only name omitted', annotation_curves_by_name(
    [{(0, 3, 'city')}], [[(0, 3, 'city', 0.9), (4, 8, 'ghost', 0.5)]]
).get('ghost'), None)

# with_labels must pass a declined curve straight through.
check('with_labels on None', with_labels(None, {'a': 1}), None)
check('with_labels attaches', with_labels({'auc': 0.5}, {'a': 1}), {'auc': 0.5, 'labels': {'a': 1}})

# Gates. A threshold of 0 must be an exact no-op.
ranked = [{'name': 'greet', 'score': 0.4}, {'name': 'bye', 'score': 0.3}]
check('gate off', gate_labels(ranked, 0.0), ranked)
check('gate above', gate_labels(ranked, 0.3), ranked)
check('gate below', gate_labels(ranked, 0.6), [
    {'name': None, 'score': 0.4}, {'name': 'bye', 'score': 0.3},
])

# Annotation gating clears the tags its dropped annotation covered.
tokens = [('fly', 0, 3), ('to', 4, 6), ('goa', 7, 10)]
kept, tags = gate_annotations(
    [{'start': 7, 'end': 10, 'score': 0.2}],
    ['O', 'O', 'B-city'],
    0.5,
    tokens,
)
check('gate annotations dropped', kept, [])
check('gate annotations tags', tags, ['O', 'O', 'O'])

kept, tags = gate_annotations(
    [{'start': 7, 'end': 10, 'score': 0.8}],
    ['O', 'O', 'B-city'],
    0.5,
    tokens,
)
check('gate annotations kept', len(kept), 1)
check('gate annotations tags intact', tags, ['O', 'O', 'B-city'])

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('ALL THRESHOLD CHECKS PASSED')
```

- [ ] **Step 4: Run it**

```bash
PYTHONPATH=. ./venv/bin/python $SCRATCH/check_thresholds.py
```

Expected: `ALL THRESHOLD CHECKS PASSED`, exit 0.

---

### Task 2: One annotation builder

The sweep in Task 3 must score exactly the annotations serving emits. Today there are two builders: `tags_to_spans` (used by the metrics) and `_merge_entities` (used by named entity recognition's `predict`), which is a line-for-line reimplementation — same `\S+` tokenizer, identical merge rule. Language understanding's `_reconstruct_entities` already delegates to the shared one. This task collapses all three onto a single definition before anything starts scoring against it.

**Files:**
- Modify: `server/models/base.py` — add `_scored_annotations` near the other annotation helpers (`_annotation_tallies` is at line 493)
- Modify: `server/models/named_entity_recognition/base.py:97-122` — `_merge_entities`
- Modify: `server/models/natural_language_understanding/base.py:290-317` — `_reconstruct_entities`
- Verify: `$SCRATCH/check_builder.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `BaseModel._scored_annotations(text: str, tags: list[str], scores: list[float]) -> list[tuple[int, int, str, float]]`, returning `(start, end, name, score)` per annotation. Tasks 3 and 4 both call it.

- [ ] **Step 1: Add the shared builder**

In `server/models/base.py`, immediately above the existing `_annotation_tallies` static method, add:

```python
    @staticmethod
    def _scored_annotations(text, tags, scores):
        """
        The annotations of one tagged input, as ``(start, end, name, score)``.

        Built on the shared ``tags_to_spans`` so an annotation means exactly
        the same thing at inference, in the metrics and on the threshold
        curve — three places that must agree for a threshold fitted on one to
        be meaningful in the others. The score is the mean over the tokens the
        annotation covers.

        ``tags`` and ``scores`` must be one per word. ``_decode_tags`` sizes
        both to the word count so every caller satisfies this, but a caller
        that did not would get annotations built from the full tag sequence and
        scored from a short one — silently mis-scored rather than obviously
        broken, which is the one failure this shared builder exists to rule
        out. Cheaper to refuse than to debug.
        """
        from ..utils.dataset import tokenize, tags_to_spans

        if len(tags) != len(scores):
            raise ValueError(
                'tags and scores must be one per word, got %d and %d'
                % (len(tags), len(scores))
            )

        tokens = tokenize(text)
        annotations = []
        for start, end, name in tags_to_spans(text, tags):
            member = [
                score for (_, token_start, token_end), score in zip(tokens, scores)
                if token_start < end and token_end > start
            ]
            annotations.append((start, end, name, float(np.mean(member)) if member else 0.0))
        return annotations
```

`np` is already imported at the top of `base.py`. The `utils.dataset` import is deferred inside the method, matching how `_annotation_tallies` imports `tags_to_spans`.

- [ ] **Step 2: Delegate named entity recognition's builder**

In `server/models/named_entity_recognition/base.py`, replace the whole `_merge_entities` method (the `@staticmethod` decorator at line 97 through the closing `} for entity in entities]` at line 122) with:

```python
    def _merge_entities(self, text, tags, scores):
        """
        The predicted entities of one input, as ``{entity, value, start, end,
        score}``. Delegates to the shared annotation builder, so an entity
        returned here is the same object the metrics and the threshold curve
        score.
        """
        return [{
            'entity': name,
            'value': text[start:end],
            'start': start,
            'end': end,
            'score': score,
        } for start, end, name, score in self._scored_annotations(text, tags, scores)]
```

It changes from a `@staticmethod` to an instance method. The only call site is `self._merge_entities(X[i], tags, scores)` at line 57, which is unaffected. The key order (`entity, value, start, end, score`) is preserved exactly.

- [ ] **Step 3: Drop the now-unused `re` import**

`re` was imported at `server/models/named_entity_recognition/base.py:2` only for `_merge_entities`. Confirm and remove:

The pattern needs a boundary — a bare `re\.` also matches `score.` and `more.`:

```bash
grep -nE '(^|[^A-Za-z_])re\.[a-z]' server/models/named_entity_recognition/base.py
```

Expected: no output. If so, delete the line `import re` from the top of the file. If there is output, leave the import.

- [ ] **Step 4: Delegate language understanding's builder**

In `server/models/natural_language_understanding/base.py`, replace the body of `_reconstruct_entities` (lines 301-317, from `entities = []` through `return entities`) with:

```python
        slot_entities = slot_entities or {}
        return [{
            'slot': name,
            'entity': slot_entities.get(name),
            'value': text[start:end],
            'score': score,
            'start': start,
            'end': end,
        } for start, end, name, score in self._scored_annotations(text, tags, scores)]
```

Keep the existing docstring and signature. The key order (`slot, entity, value, score, start, end`) is preserved exactly.

- [ ] **Step 5: Compile**

```bash
./venv/bin/python -m py_compile server/models/base.py server/models/named_entity_recognition/base.py server/models/natural_language_understanding/base.py
```

Expected: no output, exit 0.

- [ ] **Step 6: Write the equivalence check**

The point of this task is that behaviour is unchanged. Create `$SCRATCH/check_builder.py`:

```python
"""Proves the shared builder reproduces both old builders exactly."""

import re
import sys

import numpy as np

from server.models.base import BaseModel
from server.utils.dataset import tags_to_spans

failures = []


def old_merge_entities(text, tags, scores):
    """The named-entity-recognition builder exactly as it was before Task 2."""
    entities, current = [], None
    words = [match.span() for match in re.finditer(r'\S+', text)]
    for (start, end), tag, score in zip(words, tags, scores):
        name = tag[2:] if tag[:2] in ('B-', 'I-') else None
        if name and tag.startswith('I-') and current and current['entity'] == name:
            current['end'] = end
            current['scores'].append(score)
        elif name:
            current = {'entity': name, 'start': start, 'end': end, 'scores': [score]}
            entities.append(current)
        else:
            current = None
    return [{
        'entity': entity['entity'],
        'value': text[entity['start']:entity['end']],
        'start': entity['start'],
        'end': entity['end'],
        'score': float(np.mean(entity['scores'])),
    } for entity in entities]


cases = [
    ('book a flight to new delhi', ['O', 'O', 'O', 'O', 'B-city', 'I-city'], [0.9, 0.9, 0.9, 0.9, 0.8, 0.7]),
    # An I- with no open annotation must still start one.
    ('fly to goa', ['O', 'O', 'I-city'], [0.9, 0.9, 0.6]),
    # Two adjacent annotations of the same name must stay separate.
    ('delhi mumbai', ['B-city', 'B-city'], [0.8, 0.6]),
    # A name change mid-run must break the annotation.
    ('delhi mumbai', ['B-city', 'I-state'], [0.8, 0.6]),
    # Irregular whitespace must not shift offsets.
    ('  fly   to    goa  ', ['O', 'O', 'B-city'], [0.9, 0.9, 0.5]),
    # No annotations at all.
    ('nothing here', ['O', 'O'], [0.9, 0.9]),
]

model = BaseModel()
for text, tags, scores in cases:
    expected = old_merge_entities(text, tags, scores)
    actual = [{
        'entity': name,
        'value': text[start:end],
        'start': start,
        'end': end,
        'score': score,
    } for start, end, name, score in model._scored_annotations(text, tags, scores)]
    if actual != expected:
        failures.append('%r\n    expected %s\n    got      %s' % (text, expected, actual))

    # And the offsets must be the same ones the metrics tally.
    from_builder = [(start, end, name) for start, end, name, _ in model._scored_annotations(text, tags, scores)]
    from_metrics = list(tags_to_spans(text, tags))
    if from_builder != from_metrics:
        failures.append('%r offsets disagree with tags_to_spans: %s vs %s'
                        % (text, from_builder, from_metrics))

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('BUILDER EQUIVALENCE CONFIRMED')
```

- [ ] **Step 7: Run it**

```bash
PYTHONPATH=. ./venv/bin/python $SCRATCH/check_builder.py
```

Expected: `BUILDER EQUIVALENCE CONFIRMED`, exit 0.

---

### Task 3: Threshold blocks in `evaluate()`

**Files:**
- Modify: `server/models/natural_language_understanding/base.py:380-444` — `evaluate`
- Modify: `server/models/named_entity_recognition/base.py:124-168` — `evaluate`
- Modify: `server/models/text_classification/base.py:150-166` — `evaluate`
- Verify: `$SCRATCH/check_evaluate.py`

**Interfaces:**
- Consumes: `label_curve`, `annotation_curve`, `label_curves_by_name`, `annotation_curves_by_name`, `with_labels` (Task 1); `_scored_annotations` (Task 2).
- Produces:
  - `BaseModel._annotation_threshold(gold, predicted) -> dict | None` — Task 3 uses it from both annotated model types.
  - `evaluation[split]['thresholds']` — a dict with a `label` key (text classification, language understanding), an `annotation` key (named entity recognition, language understanding), or both. A model type omits the key for a head it does not have; either value may be `None` when the data could not support a curve. Each non-`None` value is `{summary, threshold, curve, labels}` where the summary key is `auc` for `label` and `average_precision` for `annotation`. Task 7 reads this shape.

- [ ] **Step 1: Add a shared helper to `BaseModel`**

Both annotated model types produce the same two arguments, though they get to them differently — language understanding decodes tags and rebuilds annotations, named entity recognition already has scored annotations from `predict`. The helper takes the built lists so both paths converge on one implementation. Add to `server/models/base.py`, directly below `_scored_annotations`:

```python
    @staticmethod
    def _annotation_threshold(gold, predicted):
        """
        The precision-recall curve for one annotated head, with its per-name
        summaries attached.

        ``gold`` is one iterable of ``(start, end, name)`` per input and
        ``predicted`` one iterable of ``(start, end, name, score)``. Both must
        come from the shared annotation builder, so the curve's
        ``threshold: 0`` point reproduces ``_annotation_metrics`` exactly —
        that identity is what lets a threshold read off this curve mean the
        same thing as the number in the Reports tab.
        """
        from .thresholds import annotation_curve, annotation_curves_by_name, with_labels

        gold = [set(item) for item in gold]
        predicted = [list(item) for item in predicted]
        return with_labels(
            annotation_curve(gold, predicted),
            annotation_curves_by_name(gold, predicted),
        )
```

- [ ] **Step 2: Store thresholds in the language understanding `evaluate`**

In `server/models/natural_language_understanding/base.py`, the prediction loop currently discards both scores. Replace lines 401-405:

```python
        y_intents_pred, y_slots_pred = [], []
        for i in range(len(X)):
            y_intents_pred.append(self._rank_intents(intent_preds[i], 1)[0]['name'])
            tags, _ = self._word_tags(slot_preds[i], positions[i])
            y_slots_pred.append(tags)
```

with:

```python
        # The scores are kept, not dropped: they are what the threshold curves
        # sweep, and recomputing them would mean a second forward pass.
        y_intents_pred, y_intents_score = [], []
        y_slots_pred, y_slots_score = [], []
        for i in range(len(X)):
            ranked = self._rank_intents(intent_preds[i], 1)[0]
            y_intents_pred.append(ranked['name'])
            y_intents_score.append(ranked['score'])
            tags, scores = self._word_tags(slot_preds[i], positions[i])
            y_slots_pred.append(tags)
            y_slots_score.append(scores)
```

Then, just above the `return` statement, build the two curves:

```python
        # Both heads are scored on the same predictions the metrics above used,
        # so the operating points and the reported numbers cannot drift apart.
        intents_correct = [
            predicted == truth
            for predicted, truth in zip(y_intents_pred, y_intents_true)
        ]
        slot_gold = [tags_to_spans(text, tags) for text, tags in zip(X, y_slots_true)]
        slot_predicted = [
            self._scored_annotations(text, tags, scores)
            for text, tags, scores in zip(X, y_slots_pred, y_slots_score)
        ]
```

and add the `thresholds` key to the returned dict, after `'slots': {...}`:

```python
            'thresholds': {
                'label': with_labels(
                    label_curve(intents_correct, y_intents_score),
                    label_curves_by_name(y_intents_pred, intents_correct, y_intents_score),
                ),
                'annotation': self._annotation_threshold(slot_gold, slot_predicted),
            }
```

Add the import at the top of the file, beside the existing `from ..crf import CRFDecoder`:

```python
from ..thresholds import label_curve, label_curves_by_name, with_labels
```

`tags_to_spans` is already imported on the `...utils.dataset` line of this file.

- [ ] **Step 3: Store thresholds in the named entity recognition `evaluate`**

In `server/models/named_entity_recognition/base.py`, replace line 142:

```python
        y_pred_all = [result['tags'] for result in self.predict(X)]
```

with:

```python
        # predict() already merged and scored the annotations, so the curve
        # reads those rather than rebuilding them: what it sweeps is then
        # literally what serving returns.
        predictions = self.predict(X)
        y_pred_all = [result['tags'] for result in predictions]
        gold = [tags_to_spans(text, tags) for text, tags in zip(X, y_true)]
        predicted = [
            [
                (item['start'], item['end'], item['entity'], item['score'])
                for item in result['entities']
            ]
            for result in predictions
        ]
```

Named entity recognition has no classification head, so it emits only the `annotation` key. Add it to the returned dict, after `'entities': {...}`:

```python
            'thresholds': {
                'annotation': self._annotation_threshold(gold, predicted),
            }
```

Extend the existing `utils.dataset` import line — it currently imports only `spans_to_tags`:

```python
from ...utils.dataset import spans_to_tags, tags_to_spans
```

No `thresholds` import is needed here: `_annotation_threshold` lives on `BaseModel` and imports what it needs itself.

- [ ] **Step 4: Store the label threshold in the text classification `evaluate`**

In `server/models/text_classification/base.py`, replace the body of `evaluate` (lines 155-166) with:

```python
        results = self.predict(X)
        y_pred = [r['labels'][0]['name'] for r in results]
        y_score = [r['labels'][0]['score'] for r in results]

        cm = confusion_matrix(y, y_pred)
        acc = accuracy_score(y, y_pred)
        report = classification_report(y, y_pred, zero_division=0, output_dict=True)
        correct = [predicted == truth for predicted, truth in zip(y_pred, y)]

        return {
            'accuracy': float(acc),
            'confusion_matrix': cm.tolist(),
            'report': report,
            # No annotation key: this model type classifies whole utterances
            # and has no annotated head to threshold.
            'thresholds': {
                'label': with_labels(
                    label_curve(correct, y_score),
                    label_curves_by_name(y_pred, correct, y_score),
                ),
            }
        }
```

Add the import at the top of the file, beside `from ..base import BaseModel`:

```python
from ..thresholds import label_curve, label_curves_by_name, with_labels
```

- [ ] **Step 5: Compile**

```bash
./venv/bin/python -m py_compile server/models/base.py server/models/text_classification/base.py server/models/named_entity_recognition/base.py server/models/natural_language_understanding/base.py
```

Expected: no output, exit 0.

- [ ] **Step 6: Write the consistency check**

This is the load-bearing check in the whole plan: the curve at `threshold = 0` must reproduce `_annotation_metrics` exactly. If it does not, the Thresholds tab and the Reports tab disagree about what an annotation is.

Create `$SCRATCH/check_evaluate.py`:

```python
"""The threshold curve at t=0 must equal the exact-match metrics."""

import sys

from server.models.base import BaseModel
from server.models.thresholds import annotation_curve
from server.utils.dataset import tags_to_spans

failures = []

# Texts with gold tags and deliberately imperfect predictions: one exact match,
# one boundary miss, one name miss, one spurious annotation, one missed entirely.
X = [
    'fly to new delhi tomorrow',
    'book the taj mahal palace',
    'call ravi at noon',
    'weather in goa',
    'remind me later',
]
y_true = [
    ['O', 'O', 'B-city', 'I-city', 'B-date'],
    ['O', 'O', 'B-hotel', 'I-hotel', 'I-hotel'],
    ['O', 'B-person', 'O', 'B-time'],
    ['O', 'O', 'B-city'],
    ['O', 'O', 'B-time'],
]
y_pred = [
    ['O', 'O', 'B-city', 'I-city', 'B-date'],
    ['O', 'O', 'B-hotel', 'I-hotel', 'O'],
    ['O', 'B-city', 'O', 'B-time'],
    ['B-city', 'O', 'B-city'],
    ['O', 'O', 'O'],
]
scores = [[0.9] * len(tags) for tags in y_pred]

model = BaseModel()

gold = [tags_to_spans(text, tags) for text, tags in zip(X, y_true)]
predicted = [
    model._scored_annotations(text, tags, score)
    for text, tags, score in zip(X, y_pred, scores)
]

curve = annotation_curve(gold, predicted)
at_zero = curve['curve'][0]
metrics = BaseModel._annotation_metrics(X, y_true, y_pred)

for field in ('precision', 'recall', 'f1'):
    if abs(at_zero[field] - round(metrics[field], 6)) > 1e-6:
        failures.append('%s: curve %s vs metrics %s' % (field, at_zero[field], metrics[field]))

# The helper on BaseModel must agree with the same computation done by hand,
# and must carry the per-name breakdown the Thresholds table renders.
via_helper = BaseModel._annotation_threshold(gold, predicted)
if via_helper['curve'][0] != at_zero:
    failures.append('_annotation_threshold disagrees with annotation_curve')
if not via_helper.get('labels'):
    failures.append('_annotation_threshold attached no per-name summaries')
for name, summary in (via_helper.get('labels') or {}).items():
    if set(summary) != {'average_precision', 'threshold', 'support'}:
        failures.append('%s summary has keys %s' % (name, sorted(summary)))

# Raising the threshold above every score must empty the predictions out:
# precision 0 (nothing kept), recall 0 (nothing found).
at_one = curve['curve'][-1]
if (at_one['precision'], at_one['recall']) != (0.0, 0.0):
    failures.append('t=1.0 should keep nothing, got %s' % at_one)

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('CURVE AGREES WITH EXACT-MATCH METRICS AT t=0')
```

- [ ] **Step 7: Run it**

```bash
PYTHONPATH=. ./venv/bin/python $SCRATCH/check_evaluate.py
```

Expected: `CURVE AGREES WITH EXACT-MATCH METRICS AT t=0`, exit 0.

If precision/recall disagree, the cause is almost always that `_scored_annotations` and `_annotation_metrics` are reading different tag lists — check that `y_pred` rows are the same length as their `y_true` rows, since `_annotation_metrics` truncates and pads.

---

### Task 4: Gating in `predict()`

**Files:**
- Modify: `server/models/text_classification/base.py:122-148` — `predict`
- Modify: `server/models/named_entity_recognition/base.py:34-59` — `predict`
- Modify: `server/models/natural_language_understanding/base.py:319-344` — `predict`
- Verify: `$SCRATCH/check_gating.py`

**Interfaces:**
- Consumes: `gate_labels`, `gate_annotations` (Task 1).
- Produces: all three `predict` methods accept `label_threshold` and/or `annotation_threshold` kwargs, each a float or a per-input list, matching how `top` already works. Task 6 sends them.

- [ ] **Step 1: Add a kwarg reader to `BaseModel`**

`top` is already either a scalar or a per-input list, because the serving loop batches requests with different options together. The thresholds need the same treatment. Add to `server/models/base.py`, below `_annotation_threshold`:

```python
    @staticmethod
    def _per_input(value, count):
        """
        Expands a serving option to one value per input.

        The serving loop batches requests that arrived with different options,
        so it passes a list aligned with the inputs; a direct caller passes a
        scalar. ``top`` already works this way and the thresholds follow it.
        """
        if isinstance(value, (list, tuple)):
            return list(value) + [0.0] * max(0, count - len(value))
        return [value] * count
```

- [ ] **Step 2: Gate the text classification head**

In `server/models/text_classification/base.py`, replace lines 130-147 (from `top = kwargs.pop('top', 1)` to the end of the loop) with:

```python
        top = kwargs.pop('top', 1)
        threshold = kwargs.pop('label_threshold', 0.0)
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]

        tops = top if isinstance(top, (list, tuple)) else [top] * len(preds)
        thresholds = self._per_input(threshold, len(preds))

        results = []
        for pred, k, cutoff in zip(preds, tops, thresholds):
            order = np.argsort(pred)[::-1]
            if k:
                order = order[:int(k)]
            # Ranked 'labels' with 'name'/'score' entries.
            labels = [
                {'name': self.labels[str(int(idx))], 'score': float(pred[idx])}
                for idx in order
            ]
            results.append({'labels': gate_labels(labels, cutoff)})
        return results
```

Extend the docstring's second paragraph with:

```
        ``label_threshold`` (default 0, meaning off) clears the top-ranked
        label's ``name`` when it scores below the cutoff. Like ``top`` it may
        be a scalar or a per-input list.
```

Extend the import added in Task 3 to:

```python
from ..thresholds import gate_labels, label_curve, label_curves_by_name, with_labels
```

- [ ] **Step 3: Gate the named entity recognition head**

In `server/models/named_entity_recognition/base.py`, replace the body of `predict` (lines 45-59) with:

```python
        threshold = kwargs.pop('annotation_threshold', 0.0)
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]
        if hasattr(preds, 'logits'):
            preds = preds.logits.numpy()

        thresholds = self._per_input(threshold, len(X))

        results = []
        for i, positions in enumerate(self._word_positions(X)):
            # The CRF Viterbi pass over the aligned word sequence, which also
            # applies the IOB legality mask — a model trained without the CRF
            # decodes here too, just with uniform transitions.
            tags, scores = self._decode_tags(preds[i], positions, self.labels)
            entities, tags = gate_annotations(
                self._merge_entities(X[i], tags, scores),
                tags,
                thresholds[i],
                tokenize(X[i]),
            )
            results.append({'tags': tags, 'entities': entities})
        return results
```

Extend the docstring with:

```
        ``annotation_threshold`` (default 0, meaning off) drops entities
        scoring below the cutoff and resets the tags they covered to ``O``.
```

Extend the `utils.dataset` import to:

```python
from ...utils.dataset import spans_to_tags, tags_to_spans, tokenize
```

and add:

```python
from ..thresholds import gate_annotations
```

- [ ] **Step 4: Gate both language understanding heads**

In `server/models/natural_language_understanding/base.py`, replace the body of `predict` (lines 331-344) with:

```python
        top = kwargs.pop('top', 1)
        label_threshold = kwargs.pop('label_threshold', 0.0)
        annotation_threshold = kwargs.pop('annotation_threshold', 0.0)
        intent_preds, slot_preds = self._joint_predictions(X, **kwargs)
        tops = top if isinstance(top, (list, tuple)) else [top] * len(X)
        label_thresholds = self._per_input(label_threshold, len(X))
        annotation_thresholds = self._per_input(annotation_threshold, len(X))

        results = []
        for i, (text, positions, k) in enumerate(zip(X, self._word_positions(X), tops)):
            tags, scores = self._word_tags(slot_preds[i], positions)
            intents = self._rank_intents(intent_preds[i], k)
            # Entities are resolved through the top intent *before* it is
            # gated. The two heads are thresholded independently, so a slot
            # that cleared its own cutoff should not lose its entity name
            # because the intent head happened to be uncertain.
            slot_entities = (self.slots or {}).get(intents[0]['name']) if intents else None
            entities, _ = gate_annotations(
                self._reconstruct_entities(text, tags, scores, slot_entities),
                tags,
                annotation_thresholds[i],
                tokenize(text),
            )
            results.append({
                'intents': gate_labels(intents, label_thresholds[i]),
                'entities': entities,
            })
        return results
```

The gated tags are discarded here because language understanding's `predict` does not return a `tags` key — only named entity recognition does. Extend the docstring with:

```
        ``label_threshold`` clears the top intent's ``name`` below its cutoff
        and ``annotation_threshold`` drops low-scoring slots; both default to
        0, meaning off. Entities are resolved through the top intent before it
        is gated, so a rejected intent does not strip entity names from slots
        that passed their own cutoff.
```

Extend the imports:

```python
from ..thresholds import gate_annotations, gate_labels, label_curve, label_curves_by_name, with_labels
from ...utils.dataset import tokenize, tags_to_spans, spans_to_tags
```

(`tokenize`, `tags_to_spans` and `spans_to_tags` are already on that import line — leave it as is and only extend the `..thresholds` line added in Task 3.)

- [ ] **Step 5: Compile**

```bash
./venv/bin/python -m py_compile server/models/base.py server/models/text_classification/base.py server/models/named_entity_recognition/base.py server/models/natural_language_understanding/base.py
```

Expected: no output, exit 0.

- [ ] **Step 6: Write the gating check**

Create `$SCRATCH/check_gating.py`:

```python
"""Gating must be a no-op at 0 and must drop exactly what the curve says."""

import sys

from server.models.base import BaseModel
from server.models.thresholds import gate_annotations, gate_labels
from server.utils.dataset import tokenize

failures = []


def check(name, actual, expected):
    if actual != expected:
        failures.append('%s: expected %s, got %s' % (name, expected, actual))


# Per-input expansion, the shape the serving loop sends.
check('scalar expands', BaseModel._per_input(0.5, 3), [0.5, 0.5, 0.5])
check('list passes through', BaseModel._per_input([0.1, 0.2], 2), [0.1, 0.2])
check('short list pads off', BaseModel._per_input([0.1], 3), [0.1, 0.0, 0.0])

# A zero threshold must not change anything at all.
ranked = [{'name': 'greet', 'score': 0.05}, {'name': 'bye', 'score': 0.01}]
check('labels untouched at 0', gate_labels(ranked, 0.0), ranked)

text = 'fly to goa tomorrow'
tokens = tokenize(text)
annotations = [
    {'slot': 'city', 'value': 'goa', 'score': 0.2, 'start': 7, 'end': 10},
    {'slot': 'date', 'value': 'tomorrow', 'score': 0.95, 'start': 11, 'end': 19},
]
tags = ['O', 'O', 'B-city', 'B-date']

kept, gated = gate_annotations(annotations, tags, 0.0, tokens)
check('annotations untouched at 0', kept, annotations)
check('tags untouched at 0', gated, tags)

# At 0.5 the low-confidence city goes and its tag clears; the date survives.
kept, gated = gate_annotations(annotations, tags, 0.5, tokens)
check('low annotation dropped', [item['slot'] for item in kept], ['date'])
check('its tag cleared', gated, ['O', 'O', 'O', 'B-date'])

# The caller's tag list must not be mutated in place.
check('input tags unmutated', tags, ['O', 'O', 'B-city', 'B-date'])

# A multi-token annotation clears every tag it covered.
multi_text = 'book the taj mahal palace'
kept, gated = gate_annotations(
    [{'score': 0.1, 'start': 9, 'end': 25}],
    ['O', 'O', 'B-hotel', 'I-hotel', 'I-hotel'],
    0.5,
    tokenize(multi_text),
)
check('multi-token dropped', kept, [])
check('multi-token tags cleared', gated, ['O', 'O', 'O', 'O', 'O'])

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('GATING CHECKS PASSED')
```

- [ ] **Step 7: Run it**

```bash
PYTHONPATH=. ./venv/bin/python $SCRATCH/check_gating.py
```

Expected: `GATING CHECKS PASSED`, exit 0.

---

### Task 5: Deployment options

**Files:**
- Modify: `server/database/instance.py:77-136` — `default_options`, `options`, `clean`
- Modify: `server/utils/registry.py:20-41` — the `Route` dataclass
- Verify: `$SCRATCH/check_options.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Instance.options()` includes `label_threshold` and `annotation_threshold`; `Route` carries both as `float` with default `0.0`. Task 6 reads `route.label_threshold` / `route.annotation_threshold`.

- [ ] **Step 1: Add the defaults**

In `server/database/instance.py`, inside the dict returned by `default_options`, add after `'top': 1,`:

```python
            # 0 means off: an existing deployment keeps returning everything
            # the model predicts until the operator opts in to a cutoff.
            'label_threshold': 0.0,
            'annotation_threshold': 0.0,
```

- [ ] **Step 2: Carry them into the route**

In the same file, extend the tuple in `options()` to:

```python
        return {field: self._config[field] for field in (
            'lazy', 'cache', 'top', 'label_threshold', 'annotation_threshold',
            'timeout', 'interval', 'batch_size', 'sleep',
            'idle_timeout', 'heartbeat_interval', 'heartbeat_ttl', 'output_ttl',
        )}
```

- [ ] **Step 3: Validate them**

In `clean`, after the existing positive-seconds loop and before the `interval > timeout` check, add:

```python
        for field in ('label_threshold', 'annotation_threshold'):
            value = config[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.0 <= value <= 1.0:
                abort(400, 'config.%s must be a number between 0 and 1' % field)
            config[field] = float(value)
```

- [ ] **Step 4: Add the route fields**

In `server/utils/registry.py`, in the `Route` dataclass, after `top: int = 1`, add:

```python
    label_threshold: float = 0.0
    annotation_threshold: float = 0.0
```

`to_mapping` stringifies every field generically, but `from_mapping` reconstructs each one by name, so both must be added there too. In the `cls(...)` call, after `top=number('top', int, default=1),` add:

```python
            label_threshold=number('label_threshold', float, default=0.0),
            annotation_threshold=number('annotation_threshold', float, default=0.0),
```

The local `number` helper returns its default for a missing or empty value, so an older route hash written before this change decodes as `0.0` — off — rather than raising.

- [ ] **Step 5: Compile**

```bash
./venv/bin/python -m py_compile server/database/instance.py server/utils/registry.py
```

Expected: no output, exit 0.

- [ ] **Step 6: Verify the round trip**

Create `$SCRATCH/check_options.py`:

```python
"""A Route must survive the Redis mapping round trip with its thresholds."""

import sys

from server.utils.registry import Route

failures = []

route = Route(
    path='models/1/0.6',
    model_type='natural_language_understanding',
    label_threshold=0.61,
    annotation_threshold=0.44,
)
restored = Route.from_mapping(route.to_mapping())

if restored is None:
    failures.append('from_mapping returned None')
else:
    if float(restored.label_threshold) != 0.61:
        failures.append('label_threshold: got %r' % (restored.label_threshold,))
    if float(restored.annotation_threshold) != 0.44:
        failures.append('annotation_threshold: got %r' % (restored.annotation_threshold,))
    for field in ('label_threshold', 'annotation_threshold'):
        value = getattr(restored, field)
        if not isinstance(value, float):
            failures.append('%s came back as %s, not float' % (field, type(value).__name__))

default = Route(path='p', model_type='text_classification')
if (default.label_threshold, default.annotation_threshold) != (0.0, 0.0):
    failures.append('defaults are not 0.0')

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('ROUTE ROUND TRIP PASSED')
```

- [ ] **Step 7: Run it**

```bash
PYTHONPATH=. ./venv/bin/python $SCRATCH/check_options.py
```

Expected: `ROUTE ROUND TRIP PASSED`, exit 0.

If the thresholds come back as strings, `from_mapping` needs the per-field float coercion from Step 4 — add it and re-run.

---

### Task 6: The infer view

**Files:**
- Modify: `server/views/triton/inference.py:31`, `:56`, `:84`
- Verify: `$SCRATCH/check_cache_key.py`

**Interfaces:**
- Consumes: `Route.label_threshold` / `Route.annotation_threshold` (Task 5); the `predict` kwargs from Task 4.
- Produces: the input envelope gains `label_threshold` and `annotation_threshold`, which the serving loop already collects per-input into lists (`server/tasks/inference.py:87`) with no change needed there.

- [ ] **Step 1: Read the thresholds off the route**

In `server/views/triton/inference.py`, after line 31 (`top = ...`), add:

```python
    def threshold(name, configured):
        """
        A cutoff from the query string, falling back to the deployment's.

        Clamped rather than rejected: an out-of-range query arg should degrade
        to the nearest sane cutoff, not fail a prediction request. NaN needs
        its own branch because it is not out of range so much as meaningless —
        ``float('nan')`` parses, so it never reaches the unparseable fallback;
        min/max propagate it rather than clamping it; and every comparison
        against it is False, so it would silently reject the whole response.
        It falls back the way an unparseable value does.
        """
        value = request.args.get(name, configured, type=float)
        if value is None or math.isnan(value):
            value = configured
        return min(max(value, 0.0), 1.0)

    label_threshold = threshold('label_threshold', route.label_threshold)
    annotation_threshold = threshold('annotation_threshold', route.annotation_threshold)
```

Add `import math` beside the existing `import time` / `import json` at the top of the file.

- [ ] **Step 2: Put them in the cache key**

Replace line 56:

```python
            hash = sha256(f'{top}:{query}'.encode('utf-8')).hexdigest()
```

with:

```python
            # The thresholds belong in the key: they change the response, so a
            # result cached under one cutoff must never be served under
            # another. A config change therefore lands on fresh keys and the
            # stale entries simply expire on output_ttl — no purge needed.
            hash = sha256(
                f'{top}:{label_threshold}:{annotation_threshold}:{query}'.encode('utf-8')
            ).hexdigest()
```

- [ ] **Step 3: Put them in the input envelope**

Replace lines 82-85:

```python
        items = [
            json.dumps({'id': key, 'data': value, "top": top}).encode('utf-8')
            for key, value in zip(list(pending), list(pending.values()))
        ]
```

with:

```python
        items = [
            json.dumps({
                'id': key,
                'data': value,
                'top': top,
                'label_threshold': label_threshold,
                'annotation_threshold': annotation_threshold,
            }).encode('utf-8')
            for key, value in zip(list(pending), list(pending.values()))
        ]
```

The serving loop at `server/tasks/inference.py:87` already folds every envelope key other than `id`/`data` into a per-input kwarg list, so it needs no change. Read that loop and confirm before moving on.

- [ ] **Step 4: Compile**

```bash
./venv/bin/python -m py_compile server/views/triton/inference.py
```

Expected: no output, exit 0.

- [ ] **Step 5: Verify keys do not collide**

Create `$SCRATCH/check_cache_key.py`:

```python
"""Two requests differing only in threshold must hash differently."""

import sys

from hashlib import sha256

failures = []


def key(top, label_threshold, annotation_threshold, query):
    return sha256(
        f'{top}:{label_threshold}:{annotation_threshold}:{query}'.encode('utf-8')
    ).hexdigest()


query = 'book a flight to goa'
base = key(1, 0.0, 0.0, query)

if key(1, 0.6, 0.0, query) == base:
    failures.append('label_threshold does not affect the key')
if key(1, 0.0, 0.6, query) == base:
    failures.append('annotation_threshold does not affect the key')
if key(2, 0.0, 0.0, query) == base:
    failures.append('top no longer affects the key')
if key(1, 0.0, 0.0, query) != base:
    failures.append('the key is not stable for identical inputs')
# The two thresholds must not be interchangeable.
if key(1, 0.6, 0.0, query) == key(1, 0.0, 0.6, query):
    failures.append('the two thresholds collide with each other')

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('CACHE KEY CHECKS PASSED')
```

- [ ] **Step 6: Run it**

```bash
PYTHONPATH=. ./venv/bin/python $SCRATCH/check_cache_key.py
```

Expected: `CACHE KEY CHECKS PASSED`, exit 0.

- [ ] **Step 7: Compile the whole backend**

```bash
./venv/bin/python -m compileall -q server/
```

Expected: no output, exit 0.

---

### Task 7: Frontend readers

**Files:**
- Modify: `src/shared/utils/training.js` — add `getThresholds`, `thresholdRows`
- Modify: `src/shared/utils/trainingDownloads.js` — add `curveCsv`
- Verify: `$SCRATCH/check_training_js.mjs`

**Interfaces:**
- Consumes: the `thresholds` shape from Task 3.
- Produces:
  - `getThresholds(training, split, head) -> {kind, summary, threshold, curve, labels} | null`. `head` is `'slots'` for the annotation head, anything else for the label head. `kind` is `'label'` or `'annotation'`.
  - `thresholdRows(metrics) -> [{label, score, threshold, support}]`, sorted by support descending then name.
  - `curveCsv(curve, kind) -> string`.

- [ ] **Step 1: Add the readers**

Append to `src/shared/utils/training.js`, after `getEntityRollup`:

```js
// The operating-point curve for one head of one split. The label head (text
// classification labels, language understanding intents) carries a ROC and an
// AUC; the annotation head (slots, entities) carries a precision-recall curve
// and an average precision, because annotations have no true negatives to give
// a ROC's false-positive rate a denominator.
//
// Returns null for runs trained before thresholds existed and for the
// degenerate cases the backend deliberately declines to score — the caller
// renders an empty state either way, never a zero.
export const getThresholds = (training, split, head = null) => {
    const block = training?.result?.evaluation?.[split]?.thresholds;
    if (!block) return null;

    // A named entity recognition run has only the annotation head and no slots
    // toggle to select it with, so a caller that cannot name a head (`null`,
    // which is what the shared split/head control reports for a single-head
    // run) falls back to whichever head this model type actually stored. A
    // caller that does name one gets exactly that head or nothing — otherwise
    // Publish's "Label threshold" field would offer a named entity
    // recognition run's annotation cutoff as though it were a label cutoff.
    // A declined head is still present as null, so key presence rather than
    // truthiness is the fallback's test.
    const kind = head === 'slots' ? 'annotation'
        : head ? 'label'
        : ('label' in block ? 'label' : 'annotation');
    const scored = block[kind];
    if (!scored) return null;

    return {
        kind,
        summary: (kind === 'label' ? scored.auc : scored.average_precision) ?? null,
        threshold: scored.threshold ?? null,
        // The coordinates the chart marks. Stored by the backend rather than
        // looked up on the curve, because the threshold is a six-decimal value
        // and the curve is a two-decimal grid.
        operating: scored.operating ?? null,
        curve: scored.curve || [],
        labels: scored.labels || {}
    };
};

// A threshold is chosen off the raw scores rather than a fixed grid, so it can
// need far more than two decimals — a confident classifier's useful cutoff can
// be 0.9988, which `toFixed(2)` would render as a flat "1.00" that rejects
// everything. Trailing zeros are dropped so ordinary round values still read
// cleanly.
export const formatThreshold = (value) => (
    typeof value === 'number' && Number.isFinite(value)
        ? String(Number(value.toFixed(6)))
        : '—'
);

// Rows for the per-class table under the curve. The summary is whichever of
// AUC / average precision that head reports, so one column serves both.
export const thresholdRows = (metrics) => (
    Object.entries(metrics?.labels || {})
        .filter(([, scores]) => scores && typeof scores === 'object')
        .map(([label, scores]) => ({
            label,
            score: scores.auc ?? scores.average_precision ?? null,
            threshold: scores.threshold ?? null,
            support: scores.support ?? null
        }))
        .sort((a, b) => (b.support ?? 0) - (a.support ?? 0) || a.label.localeCompare(b.label))
);
```

- [ ] **Step 2: Add the CSV export**

Append to `src/shared/utils/trainingDownloads.js`, following the shape of the existing `reportCsv`:

```js
// The curve on screen, one row per grid threshold. The columns differ by head
// because the two curves plot different axes.
export const curveCsv = (curve, kind) => csvBlob([
    kind === 'label'
        ? ['threshold', 'tpr', 'fpr']
        : ['threshold', 'precision', 'recall', 'f1'],
    ...(curve || []).map((point) => (kind === 'label'
        ? [point.threshold, point.tpr, point.fpr]
        : [point.threshold, point.precision, point.recall, point.f1]))
]);
```

- [ ] **Step 3: Write the reader check**

Create `$SCRATCH/check_training_js.mjs`:

```js
import { getThresholds, thresholdRows } from '../../../Users/varunseth/Documents/git/indic-nlu/src/shared/utils/training.js';

const failures = [];
const check = (name, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
};

const training = {
    result: {
        evaluation: {
            test: {
                thresholds: {
                    label: {
                        auc: 0.88,
                        threshold: 0.61,
                        curve: [{ threshold: 0, tpr: 1, fpr: 1 }],
                        labels: { greet: { auc: 0.9, threshold: 0.5, support: 12 } }
                    },
                    annotation: {
                        average_precision: 0.62,
                        threshold: 0.44,
                        curve: [{ threshold: 0, precision: 0.3, recall: 0.9, f1: 0.45 }],
                        labels: {
                            city: { average_precision: 0.7, threshold: 0.4, support: 30 },
                            date: { average_precision: 0.5, threshold: 0.6, support: 30 }
                        }
                    }
                }
            }
        }
    }
};

const label = getThresholds(training, 'test', 'intent');
check('label kind', label.kind, 'label');
check('label summary', label.summary, 0.88);
check('label threshold', label.threshold, 0.61);

const annotation = getThresholds(training, 'test', 'slots');
check('annotation kind', annotation.kind, 'annotation');
check('annotation summary', annotation.summary, 0.62);

// Equal support must fall back to name order, so the table is stable.
check('rows sorted', thresholdRows(annotation).map((row) => row.label), ['city', 'date']);
check('row score reads either summary', thresholdRows(label)[0].score, 0.9);

// Missing and declined blocks both read as absent, never as zero.
check('no block', getThresholds({}, 'test', 'intent'), null);
check('no split', getThresholds(training, 'train', 'intent'), null);
check('declined curve', getThresholds(
    { result: { evaluation: { test: { thresholds: { label: null } } } } }, 'test', 'intent'
), null);
check('empty rows', thresholdRows(null), []);

if (failures.length) {
    console.log('FAILURES:');
    failures.forEach((failure) => console.log('  ' + failure));
    process.exit(1);
}
console.log('TRAINING.JS THRESHOLD READERS PASSED');
```

Adjust the import to a path that resolves from wherever you place the file — an absolute `file://` URL is simplest:

```js
import { getThresholds, thresholdRows } from 'file:///Users/varunseth/Documents/git/indic-nlu/src/shared/utils/training.js';
```

- [ ] **Step 4: Run it**

```bash
node $SCRATCH/check_training_js.mjs
```

Expected: `TRAINING.JS THRESHOLD READERS PASSED`, exit 0.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: `✓ built in …`, exit 0.

---

### Task 8: The History Thresholds tab

**Files:**
- Create: `src/routes/model/routes/history/ThresholdsPanel.jsx`
- Modify: `src/routes/model/routes/history/History.jsx` — export three shared pieces, import and mount the panel

**Interfaces:**
- Consumes: `getThresholds`, `thresholdRows` (Task 7); `curveCsv`, `trainingFilename` (Task 7 / existing).
- Produces: `<ThresholdsPanel training model />`, mounted as the `thresholds` tab.

- [ ] **Step 1: Export the shared pieces from History.jsx**

`ThresholdsPanel` needs three things currently private to `History.jsx`. Add `export` to each declaration, leaving the bodies untouched:

- `const PanelCard = ...` (around line 620)
- `const DownloadButton = ...` (line 639)
- `const EvaluationControls = ...` (around line 1381)
- `const useEvaluationView = ...` (around line 1393)
- `const formatMetric = ...` (find it with `grep -n 'const formatMetric' src/routes/model/routes/history/History.jsx`)

Each becomes `export const …`. They keep working unchanged inside `History.jsx`.

- [ ] **Step 2: Create the panel**

Create `src/routes/model/routes/history/ThresholdsPanel.jsx`:

```jsx
// Where a run's confidence cutoff comes from.
//
// The label head (text classification labels, language understanding intents)
// gets a ROC: "was the top-1 prediction correct?" is a real binary question, so
// both rates have genuine denominators. Annotations get precision-recall
// instead — raising the cutoff only ever removes predicted annotations, so
// there is no population of true negatives for a false-positive rate to divide
// by, and a ROC drawn anyway would track the model's over-tagging rate rather
// than its ranking.
//
// The marked point is what Publish offers as the recommended threshold.

import { Table } from "react-bootstrap";
import { SlidersVertical } from "react-bootstrap-icons";
import {
    CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { FiletypeCsv } from "react-bootstrap-icons";

import downloadBlob from "../../../../shared/utils/downloadBlob";
import { formatThreshold, getThresholds, thresholdRows } from "../../../../shared/utils/training";
import { curveCsv, trainingFilename } from "../../../../shared/utils/trainingDownloads";
import {
    DownloadButton, EvaluationControls, PanelCard, formatMetric, useEvaluationView
} from "./History";

// The two curves plot different axes, and everything downstream — the summary
// label, the chart, the CSV — keys off this one table.
const CURVES = {
    label: {
        summary: "AUC",
        x: "fpr",
        y: "tpr",
        xLabel: "False positive rate",
        yLabel: "True positive rate",
        unit: "label",
        note: "Chance is the diagonal. The marked point maximises TPR − FPR."
    },
    annotation: {
        summary: "Average precision",
        x: "recall",
        y: "precision",
        xLabel: "Recall",
        yLabel: "Precision",
        unit: "annotation",
        note: "The marked point maximises F1."
    }
};

const ThresholdsPanel = ({ training, model }) => {
    const view = useEvaluationView(training);
    const metrics = getThresholds(training, view.split, view.head);
    const spec = metrics ? CURVES[metrics.kind] : null;
    const rows = thresholdRows(metrics);

    // The backend stores the operating point's own coordinates. Matching the
    // threshold against the curve would fail: the threshold is a six-decimal
    // value off the raw scores, the curve a two-decimal grid.
    const operating = metrics?.operating;

    return (
        <PanelCard
            icon={<SlidersVertical />}
            title={view.title}
            className="p-0"
            controls={
                <EvaluationControls
                    heads={view.heads}
                    split={view.split}
                    onSplit={view.setSplit}
                    head={view.head}
                    onHead={view.setHead}
                />
            }
            actions={
                <DownloadButton
                    title="Download curve CSV"
                    icon={<FiletypeCsv />}
                    disabled={!metrics}
                    onClick={() => downloadBlob(
                        curveCsv(metrics.curve, metrics.kind),
                        trainingFilename(model, training, view.suffix("curve.csv"))
                    )}
                />
            }
        >
            {metrics ? (
                <div className="px-3 pb-3">
                    <div className="d-flex flex-wrap align-items-baseline gap-3 small mb-2">
                        <span>
                            <span className="text-muted">{spec.summary}</span>{" "}
                            <span className="fw-bold">{formatMetric(metrics.summary)}</span>
                        </span>
                        <span>
                            <span className="text-muted">Recommended threshold</span>{" "}
                            <span className="fw-bold">{formatThreshold(metrics.threshold)}</span>
                        </span>
                        <span className="text-muted">{spec.note}</span>
                    </div>
                    <div style={{ height: "320px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={metrics.curve} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis
                                    type="number"
                                    dataKey={spec.x}
                                    domain={[0, 1]}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: spec.xLabel, position: "insideBottom", offset: -12, fontSize: 11 }}
                                />
                                <YAxis
                                    type="number"
                                    domain={[0, 1]}
                                    tick={{ fontSize: 11 }}
                                    label={{ value: spec.yLabel, angle: -90, position: "insideLeft", fontSize: 11 }}
                                />
                                <Tooltip
                                    formatter={(value, name) => [formatMetric(value), name]}
                                    labelFormatter={() => ""}
                                />
                                {metrics.kind === "label" && (
                                    <Line
                                        type="linear"
                                        dataKey={spec.x}
                                        stroke="currentColor"
                                        strokeDasharray="4 4"
                                        strokeOpacity={0.3}
                                        dot={false}
                                        isAnimationActive={false}
                                        name="chance"
                                    />
                                )}
                                <Line
                                    type="monotone"
                                    dataKey={spec.y}
                                    stroke="#20c997"
                                    strokeWidth={2}
                                    dot={false}
                                    isAnimationActive={false}
                                    name={spec.yLabel}
                                />
                                {operating && (
                                    <ReferenceDot
                                        x={operating[spec.x]}
                                        y={operating[spec.y]}
                                        r={5}
                                        fill="#20c997"
                                        stroke="none"
                                    />
                                )}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="text-muted small mb-3">
                        {view.split === 'test'
                            ? 'Fitted on this split, so the score at this threshold is mildly optimistic — the same rows chose the cutoff and reported the result.'
                            : 'The training-split curve, for comparison. The recommended cutoff is fitted on the test split, not this one, because training scores are inflated by memorization.'}
                    </p>
                    {rows.length > 0 && (
                        <Table responsive size="sm" className="small border border-light-subtle mb-0">
                            <thead className="bg-body-tertiary">
                                <tr className="border-bottom border-light-subtle">
                                    <th className="border-end border-light-subtle text-capitalize">{spec.unit}</th>
                                    <th className="border-end border-light-subtle">{spec.summary}</th>
                                    <th className="border-end border-light-subtle">Best threshold</th>
                                    <th>Support</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.label} className="border-bottom border-light-subtle">
                                        <td className="border-end border-light-subtle">{row.label}</td>
                                        <td className="border-end border-light-subtle">{formatMetric(row.score)}</td>
                                        <td className="border-end border-light-subtle">
                                            {formatThreshold(row.threshold)}
                                        </td>
                                        <td>{row.support ?? "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </div>
            ) : (
                <div className="text-muted small px-3 pb-3" style={{ minHeight: "400px" }}>
                    No curve for this split. Either the run predates thresholds, or the
                    held-out data could not support one — a ROC needs both a correct and an
                    incorrect prediction, and a precision-recall curve needs at least one
                    annotation to find.
                </div>
            )}
        </PanelCard>
    );
};

export default ThresholdsPanel;
```

If `SlidersVertical` is not exported by the installed `react-bootstrap-icons`, use `Sliders2` — it is already imported in `History.jsx`, so it definitely exists. Check with:

```bash
grep -c 'SlidersVertical' node_modules/react-bootstrap-icons/dist/index.d.ts
```

- [ ] **Step 3: Mount the tab**

In `src/routes/model/routes/history/History.jsx`, add the import at the top:

```jsx
import ThresholdsPanel from "./ThresholdsPanel";
```

Then insert a new `<Tab>` between the `matrix` tab and the `traceback` tab:

```jsx
                    <Tab
                        eventKey="thresholds"
                        title={<TabTitle icon={<Sliders2 />}>Thresholds</TabTitle>}
                        disabled={training.status !== 'SUCCESS'}
                    >
                        <div className="pt-3">
                            <ThresholdsPanel training={training} model={model} />
                        </div>
                    </Tab>
```

`mountOnEnter` is already set on the parent `Tabs`, so recharts will not mount until the tab is opened.

Note the circular import: `ThresholdsPanel` imports from `History.jsx`, which imports `ThresholdsPanel`. ES modules handle this as long as neither module reads the other's bindings at module-evaluation time — both only use them inside component bodies, so it resolves. If Vite reports a circular-dependency problem at build time, move the five shared pieces into a new `src/routes/model/routes/history/panels.jsx` and import from there in both files.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: `✓ built in …`, exit 0. A failure naming `SlidersVertical` means the icon does not exist — swap in `Sliders2`.

---

### Task 9: Publish fields

**Files:**
- Modify: `src/routes/model/routes/publish/Publish.jsx` — `CONFIG_NUMERIC_FIELDS` (line 366), `parseConfigForm` (line 422), `ConfigField` usage (around line 548), the curl snippet (line 140)

**Interfaces:**
- Consumes: `getThresholds` (Task 7); the config fields from Task 5.
- Produces: nothing downstream.

- [ ] **Step 1: Teach the form the two fields**

`CONFIG_NUMERIC_FIELDS` carries `[name, label, isInteger]` and both validators branch only on `isInteger`, so a `0.0–1.0` field does not fit. Add a separate list below `CONFIG_NUMERIC_FIELDS`:

```jsx
// Thresholds validate differently from every other numeric field: they are
// bounded to 0–1 and 0 is a legal value, meaning "no cutoff".
const CONFIG_THRESHOLD_FIELDS = [
    ["label_threshold", "Label threshold"],
    ["annotation_threshold", "Annotation threshold"]
];
```

- [ ] **Step 2: Validate them**

In `parseConfigForm`, before the `return { config: ... }`, add:

```jsx
    for (const [field, label] of CONFIG_THRESHOLD_FIELDS) {
        const value = Number(form[field]);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            return { error: `${label} must be a number between 0 and 1.` };
        }
        numbers[field] = value;
    }
```

Find the per-field error helper that reads `CONFIG_NUMERIC_FIELDS.find(...)` (around line 394) and add, before its `if (!rule) return null;`:

```jsx
    if (CONFIG_THRESHOLD_FIELDS.some(([name]) => name === field)) {
        const value = Number(form[field]);
        return form[field] === "" || !Number.isFinite(value) || value < 0 || value > 1
            ? "Must be a number between 0 and 1."
            : null;
    }
```

- [ ] **Step 3: Render them**

Beside the existing `config-top` field, add two more `ConfigField`s. `training` here is the version being published — use whatever the surrounding component already calls it, and read its recommendation with `getThresholds(training, 'test', head)`:

```jsx
                <Col sm={6}>
                    <ConfigField
                        id="config-label-threshold"
                        label="Label threshold"
                        help={
                            <>
                                Below this score the top label is returned with no name. 0 turns it off.
                                {labelRecommendation !== null && (
                                    <> Recommended <Button
                                        variant="link"
                                        size="sm"
                                        className="p-0 align-baseline"
                                        onClick={() => onChange("label_threshold", String(labelRecommendation))}
                                    >{formatThreshold(labelRecommendation)}</Button> from this version.</>
                                )}
                            </>
                        }
                        step="any"
                        value={form.label_threshold}
                        onChange={(event) => onChange("label_threshold", event.target.value)}
                        error={errors.label_threshold}
                    />
                </Col>
                <Col sm={6}>
                    <ConfigField
                        id="config-annotation-threshold"
                        label="Annotation threshold"
                        help={
                            <>
                                Annotations scoring below this are dropped. 0 turns it off.
                                {annotationRecommendation !== null && (
                                    <> Recommended <Button
                                        variant="link"
                                        size="sm"
                                        className="p-0 align-baseline"
                                        onClick={() => onChange("annotation_threshold", String(annotationRecommendation))}
                                    >{formatThreshold(annotationRecommendation)}</Button> from this version.</>
                                )}
                            </>
                        }
                        step="any"
                        value={form.annotation_threshold}
                        onChange={(event) => onChange("annotation_threshold", event.target.value)}
                        error={errors.annotation_threshold}
                    />
                </Col>
```

Compute the two recommendations in the form component, above its `return`:

```jsx
    // Offered, never applied: enforcing a cutoff should be a deliberate act,
    // and this number is per-version, so it would otherwise shift underneath
    // the operator on every republish.
    const labelRecommendation = getThresholds(training, "test", "intent")?.threshold ?? null;
    const annotationRecommendation = getThresholds(training, "test", "slots")?.threshold ?? null;
```

Import it:

```jsx
import { formatThreshold, getThresholds } from "../../../../shared/utils/training";
```

If the config form component does not already receive the published `training`, thread it down from the parent as a prop rather than refetching.

- [ ] **Step 4: Extend the curl snippet**

At line 140 the snippet is built as:

```jsx
        `curl -X POST '${inferUrl}?top=${instance.config?.top ?? 1}'`,
```

Replace with:

```jsx
        `curl -X POST '${inferUrl}?top=${instance.config?.top ?? 1}${
            instance.config?.label_threshold
                ? `&label_threshold=${instance.config.label_threshold}` : ""
        }${
            instance.config?.annotation_threshold
                ? `&annotation_threshold=${instance.config.annotation_threshold}` : ""
        }'`,
```

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: `✓ built in …`, exit 0.

---

### Task 10: The Traffic reference line

**Files:**
- Modify: `src/routes/model/routes/analyse/components/Traffic.jsx:179`, `:222-227`, `:375-395`

**Interfaces:**
- Consumes: `instances` (already fetched in this component) for the deployed config.
- Produces: nothing downstream.

- [ ] **Step 1: Seed the slider from the deployment**

The histogram plots intent confidence for language understanding and entity scores for named entity recognition, so it reads against whichever threshold gates that head. Replace line 179:

```jsx
    const [thresh, setThresh] = useState(0.5);
```

with:

```jsx
    // The slider starts where the deployment actually cuts off, so the
    // low-confidence readout answers "how much is this gate dropping?" rather
    // than an arbitrary hypothetical. Falls back to 0.5 when nothing is
    // enforced, which is where it always used to start.
    const [thresh, setThresh] = useState(0.5);
    const [threshPinned, setThreshPinned] = useState(false);

    const deployed = instances.find((instance) => instance.environment === env);
    const deployedThreshold = ner
        ? deployed?.config?.annotation_threshold
        : deployed?.config?.label_threshold;

    useEffect(() => {
        if (!threshPinned && deployedThreshold) setThresh(deployedThreshold);
    }, [threshPinned, deployedThreshold]);
```

`ner`, `env` and `instances` are all already in scope in this component — confirm with `grep -n 'const ner\|const env\|instances' src/routes/model/routes/analyse/components/Traffic.jsx` before editing, and move the `useState` lines if `deployed` needs to be declared after them.

- [ ] **Step 2: Mark manual changes as pinned**

So the effect does not fight the user, set the flag in the slider's handler (line ~383):

```jsx
                                                onChange={(e) => {
                                                    setThreshPinned(true);
                                                    setThresh(parseFloat(e.target.value));
                                                }}
```

- [ ] **Step 3: Draw the enforced cutoff**

Change the slider's step from `0.1` to `0.01` so it can express a fitted threshold, and add the enforced value to the readout below it. Replace the `<span>` at line ~387:

```jsx
                                            <span>
                                                {below} of {scored} {scoredUnit} ({rate(below, scored)}) below {thresh.toFixed(2)}
                                                {deployedThreshold
                                                    ? ` — enforcing ${formatThreshold(deployedThreshold)}`
                                                    : " — no threshold enforced"}
                                            </span>
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: `✓ built in …`, exit 0.

---

## Verification scripts not embedded in a task

Seven checks appear inline in the tasks above. These three were written during
execution and are recorded here so the whole suite stays regenerable from this
document — the scratch directory they run from is periodically cleared.

### `check_panel_data.mjs`

What the Thresholds panel and the Publish form actually receive: the operating point survives the reader, and every model type x caller head combination resolves to the right head or to nothing.

Create `$SCRATCH/check_panel_data.mjs`:

```js
// What the Thresholds panel and the Publish form actually receive.
import { getThresholds, thresholdRows, formatThreshold }
    from 'file:///Users/varunseth/Documents/git/indic-nlu/src/shared/utils/training.js';

const failures = [];
const check = (name, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
};

const curve = [{ threshold: 0, precision: 0.3, recall: 0.9, f1: 0.45 }];
const LABEL = {
    auc: 0.9, threshold: 0.873421,
    operating: { threshold: 0.873421, tpr: 1, fpr: 0 },
    curve: [{ threshold: 0, tpr: 1, fpr: 1 }],
    labels: { greet: { auc: 0.9, threshold: 0.5, support: 12 } }
};
const ANNOTATION = {
    average_precision: 0.62, threshold: 0.44,
    operating: { threshold: 0.44, precision: 1, recall: 0.5, f1: 0.67 },
    curve, labels: { city: { average_precision: 0.7, threshold: 0.4, support: 30 } }
};
const run = (thresholds) => ({ result: { evaluation: { test: thresholds ? { thresholds } : {} } } });

// The chart marks operating, which must survive the reader intact.
const lu = getThresholds(run({ label: LABEL, annotation: ANNOTATION }), 'test', 'intent');
check('operating passes through', lu.operating, LABEL.operating);
check('operating threshold matches block', lu.operating.threshold, lu.threshold);

// Head selection across every model type x caller combination.
const cases = [
    ['NLU intent', { label: LABEL, annotation: ANNOTATION }, 'intent', 'label'],
    ['NLU slots', { label: LABEL, annotation: ANNOTATION }, 'slots', 'annotation'],
    // A named entity recognition run has no slots toggle, so the panel passes null.
    ['NER null', { annotation: ANNOTATION }, null, 'annotation'],
    // ...but Publish names the label head explicitly, and must get nothing.
    ['NER intent', { annotation: ANNOTATION }, 'intent', null],
    ['TC null', { label: LABEL }, null, 'label'],
    ['TC slots', { label: LABEL }, 'slots', null],
    // A declined head is present as null and must not fall through.
    ['declined label', { label: null, annotation: ANNOTATION }, 'intent', null]
];
for (const [name, thresholds, head, expected] of cases) {
    check(`head ${name}`, getThresholds(run(thresholds), 'test', head)?.kind ?? null, expected);
}

// A run predating the feature reads as absent, never as zero.
check('pre-feature run', getThresholds(run(null), 'test', 'intent'), null);
check('missing split', getThresholds(run({ label: LABEL }), 'train', 'intent'), null);

// The per-class table.
check('rows', thresholdRows(lu).map((row) => [row.label, row.score, row.threshold, row.support]),
    [['greet', 0.9, 0.5, 12]]);
check('empty rows', thresholdRows(null), []);

// A six-decimal cutoff must not collapse to 1.00.
check('formatThreshold keeps precision', formatThreshold(0.9988), '0.9988');
check('formatThreshold rejects rubbish', [null, undefined, NaN, Infinity, 'x', {}].map(formatThreshold),
    ['—', '—', '—', '—', '—', '—']);

if (failures.length) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log('  ' + f));
    process.exit(1);
}
console.log('PANEL DATA CHECKS PASSED');
```

### `check_e2e_evaluate.py`

Trains a tiny model of each type and asserts the shape `evaluate()` actually emits — the only check that exercises the real training path end to end.

Create `$SCRATCH/check_e2e_evaluate.py`:

```python
"""Trains a tiny model of each type and checks evaluate()'s thresholds block."""
import csv, json, os, sys, tempfile, warnings
warnings.filterwarnings('ignore')
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')

from server.models import Model

failures = []
ROWS = [
    ('book a flight to {city: delhi} on {date: monday}', 'book_flight'),
    ('fly me to {city: mumbai} on {date: tuesday}', 'book_flight'),
    ('get me a flight to {city: goa} on {date: friday}', 'book_flight'),
    ('reserve a seat to {city: chennai} on {date: sunday}', 'book_flight'),
    ('what is the weather in {city: delhi}', 'weather'),
    ('weather for {city: mumbai} on {date: monday}', 'weather'),
    ('how hot is {city: goa} today', 'weather'),
    ('tell me the forecast for {city: chennai}', 'weather'),
]
EXPECTED = {
    'text_classification': {'label'},
    'named_entity_recognition': {'annotation'},
    'natural_language_understanding': {'label', 'annotation'},
}


def dataset(directory, kind):
    with open(os.path.join(directory, 'utterances.csv'), 'w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['utterances', 'labels'])
        for text, intent in ROWS * 3:
            writer.writerow([text, intent])
    if kind == 'natural_language_understanding':
        with open(os.path.join(directory, 'slots.json'), 'w') as handle:
            json.dump({'book_flight': {'city': 'location', 'date': 'datetime'},
                       'weather': {'city': 'location', 'date': 'datetime'}}, handle)
    return directory


for kind in EXPECTED:
    with tempfile.TemporaryDirectory() as directory:
        architecture = ('recurrent_neural_network' if kind == 'named_entity_recognition'
                        else 'deep_neural_network')
        model = Model.create(kind, architecture=architecture)
        model.train(dataset(directory, kind), epochs=1, batch_size=4, early_stopping=False)
        result = model.evaluate(model.X_test, model.y_test)

        block = result.get('thresholds')
        if block is None:
            failures.append('%s: no thresholds block' % kind)
            continue
        if set(block) != EXPECTED[kind]:
            failures.append('%s: keys %s, expected %s' % (kind, sorted(block), sorted(EXPECTED[kind])))

        for head, scored in block.items():
            if scored is None:
                print('  %s/%s: declined (too little held-out data) — allowed' % (kind, head))
                continue
            summary = 'auc' if head == 'label' else 'average_precision'
            for key in (summary, 'threshold', 'operating', 'curve', 'labels'):
                if key not in scored:
                    failures.append('%s/%s: missing %s' % (kind, head, key))
            if len(scored.get('curve', [])) != 101:
                failures.append('%s/%s: curve has %d points' % (kind, head, len(scored.get('curve', []))))
            if not 0.0 <= scored['threshold'] <= 1.0:
                failures.append('%s/%s: threshold %r out of range' % (kind, head, scored['threshold']))
            # The chart marks operating, so it must agree with the cutoff.
            operating = scored.get('operating')
            if operating is not None and operating['threshold'] != scored['threshold']:
                failures.append('%s/%s: operating %r != threshold %r'
                                % (kind, head, operating['threshold'], scored['threshold']))
            print('  %s/%s: %s=%.4f threshold=%s labels=%d'
                  % (kind, head, summary, scored[summary], scored['threshold'], len(scored['labels'])))

        # The artifact is written as JSON, so the whole block must serialize.
        try:
            json.dumps(result)
        except TypeError as error:
            failures.append('%s: evaluate() output is not JSON-serializable: %s' % (kind, error))

        for key in ('accuracy', 'report', 'confusion_matrix'):
            if key not in result:
                failures.append('%s: top-level %s disappeared' % (kind, key))

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('END-TO-END EVALUATE OK')
```

### `check_infer_threshold.py`

Drives the real infer endpoint with a stubbed registry and a minted API key, reading the thresholds off the input envelope. The clamp is a closure inside the view and cannot be imported, so a reimplementation would prove nothing.

Create `$SCRATCH/check_infer_threshold.py`:

```python
"""
Drives the real infer view and reads the thresholds off the input envelope.

The clamp is a closure inside the view, so it cannot be imported and tested in
isolation — a reimplementation of it would prove nothing about the code that
actually runs. So the registry is stubbed, a real API key is minted, and the
endpoint is called for real: what is asserted is what a request produces.
"""
import json
import sys

from jwt import encode

from server import auth, create_triton_server
from server.utils.registry import Route
from server.views.triton import inference as view

failures = []
pushed = {}

app = create_triton_server()
app.config['ENVIRONMENT'] = 'development'

API_KEY = encode({'model_id': '1'}, app.config['SECRET_KEY'], algorithm='HS256')
ROUTE = Route(path='models/1/0.6', model_type='natural_language_understanding',
              api_key=API_KEY, cache=False, top=1,
              label_threshold=0.30, annotation_threshold=0.70)


class StubRegistry:
    def route(self, model_id):
        return ROUTE

    def _output(self, model_id, key):
        return 'outputs:%s:%s' % (model_id, key)

    def _inputs(self, model_id):
        return 'inputs:%s' % model_id

    def _telemetry(self):
        return 'telemetry:development'

    def alive(self, model_id):
        return True

    def get(self, keys, pull=False):
        return {}

    def push(self, queue, items):
        # The view also pushes telemetry after responding, down the same
        # method; only the input queue carries the envelope under test.
        if queue != self._inputs('1'):
            return
        pushed['items'] = [json.loads(item.decode('utf-8')) for item in items]

    def wait(self, keys, timeout, interval, pull=False):
        return {key: json.dumps({'input': 'x', 'intents': []}).encode('utf-8') for key in keys}


# The auth decorator resolves its own registry, so both call sites are stubbed.
stub = StubRegistry()
view.registry_for = lambda environment: stub
auth.registry_for = lambda environment: stub
client = app.test_client()


def call(query):
    pushed.clear()
    response = client.post('/api/infer/1%s' % query, json={'inputs': ['book a flight']},
                           headers={'Authorization': 'Bearer %s' % API_KEY})
    if response.status_code != 200:
        failures.append('%r -> HTTP %s %s' % (query, response.status_code,
                                              response.get_data(as_text=True)[:120]))
        return None
    if not pushed.get('items'):
        failures.append('%r -> nothing pushed onto the input queue' % query)
        return None
    return pushed['items'][0]


def check(query, field, expected):
    envelope = call(query)
    if envelope is None:
        return
    actual = envelope.get(field)
    # NaN is never equal to itself, so `actual != actual` catches it.
    if actual != expected or actual != actual:
        failures.append('%r -> %s = %r, expected %r' % (query, field, actual, expected))


check('', 'label_threshold', 0.30)
check('', 'annotation_threshold', 0.70)
check('?label_threshold=nan', 'label_threshold', 0.30)
check('?annotation_threshold=nan', 'annotation_threshold', 0.70)
check('?label_threshold=NaN', 'label_threshold', 0.30)
check('?label_threshold=inf', 'label_threshold', 1.0)
check('?label_threshold=-inf', 'label_threshold', 0.0)
check('?label_threshold=-5', 'label_threshold', 0.0)
check('?label_threshold=5', 'label_threshold', 1.0)
check('?label_threshold=abc', 'label_threshold', 0.30)
check('?label_threshold=0.42', 'label_threshold', 0.42)
check('?label_threshold=0', 'label_threshold', 0.0)

if failures:
    print('FAILURES:')
    for failure in failures:
        print('  ' + failure)
    sys.exit(1)
print('INFER THRESHOLD CHECKS PASSED')
```

---

## Final verification

- [ ] **Step 1: Every backend file compiles**

```bash
./venv/bin/python -m compileall -q server/
```

Expected: no output, exit 0.

- [ ] **Step 2: Every check still passes**

```bash
export SCRATCH=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/45d239bc-64c4-4a52-9d00-4db3f8e9ce78/scratchpad
for check in thresholds builder evaluate gating options cache_key; do
  PYTHONPATH=. ./venv/bin/python $SCRATCH/check_$check.py || echo "FAILED: $check"
done
```

Expected: six PASSED lines, no `FAILED:`.

- [ ] **Step 3: The frontend builds**

```bash
npm run build
```

Expected: `✓ built in …`, exit 0.

- [ ] **Step 4: No retired vocabulary crept in**

"span" is retired as a name for a labelled region of text. It is still legitimate as the existing function names `tags_to_spans` / `spans_to_tags`, as Python's `match.span()`, and as the JSX `<span>` element — so the check excludes those and looks only for the concept.

```bash
grep -rnE '\bspans?\b' server/models/thresholds.py src/routes/model/routes/history/ThresholdsPanel.jsx \
  | grep -vE 'tags_to_spans|spans_to_tags|\.span\(\)|</?span'
```

Expected: no output.

- [ ] **Step 5: End-to-end on a real model**

Train a small language understanding model through the UI, open History → Thresholds, and confirm both heads render a curve with a marked operating point. Then publish it with the recommended annotation threshold applied and confirm on the Test page that low-confidence slots are gone. The repository owner runs the UI checks — do not attempt to drive the browser.

- [ ] **Step 6: Report, do not commit**

Summarise what changed and what the checks printed. Leave every change uncommitted; the repository owner commits their own work.
