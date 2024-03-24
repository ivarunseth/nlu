from flask import request, g, abort, send_file

from ... import db
from ...auth import token_auth
from ...models import Model

from . import api


@api.get('/models')
@token_auth.login_required
def get_models():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    query = request.args.get('query', None)
    if query:
        models = g.current_user.models.filter(Model.name.ilike(f'%{query}%'))
    else:
        models = g.current_user.models
    models = models.order_by(Model.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return {
        'models': [model.to_dict() for model in models.items],
        'total': models.total,
        'page': models.page,
        'per_page': models.per_page
    }, 200


@api.get('/models/<modelId>')
@token_auth.login_required
def get_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(400, f'Model not found: {modelId}')
    if request.args.get('format', 'json') == 'csv':
        return send_file(model.write(), 
                         mimetype='application/csv', 
                         as_attachment=True, 
                         download_name=f'{model.name}.csv')
    return model.to_dict(), 200


@api.post('/models')
@token_auth.login_required
def create_model():
    model = Model.create(request.form)
    db.session.add(model)
    if 'dataset' in request.files:
        model.read(request.files.get('dataset'), 
                   header=0 if request.form.get('header') == 'true' else None)
    db.session.commit()
    return model.to_dict(), 201


@api.put('/models/<modelId>')
@token_auth.login_required
def edit_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, f'Model not found: {modelId}')
    model.from_dict(request.form, partial_update=True)
    if 'dataset' in request.files:
        for label in model.labels.all():
            db.session.delete(label)
        model.read(request.files.get('dataset'), 
                   header=0 if request.form.get('header') == 'true' else None)
    db.session.commit()
    return model.to_dict(), 200


@api.delete('/models/<modelId>')
@token_auth.login_required
def delete_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, f'Model not found: {modelId}')
    for training in model.trainings.all():
        training.task.forget()
    model.trainings.delete()
    db.session.delete(model)
    db.session.commit()
    return '', 204
