import datetime

from flask import request, g, current_app, abort, send_file
from celery import states
from sqlalchemy import cast, String

from ...auth import token_auth
from ...database import Training
from ...tasks import training as training_tasks
from ...utils.query import (apply_sort, apply_date_range, sort_arguments,
                            list_argument, sort_position)

from ... import db, store, socketio
from . import api


# Sort fields backed by real columns — these page in SQL.
TRAINING_SQL_COLUMNS = {
    'version': Training.version,
    'created_at': Training.created_at,
    'updated_at': Training.updated_at,
}

# Sort fields derived from the Celery result (status, metrics, completion).
# Ordering by these means materializing every run's dict, so they take the
# Python path below.
TRAINING_DERIVED_SORTS = {'status', 'date_done', 'runtime', 'accuracy', 'train_accuracy'}

# Terminal statuses selectable in the status filter. PENDING/RECEIVED/STARTED
# are collapsed to "active" so the filter matches the UI's three lifecycle
# groups rather than raw Celery states.
TRAINING_ACTIVE_STATES = {'PENDING', 'RECEIVED', 'STARTED'}
TRAINING_STATUS_FILTERS = {'active', 'SUCCESS', 'FAILURE', 'ABORTED', 'REVOKED'}


def _derived_accuracy(result):
    if not isinstance(result, dict):
        return None
    if result.get('accuracy') is not None:
        return result['accuracy']
    evaluation = result.get('evaluation') or {}
    test = evaluation.get('test') or {}
    return test.get('accuracy')


def _derived_train_accuracy(result):
    if not isinstance(result, dict):
        return None
    evaluation = result.get('evaluation') or {}
    train = evaluation.get('train') or {}
    return train.get('accuracy')


def _matches_status(status, wanted):
    if not wanted:
        return True
    for want in wanted:
        if want == 'active' and status in TRAINING_ACTIVE_STATES:
            return True
        if want == status:
            return True
    return False


def _derived_sort_key(item, field, order):
    """A ``sort_position`` key for one training dict on a derived field."""
    if field == 'status':
        value = item.get('status')
    elif field == 'date_done':
        value = to_epoch_from_display(item.get('date_done'))
    elif field == 'runtime':
        value = _runtime_seconds(item)
    elif field == 'accuracy':
        value = _derived_accuracy(item.get('result'))
    else:  # train_accuracy
        value = _derived_train_accuracy(item.get('result'))
    return sort_position(value, order)


def _runtime_seconds(item):
    start = to_epoch_from_display(item.get('created_at'))
    end = to_epoch_from_display(item.get('date_done'))
    if start is None or end is None:
        return None
    seconds = end - start
    return seconds if seconds >= 0 else None


def to_epoch_from_display(value):
    """Parse the ``dd/mm/YYYY - HH:MM:SS`` strings ``to_dict`` emits back to epoch."""
    if not value:
        return None
    try:
        moment = datetime.datetime.strptime(value, '%d/%m/%Y - %H:%M:%S')
    except (ValueError, TypeError):
        return None
    return int(moment.timestamp())


def user_room(user):
    """The per-user Socket.IO room the app-wide training strip listens on."""
    return f'user:{user.id}'


def announce_training(training, event, **extra):
    """
    Tell the owner's open tabs that a run started or stopped, so the training
    strip can (un)subscribe to the model's room without polling. Progress
    travels on that model room (see WorkerTask.push_status) — but a stop does
    not: it is written into the result backend here, and the worker then
    drops the run with ``Ignore``, which pushes nothing. So ``stopped``
    carries the final status itself.
    """
    socketio.emit('training', {
        'event': event,
        'model_id': training.model_id,
        'model_name': training.model.name,
        'training_id': training.id,
        'task_id': training.task_id,
        'version': float(training.version),
        **extra
    }, room=user_room(g.current_user), namespace='/')


@api.get('/trainings/active')
@token_auth.login_required
def get_active_trainings():
    """
    Every run of the caller's that is still pending or in progress, across
    models, with the task's kwargs (for ``epochs``) and current result (the
    live history and progress) so the training strip can draw the bar on a
    fresh page load without waiting for the next status push.
    """
    active = []
    for training in Training.query \
            .filter(Training.model.has(user_id=g.current_user.id)) \
            .filter(Training.task_id.isnot(None)).all():
        task = training._get_task()
        if task is None or task.state not in TRAINING_ACTIVE_STATES:
            continue
        # A result row the backend no longer holds also reads as PENDING; a
        # genuinely queued run has its name stamped by start_training.
        if task.state == states.PENDING and not task.name:
            continue
        item = training.to_dict(extended=True)
        item['model_name'] = training.model.name
        active.append(item)
    return {'trainings': active}, 200


@api.get('/models/<modelId>/trainings')
@token_auth.login_required
def get_trainings(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    trainings = model.trainings
    query = request.args.get('query', '', type=str)
    if query:
        trainings = trainings.filter(cast(Training.version, String).like(f'%{query}%'))
    trainings = apply_date_range(trainings, Training.created_at, prefix='created')

    statuses = list_argument('status', allowed=TRAINING_STATUS_FILTERS)
    sort_field, order = sort_arguments(('created_at', 'desc'))
    extended = request.args.get('extended', '0') == '1'
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)

    # Fast path: a column sort with no status filter pages entirely in SQL,
    # so only the current page's runs touch the Celery backend.
    if sort_field in TRAINING_SQL_COLUMNS and not statuses:
        paged = apply_sort(trainings, TRAINING_SQL_COLUMNS,
                           default=('created_at', 'desc'),
                           secondary=Training.id.desc()).paginate(
            page=page, per_page=per_page, error_out=False)
        return {
            'trainings': [t.to_dict(extended=extended) for t in paged.items],
            'total': paged.total,
            'page': paged.page,
            'per_page': paged.per_page,
        }, 200

    if sort_field not in TRAINING_SQL_COLUMNS and sort_field not in TRAINING_DERIVED_SORTS:
        abort(400, 'Cannot sort by %s' % sort_field)

    # Slow path: status filtering and metric/status sorts need each run's
    # Celery-derived fields, so materialize the (date-narrowed) set, then
    # filter, sort, and page in Python. Column sorts still resolve here when
    # combined with a status filter, using the dict's own values.
    items = [t.to_dict(extended=extended) for t in trainings.all()]
    items = [item for item in items if _matches_status(item.get('status'), statuses)]

    # sort_position keeps missing values last and encodes direction, so a
    # single ascending sort serves both orders for every field.
    if sort_field == 'version':
        items.sort(key=lambda item: sort_position(item.get('version'), order))
    elif sort_field in ('created_at', 'updated_at'):
        items.sort(key=lambda item: sort_position(
            to_epoch_from_display(item.get(sort_field)), order))
    else:
        items.sort(key=lambda item: _derived_sort_key(item, sort_field, order))

    total = len(items)
    start = (page - 1) * per_page
    return {
        'trainings': items[start:start + per_page],
        'total': total,
        'page': page,
        'per_page': per_page,
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
    announce_training(training, 'started', epochs=kwargs.get('epochs'))
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
    announce_training(training, 'stopped', status=task.state)
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
