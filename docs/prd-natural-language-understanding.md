# PRD — Natural language understanding (joint intent + slots) support

| | |
|---|---|
| **Status** | Draft for review |
| **Owner** | Varun Seth |
| **Last updated** | 2026-07-12 |
| **Surface** | `src/routes/model/routes/build/` (primary), with follow-on work in `test/` and `analyse/`, plus `server/models/natural_language_understanding/` and `server/database.py` (data model) |
| **Related pages** | Build, History, Test, Publish, Analyse (all under `src/routes/model/routes/`) |
| **Related PRDs** | `docs/prd-token-classification.md` (the span half), `docs/prd-entity-values.md` (entity value catalogues, open/closed lists, training-data generation, unified import), `docs/prd-analyze-page.md`, `docs/prd-batch-testing.md` |
| **Audience** | Product, ML engineers, annotators, SRE / operators, stakeholders |

---

## 1. Summary

The app supports whole-utterance **text classification** and, via the token-classification work, **named entity recognition (NER)**. This document specifies first-class support for the third declared model type: **`natural_language_understanding` (NLU)** — **joint intent detection + slot filling**, the model that powers a conversational assistant's "what does the user want, and with which parameters?"

NLU has **three** registries, not two — this is the defining change from earlier drafts of this PRD:

- **Intents** — a whole-sentence class (`play_music`, `book_cab`), exactly like a text-classification label. Exactly one per utterance.
- **Entities** — a reusable, model-global span *type* (`location`, `datetime`, `artist`). An entity owns the set of surface **values** seen for it across the whole dataset.
- **Slots** — an intent-scoped *role* (`source`, `destination`), each mapping to exactly one entity. Slots are what the model is trained to predict and what an annotator tags on a span. **Several slots inside one intent may map to the same entity.**

The distinction between *entity* and *slot* is the crux. Consider the `book_cab` intent:

```
book_cab:  Book me a cab from {source: airport} to {destination: mall}
           slot "source"      → entity "location"
           slot "destination" → entity "location"
```

Both `airport` and `mall` are the **entity** `location`, but they play different **slots** (`source` vs `destination`). Tagging only the entity would lose the role — the assistant could not tell where the trip starts. So the model predicts the **slot**, and each slot carries its entity as metadata. An entity like `location` is then a lens across the dataset: "every value that filled a `location`, regardless of which slot" (`airport`, `mall`, `station`, …).

The single most important framing: **NLU = text classification (intent) ⊕ role-aware NER (slots over entities) on one utterance.** Most building blocks already exist. Classification gave us the `Label` registry and per-label utterance authoring; token classification gave us the `Annotation` table, the shared span↔IOB module (`server/tagging.py`), the annotation workspace, and span highlighting in Test; batch testing gave us the list-shaped infer contract (`inputs`/`outputs`). The joint model package already consumes a three-column `utterances`/`labels`/`tags` training contract and — as of the current code — already word-aligns slots, reconstructs entity spans, ranks intents top-k, and computes entity-level metrics (`server/models/natural_language_understanding/base.py`).

**What is missing is the slot/entity split and its authoring surface.** Today's code conflates the two: a span's `Annotation` points straight at a `kind='tag'` `Label` whose name *is* the trained tag. This PRD introduces the **`Slot`** table (intent-scoped, entity-referencing), repoints `Annotation` at it, adds a persisted **intent → slot → entity** mapping on the model, and restructures Build into **Intents** and **Entities** tabs.

---

## 2. Background & problem

### 2.1 The three shapes

The relational schema (`server/database.py`) already expresses the two simpler shapes and the NLU dual-ownership:

```
text_classification :  Model 1─* Label 1─* Utterance          (utterance owned by its class)
named_entity_recog. :  Model 1─* Utterance 1─* Annotation      (utterance owned by the model; spans reference Labels)
nat_lang_understand.:  Model 1─* Utterance 1─* Annotation      (utterance owned by the model AND an intent Label; spans reference Slots)
```

`Utterance` carries **both** foreign keys; the invariant is already relaxed for NLU (`server/database.py`, `Utterance.create`) so an NLU utterance sets `model_id` **and** `label_id` (its intent). That part is done. What is *not* modelled is the slot-vs-entity layer.

### 2.2 Entities vs slots — the gap this PRD closes

The current code has one span registry: `Label` with `kind='tag'`. A span's `Annotation.label_id` points at it, and its `name` is both the display name and the IOB tag string. That collapses two different ideas:

| | Entity (needed) | Slot (needed) |
|---|---|---|
| Scope | model-global | one intent |
| Example | `location` | `source`, `destination` |
| Reused across intents? | yes | no |
| What it owns | the set of surface **values** in the dataset | a **role** an entity plays in an intent |
| Trained/predicted? | no (a lens) | **yes** (the IOB tag) |

The `book_cab` example cannot be expressed today: there is no way to say "two spans are both `location` but fill different roles." This PRD adds **`Slot`** as a first-class table and makes it — not the entity — the annotated and trained unit.

### 2.3 The three-column training contract (already produced)

`Training.start` (`server/database.py`) has an NLU branch emitting `{utterances, labels, tags}`, where `tags` is the space-joined IOB of the span **slot** names via `spans_to_tags`. `BaseNaturalLanguageUnderstanding.load_data` reads exactly those three columns. This works today; the only addition here is persisting the **slot → entity** map so inference can report entities (§8.4).

