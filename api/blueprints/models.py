from flask import request, g, abort

from .. import db
from ..auth import token_auth
from ..models import Model, LanguageModel

from . import api


@api.get('/models')
@token_auth.login_required
def get_models():
    return g.current_user.models_list, 200


@api.get('/models/<id>')
@token_auth.login_required
def get_model(id):
    model = g.current_user.models.filter_by(id=id).first()
    if model is None:
        abort(400, f'Model not found: {id}')
    return model.to_dict(), 200


@api.post('/models')
@token_auth.login_required
def create_model():
    model = Model.create(request.form)
    db.session.add(model)
    for language in request.form.getlist('languages'):
        model.associate_language(language)
    db.session.commit()
    return model.to_dict(), 201


@api.put('/models/<id>')
@token_auth.login_required
def edit_model(id):
    model = g.current_user.models.filter_by(id=id).first()
    if model is None:
        abort(404, f'Model not found: {id}')
    model.from_dict(request.form)
    current = set([language.name for language in model.languages])
    updated = set(request.form.get('languages').split(','))
    for language in updated - current:
        model.associate_language(language)
    for language in current - updated:
        model.dissociate_language(language)
    db.session.commit()
    return model.to_dict(), 200


@api.delete('/models/<id>')
@token_auth.login_required
def delete_model(id):
    model = g.current_user.models.filter_by(id=id).first()
    if model is None:
        abort(404, f'Model not found: {id}')
    db.session.delete(model)
    db.session.commit()
    return '', 204


@api.post('/models/<id>/<language>/train')
@token_auth.login_required
def train(id, language):
    model = g.current_user.models.filter_by(id=id).first()
    if model is None:
        abort(404, f'Model not found: {id}')
    lm = model.la