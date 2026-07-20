"""
The entity registry of an annotated model: the span types a named entity
recognition span references directly and a language understanding slot maps
to. The per-entity value catalogue lives in the nested values resource
(``values.py``).
"""
from flask import request, g, abort

from sqlalchemy import func, select

from ...auth import token_auth
from ...database import Entity, Value
from ...utils.query import apply_sort, apply_date_range, list_argument

from ... import db
from . import api


# The catalogue tally `to_dict` reports, as a correlated subquery so the
# list can be ordered by it in SQL.
VALUES_COUNT = (
    select(func.count(Value.id))
    .where(Value.entity_id == Entity.id)
    .scalar_subquery()
)

ENTITY_SORT_COLUMNS = {
    'name': Entity.name,
    'values_count': VALUES_COUNT,
    'created_at': Entity.created_at,
    'updated_at': Entity.updated_at,
}

# Public `list_type` values map onto the stored `kind`.
ENTITY_KINDS = ('open', 'closed')


def _get_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    if model.kind not in ('named_entity_recognition', 'natural_language_understanding'):
        abort(400, 'Entities are only defined on annotated model types')
    return model


@api.get('/models/<modelId>/entities')
@token_auth.login_required
def get_entities(modelId):
    model = _get_model(modelId)
    entities = model.entities
    query = request.args.get('query', None)
    if query is not None:
        entities = entities.filter(Entity.name.ilike(f'%{query}%'))
    kinds = list_argument('kind', allowed=ENTITY_KINDS)
    if kinds:
        entities = entities.filter(Entity.kind.in_(kinds))
    entities = apply_date_range(entities, Entity.created_at, prefix='created')
    entities = apply_sort(entities, ENTITY_SORT_COLUMNS,
                          default=('name', 'asc'),
                          secondary=Entity.id.desc())
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    entities = entities.paginate(
        page=page,
        per_page=per_page,
        error_out=False
    )
    return {
        'entities': [entity.to_dict() for entity in entities.items],
        'total': entities.total,
        'page': entities.page,
        'per_page': entities.per_page
    }, 200


@api.get('/models/<modelId>/entities/<entityId>')
@token_auth.login_required
def get_entity(modelId, entityId):
    model = _get_model(modelId)
    entity = model.entities.filter_by(id=entityId).first()
    if entity is None:
        abort(404, 'Entity not found: %s' % entityId)
    return entity.to_dict(), 200


@api.post('/models/<modelId>/entities')
@token_auth.login_required
def create_entity(modelId):
    model = _get_model(modelId)
    entity = Entity.create(request.form, model)
    db.session.add(entity)
    db.session.commit()
    return entity.to_dict(), 201


@api.put('/models/<modelId>/entities/<entityId>')
@token_auth.login_required
def edit_entity(modelId, entityId):
    model = _get_model(modelId)
    entity = model.entities.filter_by(id=entityId).first()
    if entity is None:
        abort(404, 'Entity not found: %s' % entityId)
    entity.from_dict(request.form, partial_update=True)
    entity.validate_name()
    db.session.commit()
    return entity.to_dict(), 200


@api.delete('/models/<modelId>/entities/<entityId>')
@token_auth.login_required
def delete_entity(modelId, entityId):
    model = _get_model(modelId)
    entity = model.entities.filter_by(id=entityId).first()
    if entity is None:
        abort(404, 'Entity not found: %s' % entityId)
    # Cascades take the entity's values and, on language understanding
    # models, the slots mapping to it — and through them their spans (MT-5).
    db.session.delete(entity)
    db.session.commit()
    return '', 204
