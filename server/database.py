import os
import io
import uuid

from dataclasses import replace

import pandas as pd

from datetime import datetime, timedelta, timezone

from flask import abort, g, url_for, current_app
from celery import states

from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from jwt import encode

from sqlalchemy.orm import relationship
from sqlalchemy.ext.associationproxy import association_proxy

from . import db, store
from .registry import registry_for, Route
from .tasks import sage, triton, WorkerResult, training

from .utils import timestamp, format_timestamp, allowed_file, generate_secret


class User(db.Model):
    """The User model."""
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)
    email = db.Column(db.String(32), nullable=False, unique=True)
    password_hash = db.Column(db.String(256), nullable=False)
    token = db.Column(db.String(256), nullable=True, unique=True)

    models = db.relationship('Model', back_populates='user', lazy='dynamic')

    @property
    def password(self):
        raise AttributeError('password is not a readable attribute')

    @password.setter
    def password(self, password):
        self.password_hash = generate_password_hash(password)
        self.token = None

    def verify_password(self, password):
        return check_password_hash(self.password_hash, password)

    def generate_token(self, expiry=None):
        self.token = encode({
            'id': self.id, 
            'exp': datetime.utcnow() + timedelta(minutes=expiry or current_app.config['TOKEN_EXPIRY'])
        }, current_app.config['SECRET_KEY'])
        return self.token
    
    @property
    def model_list(self):
        return [model.to_dict() for model in self.models.order_by(Model.created_at.desc()).all()]

    @staticmethod
    def create(data):
        """Create a new user."""
        user = User()
        user.from_dict(data, partial_update=False)
        return user

    def from_dict(self, data, partial_update=True):
        """Import user data from a dictionary."""
        for field in ['email', 'password']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self):
        """Export user to a dictionary."""
        return {
            'id': self.id,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            'email': self.email,
            'token': self.token,
            '_links': {
                'self': url_for('api.get_user', userId=self.id),
                'tokens': url_for('api.create_token'),
                'models': url_for('api.get_models')
            }
        }


