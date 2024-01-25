from flask import request, g, abort

from .. import db
from ..auth import token_auth
from ..models import Utterance

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
    return {'utterances': label.utterance_list}, 200


@api.get('/models/<modelId>/labels/<labelId>/utterances/<utteranceId>')
@token_auth.login_required
def get_utterance(modelId, labelId, utteranceId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    utterance = label.utterances.filter_by(id=utteranceId).first()
    if utterance is None:
        abort(404, 'Utterance not found: %s' % utteranceId)
    return utterance.to_dict(), 200


@api.post('/models/<modelId>/labels/<labelId>/utterances')
@token_auth.login_required
def create_utterance(modelId, labelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    utterance = Utterance.create(request.form, label)
    db.session.add(utterance)
    db.session.commit()
    return {'utterances': label.utterance_list}, 201


@api.put('/models/<modelId>/labels/<labelId>/utterances/<utteranceId>')
@token_auth.login_required
def edit_utterance(modelId, labelId, utteranceId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    utterance = label.utterances.filter_by(id=utteranceId).first()
    utterance.from_dict(request.form)
    db.session.commit()
    return {'utterances': label.utterance_list}, 200


@api.delete('/models/<modelId>/labels/<labelId>/utterances/<utteranceId>')
@token_auth.login_required
def delete_utterances(modelId, labelId, utteranceId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    utterance = label.utterances.filter_by(id=utteranceId).first()
    db.session.delete(utterance)
    db.session.commit()
    return {'utterances': label.utterance_list}, 200
