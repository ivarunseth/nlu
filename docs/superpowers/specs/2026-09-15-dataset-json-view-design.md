# Dataset JSON view — design

**Date:** 2026-09-15
**Scope:** Build page, all three model kinds.

## Goal

Give the Build page a second view of the whole dataset: one JSON document,
edited in place in a syntax-coloured tree editor, saved back in a single
transaction. Only authored data is in the document — ids are shown read-only
so Save can tell edited from new; bookkeeping fields (`model_id`, `_link`,
timestamps, counts, derived IOB `tags`) never appear.

## Placement

`Build.jsx` grows a slim toolbar row above the kind-specific page with a
`Table | JSON` segmented switch. The choice lives in the search params as
`?view=json` (absent = table), matching `?tab=`/`?intent=` so it deep-links
and the browser's back button walks out of it. With `view=json` Build renders
`DatasetJson` regardless of kind; otherwise the existing three pages render
untouched.

## Document shape

Emitted by `Model.dataset_to_dict()`; consumed by `apply_dataset(model, document)` in the view module (it composes the rows' own `create`/`from_dict` validators and the utterance view's `_replace_annotations`, so it lives beside them).
References between collections are **by name**, matching the export formats.
Spans are never exposed as offsets: an utterance's `text` carries them as the
Build page's `{name: value}` markup, rendered with `format_inline` and parsed
back with `parse_inline` — the same pair the import/export formats use.

```jsonc
// text_classification
{ "labels": [ { "id": 3, "name": "greet", "color": "#…", "description": null,
                "utterances": [ { "id": 41, "text": "hi there" } ] } ] }

// named_entity_recognition
{ "entities":   [ { "id": 2, "name": "city", "color": "#…", "description": null,
                    "list_type": "open",
                    "values": [ { "id": 9, "value": "Delhi", "synonyms": ["New Delhi"] } ] } ],
  "utterances": [ { "id": 41, "text": "fly to {city: Delhi}" } ] }

// natural_language_understanding — two top-level keys; utterances live
// under their intent and tag spans by slot
{ "intents":    [ { "id": 3, "name": "book", "color": "#…", "description": null,
                    "slots": [ { "id": 5, "name": "dest", "entity": "city", "color": null } ],
                    "utterances": [ { "id": 41, "text": "fly to {dest: Delhi}" } ] } ],
  "entities":   [ … ] }
```

Ordering is deterministic (registries by name, utterances by id descending —
the same order the tables show) so a GET → PUT with no edits is a no-op.

## Endpoints

- `GET  /api/models/<modelId>/dataset` → the document, 200.
- `PUT  /api/models/<modelId>/dataset` (JSON body: the document) → the fresh
  document, 200. Any validation failure `abort(400, '<json path>: <message>')`
  and rolls back the whole transaction.

Both live in `server/views/api/dataset.py`, `token_auth.login_required`,
scoped to `g.current_user.models`.

## Reconciliation (`apply_dataset`)

Per collection: item with an `id` that exists on this model → update through
the row's existing `from_dict`; item without an `id` (or `null`) → create
through the row's existing `create` (reusing every current validation:
non-whitespace names, uniqueness, slot ∈ intent, value catalogue
duplicates); existing ids not present in the document → delete. An `id` that
doesn't belong to this model is a 400.

Order, so name references resolve and cascades never race an edit:

1. Registries — update then create — with a flush after each collection:
   intents (NLU) / labels (classification); entities (NER, NLU); slots,
   nested under their intent (NLU); values + synonyms, nested under their
   entity (NER, NLU).
2. Utterances — update then create — under their label (classification) or
   intent (NLU), or model-scoped (NER). Each item's `text` is parsed from
   inline markup into plain text + spans (`parse_inline`, then
   `validate_import_spans`); an existing utterance's spans are rebuilt
   (existing tags dropped, `Tag.create` per span against the *new* text)
   only when its text, intent or span set changed, so untouched spans keep
   their ids.
3. Deletes by omission, last: utterances, values, slots, entities,
   intents/labels. Running deletes after every edit means an utterance moved
   off an intent that is being removed is updated before the cascade could
   take it. The one consequence: renaming a row to a name still held by a
   row being deleted in the same save fails uniqueness — do it in two saves.

The whole PUT is one `db.session` transaction; the view commits only on
success. Errors carry the JSON path (`utterances[12].annotations[0]`).

## Client

- `src/api/dataset.js`: `get(modelId)`, `save(modelId, document)`.
- `src/shared/components/JsonEditor.jsx` (+ `JsonEditor.css`): a dependency-
  free tree editor.
  - Collapsible objects/arrays; collections below the top level start
    collapsed so large datasets open cheaply.
  - Syntax colours for keys / strings / numbers / booleans / null, JetBrains
    Mono, light/dark via existing CSS variables.
  - Click a leaf to edit; Enter commits, Esc cancels, blur commits. Typed
    inputs: string, number (`start`/`end`), nullable string (`description`,
    `color`), colour swatch + hex input for `color`.
  - Arrays get a `+` that inserts a template item for that path
    (`templateFor(path)` prop) and each item an `×`. Keys are fixed — the
    schema is the API's.
  - `readOnly(path)` prop: `id` renders dimmed and non-editable.
  - Controlled: `value` / `onChange(nextDocument)`; the editor holds no
    document state of its own.
- `src/routes/model/routes/studio/DatasetJson.jsx`: loads the document,
  holds `original` + `draft`, renders the editor plus a toolbar with a dirty
  badge (`N changes`), **Discard** and **Save**. Registers a `beforeunload`
  guard while dirty.
- `SaveDatasetModal.jsx`: confirmation before PUT. Shows created / updated /
  deleted counts per collection computed from the id diff (deletes are by
  omission, so the modal is the guard against a slipped bracket). Copy
  follows the existing modal standards: says exactly what the backend will
  do, nothing more.
- Errors from PUT show in an `Alert` with the server's path-prefixed message;
  the draft is kept so the user can fix and retry.

## Out of scope

Raw-text JSON editing, adding arbitrary keys, per-row JSON inspectors,
partial (paginated) documents, and any change to the table views.

## Verification

`python -m py_compile` on touched modules; `npm run build`; a scripted GET →
PUT round trip per model kind against a local stack confirming a no-edit PUT
changes nothing and an edit/create/delete of each collection lands.
