from datetime import datetime, timedelta

from flask import abort, url_for, current_app

from werkzeug.security import generate_password_hash, check_password_hash

from jwt import encode

from .. import db
from ..utils.common import timestamp, format_timestamp

from .model import Model


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
