# PRD — Batch testing (Test page + inference API)

| | |
|---|---|
| **Status** | Draft for review |
| **Owner** | Varun Seth |
| **Last updated** | 2026-07-08 |
| **Surface** | `server/views/triton/inference.py` (infer API) · `src/routes/model/routes/test/Test.jsx` (Test page) |
| **Related** | Publish (curl/API docs), History (result renderers), Build (CSV upload precedent) |
| **Audience** | Product, ML engineers, QA, SRE / operators |

---

## 1. Summary

Today the Test page sends **one** query at a time: the user deploys a version to `testing` from the Publish tab, types a sentence, and reads a single prediction. Evaluating a model against a set of realistic inputs means retyping and re-sending one by one, with no way to load a file, run everything, and scan the outcomes together.

This document specifies **batch testing**: a single request that accepts a *list* of inputs, runs them all through the deployed model, and returns one output per input. On the API this is a batch mode of `POST /infer/<model_id>`; in the UI it is a **drag-and-drop CSV upload** on the Test page that parses the file into inputs, submits the batch, and renders **all** predictions in a results view where each one can be inspected individually.

The important architectural fact is that **the serving path is already batch-native**. The serving loop (`server/tasks/inference.py`) pops up to `INFERENCE_BATCH_SIZE` queued inputs at once and calls `model.predict(inputs, **kwargs)`, and every `predict` implementation already takes a list `X` — text-classification even accepts a *per-input* `top` list "as sent by the batched serving loop" (`server/models/text_classification/base.py`). What is missing is only (a) a batch-shaped HTTP entry point that enqueues many inputs and waits for all of them, and (b) the client to produce that list from a CSV and render the results. No change to the model layer or the queue mechanics is required for Phase 1.

---

## 2. Background & problem

### 2.1 How a single prediction flows today

`POST /infer/<model_id>` (`server/views/triton/inference.py`), authenticated by the deployment's API key (`api_key_required`), does the following for one request:

1. Resolves the environment's `route` from the Redis registry; 404 if the model is not published there.
2. Reads `query` from the JSON body; **400 unless it is a non-empty string**.
3. Reads `top` from the query string (default `route.top`, floored at 1).
4. Computes a slot key: with `route.cache` on, `key = sha256(f'{top}:{query}')` and a cache hit short-circuits; with caching off, `key = uuid4().hex` and the output is deleted on read (`pull`).
5. Lazily starts the serving task if the model is not alive (`registry.claim` → `model.apply_async`).
6. `registry.push(model_id, key, query, top=top)` — RPUSHes one input message onto `inputs:<model_id>`.
7. `registry.wait(...)` polls the **single** output key until it appears or `INFERENCE_REQUEST_TIMEOUT` (30 s) elapses (504).
8. Returns the output (200), or the `{error, type}` envelope (502) on a serving failure.

The data plane (`triton.py`) is **gevent** monkey-patched precisely so these blocking Redis waits are cheap: each in-flight request is a greenlet, not a pooled OS thread. That is what makes a synchronous "enqueue many, wait for all" endpoint viable without redesigning the transport.

### 2.2 The serving loop is already a batcher

`server/tasks/inference.py` runs a loop that:

- `registry.pop(model_id, batch_size)` — pops up to `INFERENCE_BATCH_SIZE` (default 32) messages, returning parallel lists `inputs`, `keys`, and a `kwargs` dict whose values are per-input lists (so `top` arrives as a list aligned to `inputs`).
- Calls `model.predict(inputs, **kwargs)` **once** for the whole popped batch.
- Writes each result back under `outputs:<model_id>:<key>` with `INFERENCE_OUTPUT_TTL` (300 s).

So multiple *concurrent single requests* already coalesce into one `predict` call. A batch request simply pushes many keys from one caller instead of many callers pushing one each — the loop does not need to know the difference.

### 2.3 The gaps

