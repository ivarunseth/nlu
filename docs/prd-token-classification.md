# PRD — Token classification (NER) support

| | |
|---|---|
| **Status** | Draft for review |
| **Owner** | Varun Seth |
| **Last updated** | 2026-07-07 |
| **Surface** | `src/routes/model/routes/build/` (primary), with follow-on work in `test/` and `analyse/` |
| **Related pages** | Build, History, Test, Publish, Analyse (all under `src/routes/model/routes/`) |
| **Audience** | Product, ML engineers, annotators, SRE / operators, stakeholders |

---

## 1. Summary

The app already supports whole-utterance **text classification** end to end: author labels and utterances in **Build**, train a version in **History**, deploy in **Publish**, query in **Test**, and monitor in **Analyse**. This document specifies first-class support for **token classification** — assigning a label to each *word* in an utterance rather than to the utterance as a whole — with **Named Entity Recognition (NER) / slot filling** as the flagship use case.

A user defines a token-classification model by declaring a set of **entities / slots** (e.g. `location`, `datetime`, `artist`, `album`) and then labelling spans inside utterances. The authoring format is inline:

```
What is the weather in {location: Mumbai} {datetime: today}
```

At training time each utterance is converted to **IOB tags**, one per whitespace token, aligned to the labelled spans:

```
Play songs by Pink Floyd from Dark Side of the Moon
O    O     O  B-artist I-artist O B-album I-album I-album I-album I-album
```

The backend is already substantially scaffolded for this: `server/config.py` lists `named_entity_recognition` in `ALLOWED_MODELS`; there is a full model package (`server/models/named_entity_recognition/` with `base`, `recurrent_neural_network`, `transformer`) that consumes exactly this `X`/`y` (text / space-separated IOB tags) contract; and **Test** already ships a `TokenTags` renderer and an NER branch in `PredictionView`. **What is missing is the authoring surface** — there is no way to define entities or label spans — plus a handful of concrete plumbing gaps (a model-type naming mismatch, a broken inference return shape, and classification-only assumptions in training, the dataset schema, and analytics) documented in §3 and §8.

The bulk of the work is therefore in **Build**. Most database tables stay the same or take an additive, minor refactor; exactly one new table (`Annotation`) is introduced.

---

## 2. Background & problem

### 2.1 The data model is classification-shaped

The relational schema (`server/database.py`) encodes one relationship that is perfect for classification and wrong for token classification:

```
Model 1─* Label 1─* Utterance
```

- A **`Label`** belongs to a model and has a `name` (`server/database.py:267`).
- An **`Utterance`** belongs to exactly one **`Label`** via a non-null `label_id` and carries `text` (`server/database.py:345`).

So today an utterance *is owned by a single label* — the class the whole sentence belongs to. That is the definition of classification. In token classification the semantics invert:

- A **label is an entity / slot type** (`location`, `artist`, …) — a *reusable* tag, not a bucket that owns sentences.
- An **utterance is a sentence** that contains **zero or more labelled spans**, each referencing a different entity, at specific character positions.

"`Play songs by Pink Floyd from Dark Side of the Moon`" is not owned by `artist` or by `album`; it references *both*. The current `Utterance.label_id` cannot express that. This is the core modelling gap.

### 2.2 The lifecycle assumes one label per utterance everywhere downstream

Because the schema is classification-shaped, so is everything built on it:

| Concern | Location | Classification assumption |
|---|---|---|
| Dataset export for training | `Training.start()` — `server/database.py:396` | Iterates `model.labels → label.utterances`, emitting `X=utterance.text, y=label.name` (one label per row). |
| CSV import | `Model.read()` / `Label.read()` — `server/database.py:134`, `:291` | Two columns: `text, label`. |
| Dataset analytics | `get_dataset_analytics` — `server/views/api/analytics.py:123` | `join(Utterance, Label)` and groups utterances by their one label. |
| Build UI | `src/routes/model/routes/build/Build.jsx` | A paginated **labels** table; each label drills into its owned utterances (`build/:labelId/utterances`). No span concept. |

None of these can represent an utterance annotated with several entities at known offsets.

