import os
import binascii
import uuid

from flask import abort, current_app, g, url_for
from werkzeug.security import generate_password_hash, check_password_hash

from sqlalchemy.ext.associationproxy import association_proxy

from . import db
from .utils import timestamp, allowed_language


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
        self.token = None  # if user is changing passwords, also revoke token

    def verify_password(self, password):
        return check_password_hash(self.password_hash, password)

    def generate_token(self):
        """Creates a 64 character long randomly generated token."""
        self.token = binascii.hexlify(os.urandom(32)).decode('utf-8')
        return self.token
    
    @property
    def models_list(self):
        return {'models': [model.to_dict() for model in self.models.order_by(Model.created_at.desc()).all()]}

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
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'email': self.email,
            'token': self.token,
            '_links': {
                'self': url_for('api.get_user', id=self.id),
                'tokens': url_for('api.new_token')
            }
        }


class LanguageModel(db.Model):
    """The LanguageModel table"""
    __tablename__ = 'language_models'
    id = db.Column(db.Integer, primary_key=True)
    language_id = db.Column(db.Integer, db.ForeignKey('languages.id'))
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    language = db.relationship('Language', back_populates='model_association')
    model = db.relationship('Model', back_populates='language_association')

    @property
    def path(self):
        return f'{self.model.id}/{self.language.name}'


class Language(db.Model):
    """The Language model."""
    __tablename__ = 'languages'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, nullable=False, unique=True)
    model_association = db.relationship('LanguageModel', back_populates='language')
    models = association_proxy('model_association', 'model')
    
    @staticmethod
    def create(data):
        """Create a new language."""
        language = Language()
        language.from_dict(data)
        return language

    def from_dict(self, data, partial_update=False):
        """Import language data from a dictionary."""
        for field in ['name']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    def to_dict(self):
        """Export user to a dictionary."""
        return {
            'id': self.id,
            'name': self.name,
            '_links': {}
        }
    
    @staticmethod
    def update():
        current = set([language.name for language in Language.query.all()])
        updated = set(current_app.config['ALLOWED_LANGUAGES'])
        for name in updated - current:
            language = Language.create({'name': name})
            db.session.add(language)
        for name in current - updated:
            language = Language.query.filter_by(name=name).first()
            db.session.delete(language)
        db.session.commit()


class Model(db.Model):
    """The User model."""
    __tablename__ = 'models'
    id = db.Column(db.String, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    name = db.Column(db.String, nullable=False)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)
    language_association = db.relationship('LanguageModel', back_populates='model', cascade='all, delete-orphan')
    languages = association_proxy('language_association', 'language')
    
    @staticmethod
    def create(data, user=None):
        """Create a new language."""
        model = Model(id=uuid.uuid4().hex)
        model.from_dict(data)
        if g.current_user.models.filter_by(name=model.name).first():
            abort(400, f'{model.name} model already exists, please choose a different name.')
        model.user = user or g.current_user
        return model

    def associate_language(self, language_name):
        if not allowed_language(language_name):
            abort(400, f'{language_name} language is not supported yet')
        language = Language.query.filter_by(name=language_name).first()
        if language is None:
            abort(404, f'Language not found: {language_name}')
        language_model = LanguageModel(language=language, model=self)
        db.session.add(language_model)

    def dissociate_language(self, language_name):
        if not allowed_language(language_name):
            abort(400, f'{language_name} language is not supported yet')
        language = Language.query.filter_by(name=language_name).first()
        if language is None:
            abort(404, f'Language not found: {language_name}')
        language_model = LanguageModel.query.filter_by(language=language, model=self).first()
        if language_model:
            db.session.delete(language_model)
    
    def from_dict(self, data, partial_update=False):
        """Import model data from a dictionary."""
        for field in ['name']:
            try:
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
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'languages': [language.name for language in self.languages],
            '_links': {}
        }
