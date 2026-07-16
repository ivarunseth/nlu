# PRD — Analyse page (Model view)

| | |
|---|---|
| **Status** | Draft for review |
| **Owner** | Varun Seth |
| **Last updated** | 2026-07-06 |
| **Surface** | `src/routes/model/` → new `analyse` route |
| **Related pages** | Build, History, Test, Publish (all under `src/routes/model/routes/`) |
| **Audience** | Product, ML engineers, SRE / operators, stakeholders |

---

## 1. Summary

The Model view already exposes a fifth navigation tab, **Analyse** (`Activity` icon), but it routes to nothing — the nav link is present in `src/routes/model/Model.jsx` while the `<Routes>` block has no matching `<Route path="analyse">`. Clicking it renders an empty view.

This document specifies the Analyse page: a single destination that answers *"is this model healthy, and is it getting better or worse?"* across three lifecycles — the **dataset** it learns from, the **trained versions** it produces, and the **live deployments** that serve real traffic — plus an **active-learning** loop that turns production traffic back into labelled training data.

Analyse is deliberately an *insights and monitoring* surface. It reads and aggregates; it does not author labels (Build), inspect a single run (History), send manual queries (Test), or manage deployments (Publish). It sits on top of all of them.

---

## 2. Background & problem

The app supports three model types — `text_classification`, `named_entity_recognition`, and `natural_language_understanding` (`server/config.py` → `ALLOWED_MODELS`) — and a lifecycle of: author a dataset → train versions → deploy to environments → serve predictions.

Today that lifecycle is covered by four pages, each intentionally narrow:

| Page | Route | What it does | What it does **not** do |
|---|---|---|---|
| **Build** | `build` | Authors the dataset: labels, utterances, CSV/TSV import & export; starts a training run. | No metrics; no view of dataset *health* (balance, duplicates, coverage). |
| **History** | `history`, `history/:trainingId` | Deep-dives **one** training run: metric strip, loss/accuracy plots, per-label precision/recall/F1 reports, confusion matrix, model summary, parameters, version-to-version data diff, traceback. The list view (`HistoryMetricStrip`) already shows aggregate totals — best accuracy + its version, latest version, succeeded count — and per-version accuracy in the versions table. | No cross-version **trend charts**, per-label F1 movement, aggregated confusions, or objective-ranked best-version pick; nothing about live traffic. |
| **Test** | `test` | Deploys a version to `development`, sends ad-hoc queries, compares predictions across environments. | Measures latency **client-side only** (`performance.now()`); nothing is stored or aggregated. |
| **Publish** | `publish` | Promotes versions across environments; manages API keys, inference endpoints, `curl` snippets, and deployment config. | Shows deployment *state*, not deployment *behaviour* (volume, latency, errors, confidence over time). |

The gaps between these pages are exactly the questions users ask most:

- **Product / stakeholders:** How big and how balanced is the dataset? Is accuracy trending up across versions? Which labels are weakest?
- **ML engineers:** Which pairs of labels does the model confuse *consistently* (not just in one run)? Which version should I promote? Where should I add data?
- **SRE / operators:** How much traffic is each environment serving, at what latency and error rate? Are we seeing a spike in low-confidence or failed predictions? Is the live model drifting from its evaluation baseline?

None of these has a fully realized home. History answers them for a *single* run and surfaces a couple of aggregates (best accuracy, latest version) on its list view; nothing charts trends *across* runs, ranks a best version by a stated objective, or shows anything for *live* traffic. Analyse fills that gap.

A critical constraint shapes the plan: **predictions are not persisted anywhere today.** The infer path (`server/views/triton/inference.py`) pushes a request onto a Redis queue; the serving loop (`server/tasks/inference.py`) pops a batch, predicts, and writes the result back to Redis with a short TTL (`INFERENCE_OUTPUT_TTL`, default 300s). The relational schema (`server/database.py`) contains only `User`, `Model`, `Label`, `Utterance`, `Training`, `Instance`, and `Environment` — there is **no prediction log**. Therefore dataset and model-quality analytics can ship on existing data, but production telemetry requires new capture infrastructure. The phasing in §9 reflects this.

