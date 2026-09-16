"""
The Build page's JSON view: the whole authored dataset as one document,
read with ``GET`` and written back with ``PUT`` in a single transaction.

``Model.dataset_to_dict`` (server/database/model.py) defines the document;
``apply_dataset`` below reconciles one against the rows: a row with a known
``id`` is updated through its own ``from_dict``, a row without one is created
through its own ``create`` — so every validator the per-resource endpoints
enforce (unique, whitespace-free names; slot ∈ intent; catalogue duplicates;
span bounds and overlap) applies here unchanged — and rows whose ids the
document no longer lists are deleted. Utterance text carries its spans as
the Build page's ``{name: value}`` markup; it is parsed here with the same
``parse_inline`` the import formats use, so offsets never leave the server.
Every validation failure names the JSON path it happened at
(``intents[2].utterances[12]: …``) and rolls the whole save back.
"""
import json

from flask import Response, request, g, abort

from werkzeug.exceptions import HTTPException

from ...auth import token_auth
from ...database import Entity, Intent, Slot, Utterance, Value
from ...utils.dataset import parse_inline, validate_import_spans

from ... import db
from . import api
from .utterances import _replace_annotations


REGISTRY_FIELDS = ('name', 'color', 'description')


def _get_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    return model


def _document_response(document):
    """
    Serialise without Flask's key sorting: the document's key order (``id``
    first, registries before utterances) is what the editor renders, and a
    sorted ``color, description, id, …`` reads wrong.
    """
    return Response(json.dumps(document, ensure_ascii=False), mimetype='application/json')


@api.get('/models/<modelId>/dataset')
@token_auth.login_required
def get_dataset(modelId):
    return _document_response(_get_model(modelId).dataset_to_dict())


