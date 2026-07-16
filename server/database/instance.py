import uuid

from dataclasses import replace

from flask import abort, current_app

from celery import states

from sqlalchemy.orm import relationship

from .. import db
from ..utils.registry import registry_for, Route
from ..tasks import triton, WorkerResult
from ..utils.common import timestamp, format_timestamp, generate_secret


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
            self.forget(task)
        self.date_receive = timestamp()
        self.start(**kwargs)

    @staticmethod
    def create(environment, model, training, api_key=None, config=None):
        return Instance(
            environment=environment,
            model=model,
            training=training,
            # task_id is minted fresh by start() on every (re)start.
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

    def forget(self, task=None):
        task = task or self._get_task()
        if task and isinstance(task, WorkerResult):
            task.forget()
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
        # Mint a fresh task id on every (re)start so each serving task runs
        # under its own id. The route carries it so a lazy revive of this same
        # deployment reuses it until the next start/restart.
        self.task_id = uuid.uuid4().hex

        registry = registry_for(self.environment.name)

        registry.publish(
            self.model.id,
            Route(
                path=self.training.path,
                model_type=self.model.kind,
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
            from ..tasks.inference import model
            model.apply_async(
                task_id=self.task_id,
                args=(self.model.id, self.training.path, self.model.kind),
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