---

## 3. Goals & non-goals

### Goals

1. Give every persona a single, glanceable answer to "is this model healthy?" scoped to the current model.
2. Surface **dataset health** (size, balance, duplication, coverage) so quality problems are caught before training.
3. Surface **cross-version model quality** (accuracy/F1 trends, per-label movement, persistent confusions, best-version recommendation) — the aggregate History cannot show.
4. Surface **production telemetry** (throughput, latency, error rate, confidence distribution, per-environment) for operational monitoring.
5. Close the loop with **active learning**: review real predictions and promote useful ones into the dataset as labelled utterances.
6. Reuse existing conventions: React Router lazy routes, `ModelContext` / `UserContext` / `SocketContext`, Bootstrap + `recharts`, and the `SectionCard` component family, so the page feels native.

### Non-goals

- Not a replacement for History's single-run deep dive, Test's manual querying, or Publish's deployment controls.
- Not a general BI tool: metrics are scoped to one model, not cross-model or org-wide (a future dashboard could aggregate).
- Not an experiment-tracking system (hyperparameter sweeps, run comparison matrices) beyond the version trends described here.
- Phase 1 does not require any change to the serving hot path.

---

## 4. Personas & user stories

**P1 — Model builder (ML engineer).** Owns dataset and training quality.
- As a builder, I want to see utterances-per-label so I can spot class imbalance before it hurts accuracy.
- As a builder, I want accuracy and macro-F1 plotted across every version so I know whether my changes are helping.
- As a builder, I want the label pairs that are confused across the *last N* versions so I know where to add or clean data.
- As a builder, I want to be told which trained version is the strongest so I can promote it with confidence.

**P2 — SRE / operator.** Owns live reliability.
- As an operator, I want request volume, p50/p95/p99 latency, and error rate per environment over a time range.
- As an operator, I want an alert-worthy view of failed predictions and their error types (the serving loop already tags failures with `error` + `type`).
- As an operator, I want to see if live confidence has dropped relative to the version's evaluation baseline (drift signal).

**P3 — Product owner / stakeholder.** Owns outcomes, not internals.
- As a stakeholder, I want a plain-language health summary (dataset size, best accuracy, live traffic, top weak label) without reading a confusion matrix.
- As a stakeholder, I want to export a chart or a CSV to drop into a report.

**P4 — Reviewer / labeler (active learning).**
- As a reviewer, I want to see low-confidence and failed production inputs so I can correct and add them to the dataset.
- As a reviewer, I want one click to send a reviewed utterance to the right label in Build.

---

## 5. Success metrics

| Metric | Target |
|---|---|
| Adoption | ≥ 60% of active models have their Analyse page opened within 30 days of a training or deployment. |
| Time-to-insight | A user can answer "is accuracy trending up?" and "what's the weakest label?" within 10 seconds of page load. |
| Active-learning yield (Phase 3) | ≥ 15% of reviewed production inputs are promoted into the dataset. |
| Operational value (Phase 2) | ≥ 1 production incident per quarter is detected via the latency/error/confidence panels before a user report. |
| Trust | < 2% of sessions report a metric on Analyse that disagrees with History for the same version (they must reconcile exactly). |

---

## 6. Where Analyse fits (information architecture)

Analyse is the model's **dashboard**. It is organized as one page with a sticky filter bar and four sub-sections, surfaced as pills/tabs consistent with the `Tabs`/`Nav` pattern already used in History and Test:

```
/models/:modelId/analyse
├── Filter bar: [version range ▾] [environment ▾] [time range ▾]   (context-aware; hides filters a sub-tab doesn't use)
├── Overview     ← the glanceable health summary (all personas land here)
├── Dataset      ← composition & quality (P1, P3)
├── Model        ← cross-version quality & confusions (P1, P3)
├── Production   ← live telemetry (P2, P3)   [Phase 2]
└── Review       ← active-learning queue (P4) [Phase 3]
```

