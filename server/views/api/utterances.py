from flask import request, g, abort

from ...auth import token_auth
from ...database import Label, Utterance

from ... import db
from . import api


@api.get('/models/<modelId>/labels/<labelId>/utterances')
@token_auth.login_required
def get_utterances(modelId, labelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    utterances = label.utterances
    query = request.args.get('query', '', type=str)
    if query is not '':
        utterances = label.utterances.filter(Utterance.text.ilike(f'%{query}%'))
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    utterances = utterances.order_by(Utterance.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return {
        'utterances': [utterance.to_dict() for utterance in utterances.items],
        'total': utterances.total,
        'page': utterances.page,
        'per_page': utterances.per_page
    }, 200


@api.get('/models/<modelId>/labels/<labelId>/utterances/<utteranceId>')
@token_auth.login_required
def get_utterance(modelId, labelId, utteranceId):
    utterance = Utterance.query.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    return utterance.to_dict(), 200


@api.post('/models/<modelId>/labels/<labelId>/utterances')
@token_auth.login_required
def create_utterance(modelId, labelId):
    label = Label.query.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    utterance = Utterance.create(request.get_json(), label)
    db.session.add(utterance)
    db.session.commit()
    return utterance.to_dict(), 200


@api.put('/models/<modelId>/labels/<labelId>/utterances/<utteranceId>')
@token_auth.login_required
def edit_utterance(modelId, labelId, utteranceId):
    if not request.is_json:
        abort(400, 'Request is not JSON type')
    utterance = Utterance.query.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    utterance.from_dict(request.get_json())
    db.session.commit()
    return utterance.to_dict(), 200


@api.delete('/models/<modelId>/labels/<labelId>/utterances/<utteranceId>')
@token_auth.login_required
def delete_utterances(modelId, labelId, utteranceId):
    utterance = Utterance.query.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    db.session.delete(utterance)
    db.session.commit()
    return '', 204