class Model(db.Model):
    """The User model."""
    __tablename__ = 'models'
    id = db.Column(db.String, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    name = db.Column(db.String, nullable=False)
    type = db.Column(db.String, default='text_classification')
    description = db.Column(db.Text)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)
    
    user = db.relationship('User', back_populates='models')
    labels = db.relationship('Label', cascade="all,delete", back_populates='model', lazy='dynamic')
    trainings = db.relationship('Training', cascade="all,delete", back_populates='model', lazy='dynamic')
    instances = db.relationship('Instance', cascade="all,delete", back_populates='model', lazy='dynamic')
    environments = association_proxy('instances', 'environment')

    @property
    def label_list(self):
        return [label.to_dict() for label in self.labels.order_by(Label.name.asc(), Label.id.desc()).all()]
    
    @property
    def training_list(self):
        return [training.to_dict() for training in self.trainings.order_by(Training.created_at.desc()).all()]

    @staticmethod
    def create(data, user=None):
        """Create a new language."""
        if 'type' in data and data['type'] not in current_app.config['ALLOWED_MODELS']:
            abort(400, f"Invalid model type: {data['type']}. Allowed: {list(current_app.config['ALLOWED_MODELS'])}")
        model = Model(id=uuid.uuid4().hex)
        model.from_dict(data)
        if g.current_user.models.filter_by(name=model.name).first():
            abort(400, f'{model.name} model already exists, please choose a different name.')
        model.user = user or g.current_user
        return model
    
    def read(self, file, header=0):
        if not allowed_file(secure_filename(file.filename)):
            abort(400, 'Please upload either CSV or TSV file.')
        if file.filename.endswith('.csv'):
            data = pd.read_csv(
                file, 
                header=header, 
                on_bad_lines='skip', 
                skip_blank_lines=True,
                usecols=[0, 1]
            ).dropna()
        elif file.filename.endswith('.tsv'):
            data = pd.read_csv(
                file, 
                sep='\t', 
                header=header,
                on_bad_lines='skip', 
                skip_blank_lines=True,
                usecols=[0, 1]
            ).dropna()
        labels = list(set(data.iloc[:, 1].values.tolist()))
        for name in labels:
            label = Label.create({'name': name}, self)
            db.session.add(label)
            utterances = data.iloc[data.iloc[:, 1].astype(str).values == str(label.name), 0].values.tolist()
            db.session.add_all([Utterance.create({'text': text}, label) for text in utterances])
    
    def write(self):
        data = {'text': [], 'label': []}
        labels = self.labels.order_by(Label.name.asc(), Label.id.desc()).all()
        for label in labels:
            for utterance in label.utterances.order_by(Utterance.id.desc()).all():
                data['text'].append(utterance.text)
                data['label'].append(label.name)
        file = io.BytesIO()
        df = pd.DataFrame(data)
        df.to_csv(file, index=False)
        file.seek(0)
        return file

    def publish(self, training_id, config, params=None, **kwargs):
        training = self.trainings.filter_by(id=training_id).first()
        if not training:
            abort(400, 'Training not found: %s' % training_id)
        
        training_task = training._get_task()
        if not training_task or not training_task.successful():
            abort(400, 'Training not started yet: %s' % training_id)
            
        for environment in Environment.query.all():
            if environment.name not in config:
                continue
            
            instance = self.instances.filter(Instance.environment == environment).first()
            
            if config[environment.name]:
                # Keep the key and task id stable across redeploys, and the
                # deployment config stable across reloads of the environment.
                api_key, carried, task_id = None, None, None
                if instance:
                    # Capture the id before forget() clears it, so the
                    # recreated instance keeps serving under the same one.
                    task_id = instance.task_id
                    instance_task = instance._get_task()
                    if instance_task:
                        if not instance.ready(instance_task):
                            if instance.training == training and \
                                instance.date_receive > training_task.date_done.replace(tzinfo=timezone.utc).timestamp():
                                continue
                            instance.stop(instance_task)
                        instance.forget(instance_task)
                    api_key = instance.api_key
                    carried = instance.config
                    db.session.delete(instance)
                    db.session.flush()

                # Development always runs the defaults; elsewhere an explicit
                # config from the request wins over the carried one.
                if environment.name == 'development':
                    carried = None
                elif params is not None:
                    carried = params

                instance = Instance.create(environment, self, training, api_key=api_key, config=carried, task_id=task_id)
                db.session.add(instance)
                instance.start(**kwargs)
            
            elif not config[environment.name]:
                if instance:
                    instance_task = instance._get_task()
                    if instance_task:
                        if not instance.ready(instance_task):
                            instance.stop(instance_task)
                        instance.forget(instance_task)
                    db.session.delete(instance)

    def from_dict(self, data, partial_update=False):
        """Import model data from a dictionary."""
        for field in ['name', 'description', 'type']:
            try:
                if field == 'type' and data[field] not in current_app.config['ALLOWED_MODELS']:
                    abort(400, f"Invalid model type: {data[field]}. Allowed: {list(current_app.config['ALLOWED_MODELS'])}")
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self):
        """Export model to a dictionary."""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'name': self.name,
            'description': self.description,
            'type': self.type,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            '_links': {
                'self': url_for('api.get_model', modelId=self.id),
                'user': url_for('api.get_user', userId=self.user_id),
                'labels': url_for('api.get_labels', modelId=self.id),
                'trainings': url_for('api.get_trainings', modelId=self.id)
            }
        }


class Label(db.Model):
    __tablename__ = 'labels'
    id = db.Column(db.Integer, primary_key=True)
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    name = db.Column(db.String, nullable=False)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    model = db.relationship('Model', back_populates='labels')
    utterances = db.relationship('Utterance', cascade="all,delete", back_populates='label', lazy='dynamic')

    @property
    def utterance_list(self):
        return [utterance.to_dict() for utterance in self.utterances.order_by(Utterance.id.desc()).all()]

    @staticmethod
    def create(data, model):
        label = Label()
        label.from_dict(data)
        if model.labels.filter_by(name=label.name).first():
            abort(400, f'{label.name} label already exists, please choose a different name')
        label.model = model
        return label
    
    def read(self, file, header=0):
        if not allowed_file(secure_filename(file.filename)):
            abort(400, 'Please upload either CSV or TSV file.')
        if file.filename.endswith('.csv'):
            data = pd.read_csv(file, 
                               header=header, 
                               skip_blank_lines=True,
                               usecols=[0, 1])
        elif file.filename.endswith('.tsv'):
            data = pd.read_csv(file, 
                               sep='\t', 
                               header=header,
                               skip_blank_lines=True,
                               usecols=[0, 1])
        utterances = data.iloc[data.iloc[:, 1].astype(str).values == str(self.name), 0].values.tolist()
        db.session.add_all([Utterance.create({'text': text}, self) for text in utterances])

    def write(self):
        data = {'text': [], 'label': []}
        for utterance in self.utterances.order_by(Utterance.id.desc()).all():
            data['text'].append(utterance.text)
            data['label'].append(self.name)
        file = io.BytesIO()
        df = pd.DataFrame(data)
        df.to_csv(file, index=False)
        file.seek(0)
        return file

    
    def from_dict(self, data, partial_update=False):
        """Import label data from a dictionary."""
        for field in ['name']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self):
        return {
            'id': self.id,
            'model_id': self.model_id,
            'name': self.name,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            'utterances_count': self.utterances.count(),
            '_link': {
                'self': url_for('api.get_label', modelId=self.model_id, labelId=self.id),
                'model': url_for('api.get_model', modelId=self.model_id),
                'utterances': url_for('api.get_utterances', modelId=self.model_id, labelId=self.id)
            }
        }