### 2.4 Inference & evaluation (already fixed)

Earlier drafts flagged `predict()`/`evaluate()` as broken (subword misalignment, no span reconstruction, single intent). **That work has landed** (`server/models/natural_language_understanding/base.py`): `predict()` returns `{'intents': [...], 'entities': [...]}` per input with word-aligned, span-reconstructed slots (`text[start:end] == value`) and ranked top-k intents; `evaluate()` reports intent accuracy/F1 and entity-level slot P/R/F1. The **remaining** inference change is small: enrich each predicted span with its **entity** via the new mapping (§8.4), and rename the span's `name` key to explicit `slot`/`entity` keys (§8.5).

### 2.5 No authoring surface for the split

`UnderstandingBuild.jsx` currently renders two sub-tabs — **Intents** (`ClassificationBuild kind='label'`) and **Slots** (a flat `AnnotationBuild` over the whole model where "slot" == entity). This PRD **replaces that IA** with **Intents** and **Entities** tabs (§6): slots become intent-scoped and are defined *inside* an intent; entities become the global tab whose drill-in lists dataset values.

### 2.6 What already exists and should be reused

- **Model package:** `server/models/natural_language_understanding/{base,transformer}.py` — joint heads, `tokenize_and_align`, three-column `load_data`, **working** `predict`/`evaluate`, Indic backbones.
- **Data model:** `Label` (with `kind`/`color`/`description`), `Utterance` (dual FKs, relaxed invariant, `reassign`, model-scoped `to_dict` with `intent`), `Annotation`, `Utterance.spans`, `prune_annotations`.
- **Shared tagging:** `server/tagging.py` — `tokenize`, `spans_to_tags`, `tags_to_spans`, `parse_nlu_dataset`, and (de)serialization for inline / CoNLL / JSON / CSV.
- **Build components:** `ClassificationBuild`, `AnnotationBuild`, `UnderstandingBuild`, `LabelsTable`, `LabelFormModal`, `EntitiesPanel`, `EntityFormModal`, `EntityPicker`, `AnnotationWorkspace`, `AnnotatedUtterance`, `ImportDatasetModal`.
- **Test renderers:** `PredictionView`, `JsonView`, `getEntities`, `getLabels`, `colorOf` — `src/routes/model/routes/test/components/Prediction.jsx`.
- **Infer contract:** list-shaped `inputs`→`outputs` batch inference (`server/views/triton/inference.py`).
- **Analyse:** `server/views/api/analytics.py` branches per `model.type`.

---

## 3. Goals & non-goals

### Goals

1. Let a user **define intents, entities, and intent-scoped slots** (each slot mapping to an entity) and **author utterances that carry an intent and role-tagged slot spans**.
2. Persist the split with a **new `Slot` table** (intent + entity FKs), **repoint `Annotation`** at slots, and reuse `Label` for intents (`kind='label'`) and entities (`kind='tag'`) unchanged. Multiple slots in an intent may share an entity.
3. Persist a **model-level intent → slot → entity mapping** on the joint model so inference reports each predicted slot's entity and Analyse aggregates values by entity.
4. Keep NLU models **trainable, deployable, and queryable** end to end; the model already word-aligns slots and reconstructs spans — add only entity enrichment to the output.
5. Restructure Build into **Intents** and **Entities** tabs: an intent drills into its annotation workspace (utterances + its slots); an entity drills into all its dataset values.
6. Extend **Test** and **Analyse** so NLU is first-class: intent badge + highlighted slots (labelled by slot, coloured by entity) in Test; intent, slot, and entity distributions and metrics in Analyse.
7. Keep the **text-classification and NER paths unchanged**; every new behaviour is gated on `model.type` / `Label.kind`.

### Non-goals

- **Multiple intents per utterance.** Exactly one intent per utterance.
- **Nested / overlapping slots.** Flat, non-overlapping spans (standard IOB), matching NER.
- **Slot value normalization / entity linking** (e.g. "today" → a date). Stored `value` is the surface string.
- **Model-assisted pre-annotation.** Attractive follow-up; not in scope.
- **BILOU / BIOES.** IOB (IOB2/BIO) only.
- **A second slot head or a per-intent slot vocabulary at the model level.** Slot names are unique per model, so a slot name *is* its IOB tag; the model keeps a single shared slot head (§8.3).
- **A new model architecture.** The existing `transformer` joint model is the only NLU architecture in v1.

---

## 4. Personas & user stories

**P1 — Annotator / dataset author.**
- Define entities once (`location`, `datetime`) and reuse them across intents.
- Inside an intent, define its slots (`source`, `destination`) and point each at an entity.
- Tag a span with a **slot** and see it coloured by its entity; know both the role and the type.
- Preview the exact intent + IOB (slot) tag sequence an utterance trains on.
- Bulk-import pre-annotated NLU data (inline / JSON / three-column CSV) with intents, slots, and slot→entity mapping auto-created.

**P2 — ML engineer.**
- Authored data converts to the correct three-column CSV plus a slot→entity map, so training "just works."
- Get **intent accuracy/F1** *and* **entity-level slot F1** (a partially-correct span is not a correct slot).
- Query a deployed model and see ranked intents and predicted slots — each labelled by slot and entity — highlighted over the input.

