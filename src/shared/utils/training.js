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

// Wall-clock runtime of a finished run, in seconds, from when the record was
// created to when the task completed. Null until both timestamps exist.
export const getTrainingRuntime = (training) => {
    const start = parseApiDate(training?.created_at);
    const end = parseApiDate(training?.date_done);
    if (!start || !end) return null;
    const seconds = (end - start) / 1000;
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
