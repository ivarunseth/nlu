from flask import abort

from .. import db
from ..utils.dataset import normalize_term
from ..utils.common import timestamp, format_timestamp

from .synonym import Synonym


class Value(db.Model):
    """
    One canonical value in an entity's catalogue (``coffee_type`` →
    ``latte``), authored in the entity drill-in on both named entity
    recognition and language understanding models. Owns its synonyms
    (surface variants meaning the same value). The catalogue is shipped to the
    model as ``data/entities.json`` and feeds training-data generation
    (``server/models/augmentation.py``): closed-list entities enumerate through
    it, open-list entities use it as sample values besides the UNK
    generalization.
    """
    __tablename__ = 'values'
    id = db.Column(db.Integer, primary_key=True)
    entity_id = db.Column(db.Integer, db.ForeignKey('entities.id'), nullable=False)
    value = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    entity = db.relationship('Entity', back_populates='values')
    synonyms = db.relationship('Synonym', cascade="all,delete",
                               back_populates='value', lazy='dynamic')

    @staticmethod
    def _clean_term(raw, noun='value'):
        term = normalize_term(raw)
        if not term:
            abort(400, f'A non-empty {noun} is required')
        return term

    @staticmethod
    def create(data, entity):
        """
        Create a value (with optional ``synonyms`` list) inside ``entity``'s
        catalogue. Every term — the value and each synonym — must be unique
        within the entity, case-insensitively, across values *and* synonyms;
        a duplicate would make training-time substitution and value
        normalization ambiguous.
        """
        term = Value._clean_term(data.get('value'))
        taken = entity.catalogued_terms()
        if term.lower() in taken:
            abort(400, f'"{term}" is already in {entity.name}\'s catalogue')
        value = Value(entity=entity, value=term)
        value._set_synonyms(data.get('synonyms') or [], taken | {term.lower()})
        return value

    def from_dict(self, data, partial_update=True):
        """
        Apply a rename and/or replace the synonym set, revalidating
        uniqueness against the rest of the entity's catalogue.
        """
        taken = self.entity.catalogued_terms(exclude_value_id=self.id)
        if 'value' in data:
            term = Value._clean_term(data.get('value'))
            if term.lower() in taken:
                abort(400, f'"{term}" is already in {self.entity.name}\'s catalogue')
            self.value = term
        if 'synonyms' in data:
            for synonym in self.synonyms.all():
                db.session.delete(synonym)
            self._set_synonyms(data.get('synonyms') or [],
                               taken | {normalize_term(self.value).lower()})

    def _set_synonyms(self, synonyms, taken):
        if not isinstance(synonyms, (list, tuple)):
            abort(400, 'synonyms must be a list of strings')
        for raw in synonyms:
            term = Value._clean_term(raw, noun='synonym')
            if term.lower() in taken:
                abort(400, f'"{term}" is already in the catalogue — '
                           'synonyms must be unique within the entity')
            taken.add(term.lower())
            db.session.add(Synonym(value=self, text=term))

    def terms(self):
        """The value and all its synonyms — the substitution alternatives."""
        return [self.value] + [synonym.text for synonym in self.synonyms.all()]

    def to_dict(self, count=None):
        data = {
            'id': self.id,
            'entity_id': self.entity_id,
            'value': self.value,
            'synonyms': [
                {'id': synonym.id, 'text': synonym.text}
                for synonym in self.synonyms.order_by(Synonym.id.asc()).all()
            ],
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
        }
        if count is not None:
            data['count'] = count
        return data
