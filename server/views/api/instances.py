from flask import request, g, abort

from ...auth import token_auth
from ...database import Instance
from ...utils.common import generate_api_key

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
    data = request.get_json() or {}
    # A deployment config may ride along with the environment flags.
    # Validate it before publish so no deployment is torn down for a
    # request that would be rejected.
    config = data.pop('config', None)
    if config is not None:
        environment = next((name for name, enabled in data.items() if enabled), None)
        config = Instance.clean(config, environment)
    model.publish(training_id, data, params=config)
    db.session.commit()
    return {'instances': [instance.to_dict() for instance in model.instances.all()]}, 200


@api.put('/models/<modelId>/instances/<int:instanceId>')
@token_auth.login_required
def update_instance(modelId, instanceId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    instance = model.instances.filter_by(id=instanceId).first()
    if instance is None:
        abort(404, 'Instance not found: %s' % instanceId)
    data = request.get_json(silent=True) or {}
    if 'api_key' in data:
        # Keys are server-generated; submitting the field requests a rotation.
        instance.api_key = generate_api_key(instance.model_id, instance.environment.name)
    if 'config' in data:
        if instance.environment.name == 'development':
            # Development deployments always run the default configuration.
            abort(400, 'Deployments in development are not configurable')
        instance.configure(data['config'])
    db.session.commit()
    return {'instance': instance.to_dict()}, 200


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
