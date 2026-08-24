import re

from flask import abort

from .. import db
from ..utils.common import timestamp, format_timestamp


class Slot(db.Model):
    """
    An intent-scoped role a language understanding model is trained to
    predict — the crux of the slot/entity split. A slot belongs to exactly
    one intent and maps to exactly one entity; several slots inside one
    intent may share an entity (``source`` and ``destination`` both mapping
    to ``location``). The slot — not the entity — is the annotated and
    trained unit: its name is the IOB tag, so names are whitespace-free and
    unique per intent. Different intents may each define a slot of the same
    name (a shared tag vocabulary — ``date`` under both ``calendar.set``
    and ``alarm.set``); a predicted tag resolves to a slot through the
    jointly predicted intent, via the intent → slot → entity map shipped
    with the artifact.
    """
    __tablename__ = 'slots'
    id = db.Column(db.Integer, primary_key=True)
    model_id = db.Column(db.String, db.ForeignKey('models.id'), nullable=False)
    intent_id = db.Column(db.Integer, db.ForeignKey('intents.id'), nullable=False)
    entity_id = db.Column(db.Integer, db.ForeignKey('entities.id'), nullable=False)
    name = db.Column(db.String, nullable=False)
    # Display colour; defaults to the entity's, so every slot of one entity
    # reads alike across intents (a span is labelled by slot regardless).
    color = db.Column(db.String)
    created_at = db.Column(db.Integer, default=timestamp)

    model = db.relationship('Model', back_populates='slots')
    intent = db.relationship('Intent', back_populates='slots')
    entity = db.relationship('Entity', back_populates='slots')
    tags = db.relationship('Tag', cascade="all,delete", back_populates='slot', lazy='dynamic')

    @staticmethod
    def create(data, model):
        name = (data.get('name') or '').strip()
        if not name:
            abort(400, 'A slot name is required')
        if re.search(r'\s', name):
            suggestion = re.sub(r'\s+', '_', name)
            abort(400, f'Slot names cannot contain whitespace, try {suggestion} instead.')
        intent = model.intents.filter_by(id=data.get('intent_id')).first()
        if intent is None:
            abort(400, 'The slot must belong to one of the model\'s intents')
        if model.slots.filter_by(name=name, intent_id=intent.id).first():
            abort(400, f'{name} slot already exists on {intent.name}, please choose a different name')
        entity = model.entities.filter_by(id=data.get('entity_id')).first()
        if entity is None:
            abort(400, 'The slot must map to one of the model\'s entities')
        return Slot(
            model=model,
            intent=intent,
            entity=entity,
            name=name,
            color=data.get('color') or entity.color,
        )

    def from_dict(self, data, partial_update=True):
        """Apply a rename / remap; validated against the model's registries."""
        if 'name' in data:
            name = (data.get('name') or '').strip()
            if not name:
                abort(400, 'A slot name is required')
            if re.search(r'\s', name):
                suggestion = re.sub(r'\s+', '_', name)
                abort(400, f'Slot names cannot contain whitespace, try {suggestion} instead.')
            existing = self.model.slots.filter_by(name=name, intent_id=self.intent_id).first()
            if existing is not None and existing.id != self.id:
                abort(400, f'{name} slot already exists on {self.intent.name}, please choose a different name')
            self.name = name
        if 'entity_id' in data:
            entity = self.model.entities.filter_by(id=data.get('entity_id')).first()
            if entity is None:
                abort(400, 'The slot must map to one of the model\'s entities')
            self.entity = entity
        if 'color' in data:
            self.color = data.get('color') or None

    def to_dict(self):
        return {
            'id': self.id,
            'model_id': self.model_id,
            'intent_id': self.intent_id,
            'name': self.name,
            'color': self.color or (self.entity.color if self.entity else None),
            # Both ends of the mapping travel with the slot, so a view showing
            # "which slots reference this entity, and under which intent" needs
            # no client-side join against the intent list.
            'intent': {
                'id': self.intent.id,
                'name': self.intent.name
            } if self.intent else None,
            'entity': {
                'id': self.entity.id,
                'name': self.entity.name,
                'color': self.entity.color
            } if self.entity else None,
            'annotations_count': self.tags.count(),
            'created_at': format_timestamp(self.created_at)
        }
