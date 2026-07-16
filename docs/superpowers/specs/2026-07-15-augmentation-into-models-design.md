# Move dataset augmentation into models; ship training data via storage

**Date:** 2026-07-15
**Status:** Approved (design)

## Problem

Two coupling issues in the control plane's `Training.start`
([server/database/training.py](../../../server/database/training.py)):

1. **Augmentation runs in the app server.** For NER and NLU, `Training.start`
   expands the authored dataset with entity value/synonym substitutions (via
   `server/utils/augmentation.py`) *before* uploading the CSV. Augmentation is
   ML preprocessing that belongs with the model, not in the control plane.
2. **The slot map travels through the Celery queue.** For NLU, the
   `intent → slot → entity` map is built from the DB and shipped as
   `kwargs['slots']` to the training task. It should be uploaded to storage and
   read internally by the model, like the artifact's other sidecar files.

## Constraint

Model code (`server/models`) runs in the `sage` training worker and the
`triton` serving workers with **no DB access and no Flask app context**
(per CLAUDE.md). So anything the model needs at train time — the entity
catalogue and the slot map — must arrive as **files in storage**, resolved by
the control plane (which has the DB and config) and read by the model.
This is exactly what the `data/` folder enables.

## Decisions

- **`data/utterances.csv` stores the authored dataset only, in inline format.**
  Augmentation happens in memory at train time and is **not persisted**.
  - NER header `utterances`: `what is the weather {date: today}`
  - NLU header `utterances,labels`: `what is the weather {date: today}` , `get_weather`
  - TC header `utterances,labels`: plain text, no markup.
- **Augment the training split only.** Split first, then expand only the train
  rows; the held-out test set stays authored-only. Evaluation numbers will
  differ from today (this is the intended improvement).
- **Deterministic & idempotent.** `expand` is seeded by `random_state`;
  augmentation always derives from the base authored rows (never from a
  persisted expansion) and dedups, so retraining a version reproduces the
  identical expanded set.

## Storage layout — `models/{model_id}/{version}/data/`

| file | types | contents |
|---|---|---|
| `utterances.csv` | all | Authored dataset, inline format (see above), CSV-quoted. |
| `slots.json` | NLU | `{intent: {slot: entity}}`. Formerly `kwargs['slots']`. Still persisted into the artifact by `model.save` for inference. |
| `entities.json` | NER, NLU | `{enabled, unk_token, max_variants, max_total, catalogue: {entity: {kind, terms}}}`. The catalogue (entity values + synonyms) plus the augmentation settings `Training.start` resolves from `AUGMENT_*` config and the per-run `augment` override. |

`data/` sits beside the artifact under `models/{id}/{version}/`. `fput_dir`
re-uploads it with the artifact (it is a subfolder, not wiped), and inference's
`Model.load` reads only the artifact root, ignoring `data/`.

## Changes

### Control plane — `Training.start`
- Stop augmenting; stop putting `slots` in `kwargs`.
- Write `data/utterances.csv` via `format_inline` + `Utterance.spans` / `.intent`
  (removes `_dataset_records`, `_augmented_records`, `_record_tags`).
- Write `data/slots.json` (NLU) and `data/entities.json` (NER/NLU); the
  catalogue is built directly from `model.entities` / `Value.terms()`.
- Resolve `enabled`/caps/unk from `AUGMENT_*` config + the per-run `augment`
  override and bake them into `entities.json` — the knobs still work, now fully
  out of the queue.

### Moved logic — `server/utils/augmentation.py` → `server/models/augmentation.py`
- Pure algorithm (`expand`, `substitute`, `_alternatives`) moves under `models/`;
  it imports `normalize_term` from `..utils.dataset`.
- Add one shared glue helper both annotated models call:
  `augment(texts, tag_strings, intents, resolve_entity, spec) -> (texts, tags, intents)`.
  It reconstructs spans from IOB tags (`tags_to_spans`), resolves each span's
  entity (`resolve_entity`: identity for NER, `slots[intent][slot]` for NLU),
  runs the seeded `expand`, and converts back via `spans_to_tags`.
- Delete `server/utils/augmentation.py`.

### Model preprocessing — NER & NLU base classes
- `load_data` parses the inline `data/utterances.csv` into the same `(X, y)`
  shape as today (NER: texts + tag strings; NLU: `(intent, tags)` pairs).
- `train()` splits first, then augments only the train split, reading
  `entities.json` (+ `slots.json` for NLU) from the data dir. NLU loads
  `self.slots` from `slots.json` instead of `kwargs.pop('slots')`.
- `BaseModel.load_data` resolves a directory argument to `<dir>/utterances.csv`.

### Training task — `server/tasks/training.py`
- `store.fget_dir(bucket, f'models/{path}/data', directory/data)` instead of the
  single `data.csv`.
- `model.train(data=directory/data, random_state=random_state, ...)`.

### Readers
- `get_training_data` ([trainings.py](../../../server/views/api/trainings.py)):
  serve `data/utterances.csv`.
- `get_coverage_analytics` ([analytics.py](../../../server/views/api/analytics.py)):
  parse the inline `utterances.csv` into the same comparable tuples. The diff
  becomes base-vs-base (removes today's augmentation noise).

## Caveat

Inline format cannot represent literal `{` / `}` in raw utterance text
(pre-existing limitation of the inline export path; the old `tags` CSV was
brace-safe). A non-issue for these utterances and the format explicitly chosen.

## Verification

- `python -m py_compile` on every changed file.
- Standalone pure-Python check (no TensorFlow/Redis): inline write→parse round
  trip, `augmentation.augment` determinism/idempotency, and NER/NLU `load_data`
  parsing on a small synthetic `data/` dir.
- UI/training run verified by the user.

## Amendment (2026-07-15): coverage-first generation

The budgeted enumerate/sample strategy in `expand` is replaced by **cyclic
coverage-first pairing**:

- Per entity, its terms (values + synonyms, plus one UNK pseudo-term when
  open-list) and its span occurrences in the train split are paired
  cyclically into `max(|terms|, |occurrences|)` rows — every term and every
  annotated occurrence appears **at least once**, and **exactly once when the
  counts allow**; only the shorter side repeats, evenly.
- Each generated row substitutes **exactly one span**; other spans keep their
  authored surface.
- Occurrences are cycled in dataset order, so per-utterance generated counts
  differ by at most one within an entity — the generated set mirrors the
  authored set's intent/utterance **distribution** instead of front-loading
  early utterances.
- A term equal to the span's own surface (or a dedup collision) falls through
  deterministically to the next term in the cycle.
- **No caps, no seed**: `max_variants`/`max_total`/`seed` are removed from
  `entities.json` (shape is now `{enabled, unk_token, catalogue}`), and the
  `AUGMENT_MAX_VARIANTS`/`AUGMENT_MAX_ROWS` config knobs are deleted.
  Determinism and idempotency now hold *by construction* (pure cycling, no
  sampling). Old `entities.json` files with the extra keys still parse — the
  keys are ignored.