| Gap | Consequence |
|---|---|
| The infer view rejects anything but a single `query` string; there is no list contract. | No way to submit N inputs in one call. |
| `registry.wait` polls exactly one key. | Even if we enqueued N, nothing assembles N outputs in input order. |
| The serving loop writes a **batch-granular** failure: on any exception it stores the *same* `{error, type}` for **every** key in the popped batch (`inference.py` `except` branch). | One malformed input can mark its whole serving-batch (up to 32 items) failed — a correctness concern for per-input results (§8.5). |
| The Test page has a single textarea and a single-result panel; no file upload, no multi-result rendering. | Users retype and re-send one at a time. |
| No client-side CSV parsing exists (`package.json` has no CSV lib; Build uploads raw files for pandas to parse server-side). | The requested JSON-list contract has to be produced somewhere new. |

The problem these add up to: **there is no way to evaluate a deployed model against a batch of inputs in one action and review the results together.** That is the core QA/ML workflow before promoting a version.

---

## 3. Goals & non-goals

### Goals

1. Add a **batch mode** to the inference API: a single `POST /infer/<model_id>` that accepts a list of inputs and returns one output per input, in order, backward-compatible with the existing single-`query` contract.
2. Add **drag-and-drop CSV upload** to the Test page that parses a file into inputs and submits them as one batch.
3. Render **all** batch outputs in a results view where each row can be **inspected individually**, reusing the existing `PredictionView` / `JsonView` / `TokenTags` renderers so all three model types are supported.
4. Represent **partial results**: a failed input surfaces its own error inline without hiding the ones that succeeded.
5. Reuse existing conventions — `api_key_required` auth, the Redis queue, the `MetricStrip` / `SectionCard` / Bootstrap UI, `downloadBlob` for export — so the feature feels native and needs no new serving infrastructure in Phase 1.

### Non-goals

- **Not** a stored evaluation harness with labelled ground truth, accuracy scoring, or a leaderboard. Batch testing runs inputs and shows outputs; it does not grade them against expected labels (that is a natural follow-on — see §11 open questions).
- **Not** a new persistence layer. Batch outputs live only as long as the existing `INFERENCE_OUTPUT_TTL`; nothing is written to the relational DB. (Prediction logging is the separate concern owned by the Analyse PRD.)
- **Not** the multi-environment *compare* flow (already on Test). Batch mode targets the single deployed environment; comparing a batch across environments is out of scope for v1.
- **Not** an offline/emailed job. Even the async large-batch mode (§8.6) reports back in-session via the existing Socket.IO channel.

---

## 4. Personas & user stories

**P1 — ML engineer / model builder.** Wants to sanity-check a version before promoting it.
- As a builder, I want to upload a CSV of representative sentences and see every prediction at once, so I can spot systematic mistakes a single query would miss.
- As a builder, I want to sort/filter results by predicted label or confidence, so I can find the low-confidence and surprising cases fast.
- As a builder, I want to export inputs-plus-predictions to CSV, so I can share or diff them offline.

**P2 — QA / tester.** Owns regression checks.
- As a QA tester, I want to keep a fixed CSV of "golden" inputs and re-run it against each new version, so I can eyeball whether behaviour drifted.
- As a QA tester, I want failed inputs flagged clearly, so a bad row doesn't get lost in a long list.

**P3 — Integrator / API consumer.** Builds against the public inference endpoint.
- As an integrator, I want to POST a list and get a list back in the same order, so I can score a dataset in one round-trip instead of N.
- As an integrator, I want a copy-pasteable batch `curl` snippet on the Publish page, so I know the exact contract.

**P4 — SRE / operator.** Owns the data plane's health.
- As an operator, I want a large upload to be bounded (size cap, chunking, or an async job) so one batch can't monopolise a model's queue or tie up a request for minutes.

---

## 5. Success metrics

| Metric | Target |
|---|---|
| Adoption | ≥ 40% of Test-page sessions that run a query use batch upload within 60 days of launch. |
| Round-trip savings | A 100-input CSV is evaluated in **one** user action and **one** API round-trip (vs 100 today). |
| Correctness | Batch outputs are identical, element-for-element, to running each input singly against the same deployed version (verified in tests). |
| Ordering | 100% of batch responses return outputs in submitted input order (index-aligned), including when caching dedupes repeats. |
| Resilience | A batch containing malformed/failing rows still returns a result object for **every** input; no input is silently dropped. |
| Data-plane safety | No batch can exceed the configured cap synchronously; p95 added latency for concurrent single requests during a batch stays within an agreed bound (§8.6, §10). |

