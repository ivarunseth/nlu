# Intent/Entity split — design

**Date:** 2026-07-14
**Status:** Approved (pending spec review)

## Goal

Replace the single `Label` table (discriminated by a `kind` column) with two
first-class tables, and rename the value-catalogue models:

| Before | After | Table |
|---|---|---|
| `Label` (`kind='label'`) | `Intent` | `intents` |
| `Label` (`kind='tag'`) | `Entity` | `entities` |
| `EntityValue` | `Value` | `values` |
| `EntityValueSynonym` | `Synonym` | `synonyms` |

The split propagates end-to-end: database schema, ORM models, HTTP API
(`/labels` → `/intents`, new `/entities`), and the React frontend. "Intent"
is the universal term for whole-utterance classes, including on plain
text-classification models (display copy in the UI may still say "label" to
humans; the *resource* is intent).

No data migration: there is no production data, dev databases are rebuilt
from scratch.

## Non-goals

- No behavior changes: validation rules, uniqueness rules, cascade
  semantics, colors, training CSV shapes, and import/export formats all
  stay exactly as they are today.
- No serving/registry changes: routes, Redis coordination, and Celery
  tasks are untouched.
- No changes to the interchange formats in `server/utils/dataset.py`.

## 1. Data model (`server/database/`)

### `Intent` — `intent.py`, table `intents` (was `Label`)

Columns: `id, model_id, name, color, description, created_at, updated_at`.
**Dropped:** `kind`, `list_type`.

Relationships:
- `model` ↔ `Model.intents`
- `utterances` (cascade all,delete) ↔ `Utterance.intent` — FK `utterances.intent_id`
- `slots` (cascade all,delete) ↔ `Slot.intent` — FK `slots.intent_id`

Behavior carried over from the `kind='label'` branch of `Label`:
- `create(data, model)`: name uniqueness among the model's *intents*;
  color drawn from the intents palette (`next_label_color` over
  `model.intents` colors). No whitespace restriction on names (unchanged
  for classes/intents). All `kind`/`list_type` logic deleted.
- `read`/`write` (classification CSV import/export per class) unchanged.
- `utterance_list` property unchanged.
- `from_dict`: fields `name, color, description` only.
- `to_dict`: drops `kind`, `list_type`, `values_count`; keeps
  `utterances_count`; keeps `slots_count` on NLU models (via `slots`).
  `_link` uses the renamed endpoints (`api.get_intent`, `api.get_utterances`).

`Label.default_kind` is deleted entirely.

### `Entity` — `entity.py`, table `entities` (new class, was `Label kind='tag'`)

Columns: `id, model_id, name, list_type` (default `'open'`),
`color, description, created_at, updated_at`.

Relationships:
- `model` ↔ `Model.entities`
- `annotations` (cascade all,delete) ↔ `Annotation.entity` — FK
  `annotations.entity_id`
- `values` (cascade all,delete) ↔ `Value.entity` — FK `values.entity_id`
- `slots` (cascade all,delete) ↔ `Slot.entity` — FK `slots.entity_id`
  (dropping an entity takes its slots and, through them, their spans —
  same cascade semantics as today's `entity_slots`)

Behavior carried over from the `kind='tag'` branch of `Label`:
- `create(data, model)`: whitespace-free name validation
  (`validate_name`), `list_type` in `('open','closed')` defaulting to
  `'open'`, name uniqueness among the model's *entities*, color from the
  entities palette.
- `catalogued_terms(exclude_value_id=None)` and `annotation_surfaces()`
  move here unchanged (the NLU branch of `annotation_surfaces` joins
  through `Slot.entity_id` and now joins `Intent` for the intent name).
- `from_dict`: `name, color, description, list_type` (same validation).
- `to_dict`: includes `list_type`, `values_count`, `annotations_count`
  (direct on NER; via slots on NLU), `slots_count` on NLU. `_link` points
  at the new entity endpoints, including the values catalogue.

### `Annotation` — `annotation.py`

- Column `label_id` → **`entity_id`** (FK `entities.id`, nullable);
  relationship `.label` → **`.entity`**. XOR invariant is now exactly one
  of `entity_id` / `slot_id`.
- `name` property: `slot.name if slot else entity.name`.
- `create(data, utterance, entity=None, slot=None)`.
- `to_dict`: emits `entity_id` where it emitted `label_id`. The **`label`
  key stays** in both branches as the span's *display name* (slot name or
  entity name) — it is presentation, not a model reference, and keeps the
  annotation workspace rendering identical for both model types. The NER
  branch reads name/color from `self.entity`.

### `Utterance` — `utterance.py`

