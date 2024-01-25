from flask import request, g, abort, send_file

from .. import db
from ..auth import token_auth
from ..models import Label

from . import api


@api.get('/models/<modelId>/labels')
@token_auth.login_required
def get_labels(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    return {'labels': model.label_list}, 200


@api.get('/models/<modelId>/labels/<labelId>')
@token_auth.login_required
def get_label(modelId, labelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    if request.args.get('format', 'json') == 'csv':
        return send_file(label.write(), 
                         mimetype='application/csv', 
                         as_attachment=True, 
                         download_name=f'{model.name}-{label.name}-utterances.csv')
    return label.to_dict(), 200


@api.post('/models/<modelId>/labels')
@token_auth.login_required
def create_label(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = Label.create(request.form, model)
    db.session.add(label)
    if 'dataset' in request.files:
        label.read(request.files.get('dataset'), 
                   header=0 if request.form.get('header') == 'true' else None)
    db.session.commit()
    return {'labels': model.label_list}, 201


@api.put('/models/<modelId>/labels/<labelId>')
@token_auth.login_required
def edit_label(modelId, labelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    label.from_dict(request.form, partial_update=True)
    if 'dataset' in request.files:
        label.utterances.delete()
        label.read(request.files.get('dataset'), 
                   header=0 if request.form.get('header') == 'true' else None)
    db.session.commit()
    return {'labels': model.label_list}, 200


@api.delete('/models/<modelId>/labels/<labelId>')
@token_auth.login_required
def delete_label(modelId, labelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    label = model.labels.filter_by(id=labelId).first()
    if label is None:
        abort(404, 'Label not found: %s' % labelId)
    db.session.delete(label)
    db.session.commit()
    return {'labels': model.label_list}, 200