**P3 — Product owner / stakeholder.**
- Create a "Language understanding" model from the New Model dialog and have it work end to end.
- Read dataset health: intent balance, slot coverage, per-entity value diversity, under-represented intents/slots.

**P4 — SRE / operator.**
- Deployed NLU models serve, log telemetry, and appear in Analyse's Production tab like any other model.

---

## 5. Success metrics

| Metric | Target |
|---|---|
| End-to-end enablement | Create an NLU model, define ≥2 intents, ≥2 entities, ≥2 slots (with ≥1 intent whose two slots share an entity), author ≥N utterances, train, deploy, and get a highlighted `{intents, entities}` result in Test — no manual DB/file steps. |
| Round-trip fidelity | Inline/JSON/CSV export → re-import reproduces intents, entities, slots, slot→entity mapping, and spans exactly (100% on the test corpus), modulo whitespace normalization. |
| Inference correctness | For every input, `predict` returns word-aligned slots whose `text[start:end] == value` and whose reported `entity` matches the trained slot→entity map; offsets valid against the input. |
| Role fidelity | For the `book_cab` fixture, `source` and `destination` predictions are distinguished even though both resolve to entity `location`. |
| Metric trust | Entity-level slot F1 matches an independent `seqeval` computation within rounding; intent metrics match History for the same version. |
| No regression | text-classification and NER Build/Train/Test/Analyse behaviour and metrics unchanged. |

---

## 6. Where NLU fits (information architecture)

No new top-level pages. The five existing tabs stay; Build restructures for NLU into **two tabs**.

```
/models/:modelId/build   ← PRIMARY WORK
    text_classification            → ClassificationBuild (unchanged)
    named_entity_recognition       → AnnotationBuild (unchanged)
    natural_language_understanding → NEW two-tab IA:
        ├── Intents   list intents → drill in → intent's annotation workspace
        │                (its utterances + its slots; define slots here, each → an entity)
        └── Entities  list entities (table) → drill in → all dataset values for that entity

/models/:modelId/test    ← intent badge (ranked) + slots highlighted over the query (labelled by slot, coloured by entity)
/models/:modelId/analyse ← Dataset: intent + slot + entity distributions; Model: intent + entity-level slot metrics; Production: intent + slot/entity mix
/models/:modelId/history ← per-run report already generic; ensure the joint report renders
/models/:modelId/publish ← unchanged (serving is model-type agnostic)
```

**Intents tab.** Lists intents (reuse `LabelsTable`, `kind='label'`) with utterance counts. **Drilling into an intent** opens that intent's workspace:
- the intent's utterances (`intent.utterances`), authored under this intent;
- an **intent-scoped Slots panel**: define this intent's slots, each named and pointing at an entity chosen from the global registry ("available slots" = this intent's slots);
- span annotation over those utterances using this intent's slots (reuse `AnnotationWorkspace` / `AnnotatedUtterance`; the span picker lists slots, each shown with its entity and colour).

**Entities tab.** Lists entities in a table (reuse `LabelsTable`, `kind='tag'`): name, colour, description, #slots referencing it, #distinct values. **Drilling into an entity** shows every distinct **value** seen for it across the dataset — aggregated from all annotations whose `slot.entity` is this entity — with occurrence counts and the intents/slots each value appeared under.

