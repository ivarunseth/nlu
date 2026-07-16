from flask import request, g, abort

from ...auth import token_auth
from ...database import Intent
from ...utils import io as dataset_io

from ... import db
from . import api


@api.get('/models/<modelId>/intents')
@token_auth.login_required
def get_intents(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    intents = model.intents
    query = request.args.get('query', None)
    if query is not None:
        intents = intents.filter(Intent.name.ilike(f'%{query}%'))
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    intents = intents.order_by(
        Intent.name.asc(),
        Intent.id.desc()
    ).paginate(
        page=page,
        per_page=per_page,
        error_out=False
    )
    return {
        'intents': [intent.to_dict() for intent in intents.items],
        'total': intents.total,
        'page': intents.page,
        'per_page': intents.per_page
    }, 200


@api.get('/models/<modelId>/intents/<intentId>')
@token_auth.login_required
def get_intent(modelId, intentId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    intent = model.intents.filter_by(id=intentId).first()
    if intent is None:
        abort(404, 'Intent not found: %s' % intentId)
    if request.args.get('format', 'json') == 'csv':
        return dataset_io.send_export(intent.write(),
                         mimetype='application/csv',
                         as_attachment=True,
                         download_name=f'{model.name}-{intent.name}-utterances.csv')
    return intent.to_dict(), 200


@api.post('/models/<modelId>/intents')
@token_auth.login_required
def create_intent(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    intent = Intent.create(request.form, model)
    db.session.add(intent)
    if 'dataset' in request.files:
        intent.read(request.files.get('dataset'),
                    header=0 if request.form.get('header') == 'true' else None)
    db.session.commit()
    return intent.to_dict(), 201


@api.put('/models/<modelId>/intents/<intentId>')
@token_auth.login_required
def edit_intent(modelId, intentId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    intent = model.intents.filter_by(id=intentId).first()
    if intent is None:
        abort(404, 'Intent not found: %s' % intentId)
    intent.from_dict(request.form, partial_update=True)
    if 'dataset' in request.files:
        intent.utterances.delete()
        intent.read(request.files.get('dataset'),
                    header=0 if request.form.get('header') == 'true' else None)
    db.session.commit()
    return intent.to_dict(), 200


@api.delete('/models/<modelId>/intents/<intentId>')
@token_auth.login_required
def delete_intent(modelId, intentId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    intent = model.intents.filter_by(id=intentId).first()
    if intent is None:
        abort(404, 'Intent not found: %s' % intentId)
    db.session.delete(intent)
    db.session.commit()
    return '', 204
