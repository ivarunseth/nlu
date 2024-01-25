import os
import io
import binascii
import uuid

import pandas as pd

from datetime import timezone

from flask import abort, g, url_for, current_app

from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from . import db
from .tasks import training
from .utils import timestamp, format_timestamp, allowed_file


class User(db.Model):
    """The User model."""
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)
    email = db.Column(db.String(32), nullable=False, unique=True)
    password_hash = db.Column(db.String(256), nullable=False)
    token = db.Column(db.String(64), nullable=True, unique=True)

    models = db.relationship('Model', backref='user', lazy='dynamic')

    @property
    def password(self):
        raise AttributeError('password is not a readable attribute')

    @password.setter
    def password(self, password):
        self.password_hash = generate_password_hash(password)
        self.token = None

    def verify_password(self, password):
        return check_password_hash(self.password_hash, password)

    def generate_token(self):
        """Creates a 64 character long randomly generated token."""
        self.token = binascii.hexlify(os.urandom(32)).decode('utf-8')
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
    description = db.Column(db.Text)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)
    
    labels = db.relationship('Label', cascade="all,delete", backref='model', lazy='dynamic')
    trainings = db.relationship('Training', backref='model', lazy='dynamic')

    @property
    def label_list(self):
        return [label.to_dict() for label in self.labels.order_by(Label.id.desc()).all()]
    
    @property
    def training_list(self):
        return [training.to_dict() for training in self.trainings.order_by(Training.created_at.desc()).all()]
    
    @property
    def training(self):
        return self.trainings.order_by(Training.created_at.desc()).first()

    @staticmethod
    def create(data, user=None):
        """Create a new language."""
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
        for name in list(set(data.iloc[:, 1].values.tolist())):
            label = Label.create({'name': name}, self)
            db.session.add(label)
            utterances = data.iloc[data.iloc[:, 1].astype(str).values == str(label.name), 0].values.tolist()
            db.session.add_all([Utterance.create({'text': text}, label) for text in utterances])
    
    def write(self):
        data = {'text': [], 'label': []}
        for label in self.labels.order_by(Label.created_at.desc()).all():
            for utterance in label.utterances.order_by(Utterance.id.desc()).all():
                data['text'].append(utterance.text)
                data['label'].append(label.name)
        file = io.BytesIO()
        df = pd.DataFrame(data)
        df.to_csv(file, index=False)
        file.seek(0)
        return file

    def from_dict(self, data, partial_update=False):
        """Import model data from a dictionary."""
        for field in ['name', 'description']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self):
        """Export model to a dictionary."""
        model_dict = {
            'id': self.id,
            'user_id': self.user_id,
            'name': self.name,
            'description': self.description,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            '_links': {
                'self': url_for('api.get_model', modelId=self.id),
                'user': url_for('api.get_user', userId=self.user_id),
                'labels': url_for('api.get_labels', modelId=self.id),
                'trainings': url_for('api.get_trainings', modelId=self.id)
            }
        }
        training = self.training
        model_dict.update({'training': training.to_dict(extended=False) if training else None})
        return model_dict


class Label(db.Model):
    __tablename__ = 'labels'
    id = db.Column(db.Integer, primary_key=True)
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    name = db.Column(db.String, nullable=False)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    utterances = db.relationship('Utterance', cascade="all,delete", backref='label', lazy='dynamic')

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

    @property
    def task(self):
        return training.text_classification.AsyncResult(self.task_id)
    
    @property
    def status(self):
        return self.task.status

    @property
    def path(self):
        return f'{self.model_id}/{self.version}'

    @staticmethod
    def create(model):
        training = Training()
        if model.trainings.count() > 0:
            training.version = max([round(float(t.version), 1) for t in model.trainings.all()]) + 0.1
        else:
            training.version = 0.1
        training.model = model
        return training
    
    def start(self):
        X, y = [], []
        for label in self.model.labels.order_by(Label.created_at.desc()).all():
            for utterance in label.utterances.order_by(Utterance.id.desc()).all():
                X.append(utterance.text)
                y.append(label.name)
        filepath = os.path.join(current_app.config['MODELS_DIRECTORY'], self.path)
        task = training.text_classification.apply_async(args=(X, y, filepath,), countdown=3)
        self.task_id = task.id
        return task
    
    def from_dict(self, data, partial_update=True):
        """Import training data from a dictionary."""
        for field in ['task_id']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self, extended=True):
        training_dict = {
            'id': self.id,
            'model_id': self.model_id,
            'task_id': self.task_id,
            'version': self.version,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            '_links': {
                'self': url_for('api.get_training', modelId=self.model_id, trainingId=self.id),
                'model': url_for('api.get_model', modelId=self.model_id)
            }
        }
        if self.task_id:
            task = self.task
            training_dict.update({
                'status': task.status,
                'result': task.result if not task.failed() else task.backend.prepare_exception(task.result),
                'traceback': task.traceback,
                'children': task.children,
                'date_done': task.date_done.replace(tzinfo=timezone.utc).astimezone(tz=None).strftime('%d/%m/%Y - %H:%M:%S') if task.date_done else None})
            if extended:
                training_dict.update({
                    'name': task.name,
                    'args': task.args,
                    'kwargs': task.kwargs,
                    'worker': task.worker,
                    'retries': task.retries,
                    'queue': task.queue})
        return training_dict
