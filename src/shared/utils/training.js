// Training-result helpers shared by the History, Publish, Test and Analyse
// pages so every page computes a metric the same way.

export const getReport = (result, split) => (
    result?.evaluation?.[split]?.report
    ?? (split === 'test' ? result?.report : null)
);

export const getTrainingAccuracy = (training) => {
    const result = training?.result;
    if (!result) return null;
    return result.accuracy ?? result.evaluation?.test?.accuracy ?? null;
};

export const getConfusionMatrix = (training, split) => (
    training?.result?.evaluation?.[split]?.confusion_matrix
    ?? (split === 'test' ? training?.result?.confusion_matrix : null)
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
