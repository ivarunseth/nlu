# Auto-catalogue Entity Values + Unified Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Annotated span values flow into the entity value catalogue automatically (on import and on manual annotation), the "Discovered in dataset" table disappears, and the NER Entity panel and NLU Slot panel render identically with catalogue drill-in links.

**Architecture:** One new model-layer method, `Entity.catalogue_surfaces(surfaces)`, silently inserts uncatalogued values via the existing `dataset_io.bulk_insert` primitive. Three write paths call it: the batched annotated import (`Model._read_annotated`), the manual tag-create view, and the utterance-edit annotation rebuild. The `GET .../values` endpoint stops computing `discovered`; the frontend drops the Discovered card and unifies the two chip panels.

**Tech Stack:** Flask + SQLAlchemy (backend), React 19 + React-Bootstrap (frontend), existing `server/utils/io.py` bulk primitives, scratchpad harness (`dbio_harness.py`) for verification.

**Spec:** docs/superpowers/specs/2026-07-16-auto-catalogue-values-design.md

## Global Constraints

- **NO GIT COMMANDS.** This tree holds a large uncommitted refactor. Never run git add/commit/stash/checkout. Skip every "Commit" step; edit files in place only.
- **IOB tag naming is untouched**: `Utterance.spans` yields slot names (NLU) / entity names (NER); prediction resolves tags to entities via the `slots.json` intent → slot → entity map. Nothing in this plan may alter `Utterance.spans`, `Tag.name`, `spans_to_tags`, or `Training.start`'s sidecars.
- **Cataloguing never aborts.** Duplicates/blanks are silently skipped. Term comparison is `normalize_term(surface).lower()` — the same rule as `Entity.catalogued_terms` / `Value.create`.
- **`catalogue_surfaces` must NOT pass `copy=True`** to `bulk_insert`: the `values.updated_at` column relies on the insert-path column default, which COPY bypasses.
- All writes run on the request session transaction (no separate commits inside helpers).
- Verification per task: `python -m py_compile` on touched Python files, scratchpad harness scripts (venv: `source /Users/varunseth/Documents/git/indic-nlu/venv/bin/activate`); `npm run build` for frontend tasks. `$SCRATCH` is the session scratchpad directory (given in the dispatch).

---

### Task 1: `Entity.catalogue_surfaces`

**Files:**
- Modify: `server/database/entity.py`
- Create: `$SCRATCH/test_catalogue.py` (not committed)

**Interfaces:**
- Consumes: `Entity.catalogued_terms()`, `normalize_term`, `timestamp` (already imported in entity.py); `dataset_io.bulk_insert(mapper, rows)` from `server/utils/io.py`.
- Produces: `Entity.catalogue_surfaces(self, surfaces) -> None` — Tasks 2 uses it from `model.py`, `tags.py`, `utterances.py`.

- [ ] **Step 1: Add imports to `server/database/entity.py`**

After the existing `from ..utils.common import timestamp, format_timestamp` (line 7), add:

```python
from ..utils import io as dataset_io

from .value import Value
```

(`value.py` does not import `entity.py`, so no import cycle; keep the existing `.tag`/`.slot`/`.utterance`/`.intent` imports as they are.)

- [ ] **Step 2: Add the method**

Insert after `catalogued_terms` (which ends at line 81), before `annotation_surfaces`:

```python
    def catalogue_surfaces(self, surfaces):
        """
        Insert uncatalogued surface strings as values (without synonyms) —
        the auto-cataloguing behind dataset import and span annotation.
        Comparison is the catalogue's usual one, lowercased
        ``normalize_term``, against existing values and synonyms and within
        the batch (first spelling wins). Never aborts: blanks and duplicates
        are silently skipped, so annotating can never fail because of the
        catalogue. Requires ``self.id`` (flush auto-created entities first).
        """
        taken = self.catalogued_terms()
        rows = []
        for surface in surfaces:
            term = normalize_term(surface)
            key = term.lower()
            if not term or key in taken:
                continue
            taken.add(key)
            rows.append({'entity_id': self.id, 'value': term,
                         'created_at': timestamp()})
        if rows:
            # Default batched path only: values.updated_at relies on the
            # insert-path column default, which COPY would bypass.
            dataset_io.bulk_insert(Value, rows)
```

- [ ] **Step 3: Write `$SCRATCH/test_catalogue.py`**