The **Overview** tab is the default and is composed of the single most important card from each of the other tabs, so the common question ("how's my model?") is answered without navigation. Each Overview card links to its full tab.

---

## 7. Functional requirements

Each requirement is tagged with its data source: **[existing]** = derivable from data already in the DB or task results today; **[new]** = requires new capture/storage described in §8. This tagging drives the phasing in §9.

### 7.1 Overview tab

| # | Requirement | Source |
|---|---|---|
| OV-1 | A health strip mirroring the `MetricStrip` pattern in History: dataset size (utterances / labels), number of trained versions, best accuracy + its version, currently-deployed version(s) per environment. (Best accuracy + version already appear on History's list view via `HistoryMetricStrip`; Analyse re-surfaces them as the model's front door and adds dataset size and per-environment deployment, which History does not show. Compute via the shared helpers per §10 so the numbers reconcile exactly.) | [existing] |
| OV-2 | A one-line, plain-language summary auto-generated from the metrics (e.g. "142 utterances across 6 labels; best version v0.8 at 91.2% test accuracy; weakest label `refund` at 0.71 F1; production serving v0.7."). Aimed at P3. | [existing] |
| OV-3 | A "needs attention" list: imbalance warnings, labels below an F1 threshold, a deployed version that was retrained after deployment (the "stale" condition Test already computes), and — Phase 2 — elevated error/latency. | [existing] + [new] |
| OV-4 | Each card deep-links to the corresponding full sub-tab and, where relevant, to History for a specific version. | [existing] |

### 7.2 Dataset tab (P1, P3)

Reads labels and utterances via the existing endpoints (`/api/models/:id/labels`, `/api/models/:id/labels/:labelId/utterances`) or a new aggregation endpoint (§8) to avoid N+1 fetches.

| # | Requirement | Source |
|---|---|---|
| DS-1 | **Label distribution** bar chart — utterances per label, sortable, with a highlighted min/max and a computed imbalance ratio (max class ÷ min class). | [existing] |
| DS-2 | **Imbalance warning** when the ratio exceeds a threshold (default 10:1) or any label has fewer than *k* examples (default 5), echoing what typically breaks `test_split`/`validation_split` at training time. | [existing] |
| DS-3 | **Dataset totals**: total utterances, total labels, mean/median utterances per label, and empty labels (0 utterances). | [existing] |
| DS-4 | **Duplicate & near-duplicate detection**: exact duplicates within/across labels, and (best-effort, client- or server-side) near-duplicates. Cross-label duplicates are flagged as likely labelling conflicts. | [existing] |
| DS-5 | **Text length distribution** (characters / whitespace tokens) as a histogram, to catch truncation risk against the configured `sequence_length` / `max_seq_len`. | [existing] |
| DS-6 | **Vocabulary snapshot**: unique token count and top tokens overall and per label (useful for Indic scripts where tokenization quirks surface here). | [existing] |
| DS-7 | **Coverage vs training**: compare the current dataset against the snapshot a given version was trained on (`/api/models/:id/trainings/:id/data` returns that CSV), i.e. "N utterances added since v0.7". That endpoint 404s if the stored CSV has been evicted, so this panel needs an empty state for "training snapshot unavailable". | [existing] |
| DS-8 | Export any table/chart to CSV/PNG, reusing the `downloadBlob` util and the PNG-from-SVG approach already implemented in History's charts. | [existing] |

### 7.3 Model tab — cross-version quality (P1, P3)

History inspects one run; this tab aggregates across runs. It reads each successful training's result (`training.to_dict(extended=True)` exposes `accuracy`, `evaluation.{train,test}.report`, `evaluation.{train,test}.confusion_matrix`, `history`, `summary`, `kwargs`).

