from flask import request, g, abort

from ...auth import token_auth
from ...database import Model
from ...utils.dataset import dataset_format, NLU_FORMATS
from ...utils import io as dataset_io

from ... import db
from . import api


def _read_dataset(model, upload):
    """
    Load an uploaded dataset into ``model``. Token-classification models take
    an annotated corpus (format guessed from the extension, CSV/inline/CoNLL/
    JSON); language understanding models take the intent-aware corpus
    (inline with an intent prefix, JSON with an intent field, or the
    three-column CSV); classification models take the existing two-column
    text,label CSV.

    Returns the import's ``{imported, created, errors}`` summary so the
    caller can report skipped rows instead of dropping them silently.
    """
    if model.kind in ('named_entity_recognition', 'natural_language_understanding'):
        try:
            content = upload.read().decode('utf-8')
        except UnicodeDecodeError:
            abort(400, 'The dataset file must be UTF-8 encoded')
        fmt = dataset_format(upload.filename)
        if model.kind == 'natural_language_understanding' and fmt not in NLU_FORMATS:
            abort(400, 'Language understanding datasets import as %s' % ', '.join(NLU_FORMATS))
        return model.read(content, fmt=fmt)
    return model.read(upload, header=0 if request.form.get('header') == 'true' else None)


@api.get('/models')
@token_auth.login_required
def get_models():
    models = g.current_user.models
    query = request.args.get('query', None)
    if query is not None:
        models = models.filter(Model.name.ilike(f'%{query}%'))
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    models = models.order_by(
        Model.created_at.desc()).paginate(
            page=page, 
            per_page=per_page, 
            error_out=False)
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
        return dataset_io.send_export(model.write(),
                         mimetype='application/csv',
                         as_attachment=True,
                         download_name=f'{model.name}.csv')
    return model.to_dict(), 200


@api.post('/models')
@token_auth.login_required
def create_model():
    model = Model.create(request.form)
    db.session.add(model)
    summary = None
    if 'dataset' in request.files:
        summary = _read_dataset(model, request.files.get('dataset'))
    db.session.commit()
    payload = model.to_dict()
    if summary is not None:
        # Rides along on the model payload so the create flow can report
        # skipped rows; clients that only read model fields ignore it.
        payload['import_summary'] = summary
    return payload, 201


@api.put('/models/<modelId>')
@token_auth.login_required
def edit_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, f'Model not found: {modelId}')
    model.from_dict(request.form, partial_update=True)
    summary = None
    if 'dataset' in request.files:
        if model.kind in ('named_entity_recognition', 'natural_language_understanding'):
            # Replace the utterances (their spans cascade); keep the
            # intent/entity registries, which the import reuses or extends.
            for utterance in model.utterances.all():
                db.session.delete(utterance)
        else:
            for intent in model.intents.all():
                db.session.delete(intent)
        db.session.flush()
        summary = _read_dataset(model, request.files.get('dataset'))
    db.session.commit()
    payload = model.to_dict()
    if summary is not None:
        payload['import_summary'] = summary
    return payload, 200


@api.delete('/models/<modelId>')
@token_auth.login_required
def delete_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, f'Model not found: {modelId}')
    # The celery result backend writes through its own connection to the same
    # SQLite file, so all stop/forget calls must complete before this session
    # takes the write lock (held until commit) — otherwise they deadlock.
    instances = model.instances.all()
    trainings = model.trainings.all()
    for instance in instances:
        # Serving tasks shut down off the Redis route that forget() revokes,
        # not off the result backend, so reaping the taskmeta row is safe.
        instance.stop()
        instance.forget()
    for training in trainings:
        task = training._get_task()
        # A running training's only abort signal is its ABORTED state in the
        # result backend, which the worker polls between epochs. forget()
        # deletes that row; doing so before the worker has read it makes the
        # abort vanish (the id then reads back as PENDING) and training runs to
        # completion. So signal the abort but leave the marker in place for any
        # task that hasn't actually stopped yet — the worker reaps itself.
        was_running = not training.ready(task)
        training.stop(task)
        if not was_running:
            training.forget(task)
    # Telemetry outlives instances by design (rows carry their own model/
    # environment/version), so it is only reaped here, with its model.
    model.predictions.delete()
    model.instances.delete()
    model.trainings.delete()
    db.session.delete(model)
    db.session.commit()
    return '', 204
