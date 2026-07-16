from flask import abort

from .. import db
from ..utils.common import timestamp


class Tag(db.Model):
    """
    A labelled span: ``[start, end)`` character offsets into the utterance
    text. What the span references depends on the model type — a named
    entity recognition span points at an ``Entity``, a language
    understanding span at an intent-scoped ``Slot`` (whose entity is the
    span's type). Exactly one of ``entity_id`` / ``slot_id`` is set.

    The HTTP resource keeps its historical name: tags travel as the
    ``annotations`` key on utterance payloads and the ``/annotations``
    endpoints.
    """
    __tablename__ = 'tags'
    id = db.Column(db.Integer, primary_key=True)
    utterance_id = db.Column(db.Integer, db.ForeignKey('utterances.id'), nullable=False)
    entity_id = db.Column(db.Integer, db.ForeignKey('entities.id'), nullable=True)
    slot_id = db.Column(db.Integer, db.ForeignKey('slots.id'), nullable=True)
    start = db.Column(db.Integer, nullable=False)
    end = db.Column(db.Integer, nullable=False)
    # Denormalized surface string, text[start:end]; lets lists and exports
    # show the span without slicing and text edits detect stale offsets.
    value = db.Column(db.Text)
    created_at = db.Column(db.Integer, default=timestamp)

    utterance = db.relationship('Utterance', back_populates='tags')
    entity = db.relationship('Entity', back_populates='tags')
    slot = db.relationship('Slot', back_populates='tags')

    @property
    def name(self):
        """The name this span trains under: its slot's or its entity's."""
        return self.slot.name if self.slot is not None else self.entity.name

    @staticmethod
    def create(data, utterance, entity=None, slot=None):
        """Validate offsets against the text and existing spans, then create."""
        if (entity is None) == (slot is None):
            abort(400, 'An annotation references either an entity or a slot')
        try:
            start, end = int(data['start']), int(data['end'])
        except (KeyError, TypeError, ValueError):
            abort(400, 'Annotation offsets start and end are required')
        if not 0 <= start < end <= len(utterance.text):
            abort(400, 'Annotation offsets are out of bounds')
        for other in utterance.tags.all():
            if start < other.end and end > other.start:
                abort(400, f'Span overlaps the existing {other.name} annotation "{other.value}"')
        return Tag(
            utterance=utterance,
            entity=entity,
            slot=slot,
            start=start,
            end=end,
            value=utterance.text[start:end]
        )

    def to_dict(self):
        if self.slot is not None:
            return {
                'id': self.id,
                'utterance_id': self.utterance_id,
                'slot_id': self.slot_id,
                # 'label' stays the span's display name so the annotation
                # workspace renders slots exactly like entities.
                'label': self.slot.name,
                'entity': self.slot.entity.name if self.slot.entity else None,
                'color': self.slot.color or (self.slot.entity.color if self.slot.entity else None),
                'start': self.start,
                'end': self.end,
                'value': self.value
            }
        return {
            'id': self.id,
            'utterance_id': self.utterance_id,
            'entity_id': self.entity_id,
            'label': self.entity.name,
            'color': self.entity.color,
            'start': self.start,
            'end': self.end,
            'value': self.value
        }
