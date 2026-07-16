from flask import request, g, abort

from ...auth import token_auth
from ...database import Entity, Tag
from ...utils.dataset import FORMATS, NLU_FORMATS
from ...utils import io as dataset_io

from ... import db
from . import api


# File extension and MIME type used when exporting each dataset format.
EXPORT_META = {
    'inline': ('txt', 'text/plain'),
    'conll': ('conll', 'text/plain'),
    'json': ('jsonl', 'application/json'),
    'csv': ('csv', 'text/csv'),
}


# Tag mutations return the parent utterance so the client picks up the
# refreshed spans and IOB tags (derived server-side) in one round trip. The
# span rows keep their historical wire name: they travel as the
# ``annotations`` key on utterance payloads.

def _get_utterance(modelId, utteranceId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    utterance = model.utterances.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    return model, utterance


@api.post('/models/<modelId>/utterances/<utteranceId>/tags')
@token_auth.login_required
def create_tag(modelId, utteranceId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    model, utterance = _get_utterance(modelId, utteranceId)
    data = request.get_json()
    if model.kind == 'natural_language_understanding':
        # A language understanding span references a slot — one scoped to
        # this utterance's intent, so a span can never carry a role the
        # sentence's intent does not define (IN-4).
        slot = model.slots.filter_by(id=data.get('slot_id')).first()
        if slot is None:
            abort(404, 'Slot not found: %s' % data.get('slot_id'))
        if utterance.intent_id is None or slot.intent_id != utterance.intent_id:
            abort(400, f'Slot {slot.name} belongs to intent {slot.intent.name}, '
                       f'not this utterance\'s intent')
        tag = Tag.create(data, utterance, slot=slot)
    else:
        entity = model.entities.filter(Entity.id == data.get('entity_id')).first()
        if entity is None:
            abort(404, 'Entity not found: %s' % data.get('entity_id'))
        tag = Tag.create(data, utterance, entity)
    db.session.add(tag)
    db.session.commit()
    return utterance.to_dict(), 201


@api.delete('/models/<modelId>/utterances/<utteranceId>/tags/<tagId>')
@token_auth.login_required
def delete_tag(modelId, utteranceId, tagId):
    model, utterance = _get_utterance(modelId, utteranceId)
    tag = utterance.tags.filter_by(id=tagId).first()
    if tag is None:
        abort(404, 'Annotation not found: %s' % tagId)
    db.session.delete(tag)
    db.session.commit()
    return utterance.to_dict(), 200


@api.get('/models/<modelId>/tags/stats')
@token_auth.login_required
def get_tag_stats(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    # ?intent=<id> scopes the counts to one intent's workspace (its slots,
    # utterances and their span coverage) for the intent overview strip.
    intent_id = request.args.get('intent', type=int)
    return model.annotation_stats(intent_id=intent_id), 200


def _require_format(model=None):
    fmt = request.values.get('format', 'inline')
    # CoNLL cannot carry an intent, so language understanding datasets
    # interchange in the intent-aware formats only.
    allowed = NLU_FORMATS if model is not None and \
        model.kind == 'natural_language_understanding' else FORMATS
    if fmt not in allowed:
        abort(400, 'Unknown format: %s. Allowed: %s' % (fmt, ', '.join(allowed)))
    return fmt


@api.get('/models/<modelId>/tags/export')
@token_auth.login_required
def export_tags(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    fmt = _require_format(model)
    extension, mimetype = EXPORT_META[fmt]
    return dataset_io.send_export(
        model.write(fmt),
        mimetype=mimetype,
        as_attachment=True,
        download_name=f'{model.name}-{fmt}.{extension}'
    )


@api.post('/models/<modelId>/tags/import')
@token_auth.login_required
def import_tags(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    fmt = _require_format(model)
    upload = request.files.get('dataset')
    if upload is None:
        abort(400, 'A dataset file is required')
    try:
        content = upload.read().decode('utf-8')
    except UnicodeDecodeError:
        abort(400, 'The dataset file must be UTF-8 encoded')
    summary = model.read(content, fmt=fmt)
    db.session.commit()
    return summary, 200
