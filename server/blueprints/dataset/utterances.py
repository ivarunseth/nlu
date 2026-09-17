from flask import request, g, abort

from server.auth import token_auth
from server.database import Entity, Intent, Tag, Utterance

from server import db
from . import blueprint


@blueprint.get('/models/<modelId>/intents/<intentId>/utterances')
@token_auth.login_required
def get_utterances(modelId, intentId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    intent = model.intents.filter_by(id=intentId).first()
    if intent is None:
        abort(404, 'Intent not found: %s' % intentId)
    utterances = intent.utterances
    query = request.args.get('query', '', type=str)
    if query != '':
        utterances = intent.utterances.filter(Utterance.text.ilike(f'%{query}%'))
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    utterances = utterances.order_by(Utterance.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return {
        'utterances': [utterance.to_dict() for utterance in utterances.items],
        'total': utterances.total,
        'page': utterances.page,
        'per_page': utterances.per_page
    }, 200


@blueprint.get('/models/<modelId>/intents/<intentId>/utterances/<utteranceId>')
@token_auth.login_required
def get_utterance(modelId, intentId, utteranceId):
    utterance = Utterance.query.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    return utterance.to_dict(), 200


@blueprint.post('/models/<modelId>/intents/<intentId>/utterances')
@token_auth.login_required
def create_utterance(modelId, intentId):
    intent = Intent.query.filter_by(id=intentId).first()
    if intent is None:
        abort(404, 'Intent not found: %s' % intentId)
    utterance = Utterance.create(request.get_json(), intent)
    db.session.add(utterance)
    db.session.commit()
    return utterance.to_dict(), 200


@blueprint.put('/models/<modelId>/intents/<intentId>/utterances/<utteranceId>')
@token_auth.login_required
def edit_utterance(modelId, intentId, utteranceId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    utterance = Utterance.query.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    utterance.from_dict(request.get_json())
    if utterance.model_id:
        # A language understanding utterance can carry slot spans; a text
        # edit here must not leave stale offsets behind.
        utterance.prune_annotations()
    db.session.commit()
    return utterance.to_dict(), 200


@blueprint.delete('/models/<modelId>/intents/<intentId>/utterances/<utteranceId>')
@token_auth.login_required
def delete_utterances(modelId, intentId, utteranceId):
    utterance = Utterance.query.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    db.session.delete(utterance)
    db.session.commit()
    return '', 204


# Model-scoped utterances: named entity recognition sentences belong to the
# model directly (their spans reference the entity registry), not to a
# single intent.

def _get_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    return model


@blueprint.get('/models/<modelId>/utterances')
@token_auth.login_required
def get_model_utterances(modelId):
    model = _get_model(modelId)
    utterances = model.utterances
    # The intent workspace lists only its own utterances.
    intent_id = request.args.get('intent', type=int)
    if intent_id is not None:
        utterances = utterances.filter(Utterance.intent_id == intent_id)
    query = request.args.get('query', '', type=str)
    if query != '':
        utterances = utterances.filter(Utterance.text.ilike(f'%{query}%'))
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    utterances = utterances.order_by(Utterance.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return {
        'utterances': [utterance.to_dict() for utterance in utterances.items],
        'total': utterances.total,
        'page': utterances.page,
        'per_page': utterances.per_page
    }, 200


@blueprint.get('/models/<modelId>/utterances/<utteranceId>')
@token_auth.login_required
def get_model_utterance(modelId, utteranceId):
    model = _get_model(modelId)
    utterance = model.utterances.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    return utterance.to_dict(), 200


def _get_intent(model, intent_id):
    """Resolve an intent id to one of ``model``'s intents."""
    intent = model.intents.filter_by(id=intent_id).first()
    if intent is None:
        abort(404, 'Intent not found: %s' % intent_id)
    return intent


@blueprint.post('/models/<modelId>/utterances')
@token_auth.login_required
def create_model_utterance(modelId):
    model = _get_model(modelId)
    data = request.get_json()
    # Language understanding utterances are created under an intent; the
    # payload carries it as intent_id so the row lands in both registries.
    intent = None
    if isinstance(data, dict) and data.get('intent_id') is not None:
        intent = _get_intent(model, data['intent_id'])
    utterance = Utterance.create(data, intent=intent, model=model)
    db.session.add(utterance)
    db.session.commit()
    return utterance.to_dict(), 201


@blueprint.put('/models/<modelId>/utterances/<utteranceId>')
@token_auth.login_required
def edit_model_utterance(modelId, utteranceId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    model = _get_model(modelId)
    utterance = model.utterances.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    data = request.get_json()
    if 'intent_id' in data:
        # Re-assigning the intent changes intent_id only. Spans whose slot
        # is not defined on the new intent are surfaced with a 409 unless
        # resolve='drop' explicitly discards them (IN-5).
        utterance.reassign(_get_intent(model, data['intent_id']), resolve=data.get('resolve'))
    if 'text' in data:
        utterance.from_dict(data)
    if 'annotations' in data:
        # Seamless inline edit: the client sends the full span set (as parsed
        # from {entity: value} markup) to replace all annotations against the
        # new text. Offsets are validated against the edited text below.
        _replace_annotations(model, utterance, data['annotations'])
    elif 'text' in data:
        # A text-only edit can move or remove annotated spans; keep only those
        # whose offsets still cover the surface string they were created on.
        utterance.prune_annotations()
    db.session.commit()
    return utterance.to_dict(), 200


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
            catalogue.setdefault(slot.entity, {})[tag.value] = None
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
            catalogue.setdefault(entity, {})[tag.value] = None
    for entity, values in catalogue.items():
        entity.catalogue_surfaces(values)


@blueprint.delete('/models/<modelId>/utterances/<utteranceId>')
@token_auth.login_required
def delete_model_utterance(modelId, utteranceId):
    model = _get_model(modelId)
    utterance = model.utterances.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    db.session.delete(utterance)
    db.session.commit()
    return '', 204