| # | Requirement | Source |
|---|---|---|
| MD-1 | **Accuracy trend**: test (and optional train) accuracy plotted across every successful version, x = version. Reuses the `recharts` `LineChart` conventions from History's `HistoryCharts`. | [existing] |
| MD-2 | **Metric trend**: macro-/weighted-avg precision, recall, F1 across versions, toggled like History's per-metric checkboxes. | [existing] |
| MD-3 | **Per-label F1 movement**: small-multiples or a heatmap of each label's F1 across the last N versions, to see which labels improved or regressed. | [existing] |
| MD-4 | **Persistent confusions**: aggregate the per-version test confusion matrices to rank label pairs confused *consistently* across versions (not just one run) — the single highest-value insight History structurally can't provide. | [existing] |
| MD-5 | **Overfit gap**: train-minus-test accuracy per version, flagging versions with a large gap. | [existing] |
| MD-6 | **Best-version recommendation**: rank successful versions by a configurable objective (default test accuracy, tie-broken by macro-F1) and surface the winner, with a link to promote it in Publish. | [existing] |
| MD-7 | **Parameter correlation** (nice-to-have): plot a chosen hyperparameter from `kwargs` (e.g. `epochs`, `learning_rate`, `pretrained_model`) against resulting accuracy to guide the next run. | [existing] |

### 7.4 Production tab — live telemetry (P2, P3) — Phase 2

Requires prediction capture (§8). All panels are filterable by environment (read dynamically from the environments API, which today serves the canonical set `development`, `testing`, `production` — see §11 open question 1) and time range.

| # | Requirement | Source |
|---|---|---|
| PR-1 | **Throughput**: requests over time (line/area), split by environment; totals for the selected window. | [new] |
| PR-2 | **Latency**: p50 / p95 / p99 and max, over time and as a distribution. Server-measured, unlike Test's client-side timing. | [new] |
| PR-3 | **Error rate**: share of predictions returning the serving loop's `{error, type}` failure envelope, broken down by error `type`, over time. | [new] |
| PR-4 | **Confidence distribution**: histogram of top-1 score for text-classification / NLU intents; a low-confidence threshold slider surfaces the fraction below it. | [new] |
| PR-5 | **Predicted-label mix**: volume per predicted label/intent in production vs the dataset's label distribution — a class-drift signal. | [new] + [existing] |
| PR-6 | **Drift vs baseline**: compare live top-1 confidence and predicted-label mix against the deployed version's evaluation baseline from its training result; flag material divergence. | [new] + [existing] |
| PR-7 | **Cache & serving health** (SRE): cache-hit ratio, deployment status transitions, and idle/lazy standby state, complementing Publish's static config view. | [new] |
| PR-8 | **Top inputs**: most frequent inputs and most frequent *failing* inputs in the window (subject to the privacy controls in §10). | [new] |

### 7.5 Review tab — active learning (P4) — Phase 3

Builds on captured predictions to feed the dataset.

| # | Requirement | Source |
|---|---|---|
| RV-1 | A **review queue** of production inputs prioritized by low confidence, failure, or predicted-label disagreement with a comparison environment. | [new] |
| RV-2 | For each item: show input, predicted label/intent + score, environment, timestamp, and (for NER/NLU) the token tags, reusing Test's `PredictionView` / `TokenTags` renderers. | [new] |
| RV-3 | **Promote to dataset**: assign the correct label and create an `Utterance` under it (POST to the existing utterances endpoint), then mark the item reviewed. This is the loop's payoff. | [new] + [existing] |
| RV-4 | **Bulk actions**: accept the predicted label, reassign, or dismiss in batches. | [new] |
| RV-5 | A reviewed item is deduped against existing utterances (reusing DS-4 logic) so the same correction isn't added twice. | [new] + [existing] |

---

## 8. Technical design

### 8.1 Frontend

- **Route.** Add a lazy import and route in `src/routes/model/Model.jsx`, mirroring the existing siblings:

  ```jsx
  const Analyse = lazy(() => import('./routes/analyse/Analyse'));
  // …inside <Routes>
  <Route path="analyse" element={<Analyse />} />
  ```

  The nav link, `activeSection` breadcrumb logic, and `Activity` icon already exist and need no change. New files live under `src/routes/model/routes/analyse/` with a `components/` folder, matching the established structure.