- Column `label_id` → **`intent_id`** (FK `intents.id`); relationship
  `.label` → **`.intent`**.
- The label/model XOR in `create` and `reassign(intent, resolve=None)`
  keep identical semantics, with `label` renamed to `intent` throughout
  (parameters, error messages may keep their current wording).
- `to_dict`: emits `intent_id` where it emitted `label_id`; the nested
  `intent` object stays as-is. The classification branch's `_link` uses
  the renamed intent endpoints.

### `Slot` — `slot.py`

- Columns unchanged — `intent_id` and `entity_id` now literally match
  their target tables (`intents.id`, `entities.id`).
- `intent` relationship targets `Intent`, back-populates **`slots`**;
  `entity` targets `Entity`, back-populates **`slots`** (was
  `intent_slots`/`entity_slots` on `Label`).
- `create`/`from_dict` validate via `model.intents` / `model.entities`
  instead of kind-filtered `model.labels`.

### `Value` — `value.py`, table `values` (was `EntityValue`)

- Column `label_id` → **`entity_id`** (FK `entities.id`); relationship
  `.label` → **`.entity`** ↔ `Entity.values`.
- `synonyms` ↔ `Synonym.value_row` unchanged.
- All term-uniqueness validation unchanged. `to_dict` emits `entity_id`
  where it emitted `label_id`.

### `Synonym` — `synonym.py`, table `synonyms` (was `EntityValueSynonym`)

- `value_id` FK → `values.id`; `value_row` relationship unchanged.

### `Model` — `model.py`

- Relationship `labels` → **`intents`**; new **`entities`** relationship
  (cascade all,delete, dynamic). `label_list` property → `intent_list`.
- `read()` (classification CSV) creates `Intent` rows.
- `_ner_importer`: entity registry from `self.entities`; auto-created
  spans become `Entity` rows; `Annotation(entity=…)`.
- `_nlu_importer`: intents from `self.intents`, entities from
  `self.entities`, slots unchanged.
- `annotation_stats`: `entities` count from `self.entities`, `intents`
  count from `self.intents`; the NLU values-count query joins are
  unchanged in shape.
- `to_dict._links`: `labels` → `intents` (`api.get_intents`).

### `Training` — `training.py`

- Classification branch iterates `self.model.intents`
  (`Intent.created_at` ordering unchanged).
- `_augmented_records`: catalogue built from `self.model.entities`
  (replaces `labels.filter_by(kind='tag')`).
- NLU `slot_map` construction unchanged.

### Package `__init__.py`

Re-export `Intent, Entity, Value, Synonym` (replacing
`Label, EntityValue, EntityValueSynonym`) alongside the unchanged models.
Files `label.py`, `entity_value.py`, `entity_value_synonym.py` are
replaced by `intent.py`, `entity.py`, `value.py`, `synonym.py`.

## 2. HTTP API (`server/views/api/`)

### `intents.py` (renames `labels.py`)

- Routes `/models/<modelId>/labels…` → `/models/<modelId>/intents…`;
  endpoint functions `get_labels/get_label/create_label/edit_label/delete_label`
  → `get_intents/get_intent/create_intent/edit_intent/delete_intent`.
- The `?kind=` filter is deleted (the resource is unambiguous now).
- List response key `labels` → **`intents`**.
- Dataset upload/CSV export behavior (classification) unchanged.

### `entities.py` (new)

CRUD mirroring today's tag-flavored label endpoints, i.e. what the
frontend already sends for entities (form data: `name`, `color`,
`description`, `list_type`):

- `GET /models/<modelId>/entities` — pagination + `query` search, response
  key **`entities`**.
- `GET/POST/PUT/DELETE /models/<modelId>/entities[/<entityId>]`.
- Restricted to annotated model types (`named_entity_recognition`,
  `natural_language_understanding`), mirroring the values view's guard.
- No dataset-file handling (entities never had a per-entity CSV import).

### `values.py`

- Routes re-nest: `/models/<modelId>/labels/<labelId>/values…` →
  `/models/<modelId>/entities/<entityId>/values…`.
- `_get_entity` resolves via `model.entities` (no kind filter).
- Response shapes unchanged apart from `entity_id` in value dicts.

### `utterances.py`

- Intent-nested routes: `/models/<modelId>/labels/<labelId>/utterances…`
  → `/models/<modelId>/intents/<intentId>/utterances…` (endpoint function
  names stay `get_utterances` etc. — `url_for` targets update where the
  param renames `labelId` → `intentId`).
- `_get_intent` resolves via `model.intents`.
- `_replace_annotations` NER branch resolves via `model.entities`, accepts
  `entity_id` (id key, was `label_id`) or `label` (name key, unchanged —
  the display-name convention shared with `Annotation.to_dict`), and
  passes `entity=`.

