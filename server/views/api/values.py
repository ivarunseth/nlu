"""
The value catalogue of an entity: canonical values and their synonyms,
authored in the entity drill-in on both named entity recognition and
language understanding models. The catalogue feeds training-data generation
(closed lists enumerate through it; open lists use it as samples besides
the UNK generalization).
"""
from flask import request, g, abort

from ...auth import token_auth
from ...database import Value
from ...utils.dataset import normalize_term

from ... import db
from . import api


def _get_entity(modelId, entityId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    if model.kind not in ('named_entity_recognition', 'natural_language_understanding'):
        abort(400, 'Entity values are only defined on annotated model types')
    entity = model.entities.filter_by(id=entityId).first()
    if entity is None:
        abort(404, 'Entity not found: %s' % entityId)
    return model, entity


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


@api.post('/models/<modelId>/entities/<entityId>/values')
@token_auth.login_required
def create_entity_value(modelId, entityId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    model, entity = _get_entity(modelId, entityId)
    value = Value.create(request.get_json(), entity)
    db.session.add(value)
    db.session.commit()
    return value.to_dict(), 201


@api.put('/models/<modelId>/entities/<entityId>/values/<valueId>')
@token_auth.login_required
def edit_entity_value(modelId, entityId, valueId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    model, entity = _get_entity(modelId, entityId)
    value = entity.values.filter_by(id=valueId).first()
    if value is None:
        abort(404, 'Value not found: %s' % valueId)
    value.from_dict(request.get_json())
    db.session.commit()
    return value.to_dict(), 200


@api.delete('/models/<modelId>/entities/<entityId>/values/<valueId>')
@token_auth.login_required
def delete_entity_value(modelId, entityId, valueId):
    model, entity = _get_entity(modelId, entityId)
    value = entity.values.filter_by(id=valueId).first()
    if value is None:
        abort(404, 'Value not found: %s' % valueId)
    # Synonyms cascade with the value; annotated spans are untouched — the
    # catalogue is training metadata, never a constraint on the dataset.
    db.session.delete(value)
    db.session.commit()
    return '', 204