- **Data & state.** Reuse `ModelContext` (model id, name, type), `UserContext` (bearer token), and `SocketContext` (live updates). Fetch with `axios` against the token-authed `/api/...` endpoints, following the pagination contract used across the API: the list is keyed by resource name — e.g. `{ trainings: [...], total, page, per_page }`, likewise `labels:` and `utterances:` — not a generic `items` key, so new endpoints should key their list by the resource they return.

- **Charts & export.** Reuse `recharts` and the exact chart affordances History ships: metric checkboxes, smoothing, log-scale, zoom, and CSV/PNG export via `downloadBlob` and the SVG-inlining PNG routine. This keeps look, feel, and theming (Bootstrap CSS variables, light/dark) consistent for free.

- **Model-type awareness.** Panels adapt to `model.type`: classification/NLU show confidence and label-mix; NER shows tag-level views. The renderers already exist in Test (`PredictionView`, `TokenTags`) and can be extracted into shared components.

### 8.2 Aggregation endpoints (Phase 1, existing data)

To avoid the client fetching every training and every label separately, add read-only aggregation endpoints under the existing `api` blueprint (all `token_auth.login_required`, model-scoped):

| Method & path | Returns |
|---|---|
| `GET /api/models/:modelId/analytics/dataset` | Label distribution, totals, imbalance ratio, empty labels, length histogram, duplicate/near-duplicate counts, vocabulary snapshot. |
| `GET /api/models/:modelId/analytics/versions` | Per-successful-version: version, accuracy, train/test macro & weighted metrics, overfit gap, and the objective ranking for the best-version pick. |
| `GET /api/models/:modelId/analytics/confusions?window=N` | Aggregated confusion pairs across the last N versions' test matrices. |

These compute from `Model.labels`/`Utterance` and each `Training`'s task result — no new tables. They are cacheable and can also be assembled client-side in Phase 1 if backend work must be deferred, at the cost of extra requests.

### 8.3 Prediction capture (Phase 2, new)

The capture point should be the **infer view** (`server/views/triton/inference.py`), not the serving loop. After the view returns its response it already holds everything a telemetry record needs — the full prediction output, server-measured latency, cache-hit/miss, and the `{error, type}` envelope — and it observes *every* request, including cache hits. The serving loop (`server/tasks/inference.py`) is the wrong place for two concrete reasons:

- **Cache hits never reach the loop.** With `route.cache` on, repeated identical `(top, query)` requests are served straight from Redis by the view and never touch the queue, so loop-based capture would undercount throughput and could not compute the cache-hit ratio (PR-1, PR-7).
- **Errors are batch-granular in the loop.** On failure the loop writes the *same* `{error, type}` envelope for every key in the batch, so one bad input marks the whole batch failed and skews the error rate (PR-3). The view sees per-request outcomes.

Capturing in the view also avoids a new architectural coupling: the triton serving worker today touches only `store` and the registry, never SQLAlchemy, and each environment has its own Redis (and possibly its own host) per the per-environment `redis_url` in `config.py`. So capture should stay off the response path by pushing one telemetry record onto a Redis queue *after* the view responds, and a Celery task drains that queue into storage. The control-plane API aggregates across the per-environment Redises via `registry_for(environment)`, which it must do for the live registry anyway.

Two storage options:

1. **Relational `PredictionLog`** (recommended for correctness and query flexibility). New model + Alembic migration:

  | Column | Notes |
  |---|---|
  | `id`, `model_id` (FK), `training_id` (FK), `environment` | scope |
  | `created_at` | time-series key |
  | `latency_ms` | server-measured |
  | `top_label`, `top_score` | for confidence/label-mix (classification/NLU) |
  | `output` (JSON) | full prediction for NER/NLU and Review |
  | `cache_hit` (bool) | serving health |
  | `error_type` (nullable) | populated from the `{error, type}` failure envelope |
  | `input_text` (nullable) | gated by the retention/PII policy in §10 |

  Writes are batched by the draining Celery task to bound DB load. Because that task may run outside an app context, reuse the config-driven access pattern already used by `registry_for`.