class Utterance(db.Model):
    __tablename__ = 'utterances'
    id = db.Column(db.Integer, primary_key=True)
    label_id = db.Column(db.Integer, db.ForeignKey('labels.id'))
    text = db.Column(db.Text, nullable=False, index=True)

    label = db.relationship('Label', back_populates='utterances')

    @staticmethod
    def create(data, label):
        utterance = Utterance()
        utterance.from_dict(data)
        utterance.label = label
        return utterance
    
    def from_dict(self, data, partial_update=False):
        """Import utterance data from a dictionary."""
        for field in ['text']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self):
        return {
            'id': self.id,
            'label_id': self.label_id,
            'text': self.text,
            '_link': {
                'self': url_for('api.get_utterance', modelId=self.label.model_id, labelId=self.label_id, utteranceId=self.id),
                'label': url_for('api.get_label', modelId=self.label.model_id, labelId=self.label_id)
            }
        }


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
        return WorkerResult(self.task_id, app=sage) if self.task_id else None

    def start(self, **kwargs):
        task = self._get_task()
        if task:
            if not self.ready(task):
                abort(400, 'Training has already started')
            self.forget(task)
        utterances, labels = [], []
        for label in self.model.labels.order_by(Label.created_at.desc()).all():
            for utterance in label.utterances.order_by(Utterance.id.desc()).all():
                utterances.append(utterance.text)
                labels.append(label.name)
        data = pd.DataFrame({'utterances': utterances, 'labels': labels})
        buffer = io.BytesIO()
        data.to_csv(buffer, index=False)
        buffer.seek(0)
        store.put(
            bucket=current_app.config['STORAGE_BUCKET'], 
            object_name=f'models/{self.path}/data.csv', 
            data=buffer
        )
        args = (self.path, self.model.type,)
        task = training.train.apply_async(
            args=args, 
            kwargs=kwargs, 
            queue='training',
            countdown=3
        )
        self.task_id = task.id
        return task

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
            'updated_at': format_timestamp(self.updated_at),
            '_links': {
                'self': url_for('api.get_training', modelId=self.model_id, trainingId=self.id),
                'model': url_for('api.get_model', modelId=self.model_id)
            }
        }
        task = self._get_task()
        if task:
            training_dict.update(task.to_dict(extended=extended))
        return training_dict


