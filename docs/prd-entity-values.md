# PRD — Entity values, open/closed lists, training-data generation & unified dataset import

| | |
|---|---|
| **Status** | Implemented |
| **Owner** | Varun Seth |
| **Last updated** | 2026-07-12 |
| **Surface** | `server/database.py`, `server/tagging.py`, `server/augmentation.py` (new), `server/views/api/values.py` (new), `src/routes/model/routes/studio/` |
| **Related PRDs** | `docs/prd-natural-language-understanding.md` (slot/entity split), `docs/prd-token-classification.md` (spans & IOB) |
| **Audience** | Product, ML engineers, annotators |

---

## 1. Summary

Entities today are bare span *types*: a `kind='tag'` `Label` with a name and colour. This PRD
gives them substance, identically for **named entity recognition (NER)** and **natural language
understanding (NLU)** models:

1. **Open vs closed lists.** Every entity declares whether its value space is enumerable.
   A *closed list* entity (`coffee_type`, `device_type`) can be captured as a manageable,
   finite catalogue of values. An *open list* entity (`person`, `place`) cannot — the model
   must generalize to values it has never seen.
2. **Entity values & synonyms.** An entity owns a catalogue of **values**, and each value owns
   a set of **synonyms** (surface variants that mean the same value). The catalogue is authored
   in the entity drill-in on the Build page, on both NER and NLU models.
3. **Training-data generation.** At training time the dataset is expanded with unique
   combinations of each annotated utterance and the value/synonym catalogue of the entities its
   spans reference. Open-list entities additionally contribute variants whose span tokens are
   replaced by an UNK token, teaching the model that *anything* in that position is the entity.
4. **Unified dataset import/export.** One parsing/serialization contract across model types:
   importing the same `utterances,labels,tags` file into an NER model and an NLU model now
   yields the **same number of utterances and the same number of annotations**.

## 2. Background & problems

- The NLU studio's entity drill-in only *aggregated* values already annotated in the dataset;
  nothing could be authored, and NER entities had no drill-in at all.
- Slot filling only learns surface strings present in the dataset. `book me a {source: airport}
  cab` teaches `airport`; it does not teach `station`, and it does not teach "an unseen word in
  this position is a location".
- Import was implemented twice (`Model.import_annotations` for NER, `Model._import_nlu` for
  NLU) over two parser stacks with drifted behavior. Concretely observed differences:
  - The NER CSV parser rejected rows whose `tags` cell was empty (`0 tags for N tokens`) while
    the NLU parser accepted them as all-`O` — the same file imported different utterance counts.
  - NER inline could not read intent-prefixed lines; NLU JSON spans (`slot` key) were invisible
    to the NER JSON parser (`label` key only).

## 3. Design decisions (alternatives considered)

| Decision | Chosen | Rejected alternatives |
|---|---|---|
| Entity typing | `list_type` column on `labels` (`'open'`/`'closed'`, tags only, default `'open'`) | A separate `entities` table — entities already *are* Labels; splitting repoints slots/annotations for no gain |
| Values storage | Two tables: `entity_values` + `entity_value_synonyms` | JSON column on `labels` (no constraints, no counts, racy); single self-referential table (murky queries) |
| Augmentation site | Pure module `server/augmentation.py`, called by `Training.start` (control plane — has DB access) before `data.csv` is uploaded | Inside the `sage` worker's `model.train` — the worker has no DB access, so the catalogue would have to ride task kwargs; and augmented data would be invisible to the "training data" download |
| Import unification | One record shape from every parser + one orchestration loop with per-type span resolvers | Keeping two pipelines behaviorally aligned by convention — that is what drifted in the first place |

## 4. Data model

```
Label (kind='tag')  1 ─ *  EntityValue  1 ─ *  EntityValueSynonym
  + list_type ('open'|'closed')
```

- `labels.list_type` — `'open'` (default) or `'closed'`. Only meaningful for `kind='tag'`
  rows; intents/classes keep `NULL`. Editable at any time; switching type never touches data,
  it only changes training-time generation.
- `entity_values` — `id`, `label_id` (FK `labels.id`, the entity), `value` (Text, non-empty),
  timestamps. Cascade-deleted with the entity.
- `entity_value_synonyms` — `id`, `value_id` (FK `entity_values.id`), `text` (Text, non-empty),
  `created_at`. Cascade-deleted with the value.
- **Ambiguity guard:** within one entity, the canonical value and every synonym (of any value)
  are unique **case-insensitively after whitespace-trim**. Duplicates would make substitution
  and future value-normalization ambiguous, so they are rejected with a 400 at write time.

Migration `f3a9d17c68b2_add_entity_values.py` (down_revision `c7d2e91b4f63`) adds the column and
both tables. Downgrade drops them.

## 5. Entity values API

All endpoints require the model to be NER or NLU and the label to be `kind='tag'`.

