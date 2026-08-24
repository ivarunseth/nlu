# Training inspector improvements — design

Date: 2026-07-25
Scope: `src/routes/model/routes/history/History.jsx`, `src/shared/utils/training.js`,
`server/models/natural_language_understanding/base.py`

## Problem

Opening a training version is slow, the inspector exposes no way to take anything
out of it except the plots, joint (NLU) runs only ever show their intent head, and
the metric strip shows a spinner instead of the accuracy that is already streaming
in.

## 1. The Data tab must not block the page

`TrainingVersion`'s load effect awaits, in series:

1. `GET /trainings/:id?extended=1`
2. `GET /trainings?extended=1&per_page=100` — materializes every run's Celery result
3. `GET /trainings/:id/data` and the same for the previous version — blob storage

and only then clears `loading`, so the metric strip and every other tab wait on the
two slowest steps. The `SimpleDiffViewer` LCS (O(n·m) over the two CSVs) then runs
on mount.

**Design.** Split the effect in two:

- Phase A, tracked by `loading`: fetch the training alone. The metric strip and the
  inspector render as soon as it resolves.
- Phase B, tracked by `dataLoading`: fetch the list, resolve the previous version,
  then fetch both CSVs. Only the Data tab waits on it, showing a centred spinner.

An aborted/superseded navigation must not write phase-B state over a newer version's,
so both phases are guarded by a `cancelled` flag in the effect cleanup.

Add `mountOnEnter` to the inspector `Tabs` so Plots (recharts), Reports and Matrix
(large tables) do not mount until first selected. Panes stay mounted afterwards, so
revisiting a tab does not recompute.

## 2. Per-tab downloads

New module `src/shared/utils/trainingDownloads.js`:

- `toCsv(rows)` — RFC-4180 quoting.
- `reportCsv(report)` — label, precision, recall, f1-score, support.
- `confusionMatrixCsv(matrix, labels)` — predicted labels as the header row, each
  row prefixed with its actual label.
- `trainingFilename(model, training, suffix)` — `<model>_v<version>_<suffix>`.

A shared `DownloadButton` renders in each tab's toolbar:

| Tab        | File                                                |
| ---------- | --------------------------------------------------- |
| Data       | the fetched `utterances.csv`, verbatim               |
| Layers     | `summary.txt`                                        |
| Parameters | `parameters.json` (`training.kwargs`)                |
| Plots      | unchanged — CSV + PNG already exist                  |
| Reports    | CSV of the report currently on screen                |
| Matrix     | CSV of the matrix currently on screen                |

Reports and Matrix download whatever split/head the toolbar has selected, so the
file always matches what the user is looking at.

## 3. Intent and slots for joint models

`evaluate()` in `server/models/natural_language_understanding/base.py` returns the
intent metrics at the top level (`accuracy`, `report`, `confusion_matrix`) plus a
`slots` block holding a token-level report and entity-level scores — but no slot
confusion matrix.

**Backend.** Add `slots.confusion_matrix`, computed over the word-aligned IOB tags
already flattened into `y_slots_true_flat` / `y_slots_pred_flat`. Labels stay
derived from the report keys, exactly as the intent matrix does today. Runs trained
before this change have no slot matrix and render the existing empty state.

**Frontend.** `getReport(result, split, head)` and
`getConfusionMatrix(training, split, head)` take an optional head; `slots` reads
`evaluation[split].slots.*`, anything else keeps the current intent/top-level path,
so classification and NER are unaffected. `hasSlotMetrics(training)` reports whether
the head toggle should appear.

The Reports and Matrix panels replace their `Tabs` with a toolbar carrying
**Train | Test** and, when slot metrics exist, **Intent | Slots**.

## 4. Live train accuracy in the metric strip

Joint runs log `intents_accuracy` and `slots_accuracy`; there is never a bare
`accuracy` key, so `getLatestHistoryMetric(training, 'accuracy')` returns null for
every NLU run and the strip shows only its spinner. Add `getLiveAccuracy(training)`
falling back `accuracy` → `intents_accuracy` → `slots_accuracy`, and use it in both
the metric strip and the trainings table, which has the same bug.

While a run is active the card also shows the epoch count (the length of the longest
history series) beside the value, and keeps the spinner.

## 5. Elapsed card

A sixth card in the strip. Finished runs show `formatDuration(getTrainingRuntime())`,
the same value as the table's Runtime column. Active runs show
`now − created_at`, re-rendered on a one-second interval that is cleared as soon as
the run leaves an active status.

## Out of scope

The trainings table's download button requests `?format=zip`, but that branch is
commented out in `server/views/api/trainings.py`, so it downloads a JSON body named
`.zip`. Left alone.

## Verification

`python -m py_compile` on the touched Python file and `npm run build` for the
frontend. There is no meaningful test suite in this repo.
