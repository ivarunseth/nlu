import os

from flask import request, g, current_app, abort, send_file
from sqlalchemy import cast, String
from celery import states

from ... import db

from ...auth import token_auth
from ...models import Training
from ...utils import zip_file

from . import api


@api.get('/models/<modelId>/trainings')
@token_auth.login_required
def get_trainings(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    query = request.args.get('query', None)
    if query:
        trainings = model.trainings.filter(cast(Training.version, String).like(f'%{query}%'))
    else:
        trainings = model.trainings
    trainings = trainings.order_by(Training.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return {
        'trainings': [training.to_dict() for training in trainings.items],
        'total': trainings.total,
        'page': trainings.page,
        'per_page': trainings.per_page
    }, 200


@api.get('/models/<modelId>/trainings/<trainingId>')
@token_auth.login_required
def get_training(modelId, trainingId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training = model.trainings.filter_by(id=trainingId).first()
    if training is None:
        abort(404, 'Training not found: %s' % trainingId)
    if request.args.get('format', 'json') == 'zip':
        return send_file(zip_file(os.path.join(current_app.config['MODELS_DIRECTORY'], training.path)),
                         mimetype='application/zip',
                         as_attachment=True,
                         download_name=f'{model.name}_{training.version}.zip')
    return training.to_dict(), 200


@api.post('/models/<modelId>/trainings')
@token_auth.login_required
def create_training(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    if model.training and model.training.task.status in states.UNREADY_STATES:
        abort(400, 'Training is already in progress')
    training = Training.create(model)
    db.session.add(training)
    training.start(**request.get_json())
    db.session.commit()
    return training.to_dict(), 201


@api.delete('/models/<modelId>/trainings/<trainingId>')
@token_auth.login_required
def delete_training(modelId, trainingId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training = model.trainings.filter_by(id=trainingId).first()
    if training is None:
        abort(404, 'Training not found: %s' % trainingId)
    task = training.task
    if not task.ready():
        abort(400, 'Cannot delete an ongoing training')
    task.forget()
    db.session.delete(training)
    db.session.commit()
    return '', 204