```python
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model, Entity, Value

app = make_app()
with app.app_context():
    user = seed_user(db)
    model = Model(id='m', name='m', kind='named_entity_recognition', user=user)
    entity = Entity(name='city', model=model, kind='open', color='#111111')
    db.session.add_all([model, entity])
    db.session.commit()

    # Seed one catalogued value with a synonym.
    value = Value(entity=entity, value='Delhi')
    db.session.add(value)
    from server.database import Synonym
    db.session.add(Synonym(value=value, text='New Delhi'))
    db.session.commit()

    entity.catalogue_surfaces([
        'delhi',          # covered by value (case-insensitive)
        ' New  Delhi ',   # covered by synonym after normalize_term
        'Pune',           # new
        'pune',           # batch duplicate of Pune (first spelling wins)
        '',               # blank
        '   ',            # blank after strip
        'Mumbai',         # new
    ])
    db.session.commit()

    catalogued = sorted(v.value for v in entity.values.all())
    assert catalogued == ['Delhi', 'Mumbai', 'Pune'], catalogued
    # Idempotent: a second pass adds nothing.
    entity.catalogue_surfaces(['Pune', 'MUMBAI', 'Delhi'])
    db.session.commit()
    assert entity.values.count() == 3

    # updated_at column default survived the bulk path.
    assert all(v.updated_at is not None for v in entity.values.all())
print('OK test_catalogue')
```

(If `Synonym` is not exported from `server.database`, import it as `from server.database.synonym import Synonym`.)

- [ ] **Step 4: Run the checks**

```bash
python -m py_compile server/database/entity.py
cd "$SCRATCH" && python test_catalogue.py
```
Expected: exit 0; prints `OK test_catalogue`.

---

### Task 2: Wire the three write paths

**Files:**
- Modify: `server/database/model.py` (`_read_annotated.flush_pending`, lines ~289-315)
- Modify: `server/views/api/tags.py` (`create_tag`, lines ~36-61)
- Modify: `server/views/api/utterances.py` (`_replace_annotations`, lines ~181-208)
- Create: `$SCRATCH/test_autocatalogue_paths.py` (not committed)

**Interfaces:**
- Consumes: `Entity.catalogue_surfaces(surfaces)` from Task 1; `Tag.create(...)` returns a `Tag` with `.value = utterance.text[start:end]`; NLU tags reach their entity via `tag.slot.entity` / `slot.entity` (`NOT NULL`).
- Produces: no new surface — behavioral change only (catalogue rows appear on import/annotation).

- [ ] **Step 1: Import path — `server/database/model.py`**

In `_read_annotated`'s `flush_pending`, replace the tag-building block:

```python
            tag_rows = []
            for (text, _, spans), utterance_id in zip(pending, ids):
                for start, end, entity, slot in spans:
                    tag_rows.append({
                        'utterance_id': utterance_id,
                        'entity_id': entity.id if entity is not None else None,
                        'slot_id': slot.id if slot is not None else None,
                        'start': start, 
                        'end': end,
                        'value': text[start:end],
                        'created_at': timestamp(),
                    })
            dataset_io.bulk_insert(Tag, tag_rows)
```

with:

```python
            tag_rows = []
            catalogue = {}  # owning entity -> {surface strings in this batch}
            for (text, _, spans), utterance_id in zip(pending, ids):
                for start, end, entity, slot in spans:
                    # The catalogue owner: the span's entity, or the slot's
                    # mapped entity on language understanding models.
                    owner = entity if entity is not None else slot.entity
                    catalogue.setdefault(owner, set()).add(text[start:end])
                    tag_rows.append({
                        'utterance_id': utterance_id,
                        'entity_id': entity.id if entity is not None else None,
                        'slot_id': slot.id if slot is not None else None,
                        'start': start,
                        'end': end,
                        'value': text[start:end],
                        'created_at': timestamp(),
                    })
            dataset_io.bulk_insert(Tag, tag_rows)
            for owner, values in catalogue.items():
                owner.catalogue_surfaces(values)
```

(Owners are flushed by the `db.session.flush()` at the top of `flush_pending`, so `owner.id` exists. Do not touch anything else in the method.)

- [ ] **Step 2: Manual tag creation — `server/views/api/tags.py`**

In `create_tag`, replace:

