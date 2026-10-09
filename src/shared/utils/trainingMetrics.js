// The metric vocabulary shared by the training form: which metrics a run can
// track, and which early-stopping monitors that selection makes available.
// Mirrors server/models/metrics.py — keep the two in step.

// Selectable metrics, in the order the form lists them (matches METRIC_NAMES
// on the server). Accuracy alone is a poor guide on a skewed dataset, so the
// rest are opt-in per run.
export const METRIC_OPTIONS = [
    ['accuracy', 'Accuracy'],
    ['f1', 'F1 score'],
    ['precision', 'Precision'],
    ['recall', 'Recall'],
    ['mcc', 'Matthews correlation coefficient']
];

export const METRIC_LABELS = Object.fromEntries(METRIC_OPTIONS);

export const METRIC_HELP = {
    accuracy: 'Share of predictions that are correct.',
    f1: 'Harmonic mean of precision and recall, averaged over classes.',
    precision: 'Of everything predicted as a class, how much belonged to it.',
    recall: 'Of everything belonging to a class, how much was found.',
    mcc: 'Correlation between predictions and targets, from -1 to 1. Stays honest on imbalanced data.'
};

// Joint (NLU) models label every metric with the head that produced it.
export const NLU_HEADS = [['intents', 'Intent'], ['slots', 'Slot']];

// Mirrors normalize_metrics() on the server: unknown names are dropped, order
// follows the registry rather than the caller, and an empty selection falls
// back to accuracy — so the form and the run always agree on what is tracked.
export const normalizeMetricNames = (value) => {
    const chosen = new Set(Array.isArray(value) ? value : []);
    const names = METRIC_OPTIONS.map(([name]) => name).filter((name) => chosen.has(name));
    return names.length ? names : ['accuracy'];
};

// Early stopping can watch the loss or any metric the run actually tracks, so
// the monitor options follow the `metrics` selection. Joint models log a metric
// per head — 'val_intents_f1', never a bare 'val_f1' — so passing `heads`
// generates the per-head names Keras really emits.
export const monitorOptions = (params, heads = null) => {
    const selected = normalizeMetricNames(params?.metrics);
    const tracked = heads
        ? heads.flatMap(([head, headLabel]) => selected.map((name) => [
            `${head}_${name}`,
            `${headLabel} ${METRIC_LABELS[name].toLowerCase()}`
        ]))
        : selected.map((name) => [name, METRIC_LABELS[name].toLowerCase()]);

    return [['loss', 'loss'], ...tracked].flatMap(([value, label]) => [
        [value, label],
        [`val_${value}`, `validation ${label}`]
    ]);
};

// A registry field's `options` may be a static array or a function of the
// current parameters (as `monitor` is, since it depends on `metrics`).
export const optionsFor = (metadata, params) => (
    typeof metadata.options === 'function' ? metadata.options(params) : metadata.options
);