2. **Redis time-series / rollups** for high-volume deployments, aggregating counts, latency histograms, and confidence buckets per minute per environment, with the relational log kept only for sampled or flagged (low-confidence/failed) items. Chosen per expected traffic; the API contract in §8.4 stays the same.

Retention is enforced by a periodic Celery task (raw rows expire; rollups persist), configurable via env like the existing `INFERENCE_*` settings.

### 8.4 Telemetry & review endpoints (Phase 2–3)

| Method & path | Returns / does |
|---|---|
| `GET /api/models/:modelId/analytics/production?environment=&from=&to=&bucket=` | Time-bucketed throughput, latency percentiles, error rate, confidence histogram, label mix, cache-hit ratio. |
| `GET /api/models/:modelId/analytics/review?status=pending&sort=confidence&...` | Paginated review queue (low-confidence / failed / disagreement), same pagination contract as the rest of the API. |
| `POST /api/models/:modelId/analytics/review/:predictionId/promote` | Creates an `Utterance` under the chosen label and marks the item reviewed. |
| `POST /api/models/:modelId/analytics/review/:predictionId/dismiss` | Marks reviewed without promoting. |

### 8.5 Real-time

For the Production tab, reuse the existing Socket.IO channel (`SocketContext`, already used by History and Test for task status) to push periodic rollup deltas so counters and the latest-latency reading update live without polling. Historical charts load over HTTP; only the trailing edge streams.

---

## 9. Phasing & rollout

The phasing follows the data constraint: everything buildable on existing data ships first and needs no change to the serving hot path; telemetry follows once capture exists.

| Phase | Scope | Backend work | User value |
|---|---|---|---|
| **1 — Dataset & Model** | Overview (existing metrics), Dataset tab, Model tab. Wire the route. | None required (client can aggregate) or the three read-only `analytics/*` endpoints in §8.2. | Immediate: dataset health, cross-version trends, best-version pick, persistent confusions. |
| **2 — Production** | Production tab; capture pipeline; Overview gains live error/latency to "needs attention". | `PredictionLog` (or Redis rollups) + capture hook + `analytics/production` + retention task. | SRE monitoring; drift signal; server-measured latency. |
| **3 — Active learning** | Review tab; promote-to-dataset loop; drift alerting thresholds. | Review endpoints + dedupe reuse. | Closes the data flywheel; turns traffic into training data. |

Each phase is independently shippable and independently valuable; a user with no deployments still gets full value from Phase 1.

### Ship criteria (per phase)

- Phase 1: metrics on Analyse reconcile **exactly** with History for the same version; empty/loading/error states handled; light & dark themes correct.
- Phase 2: capture adds no measurable latency to the infer path (verify under load); retention enforced; environment/time filters correct.
- Phase 3: promote creates the right `Utterance`, dedupes, and is reflected in Build.

---

## 10. Cross-cutting concerns

**Privacy & security.** Storing `input_text` (Phase 2+) means storing user-submitted content, which may contain PII. Requirements: capture of raw input is **configurable** (off / sampled / full) per environment; retention is bounded and enforced; all `analytics/*` endpoints are model-scoped and behind `token_auth`, so a user only ever sees their own model's data (the existing `g.current_user.models.filter_by(...)` guard). The Publish page already treats API keys as sensitive (masking, reset); Analyse must not surface keys at all. `curl`/export outputs must never embed secrets.

**Performance.** Phase 1 aggregations must not trigger N+1 fetches — prefer the aggregation endpoints, cache results, and paginate. Phase 2 capture must be strictly off the response path (write after Redis set, batched) and must degrade gracefully: if logging fails, predictions still succeed. Charts should cap points and use the smoothing/downsampling already present in History.