- `GET /api/models/<mid>/labels/<lid>/values` →
  `{entity, values: [{id, value, synonyms: [{id, text}], count}], discovered: [{value, count,
  slots, intents}], total}`.
  - `count` — how many annotated spans currently carry this value **or one of its synonyms**
    (case-insensitive; via `label_id` on NER, via the entity's slots on NLU).
  - `discovered` — distinct annotated surface strings *not yet covered* by any stored
    value/synonym, with occurrence counts (and, on NLU, the slots/intents they appeared under).
    The UI offers one-click promotion into the stored catalogue.
- `POST /api/models/<mid>/labels/<lid>/values` — JSON `{value, synonyms?: [..]}` → 201.
- `PUT /api/models/<mid>/labels/<lid>/values/<vid>` — JSON `{value?, synonyms?: [..]}`;
  `synonyms` is **replace-set** semantics. → 200.
- `DELETE /api/models/<mid>/labels/<lid>/values/<vid>` → 204.

`Label.to_dict` now reports `list_type` and `values_count` (stored values) for tags on both
model types; the NLU-only aggregate that previously lived on `GET .../values` is folded into
`discovered`.

## 6. Training-data generation

`Training.start` builds the base rows exactly as before, then — for NER and NLU — expands them
through `server/augmentation.py`:

```
augment(records, catalogue, unk_token, max_variants, max_total, seed) -> generated records
```

- A **record** is `(text, intent|None, spans)` with `(start, end, name, entity)` spans — the
  same shape the unified import uses. For NER `entity == name`; for NLU `name` is the slot and
  `entity` its mapped entity.
- **Alternatives per span:** the entity's stored values plus all synonyms, minus the span's own
  surface value (case-insensitive). Open-list entities add one **UNK variant**: each whitespace
  token of the span replaced by the UNK token (token count — and therefore the IOB pattern —
  is preserved).
- **Combinations:** the cartesian product of per-span alternative sets (each set also includes
  "keep the original"), minus the all-original combination. Offsets are re-derived by splicing
  replacements left-to-right, so the generated spans stay exact and `spans_to_tags` yields
  aligned IOB rows.
- **Uniqueness & caps:** generated rows are deduped against the base dataset and each other on
  `(intent, text)`. Per-utterance cap `AUGMENT_MAX_VARIANTS` (default 20) and dataset-wide cap
  `AUGMENT_MAX_ROWS` (default 5000); when the combination space exceeds the cap it is sampled
  **deterministically** (seeded by the training `random_state`), so retraining reproduces the
  same dataset.
- **Config** (`server/config.py`): `AUGMENT_ENABLED` (default true), `AUGMENT_UNK_TOKEN`
  (default `[UNK]`, matching BERT-style vocabularies), `AUGMENT_MAX_VARIANTS`,
  `AUGMENT_MAX_ROWS` — all env-overridable. A training request may pass `augment: false` to
  skip generation for one run.
- The expanded dataset is what lands in `models/<id>/<version>/data.csv`, so History's
  "training data" download shows exactly what the model saw. Inference is untouched — UNK
  generalization is purely a training-data property.

Corner cases handled: utterances with no spans pass through; spans whose entity has no
catalogue contribute only themselves (open lists still contribute the UNK variant); empty or
whitespace-only alternatives are skipped; multi-token values retokenize cleanly; overlapping
spans cannot occur (rejected at annotation/import time).

## 7. Unified import/export

`server/tagging.py` now produces **one record shape from every format**:

```
{'line': int, 'text': str, 'intent': str|None, 'spans': [(start, end, name, entity|None)], 'error': str|None}
```

- **CSV** — one parser for both types: `text|utterances|utterance` column, optional
  `labels|label|intent` column, `tags` column where an **empty cell means all-`O`** (this fixes
  the count disparity), optional leading `# slots: a=b; …` legend.
- **Inline** — optional `intent<TAB>` prefix on every line; span carrier `{name: value}` or
  `{name@entity: value}`. Exports normalize literal tabs in utterance text to spaces so the
  prefix rule can never corrupt a round trip.
- **JSON** — optional `intent` field; a span's name key is `slot`, `label` or `entity`
  (first present wins), plus optional `entity` type.
- **CoNLL** — unchanged; carries no intent so it remains NER-only (`NLU_FORMATS` gate).

`Model.import_annotations` is now a single pipeline: parse → per-record validation (spans in
bounds, non-overlapping, IOB-safe names) → per-type **span resolver**:

- **NER** resolves a span to its *entity*: the `@entity` part when the carrier has one, else the
  name; auto-creates missing entities. A present intent is **ignored** (the NER model has no
  intent head), never an error.
- **NLU** requires an intent per record and resolves spans to intent-scoped slots exactly as
  before (slot uniqueness per model, slot→entity consistency checks, auto-creation).

**Parity guarantee:** a dataset carrying text, intents and tags imports the same number of
utterances and the same number of annotations on an NER and an NLU model; only the registry
rows they create differ (entities vs intents+slots+entities). Export stays type-shaped (NER
spans carry the entity name; NLU spans carry `slot@entity` and the intent) but flows through
the same serializers.

## 8. Frontend (Build studio)

- **Entity form** (both model types): an *open list / closed list* choice with helper copy,
  persisted as `list_type`.
- **Entity drill-in** (`EntityValues.jsx`, both model types): full CRUD — add a value with
  optional synonyms, edit value/synonyms, delete with confirmation — plus a *discovered in
  dataset* section listing annotated strings not yet catalogued, each with one-click **promote
  to value**. Metrics strip: stored values, synonyms, covered spans, discovered.
- **NER Build** gains the drill-in via `?entity=<id>` (the entity name in the side panel links
  into it), mirroring the NLU Entities tab; a back affordance returns to the workspace.
- **Entities tables** show the list type as a badge next to each entity.

## 9. Out of scope / future work

- Entity values in the dataset interchange files (a `# values:` legend or JSON header record)
  — the catalogue currently moves only through its API.
- Inference-time value normalization (mapping a predicted synonym back to its canonical value)
  — the storage introduced here is the prerequisite.
- Lookup-table features / gazetteers fed to the model directly.