### 2.3 Concrete plumbing gaps found in the current scaffolding

Three issues will block a working token-classification model even though the model package exists:

1. **Model-type naming mismatch (breaks creation today).** The create/edit model form already offers three options — but with names that do **not** match the backend:

   | Frontend (`src/routes/home/components/ModelFormModal.jsx:54`) | Backend (`server/config.py:14` `ALLOWED_MODELS`) |
   |---|---|
   | `text_classification` ✅ | `text_classification` |
   | `token_classification` ❌ | `named_entity_recognition` |
   | `language_understanding` ❌ | `natural_language_understanding` |

   Selecting **Token classification** in the UI POSTs `type=token_classification`, which `Model.create()` rejects with `400 Invalid model type` (`server/database.py:125`). The two paths must be reconciled on one canonical string (§8.1, open question 1).

2. **NER inference return shape is incompatible with the serving loop.** The serving loop wraps each prediction as `{...envelope, **prediction}` (`server/tasks/inference.py:80-86`), which requires every prediction to be a **dict**. `text_classification` returns `{'outputs': [...]}` ✅ and `natural_language_understanding` returns `{'intent':…, 'slots':…}` ✅, but `BaseNamedEntityRecognition.predict()` returns a **list of tags** (`server/models/named_entity_recognition/base.py:15-30`). `{**list}` raises `TypeError`, so NER prediction fails end to end. (Test's `PredictionView` even has an `Array.isArray(prediction)` NER branch at `src/routes/model/routes/test/Test.jsx:373` that the serving contract can never actually deliver.)

3. **Prediction is not aligned back to words, and produces no spans.** `predict()` argmaxes over all `max_seq_len` (128) subword positions and returns a tag per position — it neither collapses subwords back to whitespace tokens nor reconstructs entity spans with offsets/values. For a usable NER output (and for Test/Analyse to highlight entities) it must return word-level tags **and** a reconstructed entity list.

These are small, well-scoped fixes, but they must be named so the feature actually runs.

### 2.4 What already exists and should be reused

- **Model package:** `server/models/named_entity_recognition/{base,recurrent_neural_network,transformer}.py` — training loop, IOB `preprocess_y`, subword `tokenize_and_align`, token-level `evaluate`, and Indic-capable pretrained backbones (`ai4bharat/indic-bert`, `google/muril-base-cased`, `bert-base-multilingual-cased`).
- **Training pipeline:** `server/tasks/training.py` already reads a generic `data.csv` with columns `X`, `y` and calls `model.train(X, y, …)`; `y` being a space-separated tag string needs no change to the task itself.
- **Test renderers:** `TokenTags` (`Test.jsx:277`) renders per-token tag chips; `PredictionView` has intent/slots and NER branches.
- **Build components:** `LabelsTable`, `LabelFormModal` — reusable for the entity registry.

---

## 3. Goals & non-goals

### Goals

1. Let a user **define entities / slots** for a token-classification model and **label spans** in utterances, using the inline `{slot: value}` format both as a typed input method and as import/export.
2. Persist annotations in a model that is a **minor, additive refactor** of the existing schema — reuse `Label` (as the entity registry) and `Utterance`, add **one** `Annotation` table.
3. Deterministically produce **IOB tags** from stored spans and feed them through the **existing** `X`/`y` training contract with no change to the training task.
4. Make token-classification models **trainable, deployable, and queryable** end to end — closing the inference-shape and word-alignment gaps so Test renders highlighted entities.
5. Extend **Test** and **Analyse** so the token-classification output is a first-class citizen (entity highlighting, entity-level metrics, entity distribution), not a raw JSON fallback.
6. Keep the **text-classification path byte-for-byte unchanged**; all new behaviour is gated on `model.type`.

### Non-goals

- **Nested / overlapping entities.** Flat, non-overlapping spans only (standard IOB). Nested NER is out of scope.
- **Joint intent + slot (NLU).** `natural_language_understanding` already exists as its own type; this PRD is token-only. (Where a fix — e.g. the naming reconciliation — also touches NLU, it is noted, but NLU authoring is not designed here.)
- **Relation extraction, coreference, entity linking / normalization** (e.g. mapping "today" → a date). Out of scope; the stored `value` is the surface string only.
- **Pre-annotation / model-assisted labelling** (using a trained version to suggest spans). Attractive follow-up; not in the initial scope.
- **BILOU / BIOES** tagging schemes. IOB (a.k.a. IOB2/BIO) only, matching the model package.

---

## 4. Personas & user stories

**P1 — Annotator / dataset author.** Owns labelled data quality.
- As an annotator, I want to define my entities once (name + colour) and then reuse them across every utterance.
- As an annotator, I want to select a phrase and tag it as an entity with one click, and see it highlighted in the entity's colour.
- As an annotator, I want to type the inline `{slot: value}` syntax directly and have it parsed into highlighted spans.
- As an annotator, I want to preview the exact IOB tag sequence an utterance will train on, so I can trust the conversion.
- As an annotator, I want to bulk-import pre-annotated data (inline, CoNLL, or JSON) and have entities auto-created.

**P2 — ML engineer.** Owns model quality.
- As an engineer, I want the span data converted to correct, aligned IOB tags so training "just works" on the existing pipeline.
- As an engineer, I want **entity-level** precision/recall/F1 (not only token-level), because a partially-correct span is not a correct entity.
- As an engineer, I want to query a deployed model in Test and see predicted entities highlighted over my input.

**P3 — Product owner / stakeholder.**
- As a stakeholder, I want to create a "token classification" model from the same New Model dialog and have it work.
- As a stakeholder, I want a plain read on dataset health: how many utterances, how many are annotated, which entities are under-represented.

**P4 — SRE / operator.**
- As an operator, I want deployed token-classification models to serve, log telemetry, and appear in Analyse's Production tab like any other model.

---

## 5. Success metrics

| Metric | Target |
|---|---|
| End-to-end enablement | A user can create a token-classification model, define ≥2 entities, annotate ≥N utterances, train, deploy, and get highlighted entities in Test — with no manual DB or file steps. |
| Round-trip fidelity | Inline `{slot: value}` → stored spans → IOB → inline export reproduces the original annotation exactly (100% on the test corpus), modulo whitespace normalization. |
| Annotation speed | Median time to annotate one entity span (select → assign) under 3 seconds once entities are defined. |
| Metric trust | Entity-level F1 shown in Analyse matches an independent `seqeval` computation within rounding on the eval set. |
| No regression | Text-classification Build/Train/Test/Analyse behaviour and metrics are unchanged (verified against current snapshots). |

---

## 6. Where token classification fits (information architecture)

No new top-level pages. The five existing tabs (`Build`, `History`, `Test`, `Publish`, `Analyse`) all stay; each becomes **type-aware**, branching on `model.type` (already available via `ModelContext`, `src/contexts/ModelContext.jsx`).

```
/models/:modelId/build   ← PRIMARY WORK
    text_classification         → existing labels table (unchanged)
    token_classification        → Entities panel  +  Annotation workspace  +  IOB preview  +  import/export

/models/:modelId/test    ← entity highlighting over the query; token-aware comparison
/models/:modelId/analyse ← entity distribution (Dataset); entity-level P/R/F1 (Model); predicted-entity mix (Production)
/models/:modelId/history ← per-run reports already generic; ensure token-level/entity-level report renders
/models/:modelId/publish ← unchanged (serving is model-type agnostic)
```

History and Publish need little or no change: History renders whatever `evaluation.report` it is given, and Publish/serving are already type-agnostic (the serving loop passes `model_type` through and `Model.load()` dispatches on it).

---

## 7. Functional requirements

Tagged **[reuse]** (existing code/data, possibly minor refactor), **[new]** (net-new), **[fix]** (correct an existing gap from §2.3).

### 7.1 Build — Entities panel (P1)

The entity registry reuses the `Label` table and the existing table/modal components.

| # | Requirement | Source |
|---|---|---|
| EN-1 | For a token-classification model, Build's primary object is the **entity** (a `Label`): create, rename, delete, list, search — reusing `LabelsTable` / `LabelFormModal`. | [reuse] |
| EN-2 | Each entity has a **colour** used to highlight its spans across Build/Test/Analyse; a stable default palette is assigned on create and is editable. | [new] (adds `Label.color`) |
| EN-3 | Each entity may have an optional **description** (annotation guideline shown on hover). | [new] (adds `Label.description`) |
| EN-4 | Entity names are unique per model (already enforced, `Label.create`, `server/database.py:282`) and are validated to be IOB-safe (no whitespace; used as the `B-`/`I-` suffix). | [reuse]+[new] |
| EN-5 | Deleting an entity cascades to its annotations (not to utterances); a confirmation states how many spans will be removed. | [new] |

### 7.2 Build — Annotation workspace (P1) — the core of this PRD

| # | Requirement | Source |
|---|---|---|
| AN-1 | A **model-scoped utterance list**: add, edit text, delete, search, paginate — utterances belong to the *model*, not to one entity (§8.2). | [new]+[reuse] |
| AN-2 | **Visual span labelling:** select text in an utterance → pick an entity from a popover → the span is stored and rendered as a colour-coded highlight showing the entity name. | [new] |
| AN-3 | **Inline syntax input:** typing `{location: Mumbai}` in an utterance is parsed into a span on commit; the stored form is structured spans, not the raw markup. Malformed markup (unknown entity, unbalanced braces) is flagged inline. | [new] |
| AN-4 | **Un-label:** clicking a highlighted span offers "remove"; removing a span never deletes the surrounding text. | [new] |
| AN-5 | **Overlap prevention:** a new span that overlaps an existing one is rejected with a clear message (flat NER only, per §3). | [new] |
| AN-6 | **IOB preview:** each utterance can reveal the exact whitespace-token → IOB tag sequence it will train on (reusing the chip styling of Test's `TokenTags`), so the annotator sees the conversion. | [new]+[reuse] |
| AN-7 | **Unlabelled utterances are valid** training data (all-`O`); the UI distinguishes "no spans yet" from "reviewed, intentionally empty". | [new] |
| AN-8 | Auto-suggest: when the same surface string was previously labelled as entity E, offer E on re-selection (cheap dictionary assist; not model-based). Nice-to-have. | [new] |

### 7.3 Build — Import / export (P1)

| # | Requirement | Source |
|---|---|---|
| IO-1 | **Import inline format:** a file of one annotated utterance per line (`… {location: Mumbai} {datetime: today}`) is parsed into utterances + spans; entities not yet defined are auto-created (with default colours). | [new] |
| IO-2 | **Import CoNLL / IOB:** token-per-line with a tag column, blank line between utterances → utterances + spans (spans reconstructed by merging `B-`/`I-` runs). | [new] |
| IO-3 | **Import JSON spans:** `{text, entities:[{start,end,label}]}` per line/record. | [new] |
| IO-4 | **Export** the dataset in each of the above formats (inline is the default, human-readable round-trip), reusing `downloadBlob`. | [new]+[reuse] |
| IO-5 | Import validates offsets against text length, rejects overlaps, and reports a per-line error summary rather than failing the whole file. | [new] |
| IO-6 | **Unified parsing (see `docs/prd-entity-values.md` §7):** every format parses through `server/tagging.py:parse_dataset` into one record shape shared with language understanding. Intent-bearing files (an `intent<TAB>` inline prefix, a JSON `intent` field, a CSV `labels` column) import here with the intent *ignored*, never as an error; a `{slot@entity: value}` carrier resolves to its **entity**; an empty CSV `tags` cell is all-`O`. The same file imports the same number of utterances and annotations on either annotated model type. | [new] |

Entities additionally carry an **open/closed list** type and an authored **value catalogue** (values + synonyms, edited in the entity drill-in behind `?entity=<id>`), which feeds training-data generation — see `docs/prd-entity-values.md`.

### 7.4 Training (P2)

| # | Requirement | Source |
|---|---|---|
| TR-1 | `Training.start()` gains a token-classification branch that builds the **same** `X`/`y` CSV, where `X`=utterance text and `y`=space-separated IOB tags derived from spans via the shared tokenizer (§8.3). No change to `server/tasks/training.py`. | [fix]+[reuse] |
| TR-2 | IOB derivation is **deterministic and shared** with the IOB-preview UI (AN-6) so preview == trained data. | [new] |
| TR-3 | `train_test_split(stratify=y)` is not meaningful when every `y` is a unique tag string; the existing `except ValueError` fallback to unstratified split already covers this (`server/tasks/training.py:32-37`) — verify, don't re-engineer. | [reuse] |
| TR-4 | The `O` tag and all `B-`/`I-` tags form the label set; `preprocess_y` already builds it from the data (`named_entity_recognition/base.py:62`). Confirm the `O`-heavy class imbalance is acceptable or documented (no class weighting in v1). | [reuse] |

### 7.5 Inference & Test (P2) — [fix] then [enhance]

| # | Requirement | Source |
|---|---|---|
| IN-1 | NER `predict()` returns a **dict** compatible with the serving loop's `{**prediction}` (§2.3 #2): e.g. `{'tags': [word-level IOB…], 'entities': [{'entity','value','start','end','score'}]}`. | [fix] |
| IN-2 | `predict()` **aligns subword tags back to whitespace tokens** and **reconstructs entity spans** (merge `B-`/`I-` runs into `{entity,value,start,end}`) with a span confidence. | [fix] |
| IN-3 | Test renders predicted **entities highlighted over the query** (same colour language as Build) in addition to the per-token chips; update `PredictionView` to key off the new dict shape instead of `Array.isArray` (`Test.jsx:373`). | [enhance] |
| IN-4 | Test's cross-environment comparison (`comparePredictions`, `Test.jsx:88`) gets a token-classification branch: compare entity lists (added/removed/changed spans) rather than whole-JSON equality. | [enhance] |

### 7.6 Analyse (P3, P4)

| # | Requirement | Source |
|---|---|---|
| AL-1 | **Dataset tab:** entity distribution (span count per entity), utterance count, **% utterances annotated**, tokens tagged `O` vs entity, span-length distribution, entity co-occurrence. The current `get_dataset_analytics` join is classification-only (`analytics.py:129-135`) and needs a token-classification branch (§8.6). | [fix]+[new] |
| AL-2 | **Model tab:** **entity-level** precision/recall/F1 (seqeval-style: a span counts only if type *and* boundaries match), alongside the existing token-level report from `base.evaluate`. | [new] |
| AL-3 | **Production tab:** predicted-entity mix and low-confidence spans. Telemetry's `label`/`score` columns are classification-shaped (`PredictionLog`, `server/database.py:774`); token models rely on the stored `output` JSON, with `label`/`score` left null or repurposed as "entity count / mean span score" (open question 4). | [new] |
| AL-4 | Empty states: no entities → point to the Entities panel; no annotated utterances → explain all-`O` training; no successful training → point to History. | [reuse] |

---

## 8. Technical design

### 8.1 Model type & naming reconciliation

Resolve the §2.3 #1 mismatch on **one canonical type string**. **Recommended:** adopt **`token_classification`** as the canonical type (it matches the user framing and the existing frontend option), and treat the current `named_entity_recognition` model package as its implementation:

- `server/config.py` → `ALLOWED_MODELS` includes `token_classification`.
- `server/models/__init__.py` factory maps `token_classification` → the existing NER classes (rename the package to `token_classification/` **or** register an alias entry pointing at `NamedEntityRecognition`; alias is the smaller diff).
- Accept `named_entity_recognition` as a legacy alias so any existing rows/routes keep working, and do the same reconciliation for `natural_language_understanding` ↔ frontend `language_understanding` (out of scope to build, but fix the alias so the dropdown isn't broken).
- `model_type` is threaded through routes and the serving loop already (`Route.model_type`, `server/tasks/inference.py:14`), so once the string is canonical no serving change is needed.

Alternative (smaller UI diff, worse naming): keep `named_entity_recognition` canonical and change the two frontend `<option value>`s. Decide in open question 1.

### 8.2 Data model — reuse two tables, add one

**`Label` (reuse as the entity registry).** Additive columns only:

| Column | Change |
|---|---|
| `color` | **new**, nullable string (hex); default assigned from a palette on create (EN-2). |
| `description` | **new**, nullable text (EN-3). |

No structural change; per-model name uniqueness already holds.

**`Utterance` (minor refactor to be model-scoped for token models).**

| Column | Change |
|---|---|
| `model_id` | **new**, nullable FK → `models.id`. |
| `label_id` | relaxed to **nullable**. |

Invariant: **exactly one** of (`label_id`, `model_id`) is set. `text_classification` utterances keep `label_id` (unchanged behaviour, `label.utterances` still works); `token_classification` utterances set `model_id` and have `label_id` null. Add `Model.utterances` (a `dynamic` relationship, filtered to `model_id`) for the workspace list.

**`Annotation` (new table)** — one labelled span:

| Column | Notes |
|---|---|
| `id` | PK |
| `utterance_id` | FK → `utterances.id`, cascade delete |
| `label_id` | FK → `labels.id` (the entity); cascade delete |
| `start`, `end` | **character** offsets into `utterance.text`, half-open `[start, end)` |
| `value` | denormalized surface string (`text[start:end]`); convenience for lists/export |
| `created_at` | ordering |

Character offsets (not token indices) are the source of truth because they survive re-tokenization and render directly as highlights; IOB is derived at train/preview time (§8.3). A DB-level or app-level check enforces non-overlap per utterance (AN-5). This is the **only** new table; an Alembic migration under `migrations/versions/` adds it plus the two column sets (mirroring the existing `b3f1c07d92e4_add_prediction_logs.py`).

### 8.3 Span ↔ IOB conversion (shared, deterministic)

A single module (e.g. `server/utils.py` or a new `server/tagging.py`) provides both directions, used by TR-1/TR-2 and AN-6 so preview and training never diverge:

- **spans → IOB:** whitespace-tokenize `text`; for each token, if it falls inside a span for entity `E`, tag `B-E` on the token where the span starts and `I-E` on subsequent tokens, else `O`. Tokens must be produced with their offsets so span boundaries map to token boundaries; partial-token spans are snapped to the enclosing token(s) and a warning is surfaced at annotation time.
- **IOB → spans:** merge maximal `B-E (I-E)*` runs into `{entity:E, start, end, value}` — used by CoNLL import (IO-2) and inference span reconstruction (IN-2).

Indic scripts: the project targets Indic NLU, so tokenization must be defined explicitly. v1 uses Unicode-aware whitespace tokenization (matching `TokenTags`' `query.trim().split(/\s+/)` on the client, `Test.jsx:278`, and `text.split()` in the model, `named_entity_recognition/base.py:82`). Punctuation-splitting and script-specific segmentation are called out as an open question (5), since they affect how subword `tokenize_and_align` (`transformer.py:50`) lines up.

### 8.4 Training path

`Training.start()` (`server/database.py:396`) branches on `model.type`:

- **classification (unchanged):** iterate `labels → utterances`, emit `X=text, y=label.name`.
- **token classification (new):** iterate `model.utterances`, emit `X=utterance.text, y=` spans→IOB string (§8.3).

Both write the same `data.csv` (`X`, `y`) the training task already loads (`server/tasks/training.py:27-28`), so the task, `Model.create(model_type, architecture)` dispatch, and NER model training loop need no change. Default architecture for token models should be `transformer` (or `recurrent_neural_network`); confirm the default wired in the training request/History arch map (`History.jsx:225` already lists NER architectures).

### 8.5 Inference path

Fix the model, not the serving infrastructure:

- `BaseNamedEntityRecognition.predict()` (`named_entity_recognition/base.py:15`) returns the IN-1 dict; the serving loop's `{**prediction}` then works unchanged (`server/tasks/inference.py:80`).
- Subword→word alignment reuses the `word_ids` logic already present in `tokenize_and_align` (`transformer.py:70-78`); at inference we take the first-subword tag per word.
- `PredictionLog`/telemetry capture (`server/telemetry.py`, `capture()` in `inference.py`) stores the full `output` JSON regardless of shape; only the derived `label`/`score` columns are classification-specific (AL-3).

### 8.6 Analyse endpoints

`get_dataset_analytics` (`analytics.py:123`) branches on `model.type`: the classification branch keeps the `Utterance⋈Label` grouping; the token branch aggregates over `Annotation` (spans per `Label`, annotated-utterance ratio, span lengths, `O`/entity token ratio, co-occurrence). Model-tab entity-level metrics come from a token branch in `Base…evaluate` (or a new seqeval-style helper) so the report exposes both token-level (existing) and entity-level P/R/F1.

### 8.7 Frontend structure

- `Build.jsx` splits on `model.type`: the current labels flow is extracted as-is for `text_classification`; a new `components/` set (`EntitiesPanel`, `AnnotationWorkspace`, `AnnotatedUtterance`, `EntityPopover`, `IobPreview`, import/export modal) drives `token_classification`.
- Colour language, the span-merge helper, and the IOB chip renderer are shared with Test (extract `TokenTags` and an `EntityHighlights` component into `src/shared/components/`).
- New utterance/annotation endpoints follow the existing conventions (token auth, model-scoped, resource-keyed pagination like `{utterances:[…], total, page, per_page}`), extending `server/views/api/utterances.py` and adding an annotations view.

---

## 9. Phasing & rollout

| Phase | Scope | Backend | User value |
|---|---|---|---|
| **0 — Unblock creation** | Reconcile the model-type string (§8.1); fix NER `predict()` shape + word alignment (§8.5). | `config`, `models/__init__`, `named_entity_recognition/base` | A token model can be created, trained on hand-made CSV, deployed, and queried in Test (which already renders tags). |
| **1 — Authoring (core)** | Data model (§8.2) + migration; Entities panel; Annotation workspace; IOB preview; span↔IOB module; token branch in `Training.start`. | `database`, `utterances`/`annotations` views, `tagging` | Users author NER datasets in-app and train from them. No files. |
| **2 — Import/export & Test polish** | Inline/CoNLL/JSON import+export; entity highlighting + token-aware comparison in Test. | import parsers | Bulk onboarding of existing corpora; readable predictions. |
| **3 — Analyse** | Dataset entity distribution; entity-level P/R/F1; predicted-entity mix in Production. | `analytics` token branches, seqeval helper | Dataset & model health for token models. |

Each phase is independently shippable. Phase 0 is a prerequisite for the rest and is small.

### Ship criteria

- Phase 0: text-classification path provably unchanged; a token model round-trips create→train→deploy→Test.
- Phase 1: IOB preview == trained `y` for every utterance; overlap prevention holds; delete-entity cascade correct.
- Phase 2: inline export re-imports to identical spans; import error report is per-line.
- Phase 3: entity-level F1 matches `seqeval`; light/dark themes correct; empty states present.

---

## 10. Cross-cutting concerns

- **No classification regression.** All new behaviour is gated on `model.type`; the classification Build/Train/Test/Analyse code paths are extracted intact, not rewritten. Snapshot the current classification metrics and diff after.
- **Migration safety.** `Utterance.label_id` becomes nullable and gains `model_id`; the migration must backfill nothing (existing rows keep `label_id`) and add the exactly-one-of invariant only for new token rows. Reuse the migration pattern in `migrations/versions/b3f1c07d92e4_add_prediction_logs.py`.
- **Offsets & Unicode.** Character offsets are over Python/JS string code units; ensure client selection offsets and server slicing agree for multi-byte Indic text (test with Devanagari, etc.). This is the highest-risk correctness area — cover with fixtures.
- **Tokenization consistency.** The client IOB preview, the server training conversion, and the model's `tokenize_and_align` must agree on token boundaries; centralize the whitespace rule (§8.3) and test all three against the same corpus.
- **Privacy/telemetry.** Unchanged from the Analyse PRD: capture of `input_text` stays config-gated (`TELEMETRY_CAPTURE`); token models store full `output` JSON, which may include user text spans — same retention/PII controls apply.
- **Accessibility.** Colour is never the only signal for entities: pair the highlight colour with the entity name label and an accessible tag chip (as `TokenTags` already does).

---

## 11. Dependencies, risks & open questions

**Dependencies.** Phase 0: none. Phase 1: the `Annotation` migration and the shared tagging module. Phase 3: the entity-level metric helper (`seqeval` or hand-rolled).

**Risks.**
- *Offset drift* between client selection and server slicing on Indic/multibyte text → wrong spans and wrong IOB. Mitigate with a single offset convention + fixtures (§10).
- *Preview ≠ trained data* if two tokenizers diverge → user distrust. Mitigate by sharing one conversion (§8.3, TR-2).
- *Silent inference breakage* — the `{**prediction}` list bug (§2.3 #2) means NER looks wired but never runs; Phase 0 must include an end-to-end serving test, not just a unit test.
- *Schema invariant* (exactly one of `label_id`/`model_id`) not enforced → orphan/ambiguous utterances. Enforce in `Utterance.create` and, if the DB supports it, a check constraint.

**Open questions.**
1. **Canonical model-type string:** adopt `token_classification` (recommended, matches UI + user framing) and alias `named_entity_recognition`, or keep `named_entity_recognition` and fix the two dropdown values? (Whichever, also fix the `language_understanding`↔`natural_language_understanding` alias so the existing dropdown isn't broken.)
2. **Utterance ownership:** the recommended nullable-`model_id` + nullable-`label_id` on one `Utterance` table (minimal, per user's "tables stay the same") vs a separate `Sentence`/`Document` table for token models (cleaner separation, larger diff). Recommendation: the former.
3. **Authoring primacy:** is the inline `{slot: value}` textbox the primary input with visual highlighting as the render, or the visual selector primary with inline as import/export only? Recommendation: visual selection primary, inline as a power-user input + the canonical export.
4. **Telemetry columns for token models:** leave `PredictionLog.label`/`score` null and rely on `output` JSON, or repurpose them (e.g. entity count / mean span score) for cheap Production aggregates?
5. **Tokenization rule:** whitespace-only (v1) vs punctuation-aware/script-aware segmentation for Indic scripts — and how that interacts with subword `tokenize_and_align`.
6. **Default architecture** for token models (`transformer` vs `recurrent_neural_network`) and whether both are exposed at train time.

---

## 12. Appendix — codebase references

| Concern | Location |
|---|---|
| Model types allowed | `server/config.py:14` (`ALLOWED_MODELS`) |
| Model-type dropdown (naming mismatch) | `src/routes/home/components/ModelFormModal.jsx:54-56` |
| Classification-shaped schema (`Label`, `Utterance`) | `server/database.py:267`, `:345` |
| Prediction log (classification-shaped) | `server/database.py:774` |
| Dataset export for training (per-label) | `server/database.py:396` (`Training.start`) |
| CSV import (text,label) | `server/database.py:134` (`Model.read`), `:291` (`Label.read`) |
| Training task (generic X/y CSV) | `server/tasks/training.py:25-57` |
| NER model package (train/predict/evaluate/align) | `server/models/named_entity_recognition/{base,recurrent_neural_network,transformer}.py` |
| NER predict returns a list (breaks `{**prediction}`) | `server/models/named_entity_recognition/base.py:15-30` |
| Serving loop requires dict predictions | `server/tasks/inference.py:80-86` |
| Model factory dispatch on type | `server/models/__init__.py` |
| Build page (labels flow to refactor) | `src/routes/model/routes/build/Build.jsx`, `components/{LabelsTable,LabelFormModal}.jsx` |
| Per-label utterance editing | `src/routes/model/routes/utterances/`, `server/views/api/utterances.py` |
| Test renderers (`TokenTags`, `PredictionView` NER branch) | `src/routes/model/routes/test/Test.jsx:277`, `:373` |
| Test comparison (whole-JSON; needs token branch) | `src/routes/model/routes/test/Test.jsx:88` |
| Dataset analytics (classification-only join) | `server/views/api/analytics.py:123-196` |
| Analyse page & PRD | `src/routes/model/routes/analyse/`, `docs/prd-analyze-page.md` |
| Model context (exposes `model.type`) | `src/contexts/ModelContext.jsx` |
| Migration pattern | `migrations/versions/b3f1c07d92e4_add_prediction_logs.py` |
| Shared UI + utils | `src/shared/components/SectionCard.jsx`, `src/shared/utils/downloadBlob.js`, `AppPagination.jsx` |
