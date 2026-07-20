from flask import request, g, abort

from sqlalchemy import func, select

from ...auth import token_auth
from ...database import Intent, Utterance
from ...utils import io as dataset_io
from ...utils.query import apply_sort, apply_date_range

from ... import db
from . import api


# The utterance tally `to_dict` reports, as a correlated subquery so the
# list can be ordered by it in SQL instead of per-row in Python.
UTTERANCES_COUNT = (
    select(func.count(Utterance.id))
    .where(Utterance.intent_id == Intent.id)
    .scalar_subquery()
)

INTENT_SORT_COLUMNS = {
    'name': Intent.name,
    'utterances_count': UTTERANCES_COUNT,
    'created_at': Intent.created_at,
    'updated_at': Intent.updated_at,
}


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
    intents = apply_date_range(intents, Intent.created_at, prefix='created')
    intents = apply_sort(intents, INTENT_SORT_COLUMNS,
                         default=('name', 'asc'),
                         secondary=Intent.id.desc())
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    intents = intents.paginate(
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