@api.put('/models/<modelId>/dataset')
@token_auth.login_required
def put_dataset(modelId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    model = _get_model(modelId)
    document = request.get_json()
    if not isinstance(document, dict):
        abort(400, 'The dataset must be a JSON object')
    try:
        apply_dataset(model, document)
        db.session.commit()
    except HTTPException:
        # Request teardown would roll back too; be explicit so a failed save
        # can never leave half a document behind.
        db.session.rollback()
        raise
    return _document_response(model.dataset_to_dict())


# --- Document validation ----------------------------------------------------

def _scoped(path, fn):
    """Run one row operation, prefixing any validation abort with its JSON path."""
    try:
        return fn()
    except HTTPException as error:
        # Row validators abort with 400/404/409; to the document editor they
        # are all "this path is invalid", so they surface uniformly as 400.
        code = error.code if error.code >= 500 else 400
        abort(code, f'{path}: {error.description}')


def _items(container, key, path):
    """``container[key]`` as a list of objects, or a 400 naming the path."""
    items = container.get(key)
    if items is None:
        abort(400, f'{path}: "{key}" is required')
    if not isinstance(items, list):
        abort(400, f'{path}.{key} must be a list')
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            abort(400, f'{path}.{key}[{index}] must be an object')
    return items


def _row_id(item, path):
    value = item.get('id')
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        abort(400, f'{path}.id must be an integer or null')
    return value


def _require_text(item, key, path=None):
    """``item[key]`` as a non-empty string; ``path`` prefixes the error when the caller isn't inside ``_scoped``."""
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        abort(400, f'{path + "." if path else ""}{key} must be a non-empty string')
    return value


def _check_unique(items, key, path, what):
    seen = {}
    for index, item in enumerate(items):
        name = item.get(key)
        if name in seen:
            abort(400, f'{path}[{index}]: {what} "{name}" appears twice (also at {path}[{seen[name]}])')
        seen[name] = index


def _authored(item, fields):
    """The authored fields the document carries for a row — nothing else reaches ``from_dict``."""
    return {field: item[field] for field in fields if field in item}


def _reconcile(items, existing, path, update, create):
    """
    Update the rows whose ``id`` the document lists (``existing`` maps id →
    row for the ids this collection may legitimately reference), create the
    rest, and return the rows in document order plus the set of kept ids.
    """
    rows, kept = [], set()
    for index, item in enumerate(items):
        item_path = f'{path}[{index}]'
        row_id = _row_id(item, item_path)
        if row_id is None:
            row = _scoped(item_path, lambda: create(item))
            db.session.add(row)
        else:
            row = existing.get(row_id)
            if row is None:
                abort(400, f'{item_path}: id {row_id} is not in this dataset')
            if row_id in kept:
                abort(400, f'{item_path}: id {row_id} appears twice')
            _scoped(item_path, lambda: update(row, item))
            kept.add(row_id)
        rows.append(row)
    return rows, kept


def _delete_missing(existing, kept):
    for row_id, row in existing.items():
        if row_id not in kept:
            db.session.delete(row)


# --- Reconciliation ---------------------------------------------------------

def apply_dataset(model, document):
    """
    Reconcile ``document`` against ``model``'s rows. Phases, so name
    references resolve and cascades never race an edit: registries
    (update, then create, flushed per collection), then utterances, then
    every delete-by-omission last. See the module docstring.
    """
    if model.kind in ('named_entity_recognition', 'natural_language_understanding'):
        _apply_annotated(model, document)
    else:
        _apply_classification(model, document)


def _registry_update(row, item, fields=REGISTRY_FIELDS, validate=None):
    _require_text(item, 'name')
    row.from_dict(_authored(item, fields), partial_update=True)
    if validate is not None:
        validate(row)


def _apply_classification(model, document):
    labels = _items(document, 'labels', '$')
    _check_unique(labels, 'name', 'labels', 'label')
    for index, label in enumerate(labels):
        _require_text(label, 'name', f'labels[{index}]')
        _items(label, 'utterances', f'labels[{index}]')

    existing_labels = {row.id: row for row in model.intents.all()}
    label_rows, kept_labels = _reconcile(
        labels, existing_labels, 'labels',
        update=_registry_update,
        create=lambda item: Intent.create(_authored(item, REGISTRY_FIELDS), model)
    )
    db.session.flush()

    existing_utterances = {
        row.id: row
        for row in Utterance.query.join(Intent, Utterance.intent_id == Intent.id)
        .filter(Intent.model_id == model.id).all()
    }
    kept_utterances = set()
    for index, (label, row) in enumerate(zip(labels, label_rows)):
        path = f'labels[{index}].utterances'

        def update(utterance, item, label_row=row):
            text = _require_text(item, 'text')
            if utterance.text != text:
                utterance.from_dict({'text': text})
            # Listed under a different label than it belongs to: moved.
            if utterance.intent is not label_row:
                utterance.intent = label_row

        def create(item, label_row=row):
            return Utterance.create({'text': _require_text(item, 'text')}, intent=label_row)

        _, kept = _reconcile(label['utterances'], existing_utterances, path, update, create)
        kept_utterances |= kept
    db.session.flush()

    _delete_missing(existing_utterances, kept_utterances)
    _delete_missing(existing_labels, kept_labels)
    db.session.flush()


def _parse_markup(item):
    """
    An utterance item's ``text`` — ``{name: value}`` markup — as the plain
    text and its ``(start, end, name)`` spans. Malformed markup or an invalid
    span aborts; inside ``_scoped`` that names the utterance's path.
    """
    raw = _require_text(item, 'text')
    try:
        text, spans = parse_inline(raw)
    except ValueError as error:
        abort(400, str(error))
    if not text.strip():
        abort(400, 'text must be a non-empty string')
    error = validate_import_spans(text, spans)
    if error:
        abort(400, error)
    return text, spans


def _apply_annotated(model, document):
    nlu = model.kind == 'natural_language_understanding'

    entities = _items(document, 'entities', '$')
    _check_unique(entities, 'name', 'entities', 'entity')
    for index, entity in enumerate(entities):
        _items(entity, 'values', f'entities[{index}]')
    intents, utterances = [], []
    if nlu:
        intents = _items(document, 'intents', '$')
        _check_unique(intents, 'name', 'intents', 'intent')
        for index, intent in enumerate(intents):
            slots = _items(intent, 'slots', f'intents[{index}]')
            _check_unique(slots, 'name', f'intents[{index}].slots', 'slot')
            _items(intent, 'utterances', f'intents[{index}]')
    else:
        utterances = _items(document, 'utterances', '$')

    # Phase 1 — registries.
    existing_intents, intent_rows, kept_intents = {}, [], set()
    if nlu:
        existing_intents = {row.id: row for row in model.intents.all()}
        intent_rows, kept_intents = _reconcile(
            intents, existing_intents, 'intents',
            update=_registry_update,
            create=lambda item: Intent.create(_authored(item, REGISTRY_FIELDS), model)
        )
        db.session.flush()

    existing_entities = {row.id: row for row in model.entities.all()}
    # ``list_type`` is the public name of ``kind``; ``Entity.from_dict`` maps it.
    entity_fields = REGISTRY_FIELDS + ('list_type',)
    entity_rows, kept_entities = _reconcile(
        entities, existing_entities, 'entities',
        update=lambda row, item: _registry_update(row, item, entity_fields, validate=Entity.validate_name),
        create=lambda item: Entity.create(_authored(item, entity_fields), model)
    )
    db.session.flush()
    entities_by_name = {row.name: row for row in entity_rows}

    def resolve_entity(name):
        entity = entities_by_name.get(name)
        if entity is None:
            abort(400, f'unknown entity "{name}"')
        return entity

    existing_slots, kept_slots = {}, set()
    if nlu:
        existing_slots = {row.id: row for row in model.slots.all()}
        for index, (intent, intent_row) in enumerate(zip(intents, intent_rows)):
            path = f'intents[{index}].slots'

            def update(slot, item, intent_row=intent_row):
                if slot.intent is not intent_row:
                    abort(400, 'a slot cannot move between intents; add a new slot instead')
                data = {'name': _require_text(item, 'name')}
                if 'entity' in item:
                    data['entity_id'] = resolve_entity(item['entity']).id
                if 'color' in item:
                    data['color'] = item['color']
                slot.from_dict(data)

            def create(item, intent_row=intent_row):
                return Slot.create({
                    'name': item.get('name'),
                    'intent_id': intent_row.id,
                    'entity_id': resolve_entity(item.get('entity')).id,
                    'color': item.get('color')
                }, model)

            _, kept = _reconcile(intent['slots'], existing_slots, path, update, create)
            kept_slots |= kept
        db.session.flush()

    existing_values = {
        row.id: row
        for row in Value.query.join(Entity, Value.entity_id == Entity.id)
        .filter(Entity.model_id == model.id).all()
    }
    kept_values = set()
    for index, (entity, entity_row) in enumerate(zip(entities, entity_rows)):
        path = f'entities[{index}].values'

        def update(value, item, entity_row=entity_row):
            if value.entity is not entity_row:
                abort(400, 'a value cannot move between entities; add it to the other catalogue instead')
            data = {}
            if item.get('value') != value.value:
                data['value'] = item.get('value')
            synonyms = item.get('synonyms', [])
            if synonyms != [synonym.text for synonym in value.synonyms.all()]:
                data['synonyms'] = synonyms
            if data:
                value.from_dict(data)

        def create(item, entity_row=entity_row):
            return Value.create({'value': item.get('value'), 'synonyms': item.get('synonyms', [])}, entity_row)

        _, kept = _reconcile(entity['values'], existing_values, path, update, create)
        kept_values |= kept
    db.session.flush()

    # Phase 2 — utterances and their spans. An existing utterance's spans
    # are rebuilt (against the new text, through Tag.create's validation)
    # only when its text or span set changed, so untouched spans keep ids.
    def replace_spans(utterance, spans):
        # ``intent_id`` must be populated before the slot lookup scopes on it.
        db.session.flush()
        _replace_annotations(model, utterance, [
            {'label': name, 'start': start, 'end': end} for start, end, name in spans
        ])

    def apply_utterance(utterance, text, spans, intent=None):
        changed = utterance.text != text or sorted(spans) != utterance.spans
        if intent is not None and utterance.intent is not intent:
            changed = True
        if not changed:
            return
        utterance.from_dict({'text': text})
        if intent is not None:
            utterance.intent = intent
        replace_spans(utterance, spans)

    def new_utterance(text, spans, intent=None):
        if nlu:
            utterance = Utterance.create({'text': text}, intent=intent, model=model)
        else:
            utterance = Utterance.create({'text': text}, model=model)
        db.session.add(utterance)
        if spans:
            replace_spans(utterance, spans)
        return utterance

    kept_utterances = set()
    if nlu:
        # Only utterances filed under an intent are the document's to keep or
        # drop; an orphan (none should exist) is left alone either way.
        existing_utterances = {
            row.id: row for row in model.utterances.all() if row.intent_id is not None
        }
        for index, (intent, intent_row) in enumerate(zip(intents, intent_rows)):
            path = f'intents[{index}].utterances'

            def update(utterance, item, intent_row=intent_row):
                text, spans = _parse_markup(item)
                apply_utterance(utterance, text, spans, intent=intent_row)

            def create(item, intent_row=intent_row):
                text, spans = _parse_markup(item)
                return new_utterance(text, spans, intent=intent_row)

            _, kept = _reconcile(intent['utterances'], existing_utterances, path, update, create)
            kept_utterances |= kept
    else:
        existing_utterances = {row.id: row for row in model.utterances.all()}

        def update(utterance, item):
            text, spans = _parse_markup(item)
            apply_utterance(utterance, text, spans)

        def create(item):
            text, spans = _parse_markup(item)
            return new_utterance(text, spans)

        _, kept_utterances = _reconcile(utterances, existing_utterances, 'utterances', update, create)
    db.session.flush()

    # Phase 3 — deletes by omission, dependants first.
    _delete_missing(existing_utterances, kept_utterances)
    _delete_missing(existing_values, kept_values)
    _delete_missing(existing_slots, kept_slots)
    _delete_missing(existing_entities, kept_entities)
    _delete_missing(existing_intents, kept_intents)
    db.session.flush()