**Why this split (vs today's flat Intents/Slots).** Slots are intent-scoped roles, so they belong *inside* an intent, where the annotator already has the sentence's meaning in view. Entities are global and are best browsed as a value catalogue. The previous flat "Slots" sub-tab (one annotation list for the whole model, slot==entity) cannot express roles and is replaced.

---

## 7. Functional requirements

Tagged **[reuse]** (existing code/data, possibly minor refactor), **[new]** (net-new), **[fix]** (correct an existing gap), **[done]** (already landed in the current code; verify, don't rebuild).

### 7.1 Model type & registries

| # | Requirement | Source |
|---|---|---|
| MT-1 | Creating a `natural_language_understanding` model (offered as "Language understanding" in `ModelFormModal.jsx`, allowed in `ALLOWED_MODELS`) yields a working end-to-end model. | [done] |
| MT-2 | `Label` carries a **`kind`** column: `label` (intent) \| `tag` (**entity**), default per model type. Names unique per `(model, kind)`; the whitespace check applies to `tag`-kind (entity) names. | [done] |
| MT-3 | A new **`Slot`** table scopes a role to one intent and points at one entity: `(id, model_id, intent_id→Label(kind='label'), entity_id→Label(kind='tag'), name, color, created_at)`. Slot **names are unique per model** (so a name is a valid IOB tag). Several slots in one intent may share an `entity_id`. | [new] |
| MT-4 | An NLU model exposes three registries: **intents** (`Label kind='label'`), **entities** (`Label kind='tag'`), and **slots** (`Slot`, grouped by intent). Intents/entities reuse `LabelsTable`; slots get intent-scoped create/rename/delete/list with an entity picker. | [reuse]+[new] |
| MT-5 | **Cascades.** Deleting an **intent** removes its slots, its utterances, and their annotations (confirmation states the utterance count). Deleting an **entity** removes the slots pointing at it and their annotations (confirmation states slot + span counts). Deleting a **slot** removes its annotations only (confirmation states the span count). | [new] |

### 7.2 Build — Intents tab (P1)

| # | Requirement | Source |
|---|---|---|
| IN-1 | List intents and author each utterance under exactly one intent (reuse the `ClassificationBuild kind='label'` flow, model-scoped so the row also sets `model_id`). | [done] |
| IN-2 | Drilling into an intent opens its workspace: its utterances **and** its slots panel. Slots defined here are scoped to this intent (`Slot.intent_id`). | [new] |
| IN-3 | Define an intent's slots: name + choose an entity (from the global entity registry; create-on-the-fly allowed). Two slots in the same intent may choose the same entity. | [new] |
| IN-4 | Annotate spans on the intent's utterances using **this intent's slots**; the span picker shows each slot with its entity name and the entity's colour. Overlap prevention, un-label, inline `{slot: value}`, IOB preview — as NER. | [reuse]+[new] |
| IN-5 | Changing an utterance's intent (`reassign`) updates `label_id` only; its slot annotations move with it. Because slots are intent-scoped, reassigning to an intent that lacks a matching slot is surfaced (the span's slot no longer belongs to the new intent) — resolve by remapping or dropping, never silently mistraining. | [done]+[new] |

### 7.3 Build — Entities tab (P1)

| # | Requirement | Source |
|---|---|---|
| EN-1 | List entities in a table (reuse `LabelsTable kind='tag'`): name, colour, description, #slots referencing it, #distinct values. Create/rename/delete/colour/description. | [reuse]+[new] |
| EN-2 | Drilling into an entity lists all distinct **values** across the dataset (from annotations whose `slot.entity` is this entity), each with an occurrence count and the intents/slots it appeared under. *Extended by `docs/prd-entity-values.md`: the drill-in is now a full value/synonym CRUD; dataset values not yet catalogued appear as the promotable "discovered" section.* | [new] |
| EN-3 | Entities are global: the same entity may back slots in many intents. An entity with no slots yet is valid (empty value list). | [new] |
| EN-4 | Every entity declares an **open or closed list** type (`labels.list_type`) and owns an authored **value catalogue** with synonyms — see `docs/prd-entity-values.md`. | [new] |

### 7.4 Build — Import / export (P1)

| # | Requirement | Source |
|---|---|---|
| IO-1 | **Import** NLU datasets in three formats, auto-creating intents, entities, slots, and the slot→entity mapping: (a) **inline** with an intent prefix and per-span slot (§8.6); (b) **JSON** `{text, intent, entities:[{start,end,slot,entity}]}`; (c) **three-column CSV** `utterances,labels,tags` (tags = slot names) with a slot→entity legend (header comment or sidecar). | [new]+[reuse] |
| IO-2 | **Export** in each format (inline default), reusing `downloadBlob`; a round-trip reproduces intents, entities, slots, the mapping, and spans. | [new]+[reuse] |
| IO-3 | Import validates offsets vs text length, rejects overlaps and token/tag mismatches, requires an intent per record, requires each slot to name (or imply) an entity, and reports a **per-line** error summary. | [new]+[reuse] |
| IO-4 | **Parity with named entity recognition:** every format parses to one unified record shape (`server/tagging.py:parse_dataset`); the same file imports the same number of utterances and annotations on either annotated model type (an empty `tags` cell is all-`O` everywhere; only the requiring-vs-ignoring of the intent differs). See `docs/prd-entity-values.md` §7. | [new] |

### 7.5 Training (P2)

| # | Requirement | Source |
|---|---|---|
| TR-1 | `Training.start` emits the three-column CSV `{utterances, labels=intent name, tags=space-joined IOB of slot names}` via `spans_to_tags`. Empty-text rows skipped; an intent with no utterances contributes no rows and never blocks the run. | [done] |
| TR-2 | `Training.start` **also serializes the intent → slot → entity map** and hands it to the model so it is persisted in the artifact (§8.3). | [new] |
| TR-3 | IOB derivation is the shared `spans_to_tags` (slot names), identical to the workspace preview, so preview == trained data. | [done] |
| TR-4 | The joint model's `_train_test_split`, `preprocess_y`, `tokenize_and_align`, dual-head `build` are used unchanged; default architecture `transformer`. | [done] |

### 7.6 Inference & Test (P2)

| # | Requirement | Source |
|---|---|---|
| IF-1 | NLU `predict()` returns `{'intents': [...], 'entities': [...]}` per input (§8.5). | [done] |
| IF-2 | **Intents** are ranked top-k `[{name, score}]`, honouring the `top` kwarg. | [done] |
| IF-3 | **Slots** are subword→word aligned and reconstructed into spans `[{slot, entity, value, score, start, end}]` via `tags_to_spans`; `entity` is looked up from the persisted map (§8.3), `value == text[start:end]`. Adding `entity` and renaming the span's `name`→`slot` is the only inference change. | [fix] |
| IF-4 | `evaluate()` reports **intent** accuracy/P/R/F1 **and** **entity-level** slot P/R/F1 (span counts only if slot *and* boundaries match), plus the token-level view. Optionally also roll up metrics by entity. | [done]+[new] |
| IF-5 | Test renders ranked **intent(s)** as a badge/score bar and predicted **slots highlighted over the query**, each labelled by slot name and coloured by its entity (reuse `PredictionView` + `colorOf`/`getEntities`), keyed off `{intents, entities}`. | [enhance] |

### 7.7 Analyse (P3, P4)

| # | Requirement | Source |
|---|---|---|
| AL-1 | **Dataset tab:** intent distribution (utterances per intent, imbalance) + slot distribution (spans per slot) + **entity distribution** (spans/values per entity) + % utterances with ≥1 slot + intent↔slot co-occurrence + span-length distribution. NLU branch in `get_dataset_analytics`. | [new]+[reuse] |
| AL-2 | **Model tab:** intent accuracy/F1 trends + entity-level slot F1 trends across versions, from `evaluate`. | [new]+[reuse] |
| AL-3 | **Production tab:** predicted-intent mix, predicted-slot mix, predicted-entity mix, low-confidence intents and low-score spans, from stored telemetry `output` JSON. | [new]+[reuse] |
| AL-4 | Empty states: no intents → Intents tab; no entities → Entities tab; no slots → point into an intent; no annotated utterances → explain all-`O` training; no successful training → History. | [reuse] |

---

## 8. Technical design

### 8.1 Data model — reuse `Label`, add `Slot`, repoint `Annotation`

**`Label` (reuse).** Intents are `kind='label'`; **entities** are `kind='tag'`. No change beyond what exists. `next_label_color` already draws a per-`(model, kind)` palette so intents and entities keep distinct colours.

**`Slot` (new table).**

```python
class Slot(db.Model):
    __tablename__ = 'slots'
    id        = db.Column(db.Integer, primary_key=True)
    model_id  = db.Column(db.String,  db.ForeignKey('models.id'), nullable=False)
    intent_id = db.Column(db.Integer, db.ForeignKey('labels.id'), nullable=False)  # kind='label'
    entity_id = db.Column(db.Integer, db.ForeignKey('labels.id'), nullable=False)  # kind='tag'
    name      = db.Column(db.String,  nullable=False)   # unique per model → valid IOB tag
    color     = db.Column(db.String)                    # display; defaults to the entity's colour
    created_at = db.Column(db.Integer, default=timestamp)
```

- `create` validates: `intent` is a `kind='label'` Label of this model; `entity` is a `kind='tag'` Label of this model; `name` has no whitespace and is unique per model; several slots may share `entity_id` within one intent.
- Relationships: `Label(intent).slots`, `Label(entity).slots`, `Slot.annotations` — all `cascade="all,delete"` so MT-5 needs no bespoke delete logic.

**`Annotation` (repoint).** `label_id` → **`slot_id`** referencing `Slot`. `Utterance.spans` yields `(start, end, slot.name)`; `prune_annotations` unchanged (offset/value logic is independent of what the span references). The span's entity is `annotation.slot.entity`.

| Model type | `label_id` (Utterance) | `model_id` | Annotation references |
|---|---|---|---|
| `text_classification` | class (required) | null | — |
| `named_entity_recognition` | null | model (required) | `Label` (`kind='tag'`) — unchanged |
| `natural_language_understanding` | intent (required) | model (required) | **`Slot`** |

NER keeps `Annotation → Label`; NLU uses `Annotation → Slot`. Because both are nullable FKs off `annotations`, one table serves both (an annotation sets exactly one of `label_id` / `slot_id`, gated by `model.type`). This preserves the "reuse `Annotation`" property while giving NLU its role layer.

### 8.2 Registries and endpoints

- Intents/entities CRUD reuse `server/views/api/labels.py`, filtered by `kind` (Intents tab → `label`, Entities tab → `tag`).
- **Slots** get a small intent-scoped resource under `server/views/api/` (list/create/rename/delete for `?intent=`), each returning `{id, name, entity: {id, name, color}}`.
- The Entities-tab value catalogue (EN-2) is a read endpoint aggregating `annotation.value` grouped by `slot.entity`, with counts and the intents/slots each value came from.
- Model-scoped utterance/annotation views (`utterances.py`, `annotations.py`) accept/return `slot_id` for NLU annotations; the utterance resource already carries its `intent`.
- `GET /annotations/stats` (backing the Build overview strips) reports model-wide NLU counts — intents, entities, slots, utterances, annotated, spans, and **distinct entity `values`** (distinct `(entity, value)` pairs, i.e. the sum of each entity's `values_count`). It also takes an optional `?intent=<id>`; `Model.annotation_stats(intent_id=…)` then scopes the counts to one intent (its slots, its utterances, their spans) instead of the whole model.

### 8.3 Training path & the persisted mapping

`Training.start`'s NLU branch already writes the three-column CSV (slot names as tags). It additionally serializes the **intent → slot → entity** map:

```python
slot_map = {}
for slot in self.model.slots.all():          # Slot rows
    slot_map.setdefault(slot.intent.name, {})[slot.name] = slot.entity.name
# passed to the training task and stored by the model alongside self.labels / self.tags
```

On the model, `BaseNaturalLanguageUnderstanding` gains `self.slots` (this `{intent: {slot: entity}}` dict), saved/loaded with the artifact next to `self.labels`/`self.tags`. `self.tags` stays exactly what it is today — the sorted slot-name vocabulary — so `preprocess_y`, `tokenize_and_align`, and the single shared slot head are unchanged. The map is metadata for enrichment only; it never alters what the slot head predicts.

### 8.4 Inference path

`predict()` already produces word-aligned, span-reconstructed slots. The only change is enrichment in `_reconstruct_entities`: for each reconstructed span, look up the entity from `self.slots` using the predicted intent and the span's slot name, and emit both keys:

```python
entity_name = (self.slots.get(intent_name, {}) or {}).get(slot_name)
{'slot': slot_name, 'entity': entity_name, 'value': text[start:end],
 'score': ..., 'start': start, 'end': end}
```

The top-ranked intent selects which intent's slot→entity submap to use; a predicted slot absent from that submap yields `entity: null` (surfaced, not dropped). `evaluate()` is unchanged except an optional per-entity metric roll-up (IF-4).

### 8.5 Inference output contract (target)

`outputs` index-aligned to `inputs` (the established batch contract), each element:

```jsonc
{
  "environment": "<environment_name>",
  "model": "<model_name>",
  "version": "<version_no>",
  "inputs": "<input>",
  "outputs": [
    {
      "intents": [
        { "name": "<intent_name>", "score": <intent_score> }
        // …ranked, length = top
      ],
      "entities": [
        { "slot": "<slot_name>", "entity": "<entity_name>",
          "value": "<surface string>", "score": <span_score>,
          "start": <char_start>, "end": <char_end> }
        // …one per reconstructed slot span
      ]
    }
  ]
}
```

The `entities` array is keyed on **slot** (the predicted role) and **entity** (its type). `value`/`score`/`start`/`end` are the keys Test/Analyse consume for highlighting; Test labels a span by `slot` and colours it by `entity`. (Renaming the current `name` key to `slot` + adding `entity` is a coordinated change across `predict`, Test's renderer, and any telemetry readers.)

### 8.6 Import / export formats

**Superseded in part by `docs/prd-entity-values.md` §7 (unified import/export).** All formats now parse through one function, `server/tagging.py:parse_dataset`, into one record shape — `{'line', 'text', 'intent': str|None, 'spans': [(start, end, name, entity|None)], 'error'}` — shared with named entity recognition; the language understanding importer requires the intent and resolves spans to intent-scoped slots:

- **Inline:** an *optional* intent prefix + inline-annotated text where each span names its slot and optionally its entity, e.g. `book_cab⇥Book a cab from {source@location: airport} to {destination@location: mall}` — the per-span `slot@entity` carrier keeps each line self-describing. Reuses `format_inline`/`parse_inline` for the text half; exports normalize tabs in text to spaces.
- **JSON:** `{text, intent, entities:[{start, end, slot, entity}]}` — self-describing, no separate legend.
- **CSV:** three columns `utterances,labels,tags` (tags = slot names) exactly as `Training.start` writes, preceded by a `# slots: source=location; …` legend comment carrying the slot→entity mapping; an empty `tags` cell means all-`O`.

Per-line error reporting keeps the record structure above, extended with slot/entity resolution errors from the importer.

### 8.7 Frontend structure

- `UnderstandingBuild.jsx` hosts the **Intents/Entities** tabs (`?tab=`); drill-ins live in `?intent=`/`?entity=` so both levels deep-link and the browser back button walks out naturally. The tabs, the Import/Export actions, **and the overview metric strip render at the overview (table) level only** — a drill-in (`?intent=`/`?entity=`) renders just its workspace, with the breadcrumb as the way back out.
- **Drill-in navigation is the page breadcrumb only.** The one page-context breadcrumb in `Model.jsx` reads `?intent=`/`?entity=` (a Build drill-in lives in a search param, not the path) and resolves the intent/entity name via `GET /labels/<id>`. It names the active registry as a **plain-text** segment: the overview reads `models / <model> / build / intents` (or `entities`), and a drill-in `models / <model> / build / intents / <name>`. **`build` is the only link**, and it carries the active tab (`/build?tab=intents|entities`) so walking back out lands on the same registry; the tab segment and the name are plain text. The drill-in components carry **no** in-content breadcrumb or back button (the earlier `DrillBreadcrumb` is removed); their in-page context is the metric strip below.
- **Overview strips.** A shared **`MetricsStrip`** (`src/shared/components/MetricsStrip.jsx`, extracted from `AnnotationBuild`) renders a responsive row of metric cards from a caller-supplied `items` list, used across these surfaces:
    - **Overview (table) level** — `UnderstandingBuild` owns a single `GET /models/:id/annotations/stats` fetch (§8.2) and renders a **per-tab** strip: the **Intents** tab shows intents · utterances · annotated % · slot spans; the **Entities** tab shows entities · slots · slot spans · **values**. The two registry tables (`ClassificationBuild`, `EntitiesBuild`) fire an optional `onMutate` callback after a create/delete so the strip refreshes; an import refreshes it too. (The strip is no longer owned by `EntitiesBuild`.)
    - **Intent workspace** — an intent-scoped strip (slots · utterances · annotated % · slot spans), reading the same endpoint with `?intent=<id>`.
    - **Entity value catalogue** — a strip (values · occurrences · slots · intents) derived entirely from the value-catalogue response already loaded (EN-2; distinct intents computed client-side), no extra request.
- **Intents tab:** `ClassificationBuild kind='label' noun='intent'` (the same registry flow; its toolbar aligned to the Entities/NER styling — auto-width actions, search filling the row). Selecting an intent opens `IntentWorkspace`, which matches the NER **`AnnotationBuild`** two-pane layout through a shared **`SplitPane`** (`src/shared/components/SplitPane.jsx` + `src/shared/hooks/useSplitPane.js`, extracted from `AnnotationBuild`): an overview strip on top, then the **left pane** — the intent's slot registry, reusing **`EntitiesPanel`** with an optional secondary entity-name label so slot chips are identical to entity chips, with **Create-slot + search on one row** — and the **right pane**, the utterance search + `AnnotationWorkspace` scoped to this intent's utterances and slots. (The old bespoke `SlotsPanel` is removed in favour of `EntitiesPanel` reuse.)
- **Entities tab:** `EntitiesBuild` (a `kind='tag'` registry table, paginated via `AppPagination`); selecting an entity opens `EntityValues`, its value catalogue (EN-2, also paginated).
- The span picker (`EntityPicker`) lists the current intent's slots, each with its entity name and colour.
- Slot create/edit uses `SlotFormModal` (name + entity picker, with create-entity-on-the-fly).
- Test's `PredictionView` NLU branch renders ranked intents + slots highlighted, labelled by `slot` and coloured by `entity`, off the `{intents, entities}` shape.
- `analytics.py` gets NLU branches composing intent + slot + entity aggregations.

---

## 9. Phasing & rollout

| Phase | Scope | Backend | User value |
|---|---|---|---|
| **0 — Core (mostly landed)** | Joint `predict()`/`evaluate()` word alignment, span reconstruction, top-k intents, entity-level metrics; three-column `Training.start` branch. **Verify only.** | `natural_language_understanding/base.py`, `database.py` | An NLU model trains from a three-column CSV, deploys, and returns `{intents, entities}`. |
| **1 — Slot/entity model** | Add `Slot` table; repoint `Annotation` → `Slot`; persist `self.slots` map; enrich `predict` output with `entity` and rename `name`→`slot`. | `database.py`, `training.py`/model, `slots`/`utterances`/`annotations` views | Roles are modelled and predicted; `source`≠`destination` though both are `location`. |
| **2 — Authoring IA** | Build **Intents/Entities** tabs; intent workspace with its slots panel; entity value catalogue; slot CRUD with entity picker. | slots + entity-values endpoints | Users author intents, entities, and role slots in-app and train from them. |
| **3 — Import/export & Test polish** | Intent+slot+entity-aware inline/JSON/CSV import+export; ranked-intent + slot/entity-highlighted rendering in Test. | `tagging` NLU layer | Bulk onboarding; readable joint predictions. |
| **4 — Analyse** | Dataset intent+slot+entity distributions; metric trends; production mix. | `analytics.py` NLU branches | Dataset & model health for NLU models. |

Each phase is independently shippable. Phase 0 is a verification pass over already-landed code.

### Ship criteria

- **Phase 0:** classification/NER provably unchanged; an NLU model round-trips create→train→deploy→Test with valid spans (`text[start:end] == value`); intents ranked, length = `top`.
- **Phase 1:** for the `book_cab` fixture, `source` and `destination` are distinguished and each reports `entity: location`; `predict` output carries `slot` + `entity`; cascades (MT-5) behave with confirming counts.
- **Phase 2:** IOB preview == trained `tags` for every utterance; the Intents workspace annotates only that intent's slots; the Entities value catalogue lists correct dataset values.
- **Phase 3:** export re-imports to identical intents + entities + slots + mapping + spans; import error report is per-line.
- **Phase 4:** entity-level slot F1 matches `seqeval`; intent metrics match History; light/dark correct; empty states present.

---

## 10. Cross-cutting concerns

- **No classification/NER regression.** All new behaviour gated on `model.type` / `Label.kind`. NER keeps `Annotation → Label`; only NLU uses `Annotation → Slot`. Snapshot current metrics and diff after. The NER `AnnotationBuild` two-pane split was extracted into the shared `SplitPane`/`useSplitPane` with identical output, so the NER Build layout is unchanged — verify visually alongside the NLU intent workspace it is now shared with.
- **Migration safety.** Adding `Slot` and the `Annotation.slot_id` FK is additive; existing NER `Annotation.label_id` rows are untouched. No existing NLU data is expected; if any exists it must be migrated from tag-Labels to Slots (one slot per distinct tag, entity = same-named entity Label) — spell this out in the migration.
- **Slot-name uniqueness = tag validity.** Because a slot name is its IOB tag, names must be whitespace-free and unique per model; enforce in `Slot.create`, mirroring `Label.validate_name`.
- **Intent/slot consistency on reassign.** Reassigning an utterance to an intent that lacks a span's slot must be surfaced (IN-5), never silently trained as a foreign tag.
- **Offsets & Unicode.** Character offsets over string code units; client selection and server slicing must agree for multi-byte Indic text. Cover with Devanagari fixtures.
- **Tokenization consistency.** Workspace preview, `Training.start`, `tokenize_and_align`, and inference word-alignment must agree; `server/tagging.py:tokenize` is the single whitespace rule.
- **Privacy/telemetry.** NLU stores the full `output` JSON (intents + slot values + entities); the same retention/PII controls apply. Renaming the span key `name`→`slot` must not break the telemetry consumer/Analyse readers — update them together.
- **Accessibility.** Colour is never the only signal: pair a span's entity colour with its slot name (and entity name) chip, as Test's renderers already do.

---

## 11. Dependencies, risks & open questions

**Dependencies.** Phase 0: none (verification). Phase 1: `Slot` migration + `Annotation.slot_id`. Phase 4: an entity-level metric helper (`seqeval` or the hand-rolled one in `base.py`).

**Risks.**
- *Slot/entity confusion for users* — the two concepts are easy to conflate. Mitigate: define slots *inside* an intent with an explicit entity picker; always show a span's slot **and** entity.
- *Key rename fallout* — `name`→`slot` on span output touches `predict`, Test, telemetry, and Analyse; change them in one coordinated pass with a fixture asserting the new shape.
- *Reassign mistraining* — moving an utterance to an intent lacking its slot could emit a foreign tag; IN-5 must catch it.
- *Preview ≠ trained data* if any path diverges from `spans_to_tags`; share the one module (TR-3).
- *Surprising cascade* — deleting an entity removes slots (and their spans) across many intents; MT-5 confirmations must state the counts.
- *Offset drift* on Indic/multibyte text; one offset convention + fixtures.

**Resolved (design decisions).**
- **Model predicts the slot, not the entity.** Only the slot distinguishes `source` from `destination`; the entity is metadata resolved via the persisted map (§8.3, §8.4).
- **New `Slot` table** (not overloaded `Label`, not an `Annotation` column): slots are first-class, intent-scoped, entity-referencing, and definable as a registry.
- **Slot names unique per model** so a slot name is a valid IOB tag and the model machinery (`self.tags`, single slot head) is unchanged; per-intent duplicate slot names are out of scope.
- **Intent delete → cascade** its slots, utterances, and their annotations, with a confirming count (MT-5).

**Open questions.**
1. **Inline slot→entity legend format:** a legend block per file vs a per-span `{slot@entity: value}` inline carrier — pick the canonical human-readable export.
2. **Span score definition:** mean vs min of member-token softmax (currently mean).
3. **Per-entity metrics:** ship entity-rollup metrics in Phase 1 `evaluate` or defer to Phase 4 Analyse.
4. **Slot colour:** inherit the entity's colour (recommended, so all `location` slots read alike) vs an independent per-slot palette.

---

## 12. Appendix — codebase references

| Concern | Location |
|---|---|
| Model types allowed | `server/config.py` (`ALLOWED_MODELS`) |
| Model-type dropdown ("Language understanding") | `src/routes/home/components/ModelFormModal.jsx` |
| NLU model package (joint heads, load_data, tokenize_and_align) | `server/models/natural_language_understanding/{base,transformer}.py` |
| NLU `predict`/`evaluate` (word-aligned, span-reconstructed — add `entity`) | `server/models/natural_language_understanding/base.py` |
| Model factory dispatch on type | `server/models/__init__.py` |
| Dual-FK `Utterance` (relaxed invariant, `reassign`, model-scoped `to_dict`) | `server/database.py` (`class Utterance`) |
| `Label` (intents `kind='label'`, entities `kind='tag'`) | `server/database.py` (`class Label`) |
| **`Slot` (new)** — intent-scoped role → entity | `server/database.py` (new `class Slot`) |
| `Annotation` (repoint `label_id` → `slot_id` for NLU) | `server/database.py` (`class Annotation`) |
| Training export (three-column CSV + slot→entity map) | `server/database.py` (`Training.start`) |
| Training task (generic CSV → model.train) | `server/tasks/training.py` |
| Shared span↔IOB + NLU dataset (de)serialization | `server/tagging.py` (`spans_to_tags`, `tags_to_spans`, `parse_nlu_dataset`) |
| Serving loop (`{'input': input, **output}` merge) | `server/tasks/inference.py` |
| Batch infer contract (`inputs`→`outputs`) | `server/views/triton/inference.py` |
| Build dispatch (Classification / Annotation / **Understanding**) | `src/routes/model/routes/build/Build.jsx` |
| NLU Build (**Intents/Entities** tabs + tab-level import/export) | `src/routes/model/routes/build/UnderstandingBuild.jsx` |
| Intent drill-in (two-pane: slots + workspace) | `src/routes/model/routes/build/components/IntentWorkspace.jsx` |
| Entities tab table + entity value catalogue (EN-2) | `src/routes/model/routes/build/components/{EntitiesBuild,EntityValues}.jsx` |
| Slot create/edit (name + entity picker) | `src/routes/model/routes/build/components/SlotFormModal.jsx` |
| Reusable Build components | `src/routes/model/routes/build/components/{LabelsTable,LabelFormModal,EntitiesPanel,EntityFormModal,EntityPicker,AnnotationWorkspace,AnnotatedUtterance,ImportDatasetModal}.jsx` |
| Shared layout/UI primitives (two-pane split, metric strip, section cards) | `src/shared/components/{SplitPane,MetricsStrip,SectionCard}.jsx`, `src/shared/hooks/useSplitPane.js` |
| Page-context breadcrumb (resolves `?intent=`/`?entity=` drill-in) | `src/routes/model/Model.jsx` |
| Build overview counts (optional `?intent=` scope) | `server/database.py` (`Model.annotation_stats`), `server/views/api/annotations.py` |
| Test renderers (`PredictionView`, `getEntities`, `colorOf`) | `src/routes/model/routes/test/components/Prediction.jsx`, `Test.jsx` |
| Analytics (per-`model.type` branches; add NLU) | `server/views/api/analytics.py` |
| Labels / utterances / annotations views (add slots view) | `server/views/api/{labels,utterances,annotations}.py` |
| Model context (exposes `model.type`) | `src/contexts/ModelContext.jsx` |
| Export util | `src/shared/utils/downloadBlob.js` |
