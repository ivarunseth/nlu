# Owned by the `training` blueprint. `publishing` and `analytics` read only.
import io
import json

from flask import abort, current_app
from celery import states

from .. import db, store
from ..tasks import training, WorkerResult
from ..tasks.train import train
from ..utils.common import timestamp, format_timestamp


class Training(db.Model):
    __tablename__ = 'trainings'
    id = db.Column(db.Integer, primary_key=True)
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    task_id = db.Column(db.String, unique=True)
    version = db.Column(db.Numeric(precision=3, scale=1), nullable=False)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    model = db.relationship('Model', back_populates='trainings')
    instances = db.relationship('Instance', cascade="all,delete", back_populates='training', lazy='dynamic')

    def _get_task(self):
        return WorkerResult(self.task_id, app=training) if self.task_id else None

    def start(self, **kwargs):
        task = self._get_task()
        if task:
            if not self.ready(task):
                abort(400, 'Training has already started')
            self.forget(task)
        # Whether to expand the dataset through the entity value catalogues; a
        # per-run override of the AUGMENT_ENABLED config. Popped so it never
        # reaches the training task's kwargs. Augmentation itself now runs
        # inside the model's preprocessing (server/models/augmentation.py),
        # driven by the files written below — the training blueprint only ships the
        # authored dataset and the ingredients.
        augment = kwargs.pop('augment', None)

        if self.model.kind == 'named_entity_recognition':
            self.model.write(fmt='training', object_name=self._data_object('utterances.csv'))
            self._put_data('entities.json', self._catalogue_spec(augment))
        elif self.model.kind == 'natural_language_understanding':
            self.model.write(fmt='training', object_name=self._data_object('utterances.csv'))
            self._put_data('entities.json', self._catalogue_spec(augment))
            slot_map = {}
            for slot in self.model.slots.all():
                slot_map.setdefault(slot.intent.name, {})[slot.name] = slot.entity.name
            self._put_data('slots.json', json.dumps(slot_map))
        else:
            self.model.write(fmt='training', object_name=self._data_object('utterances.csv'))

        args = (self.path, self.model.kind,)
        task = train.apply_async(
            args=args,
            kwargs=kwargs,
            queue='training',
            countdown=3
        )
        self.task_id = task.id
        return task

    def _data_object(self, name):
        return f'models/{self.path}/data/{name}'

    def _put_data(self, name, data):
        """Upload one file into this version's ``data/`` folder in blob storage."""
        buffer = io.BytesIO(data.encode('utf-8')) if isinstance(data, str) else data
        store.put(
            bucket=current_app.config['STORAGE_BUCKET'],
            object_name=self._data_object(name),
            data=buffer,
        )

    def _catalogue_spec(self, augment):
        """
        The augmentation spec written to ``data/entities.json``: the per-entity
        value/synonym catalogue plus the settings the model needs to expand the
        dataset without the DB or an app context — resolved here from the
        AUGMENT_* config and the request's per-run ``augment`` override. The
        expansion itself is coverage-first and cyclic (deterministic with no
        seed or caps): every term and every annotated occurrence at least once.
        """
        catalogue = {}
        for entity in self.model.entities.all():
            terms = []
            for value in entity.values.all():
                terms.extend(value.terms())
            catalogue[entity.name] = {'kind': entity.kind or 'open', 'terms': terms}
        enabled = current_app.config.get('AUGMENT_ENABLED', True) if augment is None else bool(augment)
        return json.dumps({
            'enabled': enabled,
            'unk_token': current_app.config.get('AUGMENT_UNK_TOKEN', '[UNK]'),
            'catalogue': catalogue,
        })

    def ready(self, task=None):
        task = task or self._get_task()
        return (task.ready() or task.state in ['ABORTED', 'REVOKED']) if task else True

    def failed(self, task=None):
        task = task or self._get_task()
        return task.failed() if task else False

    def stop(self, task=None):
        task = task or self._get_task()
        if task and isinstance(task, WorkerResult) and not task.ready():
            if task.state == states.PENDING:
                task.revoke()
            elif task.state == states.RECEIVED:
                task.revoke(terminate=True)
            elif task.state == states.STARTED:
                task.abort()
                try:
                    task.wait(timeout=3)
                except:
                    pass

    def forget(self, task=None):
        task = task or self._get_task()
        if task and isinstance(task, WorkerResult):
            task.forget()
            self.task_id = None

    @property
    def path(self):
        return f'{self.model_id}/{self.version}'

    @staticmethod
    def create(model):
        training = Training()
        if model.trainings.count() > 0:
            training.version = round(max([float(t.version) for t in model.trainings.all()]) + 0.1, 1)
        else:
            training.version = 0.1
        training.model = model
        return training

    def from_dict(self, data, partial_update=True):
        """Import training data from a dictionary."""
        for field in ['task_id']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self, extended=False):
        training_dict = {
            'id': self.id,
            'model_id': self.model_id,
            'task_id': self.task_id,
            'version': float(self.version),
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at)
        }
        task = self._get_task()
        if task:
            training_dict.update(task.to_dict(extended=extended))
        return training_dict
