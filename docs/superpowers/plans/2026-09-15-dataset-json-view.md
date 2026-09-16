# Dataset JSON View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Table | JSON` switch on the Build page that shows the whole model dataset as one editable JSON tree and saves it back in a single transaction.

**Architecture:** One new control-plane endpoint pair (`GET`/`PUT /api/models/<id>/dataset`) serialises and reconciles authored data only; the reconciler reuses every existing `create`/`from_dict` validator and the existing `_replace_annotations` helper. The client holds `original` + `draft` documents, renders the draft in a dependency-free `JsonEditor` tree, and confirms an id-diff summary before `PUT`.

**Tech Stack:** Flask + SQLAlchemy (backend); React 19 + React-Bootstrap + existing `--app-json-*` theme tokens (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-dataset-json-view-design.md`

## Global Constraints

- No new npm or pip dependencies.
- No DB migration.
- Verification is `python -m py_compile` and `npm run build` (repo has no test suite); plus a scripted GET → PUT round trip per model kind.
- Never `git commit` (standing user rule).
- Dialog composition follows `SessionExpiredModal` / `DeleteConfirmationModal`: centered icon badge, semantic tokens, `aria-labelledby`; copy states exactly what the backend does.
- Reference between collections by **name** (`entity`, `slot`, `intent`); `id` present but read-only; never emit `model_id`, `_link`, timestamps, counts, derived `tags`, or span `value`.

---

### Task 1: `Model.dataset_to_dict()` + `GET /dataset`

**Files:**
- Modify: `server/database/model.py` (add method next to `to_dict`)
- Create: `server/views/api/dataset.py`
- Modify: `server/views/api/__init__.py:15` (add `dataset` to the import list)

**Interfaces:**
- Produces: `Model.dataset_to_dict() -> dict` with the spec's shape per `self.kind`. Ordering: intents/labels/entities by `name`, slots by `name`, values by `id`, utterances by `id` desc, annotations by `start`.
- Produces: `GET /api/models/<modelId>/dataset` → 200 document; 404 when the model isn't the caller's.

- [x] Step 1: Implement `dataset_to_dict` (classification branch: `labels[].utterances[]`; NER/NLU: `entities[].values[].synonyms` as strings, `utterances[].annotations[]` with `entity` (NER) or `slot` (NLU) name; NLU adds `intents[].slots[]` and `utterances[].intent`).
- [x] Step 2: Create `dataset.py` view with `get_dataset` (`token_auth.login_required`, `g.current_user.models.filter_by(id=modelId)`).
- [x] Step 3: Register in `__init__.py`; `python -m py_compile server/database/model.py server/views/api/dataset.py server/views/api/__init__.py`.
- [x] Step 4: `curl -H "Authorization: Bearer $TOKEN" localhost:5001/api/models/<id>/dataset | jq` on one model of each kind.

### Task 2: Reconciler + `PUT /dataset`

**Files:**
- Modify: `server/views/api/dataset.py`

**Interfaces:**
- Consumes: `Intent.create/from_dict`, `Entity.create/from_dict/validate_name`, `Slot.create/from_dict`, `Value.create/from_dict`, `Utterance.create/from_dict`, `_replace_annotations(model, utterance, spans)` from `.utterances` (spans as `{label, start, end}`).
- Produces: `apply_dataset(model, document) -> None` (raises via `abort`), `PUT /api/models/<modelId>/dataset` → 200 fresh document.

- [x] Step 1: `_scoped(path, fn)` helper: runs `fn()`, catches `werkzeug.exceptions.HTTPException` and re-`abort(e.code, f'{path}: {e.description}')`.
- [x] Step 2: Document-level checks first: top-level keys are lists; names unique within `intents`/`labels`/`entities`, slot names unique per intent, every `id` present belongs to this model (else 400 with path).
- [x] Step 3: Phase A — registries update/create: intents (or labels), entities, then slots under their intent (resolve `entity` by name from the doc-updated map), then values under their entity. `db.session.flush()` after each collection so name maps have ids.
- [x] Step 4: Phase B — utterances update/create. Existing: compute `changed = text differs or intent name differs or [(start,end,name)] differs`; if changed set text/intent then `_replace_annotations`. New: `Utterance.create` under label (classification) / intent+model (NLU) / model (NER), then `_replace_annotations` when annotations non-empty. Flush.
- [x] Step 5: Phase C — deletes by omission: utterances, values, slots, entities, intents/labels (in that order). Flush.
- [x] Step 6: `put_dataset` view: `request.is_json` guard, `apply_dataset`, `db.session.commit()`, return `model.dataset_to_dict()`. Rollback is automatic on abort (request teardown), but call `db.session.rollback()` explicitly in an `except HTTPException` before re-raising to be certain.
- [x] Step 7: `py_compile`; scripted round trip per kind: (a) GET→PUT unchanged → response equals GET; (b) rename + add + remove one item in each collection → reflected; (c) bad offset → 400 with `utterances[i].annotations[j]:` prefix and nothing persisted.

### Task 3: Client API + `JsonEditor`

**Files:**
- Create: `src/api/dataset.js`; Modify: `src/api/index.js`
- Create: `src/shared/components/JsonEditor.jsx`, `src/shared/components/JsonEditor.css`

**Interfaces:**
- Produces: `api.dataset.get(modelId)`, `api.dataset.save(modelId, document)`.
- Produces: `<JsonEditor value onChange readOnly={(path)=>bool} templateFor={(path)=>item|undefined} collapsedDepth={1} />`. `path` is an array of keys/indexes. `onChange` receives a new document (immutable update via `setAt(doc, path, value)` / `removeAt` / `insertAt` helpers exported from the same file).

- [x] Step 1: `dataset.js` (two calls) and register in `index.js`.
- [x] Step 2: `JsonEditor.jsx`: recursive `Node` for object/array/leaf. Object: key list; array: indexed items + trailing `+` when `templateFor(path)` returns an item; each array item gets `×`. Collapsible containers show `{ 3 keys }` / `[ 128 items ]` summaries; nodes deeper than `collapsedDepth` start collapsed. Leaf: click → inline `<input>` (number input for numeric leaves, text otherwise; empty on a nullable string → `null`); Enter/blur commit, Esc cancel. `color` keys render a swatch beside the value. Read-only paths render dimmed with no click handler.
- [x] Step 3: `JsonEditor.css`: `.json-editor` monospace via `var(--app-font-mono)`, colours via `--app-json-*`, hover affordances, punctuation muted with `--bs-secondary-color`, focus ring via `--bs-focus-ring-color`.
- [x] Step 4: `npm run build`.

### Task 4: `DatasetJson` surface + save modal + Build switch

**Files:**
- Create: `src/routes/model/routes/studio/DatasetJson.jsx`, `src/routes/model/routes/studio/components/SaveDatasetModal.jsx`
- Modify: `src/routes/model/routes/studio/Build.jsx`

**Interfaces:**
- Consumes: `api.dataset.get/save`, `JsonEditor`, `ModelContext.model.kind`.
- Produces: `diffDataset(original, draft, kind) -> { [collection]: { created, updated, deleted } }` (exported from `DatasetJson.jsx` for the modal).

- [x] Step 1: `DatasetJson.jsx`: load on mount; state `original`, `draft`, `saving`, `alert`; `dirty = JSON.stringify(draft) !== JSON.stringify(original)`; toolbar: change badge (`N changes` = sum of diff counts), **Discard** (`setDraft(original)`), **Save** (opens modal). `beforeunload` guard while dirty. `readOnly = (path) => path[path.length-1] === "id"`; `templateFor` by path shape per kind (label/intent/entity/slot/value/utterance/annotation templates with `id: null`).
- [x] Step 2: `diffDataset`: walk each collection (nested ones flattened with paths) comparing by id — no id → created; id in both and `JSON.stringify` differs → updated; id only in original → deleted.
- [x] Step 3: `SaveDatasetModal.jsx`: icon badge (`CloudUpload`), title "Save dataset changes", per-collection lines "3 utterances created · 2 updated · 1 deleted" (only non-zero collections), caveat line "Deleted rows and their annotations cannot be recovered." shown only when any delete count > 0; footer Cancel / Save (spinner while saving).
- [x] Step 4: On success: `setOriginal(res); setDraft(res)`; success `Alert`. On 400: danger `Alert` with the server message; keep the draft.
- [x] Step 5: `Build.jsx`: read `?view`; render a right-aligned `ButtonGroup` (`Table` / `JSON`, `variant="light"` + `border`, `active` on the current one) in a `d-flex justify-content-end mt-4` row; set/delete `view` in search params preserving other params; branch to `<DatasetJson />` when `view === "json"`.
- [x] Step 6: `npm run build`.

### Task 5: Verification pass

- [x] `python -m py_compile` on every touched Python file; `npm run build`.
- [x] Round-trip script from Task 2 Step 7 re-run against the final code.
- [x] Re-read `docs/superpowers/specs/2026-09-15-dataset-json-view-design.md` and confirm each section maps to shipped code; update the spec's reconciliation order note (registries → utterances → deletes) if wording drifted.
