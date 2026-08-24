# Annotation metrics, canonical vocabulary, and the entity slot table

Date: 2026-07-26
Status: approved

## Problem

Three related problems, all rooted in one terminology tangle.

1. **NER computes no exact-match metrics.** `BaseNamedEntityRecognition.evaluate()`
   returns only token accuracy, a token report and a token confusion matrix. NLU
   has exact-match metrics (`_entity_metrics`) but NER has no equivalent, so NER
   quality can only be read at the token level anywhere in the product.
2. **History reports token-level slot metrics.** Token scoring gives partial
   credit for annotations that are wrong in production: predicting
   `B-business_name I-business_name O` over a three-word name scores 2/3 at the
   token level while extracting the wrong value. Token averages also mislead —
   on voice-assistant v0.6 the same predictions read 0.9532 (weighted, where
   `O` is 81.7% of tokens), 0.7313 (macro over 110 tags, 3 of which have support
   0 and auto-score 0), or 0.8471 (weighted excluding `O`).
3. **One concept has four names.** A labelled region of text is the DB `Tag`
   class, the `annotations` HTTP key, "span" in 270 places in `server/`, and
   half of `spans_to_tags`. Meanwhile "tag" means both that region (DB) and a
   per-token IOB label (ML). On top of that, `_entity_metrics` / `slots.entity` /
   the Analyse label "slot F1 (entity)" use "entity" to mean *exact-match level*,
   colliding with `Entity`, the reusable NER type.

## Canonical vocabulary

Adopted across metrics code, metrics JSON and all user-facing labels. No new
terms are introduced; three are retired.

| concept | canonical term | retires |
| --- | --- | --- |
| reusable NER type | **entity** | — |
| intent-scoped NLU role mapping to an entity | **slot** | — |
| a labelled region of text in an utterance | **annotation** | "span", DB `Tag` |
| the per-token IOB label string | **tag** (this meaning only) | — |
| exact-match metric over whole annotations | **slot metrics** (NLU) / **entity metrics** (NER) | "entity-level", "span-level" |
| per-token metric | **token metrics** | — |

Because a model type's own noun already names the unit, exact-match metrics need
no qualifier: for an NLU model the *slot metrics* are exact-match by definition,
and the only other thing is explicitly *token metrics*.

**Enforcement:** all metrics naming (JSON keys, function names, UI labels), plus
"span" → "annotation" in the files this work touches. No DB migration, no HTTP
API rename — `Tag`, the `tags` table and the `/annotations` routes stay.

## Design

### 1. Shared exact-match helper

`BaseModel._annotation_metrics(X, y_true_tags, y_pred_tags)` returns
`{precision, recall, f1, support, labels: {name: {precision, recall, f1, support}}}`.
An annotation counts only when its name and both boundaries match a true
annotation exactly. This is the existing NLU `_entity_metrics` body, lifted to
the shared base and keyed generically by annotation name.

### 2. Evaluate shapes

NLU `evaluate()`:

```
slots: {
  precision, recall, f1, support,
  labels:   { slotName:   {precision, recall, f1, support} },
  entities: { entityName: {precision, recall, f1, support} },
  tokens:   { accuracy, report, confusion_matrix }
}
```

NER `evaluate()`:

```
entities: {
  precision, recall, f1, support,
  labels: { entityName: {precision, recall, f1, support} },
  tokens: { accuracy, report, confusion_matrix }
}
```

`entities` under NLU keeps its current meaning — the roll-up through the
slot → entity map, answering "how well are cities found, whatever role they
fill". It is unambiguous now that it sits beside `labels` rather than under a
key named `entity`.

Top-level `accuracy` / `report` / `confusion_matrix` are unchanged: the
Trainings list and `analytics.py` read them. NER's top-level accuracy therefore
stays token-level. This is a known wart, kept deliberately so version-to-version
comparisons of an existing number do not silently shift.

### 3. Back-compatibility

Artifacts trained before this change carry `slots.entity`. Stored JSON is not
migrated; readers normalise both shapes:

- `analytics.py` reads the new shape, falling back to `slots.entity`.
- The frontend normalises in one place (`src/shared/utils/training.js`).

### 4. History

`training.js` gains a normaliser returning `{overall, labels}` from either
shape. The Reports tab renders **Slots** (NLU) or **Entities** (NER) with name,
precision, recall, F1 and support. The token report is removed.

The Matrix tab is kept. It is tag × tag and inherently token-level, but it is a
diagnostic tab rather than a metrics table, and it is where `B-` vs `I-`
confusion is visible.

### 5. Entity slot table

- `Slot.to_dict()` gains `'intent': {id, name}`, mirroring the existing
  `'entity': {id, name, color}`, so the table needs no client-side join.
- `GET /models/<id>/slots` gains an `?entity=<id>` filter, mirroring `?intent=`.
- New `EntitySlots.jsx` renders **Intent | Slot | Annotations** on the entity
  detail view (`?tab=entities&entity=<id>`), beside `EntityValues`.

The entity picker in `SlotFormModal` is left alone — it is how the mapping is
assigned, not a redundant display of it.

## Verification

- `_annotation_metrics` against a hand-built case where a predicted annotation
  is short by one word: token scoring gives partial credit, exact matching gives
  zero. This is the property the change rests on.
- A pre-change artifact shape (`slots.entity`) still renders in History.
- `python -m py_compile` on touched backend files; `npm run build`.

## Risks

Changing what History displays changes which number the user steers on — that is
the intent. Existing stored evaluations are untouched and still render through
the normaliser, so no retraining is required to read old versions.