```python
        tag = Tag.create(data, utterance, slot=slot)
    else:
        entity = model.entities.filter(Entity.id == data.get('entity_id')).first()
        if entity is None:
            abort(404, 'Entity not found: %s' % data.get('entity_id'))
        tag = Tag.create(data, utterance, entity)
    db.session.add(tag)
    db.session.commit()
```

with:

```python
        tag = Tag.create(data, utterance, slot=slot)
        slot.entity.catalogue_surfaces([tag.value])
    else:
        entity = model.entities.filter(Entity.id == data.get('entity_id')).first()
        if entity is None:
            abort(404, 'Entity not found: %s' % data.get('entity_id'))
        tag = Tag.create(data, utterance, entity)
        entity.catalogue_surfaces([tag.value])
    db.session.add(tag)
    db.session.commit()
```

- [ ] **Step 3: Utterance-edit rebuild — `server/views/api/utterances.py`**

Replace the whole `_replace_annotations` function body:

```python
def _replace_annotations(model, utterance, spans):
    """Drop every annotated span on ``utterance`` and recreate it from ``spans``."""
    for tag in utterance.tags.all():
        db.session.delete(tag)
    db.session.flush()
    catalogue = {}  # owning entity -> {surface strings}
    if model.kind == 'natural_language_understanding':
        # Language understanding spans reference slots — only the ones
        # scoped to this utterance's intent, so an inline edit can never
        # smuggle in a role the intent does not define.
        scoped = model.slots.filter_by(intent_id=utterance.intent_id)
        slots = {slot.name: slot for slot in scoped.all()}
        for span in sorted(spans, key=lambda item: item.get('start', 0)):
            slot = scoped.filter_by(id=span['slot_id']).first() if 'slot_id' in span \
                else slots.get(span.get('label'))
            if slot is None:
                abort(404, 'Slot not defined on this intent: %s'
                      % (span.get('slot_id') or span.get('label')))
            tag = Tag.create(span, utterance, slot=slot)
            db.session.add(tag)
            catalogue.setdefault(slot.entity, set()).add(tag.value)
    else:
        # The name key stays 'label' — the display-name convention shared with
        # Tag.to_dict.
        entities = {entity.name: entity for entity in model.entities.all()}
        for span in sorted(spans, key=lambda item: item.get('start', 0)):
            entity = model.entities.filter(Entity.id == span['entity_id']).first() \
                if 'entity_id' in span else entities.get(span.get('label'))
            if entity is None:
                abort(404, 'Entity not found: %s' % (span.get('entity_id') or span.get('label')))
            tag = Tag.create(span, utterance, entity)
            db.session.add(tag)
            catalogue.setdefault(entity, set()).add(tag.value)
    for entity, values in catalogue.items():
        entity.catalogue_surfaces(values)
```

(Note the original NLU branch ended with `return`; the restructure into if/else removes it so the shared catalogue loop runs for both kinds. Everything else — ordering, abort messages, comments — stays identical.)

- [ ] **Step 4: Write `$SCRATCH/test_autocatalogue_paths.py`**

```python
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model, Utterance, Value

app = make_app()
with app.app_context():
    user = seed_user(db)

    # --- Import path, NER: values land under the span's entity. ---
    ner = Model(id='ner', name='ner', kind='named_entity_recognition', user=user)
    db.session.add(ner); db.session.commit()
    ner.read('fly to {city: Delhi}\nbook {city: Pune} hotel\ngo {city: Delhi}\n',
             fmt='inline')
    db.session.commit()
    city = ner.entities.filter_by(name='city').first()
    catalogued = sorted(v.value for v in city.values.all())
    assert catalogued == ['Delhi', 'Pune'], catalogued

    # Re-import: idempotent, no duplicate values.
    ner.read('again {city: Delhi}\n', fmt='inline')
    db.session.commit()
    assert city.values.count() == 2

    # --- Import path, NLU: values land under the slot's mapped entity. ---
    nlu = Model(id='nlu', name='nlu', kind='natural_language_understanding',
                user=user)
    db.session.add(nlu); db.session.commit()
    nlu.read('book\tfly to {dest: Mumbai}\n', fmt='inline')
    db.session.commit()
    dest_entity = nlu.entities.filter_by(name='dest').first()
    assert [v.value for v in dest_entity.values.all()] == ['Mumbai']

    # --- Utterance-edit rebuild path catalogues too. ---
    from server.views.api.utterances import _replace_annotations
    utterance = db.session.query(Utterance).filter_by(model_id='ner').first()
    _replace_annotations(ner, utterance,
                         [{'label': 'city', 'start': 0, 'end': 3}])
    db.session.commit()
    surface = utterance.text[0:3]
    assert any(v.value == surface for v in city.values.all()) \
        or surface.lower() in {v.value.lower() for v in city.values.all()}

    # --- IOB constraint untouched: NLU spans still train under slot names. ---
    nlu_utterance = db.session.query(Utterance).filter_by(model_id='nlu').first()
    assert nlu_utterance.spans[0][2] == 'dest'
print('OK test_autocatalogue_paths')
```

