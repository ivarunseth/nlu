// Training-result helpers shared by the History, Publish, Test and Analyse
// pages so every page computes a metric the same way.

// Joint (NLU) runs evaluate two heads. The intent head is mirrored at the top
// of the split so a joint run reads exactly like a classifier; the slot head
// lives under `slots`. `head` is ignored by single-head model types, which
// never carry a `slots` block.
//
// The slot head's report is per tag, so it stays the source for the tag matrix's
// axis labels even though the metrics table now scores whole annotations. Runs
// trained before the token view was demoted keep it directly on `slots`.
export const getReport = (result, split, head = null) => {
    const block = result?.evaluation?.[split];
    if (head === 'slots') {
        return block?.slots?.tokens?.report ?? block?.slots?.report ?? null;
    }
    return block?.report ?? (split === 'test' ? result?.report : null);
};

export const getTrainingAccuracy = (training) => {
    const result = training?.result;
    if (!result) return null;
    return result.accuracy ?? result.evaluation?.test?.accuracy ?? null;
};

// Final train-split accuracy, only available once the run has evaluated.
export const getTrainingTrainAccuracy = (training) => (
    training?.result?.evaluation?.train?.accuracy ?? null
);

// Latest value of a live metric series streamed into result.history while a
// run is in progress (e.g. 'accuracy' for the running train accuracy).
export const getLatestHistoryMetric = (training, key) => {
    const series = training?.result?.history?.[key];
    return Array.isArray(series) && series.length ? series[series.length - 1] : null;
};

// Keras names a metric after the head that produced it on a joint (NLU) model,
// so those runs log 'intents_accuracy' and 'slots_accuracy' and never a bare
// 'accuracy' — a single-key lookup reports nothing for them.
const LIVE_ACCURACY_KEYS = ['accuracy', 'intents_accuracy', 'slots_accuracy'];

// Train accuracy of the epoch most recently streamed in, whatever the run
// happens to call it.
export const getLiveAccuracy = (training) => {
    for (const key of LIVE_ACCURACY_KEYS) {
        const value = getLatestHistoryMetric(training, key);
        if (value !== null) return value;
    }
    return null;
};

// Epoch number the history plot would currently be drawing up to — the length
// of its longest series, matching how the chart numbers its x-axis.
export const getTrainingEpochs = (training) => {
    const history = training?.result?.history;
    if (!history || typeof history !== 'object') return null;
    const lengths = Object.values(history).filter(Array.isArray).map((series) => series.length);
    return lengths.length ? Math.max(...lengths) : null;
};

// Runs trained before the slot head gained a matrix have no matrix at all, so
// this is null for them and the view falls back to its empty state. The tag
// matrix is token-level either way — it is the diagnostic that shows B-/I-
// confusion, which is only visible per token.
export const getConfusionMatrix = (training, split, head = null) => {
    const block = training?.result?.evaluation?.[split];
    if (head === 'slots') {
        const slots = block?.slots;
        return slots?.tokens?.confusion_matrix ?? slots?.confusion_matrix ?? null;
    }
    return block?.confusion_matrix
        ?? (split === 'test' ? training?.result?.confusion_matrix : null);
};

// Exact-match metrics over whole annotations: `slots` on a language
// understanding run, `entities` on a named entity recognition one. An
// annotation counts only when its name and both boundaries match, which is what
// the product experiences — a slot is filled with the matched text, so being one
// word out yields the wrong value, not a partly-right one.
//
// Reads both the current shape (scores on the block, per name under `labels`)
// and the shape stored before it (scores nested under `entity`, per name keyed
// `slots`). Stored evaluations are never rewritten, so both must keep working.
// Returns `{ overall, labels }` or null.
export const getAnnotationMetrics = (training, split) => {
    const evaluation = training?.result?.evaluation?.[split];
    const block = evaluation?.slots ?? evaluation?.entities;
    if (!block) return null;

    const legacy = block.entity;
    const scores = legacy ?? block;
    const labels = (legacy ? legacy.slots : block.labels) ?? {};
    if (scores?.f1 === undefined && !Object.keys(labels).length) return null;

    return {
        overall: {
            precision: scores?.precision ?? null,
            recall: scores?.recall ?? null,
            f1: scores?.f1 ?? null,
            support: scores?.support ?? null
        },
        labels
    };
};

// Rows for the annotation metrics table, sorted by support so the names that
// carry the dataset lead.
export const annotationRows = (metrics) => (
    Object.entries(metrics?.labels || {})
        .filter(([, scores]) => scores && typeof scores === 'object')
        .map(([label, scores]) => ({
            label,
            precision: scores.precision,
            recall: scores.recall,
            f1: scores.f1,
            support: scores.support
        }))
        .sort((a, b) => (b.support ?? 0) - (a.support ?? 0) || a.label.localeCompare(b.label))
);

// The entity roll-up of a language understanding run's slot metrics — the same
// annotations re-tallied by the entity each slot maps to. Null when the run
// carries no mapping.
export const getEntityRollup = (training, split) => {
    const evaluation = training?.result?.evaluation?.[split];
    const block = evaluation?.slots;
    return (block?.entities ?? block?.entity?.entities) ?? null;
};

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

// Whether this run evaluated a slot head, i.e. whether the intent/slots toggle
// is worth showing at all.
export const hasSlotMetrics = (training) => Boolean(
    training?.result?.evaluation?.test?.slots
    || training?.result?.evaluation?.train?.slots
);

export const reportRows = (report) => {
    if (!report || typeof report === 'string') return [];
    return Object.entries(report)
        .filter(([, metrics]) => metrics && typeof metrics === 'object')
        .map(([label, metrics]) => ({
            label,
            precision: metrics.precision,
            recall: metrics.recall,
            f1: metrics['f1-score'],
            support: metrics.support
        }));
};

export const pct = (value) => `${(value * 100).toFixed(1)}%`;

// Parse the "dd/mm/yyyy - HH:MM:SS" local-time strings the API returns into a Date.
export const parseApiDate = (value) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2}):(\d{2})$/.exec(value || "");
    if (!match) return null;
    const [, day, month, year, hour, minute, second] = match;
    return new Date(+year, +month - 1, +day, +hour, +minute, +second);
};

// Wall-clock runtime of a finished run, in seconds, from when the record was
// created to when the task completed. Null until both timestamps exist.
export const getTrainingRuntime = (training) => {
    const start = parseApiDate(training?.created_at);
    const end = parseApiDate(training?.date_done);
    if (!start || !end) return null;
    const seconds = (end - start) / 1000;
    return seconds >= 0 ? seconds : null;
};

// Wall-clock seconds since a still-running run was created. Callers pass the
// current time so a ticking display re-renders off their own clock.
export const getTrainingElapsed = (training, now = Date.now()) => {
    const start = parseApiDate(training?.created_at);
    if (!start) return null;
    const seconds = (now - start) / 1000;
    return seconds >= 0 ? seconds : null;
};

// Human-readable duration, e.g. "45 secs", "2 mins 5 secs", "1 hr 30 mins".
// Seconds are dropped once the duration reaches an hour to keep it compact.
export const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined) return null;
    const total = Math.round(seconds);
    if (total < 60) return `${total} sec${total === 1 ? '' : 's'}`;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const parts = [];
    if (hours) parts.push(`${hours} hr${hours === 1 ? '' : 's'}`);
    if (minutes) parts.push(`${minutes} min${minutes === 1 ? '' : 's'}`);
    if (!hours && secs) parts.push(`${secs} sec${secs === 1 ? '' : 's'}`);
    return parts.join(' ');
};
