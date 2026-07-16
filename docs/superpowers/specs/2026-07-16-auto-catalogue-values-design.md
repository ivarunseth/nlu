# Auto-catalogue entity values + unified Entity/Slot panels — design

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan

## Problem

1. Annotated span values reach the entity value catalogue only by hand: the
   entity drill-in (`EntityValues.jsx`) shows a "Discovered in dataset" table
   (computed on every `GET .../values` request) from which the user promotes
   values one click at a time. Import and annotation should feed the
   catalogue directly; the discovered table goes away.
2. The Entity panel (NER build page) and the Slot panel (NLU intent
   workspace) render differently: the NER panel links each chip to the
   entity's value catalogue, while the NLU panel shows a muted entity-name
   sub-label inside each slot chip and links nowhere. They should be alike:
   no sub-label, and the chip name links to the value catalogue.

## Decisions

1. **Auto-catalogue on every write path** (user choice: "Import + manual
   annotation"). Both dataset import and every span created or edited in the
   workspace insert uncatalogued values, so nothing is ever "uncatalogued"
   and removing the Discovered table loses nothing.
2. **Model-layer helper, not ORM events** (approach A). Bulk/COPY inserts
   bypass ORM events, so the import path — the main one — would never fire a
   listener. An explicit helper called from each write path matches the
   codebase's model-method pattern.
3. **The catalogue owner is the span's entity.** NER: the tag's entity. NLU:
   the tag's slot's mapped entity (`slot.entity`, `NOT NULL`), so values from
   `source`/`destination` slots both land under the shared `location` entity.
4. **Cataloguing never fails the write.** Duplicates (against existing
   values *and* synonyms, and within the incoming batch) are silently
   skipped using the existing `normalize_term(...).lower()` comparison that
   `values.py` already uses for coverage counts. Auto-catalogued values get
   no synonyms.
5. **No backfill.** Existing "discovered but never promoted" values enter
   the catalogue the next time an import or annotation touches them. (Can be
   added later as a one-shot script if wanted.)
6. **IOB tag naming is untouched — stated as a constraint.** Verified
   current behavior: `Utterance.spans` yields the *slot's* name for language
   understanding and the *entity's* name for named entity recognition;
   training and every export format flow through it (`spans_to_tags`,
   `format_inline`, CoNLL, CSV); prediction post-processing resolves a
   predicted tag to an entity via the intent → slot → entity map shipped as
   `slots.json`. Nothing in this design may change that: the catalogue keys
   `Value` rows on the slot's mapped entity, which is orthogonal to the tag
   vocabulary.

## Backend changes

### `Entity.catalogue_surfaces(surfaces)` — `server/database/entity.py`

One new method. Input: an iterable of surface strings. Behavior:

- Build the covered-term set once from `catalogued_terms()` (values +
  synonyms), normalized lowercase.
- Filter incoming surfaces: drop blanks, drop anything already covered,
  de-duplicate within the batch (first spelling wins).
- Insert the remainder as `Value` rows (`entity_id`, `value`,
  `created_at`) via `dataset_io.bulk_insert` — no synonyms, no returning.
- Never `abort`; a no-op when everything is covered. Runs on the session
  transaction like every other write (a failed import rolls values back
  with the tags).

### Call sites

- **Import** — `Model._read_annotated.flush_pending`
  (`server/database/model.py`): while building `tag_rows`, accumulate
  `entity → {surfaces}` (NER: the span's entity; NLU: `slot.entity`). After
  the tag `bulk_insert`, call `entity.catalogue_surfaces(surfaces)` once per
  entity in the batch. Registry rows are already flushed at that point, so
  `entity.id` exists.
- **Manual tag creation** — the two `Tag.create` call sites in
  `server/views/api/tags.py` (NER `entity=`, NLU `slot=`): after creating
  the tag, call `catalogue_surfaces([value])` on the owning entity.
- **Utterance edit** — `_replace_annotations` in
  `server/views/api/utterances.py` (the PUT-with-`annotations` path that
  rebuilds all tags from inline markup): each rebuilt span catalogues its
  value the same way, batched per entity.
- Inline utterance creation in the workspaces posts tags through the same
  tag view, so it is covered by the manual path.

### `GET /models/<id>/entities/<id>/values` — `server/views/api/values.py`

Drop the `discovered` computation and the `discovered` key from the
payload. Keep `annotation_surfaces()` and the per-value covered-span
counts, which reuse the same single query.

## Frontend changes

### `EntityValues.jsx`

Remove: the "Discovered in dataset" card and its table, `discovered` /
`discoveredPage` state, `handlePromote` / `promoting`, the discovered
pagination block, and the "Discovered" metrics tile (strip shows Values /
Synonyms / Covered spans). The values API response no longer carries
`discovered`.

### `IntentWorkspace.jsx`

On its `EntitiesPanel` usage: remove `secondary={(slot) => slot.entity?.name}`
and add
`linkOf={(slot) => `/models/${modelId}/build?tab=entities&entity=${slot.entity.id}`}`
— the slot chip's name links to its mapped entity's value catalogue, the
same drill-in the NLU entities tab uses. Keep `titleOf` (`slot → entity` on
hover) so the mapping stays discoverable without the sub-label.

### `EntitiesPanel.jsx`

Remove the now-unused `secondary` prop and its render block — the NER and
NLU panels become alike by construction (dot, linked name, span count,
edit, delete).

## Error handling

- `catalogue_surfaces` cannot abort; it only ever adds rows. All writes
  share the request transaction, so any later `abort` rolls back values
  together with tags/utterances.
- Concurrent duplicate inserts are possible in principle (two requests
  cataloguing the same new value simultaneously) since there is no DB
  unique constraint on `(entity_id, value)` — the duplicate would show as
  two identical rows in the drill-in. Accepted as out of scope: it is
  unlikely, harmless to training, and consistent with `Value.create`'s
  existing application-level (not DB-level) uniqueness check.

## Testing / verification

- `python -m py_compile` on touched Python files; `npm run build`.
- Scratchpad script against the harness: import an annotated dataset →
  assert `Value` rows exist under the right entities (NLU: under the
  slot's mapped entity), duplicates skipped, blank/covered surfaces
  skipped; manual-path check via `Tag.create` + `catalogue_surfaces`;
  re-import the same file → no duplicate values.
- Verify `GET .../values` payload has no `discovered` key and counts are
  unchanged.
- IOB constraint: assert `spans_to_tags` output for an NLU utterance uses
  slot names (unchanged by this work).

## Rejected alternatives

- **ORM event listener on Tag insert** — bulk/COPY inserts bypass ORM
  events, so imports would not catalogue; hidden magic besides.
- **Auto-promote inside the GET endpoint** — mutation on GET and the
  recompute cost stays on every drill-in view.
- **Keeping the Discovered table read-only** — the user explicitly wants it
  gone; with auto-cataloguing it would always be empty anyway.