- [ ] **Step 5: Run the checks**

```bash
python -m py_compile server/database/model.py server/views/api/tags.py server/views/api/utterances.py
cd "$SCRATCH" && python test_autocatalogue_paths.py
```
Expected: exit 0; prints `OK test_autocatalogue_paths`.

---

### Task 3: Retire the Discovered table

**Files:**
- Modify: `server/views/api/values.py` (`get_entity_values`, lines 30-74)
- Modify: `src/routes/model/routes/studio/components/EntityValues.jsx`
- Create: `$SCRATCH/test_values_payload.py` (not committed)

**Interfaces:**
- Consumes: nothing new. `entity.annotation_surfaces()` stays (feeds coverage counts).
- Produces: `GET /models/<id>/entities/<id>/values` payload without the `discovered` key; `EntityValues.jsx` without the Discovered UI.

- [ ] **Step 1: Trim `get_entity_values` in `server/views/api/values.py`**

Replace the function body from `surfaces = entity.annotation_surfaces()` to the `return`, and update the docstring:

```python
@api.get('/models/<modelId>/entities/<entityId>/values')
@token_auth.login_required
def get_entity_values(modelId, entityId):
    """
    The entity drill-in payload: the stored catalogue — each value with its
    synonyms and how many annotated spans it currently covers. Annotated
    values are catalogued automatically on import and annotation, so there
    is no separate "discovered" section.
    """
    model, entity = _get_entity(modelId, entityId)

    # One pass over the entity's annotated surfaces; coverage counts are
    # aggregated in Python so each request costs a single dataset query.
    surfaces = entity.annotation_surfaces()
    occurrences = {}
    for value, slot_name, intent_name in surfaces:
        key = normalize_term(value).lower()
        occurrences[key] = occurrences.get(key, 0) + 1

    values = []
    for value in entity.values.order_by(Value.id.asc()).all():
        terms = {normalize_term(term).lower() for term in value.terms()}
        count = sum(occurrences.get(term, 0) for term in terms)
        values.append(value.to_dict(count=count))

    return {
        'entity': entity.to_dict(),
        'values': values,
        'total': len(values)
    }, 200
```

- [ ] **Step 2: Strip the Discovered UI from `EntityValues.jsx`**

All edits in `src/routes/model/routes/studio/components/EntityValues.jsx`:

1. Imports: remove `Bookmarks` and `Search` from the `react-bootstrap-icons` import (both are only used by the Discovered UI); remove the now-unused `ModelContext` import.
2. Remove the `nlu` derivation and its `ModelContext` usage: delete `const { model } = useContext(ModelContext);` and `const nlu = model?.kind === "natural_language_understanding";` (keep `UserContext`).
3. State: delete `const [discovered, setDiscovered] = useState([]);`, `const [discoveredPage, setDiscoveredPage] = useState(1);`, and `const [promoting, setPromoting] = useState(null);`.
4. In `getValues`: delete `setDiscovered(response.data.discovered);`.
5. Delete the whole `handlePromote` function.
6. Delete `const pagedDiscovered = discovered.slice(...)`.
7. MetricsStrip: delete the `{ label: "Discovered", value: discovered.length, icon: <Search /> }` item (strip becomes Values / Synonyms / Covered spans).
8. Delete the entire "Discovered in dataset" `<Card>` block (the second Card, `CardHeading icon={<Search />} title="Discovered in dataset"` through its closing `</Card>`) **and** the `<AppPagination ... page={discoveredPage} ...>` block that follows it (keep the values-table pagination).

- [ ] **Step 3: Write `$SCRATCH/test_values_payload.py`**

