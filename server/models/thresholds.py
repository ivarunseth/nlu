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
    predictions and never in the gold data has no recall denominator, so it is
    declined and omitted.
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
        scores = _annotation_scores(subset_gold, subset_predicted)
        if scores:
            curves[name] = {
                'average_precision': scores['average_precision'],
                'threshold': scores['threshold'],
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
