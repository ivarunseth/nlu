// Turns what the training inspector renders into files the user can take away.
// The tables on screen are the source of truth here: a downloaded report or
// matrix has to line up cell-for-cell with the tab it came from, so these build
// from the same `reportRows` / matrix shapes the views read.

import { reportRows, annotationRows } from './training';

// RFC 4180: quote a field whenever it carries a delimiter, a quote or a newline,
// and double the quotes inside. Label names come from user-authored intents and
// entities, so commas and quotes do turn up.
const escapeCell = (value) => {
    const cell = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};

export const toCsv = (rows) => rows.map((row) => row.map(escapeCell).join(',')).join('\n');

const csvBlob = (rows) => new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });

// The dataset tab already holds the CSV the server sent, so it ships verbatim
// rather than being rebuilt from parsed rows.
export const rawCsvBlob = (text) => new Blob([text ?? ''], { type: 'text/csv;charset=utf-8' });

export const textBlob = (text) => new Blob([text ?? ''], { type: 'text/plain;charset=utf-8' });

export const jsonBlob = (value) => new Blob([JSON.stringify(value ?? {}, null, 2)], {
    type: 'application/json'
});

// `<model>_v<version>_<suffix>`, matching the naming the artifact download
// already uses. Model names are free text, so anything awkward in a filename
// collapses to an underscore.
export const trainingFilename = (model, training, suffix) => {
    const name = (model?.name || 'model').replace(/[^\w.-]+/g, '_');
    return `${name}_v${training?.version ?? '0'}_${suffix}`;
};

// Same columns as the ReportTable, with the summary rows sklearn appends
// (accuracy / macro avg / weighted avg) left in place — they are part of the
// report and the table shows accuracy too.
export const reportCsv = (report) => csvBlob([
    ['label', 'precision', 'recall', 'f1-score', 'support'],
    ...reportRows(report).map((row) => [row.label, row.precision, row.recall, row.f1, row.support])
]);

// Exact-match metrics per slot (language understanding) or entity (named entity
// recognition), with the overall row last so it reads like the table's footer.
export const annotationCsv = (metrics, unit) => csvBlob([
    [unit, 'precision', 'recall', 'f1-score', 'support'],
    ...annotationRows(metrics).map((row) => [row.label, row.precision, row.recall, row.f1, row.support]),
    ...(metrics?.overall ? [[
        'overall',
        metrics.overall.precision,
        metrics.overall.recall,
        metrics.overall.f1,
        metrics.overall.support
    ]] : [])
]);

// Predicted labels across the header, actual labels down the first column —
// the same orientation as the on-screen matrix.
export const confusionMatrixCsv = (matrix, labels) => csvBlob([
    ['actual \\ predicted', ...labels],
    ...matrix.map((row, index) => [labels[index] ?? index, ...row])
]);

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
