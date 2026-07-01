from flask import request, g, abort

from ...auth import token_auth

from ... import db
from . import api


@api.get('/models/<modelId>/instances')
@token_auth.login_required
def get_instances(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    instances = model.instances
    training_id = request.args.get('training_id', None)
    if training_id:
        training = model.trainings.filter_by(id=training_id).first()
        if training is None:
            abort(404, 'Training not found: %s' % training_id)
        instances = instances.filter_by(training=training)
    return {'instances': [instance.to_dict() for instance in instances.all()]}, 200


@api.post('/models/<modelId>/instances')
@token_auth.login_required
def create_instance(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    training_id = request.args.get('training_id')
    if not training_id:
        abort(400, 'training_id is required')
    config = request.get_json() or {}
    model.publish(training_id, config, prewarm=True)
    db.session.commit()
    return {'instances': [instance.to_dict() for instance in model.instances.all()]}, 200


@api.delete('/models/<modelId>/instances/<int:instanceId>')
@token_auth.login_required
def delete_instance(modelId, instanceId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    instance = model.instances.filter_by(id=instanceId).first()
    if instance is None:
        abort(404, 'Instance not found: %s' % instanceId)
    instance.stop()
    instance.forget()
    db.session.delete(instance)
    db.session.commit()
    return '', 204
