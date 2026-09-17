"""
The slot registry of a language understanding model: intent-scoped roles,
each mapping to one entity. Slots are what an annotator tags and what the
model trains on, so the resource is only available on
``natural_language_understanding`` models.
"""
from flask import request, g, abort

from server.auth import token_auth
from server.database import Slot

from server import db
from . import blueprint


def _get_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    if model.kind != 'natural_language_understanding':
        abort(400, 'Slots are only defined on language understanding models')
    return model


@blueprint.get('/models/<modelId>/slots')
@token_auth.login_required
def get_slots(modelId):
    model = _get_model(modelId)
    slots = model.slots
    # The intent workspace lists only its own slots.
    intent_id = request.args.get('intent', type=int)
    if intent_id is not None:
        slots = slots.filter(Slot.intent_id == intent_id)
    # The entity view lists the slots that map to it, across every intent.
    entity_id = request.args.get('entity', type=int)
    if entity_id is not None:
        slots = slots.filter(Slot.entity_id == entity_id)
    slots = slots.order_by(Slot.name.asc()).all()
    return {'slots': [slot.to_dict() for slot in slots], 'total': len(slots)}, 200


@blueprint.post('/models/<modelId>/slots')
@token_auth.login_required
def create_slot(modelId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    model = _get_model(modelId)
    slot = Slot.create(request.get_json(), model)
    db.session.add(slot)
    db.session.commit()
    return slot.to_dict(), 201


@blueprint.put('/models/<modelId>/slots/<slotId>')
@token_auth.login_required
def edit_slot(modelId, slotId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    model = _get_model(modelId)
    slot = model.slots.filter_by(id=slotId).first()
    if slot is None:
        abort(404, 'Slot not found: %s' % slotId)
    slot.from_dict(request.get_json())
    db.session.commit()
    return slot.to_dict(), 200


@blueprint.delete('/models/<modelId>/slots/<slotId>')
@token_auth.login_required
def delete_slot(modelId, slotId):
    model = _get_model(modelId)
    slot = model.slots.filter_by(id=slotId).first()
    if slot is None:
        abort(404, 'Slot not found: %s' % slotId)
    # Cascades take the slot's annotations with it (MT-5); the client's
    # confirmation dialog reads the span count off the slot row first.
    db.session.delete(slot)
    db.session.commit()
    return '', 204