### `annotations.py`

- NER branch: `model.entities` lookup, `entity_id` in the request payload,
  `Annotation.create(data, utterance, entity)`.
- NLU branch unchanged.

### `analytics.py`

- Import `Intent, Entity` instead of `Label`; kind filters deleted.
- Intent distribution queries join `Utterance.intent_id == Intent.id`.
- Entity value-diversity query joins `Slot.entity_id == Entity.id`.
- **Response keys stay unchanged.** The `labels` key in analytics payloads
  is a uniform chart-payload key carrying "the model's classes" across all
  three model types (classification labels / NER entities / NLU intents),
  which is what lets the Analyse components render one way. Like the
  annotation `label` display key, it is presentation, not a model
  reference. Analyse components therefore need no changes.

## 3. Frontend (`src/`)

- **`/labels` → `/intents`** everywhere a class/intent is meant:
  `ClassificationBuild.jsx` (also drop the `kind` prop and its
  `data.append("kind", …)`/params plumbing; `UnderstandingBuild.jsx` stops
  passing `kind="label"`), `IntentWorkspace.jsx` (intent lookups), and any
  response-key reads `labels` → `intents`.
- **`/labels?kind=tag` → `/entities`**: `AnnotationBuild.jsx`,
  `EntitiesBuild.jsx`, `IntentWorkspace.jsx` (entity list + inline entity
  creation); response key `entities`.
- **`EntityValues.jsx`**: `/labels/<id>/values` → `/entities/<id>/values`.
- **Span payloads**: `label_id` → `entity_id`
  (`AnnotationBuild.jsx`, `AnnotatedUtterance.jsx`); the name-based
  `label` key in inline-edit span payloads stays (display-name
  convention).
- **Utterance payloads**: reads of `utterance.label_id` → `intent_id`
  (the nested `intent` object is unchanged).
- **`Utterances.jsx`** (classification per-label utterance CRUD):
  `/labels/<id>/utterances…` → `/intents/<id>/utterances…`.
- **`Model.jsx`** (breadcrumb name fetch): resolves `?entity=` drill-ins
  via `/entities/<id>`, everything else via `/intents/<id>`.
- **`Test.jsx`**: the name→color fetch calls `/intents` (plus `/entities`
  on annotated model types) instead of `/labels`, concatenating the two
  lists; `labelCount` becomes the combined total, matching today's
  all-rows semantics.
- **Analyse components**: no changes (analytics response keys unchanged).
- Display copy (button text, headings) unchanged.

## 4. Migration

One new Alembic revision at the current head (`f3a9d17c68b2`). Because the
rename fans out across five FK-bearing tables and there is no data to
preserve, the migration **drops and recreates** the affected tables rather
than chaining renames:

- `upgrade()`: drop `annotations`, `slots`, `entity_value_synonyms`,
  `entity_values`, `utterances`, `labels` (dependency order); create
  `intents`, `entities`, `utterances`, `slots`, `values`, `synonyms`,
  `annotations` with the new columns and FKs.
- `downgrade()`: the mirror image, recreating the old `labels`-based
  schema.
- Uses only generic `op.create_table`/`op.drop_table` — portable across
  SQLite and PostgreSQL, no `batch_alter_table` needed.

Existing migration files are untouched; `flask db upgrade` from an empty
database must build the final schema cleanly.

## 5. PostgreSQL compatibility

`values` is a reserved word in PostgreSQL (and the SQL standard);
`synonyms` is not. SQLAlchemy and Alembic quote reserved identifiers
automatically in all generated SQL (`"values"`), so the ORM, the
migration, and every query in this codebase work unchanged on PostgreSQL.
The only caveat is hand-written raw SQL, which must quote the table name —
the codebase currently has none against these tables, and this constraint
is documented here for future work.

## 6. Verification

1. `python -m py_compile` over all touched Python files.
2. Import `server.database` + `sqlalchemy.orm.configure_mappers()` — proves
   every renamed relationship resolves.
3. Boot both servers (`create_application_server`, `create_triton_server`)
   — proves views import and routes register.
4. `flask db upgrade` on a fresh SQLite database; confirm the resulting
   tables are `intents`, `entities`, `values`, `synonyms` (+ unchanged
   ones) and `labels`/`entity_values`/`entity_value_synonyms` are gone.
5. `npm run build` for the frontend.
6. Grep gates: no remaining references to `Label`, `EntityValue`,
   `kind=`/`kind ==`, `label_id`, or `/labels` endpoints in `server/` and
   `src/`. (The bare `label` key as a span's display name is the one
   deliberate survivor.)
