import os

from flask import request, g, current_app, abort, send_file
from celery import states

from .. import db

from ..auth import token_auth
from ..models import Training
from ..utils import zip_file

from . import api


@api.get('/models/<modelId>/trainings')
@token_auth.login_required
def get_trainings(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    return {'trainings': model.training_list}, 200


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
        path = os.path.join(current_app.config['MODELS_DIRECTORY'], training.path)
        return send_file(zip_file(path),
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
    if model.training and model.training.status in states.UNREADY_STATES:
        abort(400, 'Training is already in progress')
    training = Training.create(model)
    db.session.add(training)
    training.start()
    db.session.commit()
    return model.to_dict(), 201


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
    return {'trainings': model.training_list}, 200