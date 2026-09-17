# Owned by the `dataset` blueprint. Other blueprints read only.
from .. import db
from ..utils.common import timestamp


class Synonym(db.Model):
    """A surface variant of one ``Value`` (``latte`` → ``caffè latte``)."""
    __tablename__ = 'synonyms'
    id = db.Column(db.Integer, primary_key=True)
    value_id = db.Column(db.Integer, db.ForeignKey('values.id'), nullable=False)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.Integer, default=timestamp)

    value = db.relationship('Value', back_populates='synonyms')