---

## 6. Information architecture (where it fits)

Batch testing lives on the **existing Test page** as a second input mode alongside the current single-query form — not a new route. The Response panel gains a **Batch** result surface next to the current Result / JSON / Compare tabs.

```
/models/:modelId/test
├── Metric strip                     (unchanged: environment, version, versions, last latency)
├── Request panel
│   ├── [ Single | Batch ] mode toggle          ← new
│   ├── Single mode: textarea + top + compare    (unchanged)
│   └── Batch mode: drag-and-drop CSV dropzone   ← new
│       ├── file parse + column pick + row preview
│       └── Run batch  (N inputs)
└── Response panel (tabs)
    ├── Result  (single)             (unchanged)
    ├── JSON    (single)             (unchanged)
    ├── Batch   ← new: results list + per-row detail + export
    └── Compare (single)             (unchanged)
```

The mode toggle keeps the two workflows from colliding: deploy/version controls, the `top` selector, and the deployed-stale warnings are shared; only the input surface and the result surface switch.

---

## 7. Functional requirements

Tagged **[existing]** (buildable on today's serving path / UI) or **[new]** (needs a backend or client addition described in §8).

### 7.1 Inference API — batch mode

| # | Requirement | Source |
|---|---|---|
| API-1 | `POST /infer/<model_id>` accepts a **batch body** in addition to the single body. Recommended shape: `{"queries": ["...", "..."]}`. The single `{"query": "..."}` contract is unchanged and still returns a single object. | [new] |
| API-2 | The batch response is `{"outputs": [ <element>, ... ]}`, **index-aligned** to `queries`. Each `<element>` is either a normal prediction envelope (`environment/model/version/input` + the model's output) or a `{error, type}` failure envelope for that input. HTTP 200 when the batch was accepted and processed (even if some elements are errors). | [new] |
| API-3 | Validation: `queries` must be a non-empty list of non-empty strings, length ≤ `INFERENCE_MAX_BATCH` (new config). Empty list, wrong types, or over-cap → 400 with a clear message, mirroring the existing single-query 400s. | [new] |
| API-4 | `top` applies to the whole batch, read from the query string exactly as today (default `route.top`). Per-input `top` (via object rows) is an open question (§11), not v1. | [existing] |
| API-5 | Caching honoured per input: with `route.cache` on, each input hashes to its own slot, cache hits are served without re-que:uing, and **duplicate inputs within a batch dedupe** to one prediction. With caching off, each input gets a unique key and its output is pulled (deleted) on read. | [existing] |
| API-6 | Lazy start unchanged: the batch triggers the same `registry.claim` → `model.apply_async` as a single request if the model is not alive. | [existing] |
| API-7 | Timeout: the batch waits until **all** enqueued keys resolve or a batch-scoped deadline elapses. On deadline, unresolved inputs return a `{error: "timed out", type: "Timeout"}` element rather than failing the whole request (partial return). Over-cap batches never reach this path (rejected at API-3). | [new] |
| API-8 | CORS/headers unchanged — the `triton.after_request` allow-list already covers `POST`/`Content-Type: application/json`. | [existing] |

### 7.2 Test page — CSV upload & submission

| # | Requirement | Source |
|---|---|---|
| UI-1 | A **mode toggle** (Single / Batch) in the Request panel switches the input surface. Version/deploy controls and `top` remain shared and visible in both modes. | [new] |
| UI-2 | A **drag-and-drop dropzone** accepts a `.csv`/`.tsv` file (also click-to-browse). It shows drag-over affordance, rejects non-CSV/TSV and oversized files with an inline message, and mirrors Build's "contains header" toggle. | [new] |
| UI-3 | The file is **parsed client-side** into rows. If multiple columns exist, the user picks the **input column** (default: the first/only column, or a `text`/`query`/`input`-named column if present). Remaining columns are retained as per-row metadata for display and export. | [new] |
| UI-4 | A **preview** shows parsed row count, the chosen column, and the first few inputs, so the user confirms before running. Blank rows are skipped with a visible count. | [new] |
| UI-5 | "Run batch" is disabled unless a version is deployed and ≥ 1 valid input parsed; it shows progress while in flight, and is bounded by the same size cap the API enforces (large files → chunked or async per §8.6, with a clear indication of how many rows will run). | [new] |
| UI-6 | Batch submission reuses the deployment's API key and the `/api/infer/<modelId>` endpoint (dev is proxied to the data plane by Vite; the same endpoint serves prod), consistent with the single-query `handleSubmit`. | [existing] |
| UI-7 | Errors (401/404/504/network) surface with the same alert conventions as single mode (e.g. "the selected version isn't serving — redeploy"). | [existing] |

### 7.3 Prediction view — render all outputs

| # | Requirement | Source |
|---|---|---|
| PV-1 | The **Batch** tab renders a **results list/table**: one row per input showing the (truncated) input text and a **compact prediction summary** appropriate to the model type — top label + score bar for text-classification, the intent badge for NLU, an entity-count/first-entities chip for NER. | [new] + [existing renderers] |
| PV-2 | Selecting a row opens a **detail view** for that single input, reusing `PredictionView` (rendered result) and `JsonView` (raw), and `TokenTags` for NER/NLU slots — the exact components single mode already uses. This is the "inspect individually" requirement. | [existing] |
| PV-3 | **Failed rows** are visually flagged (danger styling + the `{type}`/`error` message) inline in the list and in their detail view, without removing them from the list. | [existing renderer] |
| PV-4 | **Filter & sort**: filter by search text and by status (ok/error), and sort by confidence (classification/NLU) so low-confidence and failed cases float up. | [new] |
| PV-5 | **Summary strip** for the batch: total inputs, succeeded, failed, and (classification/NLU) a mean/median top-1 confidence, so the run is glanceable before drilling in. | [new] |
| PV-6 | **Export results** to CSV via `downloadBlob`: input text, any retained metadata columns, predicted label/intent (+ score) or serialized output, and error (if any) — one row per input. | [new] + [existing util] |
| PV-7 | Empty/loading states consistent with the page: a dropzone empty state before upload, a spinner/progress while running, and `EmptyState` when a mode has no results yet. | [existing] |

### 7.4 Publish page — document the batch contract

| # | Requirement | Source |
|---|---|---|
| DOC-1 | The Publish page's request docs gain a **batch `curl` snippet** (list body + `outputs` response), beside the existing single-query snippet, so integrators (P3) get the exact contract including the API key and `?top=`. | [new] |

---

## 8. Technical design

### 8.1 API contract (batch mode of the existing route)

Keep **one** public URL and **one** auth surface by teaching `POST /infer/<model_id>` to accept either body shape:

```jsonc
// Single (unchanged)
{ "query": "book me a cab to the airport" }
// → { "environment": "...", "model": "...", "version": "...", "input": "...", "outputs": [ ... ] }

// Batch (new)
{ "queries": ["book me a cab", "cancel my order", ""] }
// → { "outputs": [ {<prediction>}, {<prediction>}, {"error": "...", "type": "..."} ] }
```

Rationale for extending the same route rather than adding `/infer/<id>/batch`: identical auth (`api_key_required` keys off `model_id`), identical route/registry/lazy-start logic, one thing to document, and `model.predict` is already list-shaped so the server has no second code path to maintain. A `queries` key (vs overloading `query` to accept a list) keeps the discriminator explicit and the single-query validation untouched.

### 8.2 Backend — enqueue many, wait for all

The batch branch of the infer view generalises the seven single-request steps to a list, reusing every registry primitive that exists:

1. Validate `queries` (non-empty list of non-empty strings, ≤ `INFERENCE_MAX_BATCH`).
2. For each input, compute its key exactly as the single path does — `sha256(f'{top}:{q}')` when `route.cache`, else `uuid4().hex`. Deduplicate identical cache keys so a repeated input is enqueued once (API-5).
3. Check the cache for each cache-keyed input up front; collect immediate hits.
4. `registry.push(...)` the misses (one RPUSH per input; or a small pipeline helper to push them in one round-trip — a minor `Registry` addition).
5. Lazy-start once if the model isn't alive (unchanged claim logic).
6. **Wait for all** outstanding keys. Add a `registry.wait_many(model_id, keys, timeout, interval, pull)` that polls the set of keys, removing each as it resolves, until all resolve or the deadline passes — the multi-key generalisation of today's `wait`. It should batch its reads (`MGET`/pipeline) rather than one `GET` per key per tick to keep the poll cheap. gevent makes the blocking wait a cheap greenlet (§2.1).
7. Assemble outputs **in input order** by mapping each original index → its key → its resolved value (cache hit, served output, or a per-input timeout envelope for anything still unresolved at the deadline). Return `{"outputs": [...]}`.

No change is needed to `registry.pop`, `registry.set`, the serving loop's happy path, or any `model.predict` — the loop already coalesces whatever is on the queue.

### 8.3 Config

Add alongside the existing `INFERENCE_*` settings in `server/config.py`:

- `INFERENCE_MAX_BATCH` (e.g. 256) — hard cap on synchronous batch size (API-3).
- `INFERENCE_BATCH_TIMEOUT` (optional; default to a multiple of `INFERENCE_REQUEST_TIMEOUT`, or scale with input count) — the batch-scoped deadline for API-7.

### 8.4 Frontend

- **State & submission.** Extend `Test.jsx` with a mode (`single`/`batch`), parsed rows, chosen column, and a `batchResults` array. The batch `handleRunBatch` mirrors `handleSubmit`: POST to `/api/infer/${modelId}` with `{ queries }`, `params: { top }`, and `Authorization: Bearer ${deployedInstance.api_key}`. Latency is still `performance.now()` around the call (batch-level), consistent with single mode.
- **CSV parsing.** The requested contract is a JSON list, so parse on the client. The example datasets include quoted fields with embedded commas and newlines (`data/examples/IMDB Dataset.csv`), so a naïve `split(',')` is wrong — pull in a small, well-tested parser (**`papaparse`**, recommended) rather than hand-rolling RFC-4180 quoting. Papaparse also gives header detection, delimiter auto-detect (handles the `.tsv` examples), and streaming for large files.
- **Dropzone.** A native drag-and-drop zone (`onDragOver`/`onDrop` + a hidden `<input type="file" accept=".csv,.tsv">`) styled with the existing Bootstrap/`SectionCard` classes; no new drag library needed. Reuse Build's "contains header" affordance and copy.
- **Results rendering.** A new `BatchResults` component: the summary strip (PV-5), a filter/sort bar (PV-4), a virtualised-if-needed list (PV-1) where each row's compact summary is derived with the helpers already in `Test.jsx` (`getOutputs`, `isErrorPrediction`), and a detail pane that renders the selected row through the **existing** `PredictionView`/`JsonView`/`TokenTags`. Export via the existing `downloadBlob` util.
- **Model-type awareness.** Row summaries branch on the output shape the renderers already distinguish: `outputs:[{label,score}]` (classification), `{intent,slots}` (NLU), `[tags]` (NER). No model-type flag needs threading through — the shape is self-describing, as the current `PredictionView` proves.

### 8.5 Partial-failure isolation (recommended [new], Phase 2)

The serving loop currently writes the **same** `{error, type}` for every key in a popped batch when `model.predict` raises (`server/tasks/inference.py`). Under batch testing, a single malformed input could therefore fail up to `INFERENCE_BATCH_SIZE` unrelated inputs that happened to be popped with it. Recommended hardening: on a batch `predict` exception, fall back to predicting **per input** (or bisecting the batch) so only the genuinely offending inputs get an error envelope and the rest succeed. This is a localized change to the loop's `except` branch and benefits *all* callers (concurrent single requests already coalesce into these batches too), not just batch mode. Phase 1 ships without it — the client-side cap and chunk sizing bound the blast radius — but PV-3/API-2's "one result per input" contract is only *fully* honoured once this lands.

### 8.6 Large batches: cap, chunk, or async

A single Flask (gevent) request that waits on thousands of outputs holds a greenlet for the whole run and, more importantly, a huge single push monopolises that model's FIFO `inputs` list ahead of other callers. Three tiers, phased:

- **Cap (Phase 1).** Reject synchronous batches over `INFERENCE_MAX_BATCH` (API-3). Simple, safe, predictable.
- **Client chunking (Phase 1).** For files larger than the cap, the client splits the parsed rows into cap-sized chunks and submits them **sequentially**, streaming results into the list as each chunk returns. Interleaving with other callers is preserved (each chunk is just a normal batch), and progress is visible. This covers the common "a few thousand rows" CSV without any new server machinery.
- **Async job (Phase 2, optional).** For very large datasets, a `POST /infer/<model_id>/jobs` that returns a job id immediately, drains chunks off a job queue, writes results to storage, and reports progress/completion over the existing Socket.IO channel (`SocketContext`, already used by Test for task status). Chosen only if real usage exceeds what chunking handles comfortably.

### 8.7 Publish docs

Add a second snippet next to the existing `curlSnippet` in `Publish.jsx` (currently a single-`query` body), e.g.:

```bash
curl -X POST '<endpoint>?top=1' \
  -H 'Authorization: Bearer <api_key>' \
  -H 'Content-Type: application/json' \
  -d '{"queries": ["first input", "second input"]}'
```

---

## 9. Phasing & rollout

| Phase | Scope | Backend work | User value |
|---|---|---|---|
| **1 — Batch happy path** | Batch mode of the infer API (API-1–8), `wait_many`, size cap + client chunking, Test-page CSV dropzone, `BatchResults` view, export, Publish batch snippet. | Infer-view batch branch + `wait_many`/push-pipeline helpers + `INFERENCE_MAX_BATCH` config. No new tables, no serving-loop change. | End-to-end batch testing from CSV; one round-trip; individually inspectable results. |
| **2 — Robustness** | Per-input failure isolation in the serving loop (§8.5); optional async job mode for very large files (§8.6). | Loop `except`-branch bisection; optional job endpoint + queue + socket progress. | One-bad-row-can't-fail-the-batch guarantee; unbounded file sizes. |
| **3 — Evaluation (future)** | Optional "expected label" column → per-row correct/incorrect + batch accuracy; save/re-run a named batch against new versions. | Scoring logic; optionally persist named batches. | Turns batch testing into lightweight regression/eval (feeds the Analyse PRD's active-learning loop). |

Each phase is independently shippable; Phase 1 delivers the requested feature in full for reasonably sized CSVs.

### Ship criteria (Phase 1)

- Batch outputs are element-for-element identical to running each input singly against the same version (test).
- Ordering is preserved including with duplicate inputs and cache hits/misses (test).
- Every input yields exactly one result element; timeouts and per-batch serving failures surface as error elements, never as dropped rows.
- CSV parsing handles quoted commas/newlines and TSV (verified against `data/examples`), and the "contains header"/column-pick flows work.
- Single-query mode and the Compare flow are unchanged (regression).

---

## 10. Cross-cutting concerns

**Security & auth.** Batch mode uses the *same* `api_key_required` guard and per-deployment key as single mode; no new surface. The cap (API-3) is also a DoS guardrail — an unbounded list must never be accepted. Export/`curl` output must never embed anything beyond what Publish already exposes.

**Data-plane fairness & performance.** A batch is just many entries on the same FIFO `inputs` list; the serving loop still pops `INFERENCE_BATCH_SIZE` at a time, so a large batch is processed in `predict`-sized chunks interleaved with other callers *only* if it isn't pushed as one giant block ahead of them. The cap + client chunking (§8.6) keep any single caller from starving others. `wait_many` must poll with batched reads (MGET/pipeline), not one GET per key per tick, or the poll cost grows with batch size.

**Caching semantics.** Within-batch duplicates dedupe to one prediction when caching is on (API-5); this is a feature (cheaper) but means the response is assembled by key, so the index→key→value mapping in §8.2 step 7 is what guarantees ordering — not queue arrival order.

**Correctness of partial results.** Until §8.5 lands, a serving-batch failure can over-report errors. Phase 1 must present error elements honestly (show the `{type}`/`error`), and the ship criteria pin the "one element per input" invariant so no row is ever silently missing.

**Accessibility & theming.** Reuse Bootstrap components, `SectionCard`, and CSS variables so light/dark and contrast come for free; the results list must be keyboard-navigable and status must not be conveyed by colour alone (pair danger styling with the error text/icon, as `PredictionView` already does). The dropzone needs a click-to-browse fallback for keyboard/AT users.

**Empty & error states.** Batch tab before upload → dropzone prompt; parsing error → inline message with the offending detail; no version deployed → the same "deploy a version first" guidance single mode shows; timeout/404 → the existing redeploy hint.

---

## 11. Dependencies, risks & open questions

**Dependencies.** Phase 1: a client CSV parser (`papaparse` recommended — new `package.json` dep); `registry.wait_many` and an optional push-pipeline helper; `INFERENCE_MAX_BATCH` config. Phase 2: serving-loop change; optional job endpoint/queue. No schema/migration in Phases 1–2.

**Risks.**
- *Ordering/dedup bugs* — mitigated by assembling strictly via the index→key map and by explicit tests with duplicate and cache-hit inputs.
- *Batch-granular serving failures over-reporting errors* (§8.5) — mitigated short-term by chunk sizing, resolved by per-input isolation in Phase 2.
- *Data-plane starvation from big pushes* — mitigated by the cap and sequential client chunking.
- *Client-side parsing of large CSVs* — mitigated by papaparse streaming and the row cap; very large files route to Phase 2 async.
- *Worker/greenlet held for a long synchronous batch* — bounded by the cap; unbounded sizes only via Phase 2 async.

**Open questions.**
1. **Batch body shape** — `{"queries": [...]}` (recommended) vs allowing `query` to be either a string or a list. Recommendation keeps validation explicit; confirm before freezing the public contract.
2. **Per-input `top`** — v1 applies one `top` to the whole batch (query arg). Do we need per-row `top` (object rows `[{query, top}]`)? `model.predict` already supports a per-input `top` list, so it's cheap to add later.
3. **`INFERENCE_MAX_BATCH` value** and the chunk size — pick defaults against expected CSV sizes and the model's per-call latency.
4. **Multi-column CSVs** — auto-pick the input column by name (`text`/`query`/`input`) vs always prompt? And do retained metadata columns matter beyond display/export?
5. **Expected-label column (Phase 3)** — should batch testing eventually score against ground truth and report accuracy, and should named batches be persisted for re-run? This is where batch testing meets the Analyse PRD's evaluation/active-learning surface.
6. **Async threshold** — is client chunking sufficient indefinitely, or is a real job queue (§8.6) needed for the actual dataset sizes users bring?

---

## 12. Appendix — codebase references

| Concern | Location |
|---|---|
| Single infer entry point (extend for batch) | `server/views/triton/inference.py` (`infer`, `api_key_required`) |
| Inference blueprint + CORS after-request | `server/views/triton/__init__.py` |
| Serving loop (already batches; batch-granular failure branch) | `server/tasks/inference.py` |
| `model.predict(X, **kwargs)` is list-native; per-input `top` | `server/models/base.py`, `server/models/text_classification/base.py` |
| Registry: `push`, `pop`, `set`, `get`/`pull`, `wait` (add `wait_many`) | `server/registry.py` |
| API-key auth keyed by `model_id` | `server/auth.py` (`api_key_required`) |
| Inference config knobs (`INFERENCE_*`; add `INFERENCE_MAX_BATCH`) | `server/config.py` |
| Test page: single-query submit, `PredictionView`, `JsonView`, `TokenTags`, `getOutputs`, `isErrorPrediction`, `MetricStrip` | `src/routes/model/routes/test/Test.jsx` |
| CSV upload precedent (drag target copy, "contains header", server-side pandas parse) | `src/routes/model/routes/build/Build.jsx`, `.../build/components/LabelFormModal.jsx`, `server/views/api/labels.py` |
| Export util | `src/shared/utils/downloadBlob.js` |
| Publish request docs / `curl` snippet (add batch variant) | `src/routes/model/routes/publish/Publish.jsx` |
| Endpoint routing (dev `/api/infer` proxied to data plane) | `vite.config.js`, `triton.py` (gevent data plane) |
| Example CSV/TSV with quoted fields (parser test fixtures) | `data/examples/` (`IMDB Dataset.csv`, `BBC_data.tsv`, `Restaurant_Reviews.tsv`) |
| Frontend stack (React 19, react-bootstrap, react-router 7, axios, socket.io; **no CSV lib yet**) | `package.json` |