```python
from dbio_harness import make_app, seed_user
from server import db
from server.database import Model

app = make_app()
with app.app_context():
    user = seed_user(db)
    ner = Model(id='p', name='p', kind='named_entity_recognition', user=user)
    db.session.add(ner); db.session.commit()
    ner.read('fly to {city: Delhi}\n', fmt='inline')
    db.session.commit()
    entity = ner.entities.filter_by(name='city').first()

    from server.views.api.values import get_entity_values
    from flask import g
    # Call past the @token_auth.login_required wrapper (functools.wraps
    # exposes the raw view as __wrapped__) — no auth header in this harness.
    view = get_entity_values.__wrapped__
    with app.test_request_context():
        g.current_user = user
        payload, status = view('p', str(entity.id))
    assert status == 200
    assert 'discovered' not in payload, payload.keys()
    assert payload['values'][0]['value'] == 'Delhi'
    assert payload['values'][0]['count'] == 1  # coverage count survived
print('OK test_values_payload')
```

- [ ] **Step 4: Run the checks**

```bash
python -m py_compile server/views/api/values.py
cd "$SCRATCH" && python test_values_payload.py
grep -n "discovered\|Discovered\|handlePromote\|promoting" \
    /Users/varunseth/Documents/git/indic-nlu/src/routes/model/routes/studio/components/EntityValues.jsx
cd /Users/varunseth/Documents/git/indic-nlu && npm run build
```
Expected: py_compile exit 0; prints `OK test_values_payload`; the grep returns **no matches**; build succeeds.

---

### Task 4: Unify the Entity/Slot panels

**Files:**
- Modify: `src/routes/model/routes/studio/components/IntentWorkspace.jsx` (the `EntitiesPanel` usage, lines ~422-431)
- Modify: `src/routes/model/routes/studio/components/EntitiesPanel.jsx`

**Interfaces:**
- Consumes: `EntitiesPanel`'s existing `linkOf` prop (renders the chip name as a `<Link>`); slot rows carry `slot.entity` (`NOT NULL` in the DB). The NLU entity drill-in route is `/models/${modelId}/build?tab=entities&entity=<entityId>` (see `UnderstandingBuild.jsx`).
- Produces: identical chip rendering for NER entities and NLU slots: dot, linked name, span count, edit, delete.

- [ ] **Step 1: Update the panel usage in `IntentWorkspace.jsx`**

Replace:

```jsx
                        <EntitiesPanel
                            loading={slotsLoading}
                            entities={slots}
                            query={slotQuery}
                            noun="slot"
                            secondary={(slot) => slot.entity?.name}
                            titleOf={(slot) => (slot.entity ? `${slot.name} → ${slot.entity.name}` : slot.name)}
                            onEdit={handleOpenEditSlot}
                            onDelete={setSlotToDelete}
                        />
```

with:

```jsx
                        <EntitiesPanel
                            loading={slotsLoading}
                            entities={slots}
                            query={slotQuery}
                            noun="slot"
                            titleOf={(slot) => (slot.entity ? `${slot.name} → ${slot.entity.name}` : slot.name)}
                            linkOf={(slot) => `/models/${modelId}/build?tab=entities&entity=${slot.entity?.id}`}
                            onEdit={handleOpenEditSlot}
                            onDelete={setSlotToDelete}
                        />
```

(The sub-label goes; the mapping stays discoverable via the hover title. The link opens the slot's mapped entity's value catalogue on the entities tab.)

- [ ] **Step 2: Remove the `secondary` prop from `EntitiesPanel.jsx`**

1. Delete `secondary,` from the destructured props.
2. Delete the render block:

```jsx
                                {secondary && secondary(entity) && (
                                    <span className="text-muted small text-truncate" style={{ maxWidth: "100px" }}>
                                        {secondary(entity)}
                                    </span>
                                )}
```

3. Update the component's doc comment: drop the sentence about `secondary` ("`secondary` optionally renders a muted sub-label inside the chip (a slot's mapped entity name);") and keep the `titleOf` / `linkOf` sentences.

- [ ] **Step 3: Run the checks**

```bash
grep -rn "secondary" /Users/varunseth/Documents/git/indic-nlu/src/routes/model/routes/studio/components/EntitiesPanel.jsx /Users/varunseth/Documents/git/indic-nlu/src/routes/model/routes/studio/components/IntentWorkspace.jsx
cd /Users/varunseth/Documents/git/indic-nlu && npm run build
```
Expected: the grep returns **no matches**; build succeeds.
