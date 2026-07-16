from flask import request, g, current_app, abort, send_file
from celery import states
from sqlalchemy import cast, String

from ...auth import token_auth
from ...database import Training
from ...tasks import training as training_tasks

from ... import db, store
from . import api


@api.get('/models/<modelId>/trainings')
@token_auth.login_required
def get_trainings(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    trainings = model.trainings
    query = request.args.get('query', '', type=str)
    if query:
        trainings = model.trainings.filter(cast(Training.version, String).like(f'%{query}%'))
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    trainings = trainings.order_by(
        Training.created_at.desc()).paginate(
            page=page, 
            per_page=per_page, 
            error_out=False)
    return {
        'trainings': [training.to_dict(extended=request.args.get('extended', '0') == '1') \
                      for training in trainings.items],
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
    # if request.args.get('format', 'json') == 'zip':
    #     return send_file(zip_file(os.path.join(current_app.config['MODELS_DIRECTORY'], training.path)),
    #                      mimetype='application/zip',
    #                      as_attachment=True,
    #                      download_name=f'{model.name}_{training.version}.zip')
    return training.to_dict(extended=request.args.get('extended', '0') == '1'), 200


@api.get('/models/<modelId>/trainings/<trainingId>/data')
@token_auth.login_required
def get_training_data(modelId, trainingId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training = model.trainings.filter_by(id=trainingId).first()
    if training is None:
        abort(404, 'Training not found: %s' % trainingId)
    data = store.get(current_app.config['STORAGE_BUCKET'], f'models/{training.path}/data/utterances.csv')
    if data is None:
        abort(404, 'Training data not found')
    return send_file(data, mimetype='text/csv')


@api.post('/models/<modelId>/trainings')
@token_auth.login_required
def create_training(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training = Training.create(model)
    db.session.add(training)
    db.session.commit()
    return training.to_dict(), 201


@api.post('/models/<modelId>/trainings/<trainingId>/start')
@token_auth.login_required
def start_training(modelId, trainingId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training = model.trainings.filter_by(id=trainingId).first()
    if training is None:
        abort(404, 'Training not found: %s' % trainingId)
    kwargs = request.get_json(silent=True) or {}
    task = training.start(**kwargs)
    db.session.commit()
    task.update_state(
        states.PENDING,
        name=training_tasks.train.name,
        args=(training.path, model.kind),
        kwargs=kwargs,
        retries=0,
        queue='training'
    )
    return training.to_dict(extended=True), 200


@api.post('/models/<modelId>/trainings/<trainingId>/stop')
@token_auth.login_required
def stop_training(modelId, trainingId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training = model.trainings.filter_by(id=trainingId).first()
    if training is None:
        abort(404, 'Training not found: %s' % trainingId)
    task = training._get_task()
    if training.ready(task):
        abort(400, 'Training has already finished')
    training.stop(task)
    db.session.commit()
    return training.to_dict(extended=True), 200



@api.delete('/models/<modelId>/trainings/<trainingId>')
@token_auth.login_required
def delete_training(modelId, trainingId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training = model.trainings.filter_by(id=trainingId).first()
    if training is None:
        abort(404, 'Training not found: %s' % trainingId)
    if not training.ready():
        abort(400, 'Cannot delete an ongoing training')
    training.forget()
    db.session.delete(training)
    db.session.commit()
    return '', 204