**Accessibility & theming.** Reuse Bootstrap components and CSS variables so light/dark and contrast come for free; every chart needs a table or text equivalent (screen readers can't read an SVG heatmap), tabs must be keyboard-navigable, and color is never the only signal (pair with labels/icons, as the confusion matrix already does).

**Empty & error states.** Every tab needs first-run states: no labels yet → point to Build; no successful training → point to History/Build; nothing deployed → Production/Review explain they populate once traffic flows (mirroring Test's `EmptyState` usage). A model with one version still renders trends (a single point) rather than erroring.

**Consistency.** Any metric shown here must be computed identically to its History counterpart. Where possible, share the helper functions already in `History.jsx` (`reportRows`, `getTrainingAccuracy`, `getConfusionMatrix`) by extracting them into a shared module rather than reimplementing.

---

## 11. Dependencies, risks & open questions

**Dependencies.** Phase 1: none beyond the existing training-result shape. Phase 2: the `PredictionLog`/rollup decision and a migration; the capture hook in the infer view plus a Celery drain task; a Celery retention task. Note the triton serving worker does not currently use SQLAlchemy (only `store` and the registry), so capture writes go through the drain task on the control plane rather than the worker itself (§8.3). Phase 3: Phase 2 capture.

**Risks.**
- *Metric divergence* from History would erode trust — mitigated by sharing computation (§10).
- *Serving-path regression* from capture — mitigated by off-path, batched, fail-open writes and load testing before enabling in production.
- *Storage growth / PII* from raw inputs — mitigated by sampling, retention, and config gating.
- *Low-traffic models* make Production/Review sparse — mitigated by clear empty states and by Phase 1 standing alone.

**Open questions.**
1. Environment set is already settled: `server/config.py` → `ALLOWED_ENVIRONMENTS` defines exactly `development`, `testing`, `production`, and `Environment.update()` syncs the DB table to that set (there is no `staging` anywhere in the repo, and worker queues are named per this set). Analyse must still read the environment list dynamically from the environments API rather than hard-code it, so it tracks any future config change automatically.
2. Default thresholds (imbalance ratio, min examples/label, low-confidence cutoff, F1 "weak" cutoff) — global defaults vs per-model overrides?
3. Retention windows and whether raw-input capture defaults to off.
4. Best-version objective: fixed (test accuracy → macro-F1) or user-selectable?
5. Should Overview eventually roll up across *all* of a user's models (a portfolio view), or stay single-model?

---

## 12. Appendix — codebase references

| Concern | Location |
|---|---|
| Nav link present, route missing | `src/routes/model/Model.jsx` (`eventKey='analyse'`; no `<Route path="analyse">`) |
| Sibling pages | `src/routes/model/routes/{build,history,test,publish,utterances}/` (note the `build/:labelId/utterances` route) |
| Reusable chart/report/matrix logic | `src/routes/model/routes/history/History.jsx` |
| Prediction renderers (classification/NLU/NER) | `src/routes/model/routes/test/Test.jsx` (`PredictionView`, `TokenTags`) |
| Shared UI + utils | `src/shared/components/SectionCard.jsx`, `src/shared/utils/downloadBlob.js`, `src/shared/components/AppPagination.jsx` |
| Contexts | `src/contexts/{ModelContext,UserContext,SocketContext}.jsx` |
| Data model (no prediction log) | `server/database.py` |
| Training results shape (`accuracy`, `evaluation`, `history`, `summary`, `kwargs`) | `server/tasks/training.py`, surfaced via `Training.to_dict(extended=True)` |
| Infer entry point | `server/views/triton/inference.py` |
| Serving loop (batches predictions; not the capture point — see §8.3) | `server/tasks/inference.py` |
| Telemetry capture point (sees every request incl. cache hits) | `server/views/triton/inference.py` |
| Cross-version aggregates already in History (`HistoryMetricStrip`) | `src/routes/model/routes/history/History.jsx` |
| Redis registry (routes, queues, output TTL) | `server/registry.py` |
| API conventions (auth, pagination) | `server/views/api/trainings.py`, `server/views/api/__init__.py` |
| Model types, environments, inference config | `server/config.py` |
| Frontend stack (React 19, react-router 7, recharts, socket.io, axios) | `package.json` |