class Instance(db.Model):
    """
    Association Object between Environment and Domain Model
    """
    __tablename__ = 'instances'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    environment_id = db.Column(db.Integer, db.ForeignKey('environments.id'))
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    training_id = db.Column(db.Integer, db.ForeignKey('trainings.id'))
    
    task_id = db.Column(db.String(155), unique=True, nullable=True)
    # Deployment configuration, always complete: instances are created with
    # environment-aware defaults filled in under whatever the user chose.
    config = db.Column(db.JSON, nullable=False)

    _api_key = db.Column('api_key', db.String(64), unique=True, nullable=True)

    date_receive = db.Column(db.Integer, default=timestamp, nullable=True)
    date_updated = db.Column(db.Integer, default=timestamp, onupdate=timestamp, nullable=True)

    environment = relationship('Environment', back_populates='instances')
    model = relationship('Model', back_populates='instances')
    training = relationship('Training', back_populates='instances')

    def __init__(self, **kwargs) -> None:
        super(Instance, self).__init__(**kwargs)

    def __repr__(self) -> str:
        return f"<Instance {self.model.name} {self.training.version} ({self.environment.name})>"

    @property
    def api_key(self):
        return self._api_key

    @api_key.setter
    def api_key(self, api_key):
        self._api_key = api_key
        # Keep the live route in sync. On a fresh instance the foreign keys
        # are still unset and start() publishes the route with the key.
        if self.environment_id is not None and self.model_id:
            self._sync(api_key=api_key)

    def _sync(self, **changes):
        """Rewrite the published route with ``changes``, if one exists."""
        registry = registry_for(self.environment.name)
        route = registry.route(self.model_id)
        if route:
            registry.publish(self.model_id, replace(route, **changes))

    # Options the serving task reads at startup; changing one requires a
    # restart, unlike the request options the infer view reads per request.
    TASK_CONFIG_FIELDS = (
        'lazy', 'batch_size', 'sleep', 'idle_timeout',
        'heartbeat_interval', 'heartbeat_ttl', 'output_ttl',
    )

    @staticmethod
    def default_options(environment=None):
        """The default deployment configuration for an environment.

        Development deployments load lazily: models come and go there at
        unpredictable times and only a few reach the higher environments,
        so a model should occupy a worker only while actually being tested.
        """
        heartbeat_interval = current_app.config['INFERENCE_HEARTBEAT_INTERVAL']
        return {
            'lazy': environment == 'development',
            'cache': True,
            'top': 1,
            'timeout': current_app.config['INFERENCE_REQUEST_TIMEOUT'],
            'interval': current_app.config['INFERENCE_POLL_INTERVAL'],
            'batch_size': current_app.config['INFERENCE_BATCH_SIZE'],
            'sleep': current_app.config['INFERENCE_SLEEP'],
            'idle_timeout': current_app.config['INFERENCE_IDLE_TIMEOUT'],
            'heartbeat_interval': heartbeat_interval,
            'heartbeat_ttl': max(int(heartbeat_interval * 3), 1),
            'output_ttl': current_app.config['INFERENCE_OUTPUT_TTL'],
        }

    @property
    def _config(self):
        return {**Instance.default_options(self.environment.name), **(self.config or {})}

    def options(self):
        """The serving options carried into this deployment's route."""
        return {field: self._config[field] for field in (
            'lazy', 'cache', 'top', 'timeout', 'interval', 'batch_size', 'sleep',
            'idle_timeout', 'heartbeat_interval', 'heartbeat_ttl', 'output_ttl',
        )}

    @staticmethod
    def clean(data, environment=None):
        """Validate a config payload and normalize it over the defaults."""
        if not isinstance(data, dict):
            abort(400, 'config must be an object')
        defaults = Instance.default_options(environment)
        unknown = set(data) - set(defaults)
        if unknown:
            abort(400, 'Unknown config fields: %s' % ', '.join(sorted(unknown)))
        config = {**defaults, **data}
        for field in ('lazy', 'cache'):
            if not isinstance(config[field], bool):
                abort(400, 'config.%s must be a boolean' % field)
        for field in ('top', 'batch_size', 'heartbeat_ttl', 'output_ttl'):
            value = config[field]
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                abort(400, 'config.%s must be an integer greater than or equal to 1' % field)
        for field in ('timeout', 'interval', 'sleep', 'idle_timeout', 'heartbeat_interval'):
            value = config[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
                abort(400, 'config.%s must be a positive number of seconds' % field)
            config[field] = float(value)
        if config['interval'] > config['timeout']:
            abort(400, 'config.interval cannot exceed config.timeout')
        if config['heartbeat_interval'] >= config['heartbeat_ttl']:
            abort(400, 'config.heartbeat_ttl must exceed config.heartbeat_interval')
        return config

    def configure(self, data):
        """Apply a new deployment config and push it into the live route."""
        config = Instance.clean(data, self.environment.name)
        previous = self.options()
        self.config = config
        cache_disabled = previous["cache"] and not config["cache"]
        restart = any(config[field] != previous[field] for field in Instance.TASK_CONFIG_FIELDS)

        if restart:
            # restart() revokes the old route, which already purges any
            # cached outputs, so no explicit purge is needed here.
            self.restart()
        else:
            # The request options take effect immediately on a live route.
            self._sync(**self.options())
            if cache_disabled:
                # Cached responses must not outlive the setting that allowed them.
                registry_for(self.environment.name).purge(self.model_id)

    def restart(self, **kwargs):
        """Restart this deployment in place with its current config."""
        task = self._get_task()
        if task:
            if not self.ready(task):
                self.stop(task)
            # Preserve the task id across the restart.
            self.forget(task, reset=False)
        self.date_receive = timestamp()
        self.start(**kwargs)

    @staticmethod
    def create(environment, model, training, api_key=None, config=None, task_id=None):
        return Instance(
            environment=environment,
            model=model,
            training=training,
            # Assigned once and reused for the life of the deployment, so the
            # task id stays stable across restarts, reloads and lazy revives.
            task_id=task_id or uuid.uuid4().hex,
            api_key=api_key or generate_secret(current_app.config['INFERENCE_API_KEY_NBYTES']),
            # Instances always carry a complete config, so partial or absent
            # input is normalized over the environment's defaults here.
            config=Instance.clean(config or {}, environment.name),
        )

    def _get_task(self):
        return None if not self.task_id else WorkerResult(id=self.task_id, app=triton)

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

    def forget(self, task=None, reset=True):
        task = task or self._get_task()
        if task and isinstance(task, WorkerResult):
            task.forget()
            # A restart clears the old result but keeps the id (reset=False) so
            # the revived task runs under the same, stable task id.
            if reset:
                self.task_id = None
        # Make the model unroutable in its environment. A resident serving task
        # notices the missing route on its next loop and shuts itself down.
        registry_for(self.environment.name).revoke(self.model_id)

    def start(self, **kwargs):
        """
        Publish this model into its environment's inference data plane.

        Publishing only writes the route (model -> artifact) into the
        environment's Redis; the serving task is started lazily by the first
        prediction request. Set ``lazy=False`` in the model's options to launch it eagerly
        """
        # Reuse the id assigned at creation so it stays stable across restarts;
        # only mint one defensively if an instance somehow lacks it.
        if not self.task_id:
            self.task_id = uuid.uuid4().hex

        registry = registry_for(self.environment.name)

        registry.publish(
            self.model.id,
            Route(
                path=self.training.path,
                model_type=self.model.type,
                version=str(self.training.version),
                name=self.model.name,
                task_id=self.task_id,
                api_key=self.api_key,
                **self.options(),
            ),
        )

        if not self.options()['lazy']:
            # Reserve the start slot so a query arriving while this task is still
            # loading waits for its output instead of spinning up a rival task.
            registry.claim(self.model.id, ttl=current_app.config['INFERENCE_START_TTL'])
            from .tasks.inference import model
            model.apply_async(
                task_id=self.task_id,
                args=(self.model.id, self.training.path, self.model.type),
                kwargs={**kwargs, 'environment': self.environment.name},
                queue=self.environment.name,
            )

    def from_dict(self, data, partial_update=False):
        for field in ['environment_id', 'domain_id', 'model_id']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400, '%s is missing in request data' % field)

    def to_dict(self):
        settings = current_app.config['ALLOWED_ENVIRONMENTS'][self.environment.name]
        instance = {
            'id': self.id,
            'environment': self.environment.name,
            'model_id': self.model_id,
            'training_id': self.training_id,
            'task_id': self.task_id,
            'api_key': self.api_key,
            'config': self.options(),
            'endpoint': '%s:%s/api/infer/%s' % (
                settings['triton']['host'],
                settings['triton']['port'],
                self.model_id,
            ),
            'date_receive': format_timestamp(self.date_receive),
            'date_updated': format_timestamp(self.date_updated)
        }
        task = self._get_task()
        if task:
            instance.update(task.to_dict())
        return instance


class Environment(db.Model):
    """
    NLU Server Envrionments database model.
    """
    __tablename__ = 'environments'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String, unique=True, nullable=False)

    instances = db.relationship('Instance', back_populates='environment', lazy='dynamic')
    models = association_proxy('instances', 'model')

    def __init__(self, **kwargs) -> None:
        super(Environment, self).__init__(**kwargs)

    def __repr__(self) -> str:
        return f"<Environment {self.name}>"

    @staticmethod
    def create(data):
        environment = Environment()
        environment.from_dict(data)
        return environment

    def from_dict(self, data, partial_update=False):
        try:
            for field in ['name']:
                setattr(self, field, data[field])
        except KeyError:
            if not partial_update:
                abort(400, '%s is missing in request body' % field)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name
        }

    @staticmethod
    def update():
        all = set(current_app.config['ALLOWED_ENVIRONMENTS'])
        available = set(environment.name for environment in Environment.query.all())
        
        for name in all - available:
            environ = Environment.create({'name': name})
            db.session.add(environ)

        for name in available - all:
            environment = Environment.query.filter_by(name=name).first()
            for instance in environment.instances.all():
                instance.stop()
                instance.forget()
                db.session.delete(instance)
            db.session.delete(environment)

        db.session.commit()
