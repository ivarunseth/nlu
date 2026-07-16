from flask import abort, url_for

from .. import db
from ..utils.dataset import spans_to_tags

from .tag import Tag


class Utterance(db.Model):
    __tablename__ = 'utterances'
    id = db.Column(db.Integer, primary_key=True)
    # Ownership per model type: classification utterances belong to an
    # intent, named entity recognition utterances belong to the model and
    # carry annotations, and language understanding utterances set both —
    # the intent classifies them, the model scopes the shared slots
    # workspace.
    intent_id = db.Column(db.Integer, db.ForeignKey('intents.id'))
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    text = db.Column(db.Text, nullable=False, index=True)

    intent = db.relationship('Intent', back_populates='utterances')
    model = db.relationship('Model', back_populates='utterances')
    tags = db.relationship('Tag', cascade="all,delete", back_populates='utterance', lazy='dynamic')

    @staticmethod
    def create(data, intent=None, model=None):
        owner = model if model is not None else (intent.model if intent is not None else None)
        if owner is not None and owner.kind == 'natural_language_understanding':
            # Both owners at once: created under an intent, the utterance
            # inherits the model so it appears in the slots workspace too.
            if intent is None:
                abort(400, 'A language understanding utterance must be created under an intent')
            if intent.model is not owner:
                abort(400, 'The intent must be one of the model\'s intents')
            model = owner
        elif (intent is None) == (model is None):
            abort(400, 'An utterance belongs to either an intent or a model')
        utterance = Utterance()
        utterance.from_dict(data)
        utterance.intent = intent
        utterance.model = model
        return utterance

    def reassign(self, intent, resolve=None):
        """
        Move this utterance to a different intent. Only ``intent_id``
        changes; annotations whose slot belongs to the new intent move
        untouched.

        Slots are intent-scoped, so a span whose slot does not belong to the
        new intent would train as a foreign tag (IN-5). Such conflicts are
        surfaced with a 409 unless ``resolve='drop'`` explicitly discards
        the conflicting spans — never silently mistrained.
        """
        if intent is None or intent.model is not self.model:
            abort(400, 'The intent must be one of the model\'s intents')
        conflicts = [
            tag for tag in self.tags.all()
            if tag.slot is not None and tag.slot.intent_id != intent.id
        ]
        if conflicts:
            if resolve == 'drop':
                for tag in conflicts:
                    db.session.delete(tag)
            else:
                names = sorted({tag.slot.name for tag in conflicts})
                abort(409, f'{len(conflicts)} span(s) use slot(s) not defined on '
                           f'{intent.name}: {", ".join(names)}. Remap them or pass '
                           f'resolve=drop to discard the conflicting spans.')
        self.intent = intent

    def from_dict(self, data, partial_update=False):
        """Import utterance data from a dictionary."""
        for field in ['text']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    @property
    def spans(self):
        """
        The annotated spans as ``(start, end, name)`` triples — the name a
        span trains under: its slot's for language understanding, its
        entity's for named entity recognition.
        """
        return [
            (tag.start, tag.end, tag.name)
            for tag in self.tags.order_by(Tag.start.asc()).all()
        ]

    def prune_annotations(self):
        """
        Drop annotations invalidated by a text edit: offsets out of bounds or
        no longer covering the surface string they were created on.
        """
        for tag in self.tags.all():
            if tag.end > len(self.text) or self.text[tag.start:tag.end] != tag.value:
                db.session.delete(tag)

    def to_dict(self):
        if self.model_id:
            return {
                'id': self.id,
                'model_id': self.model_id,
                'intent_id': self.intent_id,
                # The intent, for language understanding utterances: shown
                # read-only in the slots workspace and set in the intents tab.
                'intent': {
                    'id': self.intent.id,
                    'name': self.intent.name,
                    'color': self.intent.color
                } if self.intent_id and self.intent else None,
                'text': self.text,
                # Span rows keep their historical wire name.
                'annotations': [
                    tag.to_dict()
                    for tag in self.tags.order_by(Tag.start.asc()).all()
                ],
                # The IOB tags this utterance trains on; derived by the same
                # module Training.start uses, so the preview never diverges.
                'tags': spans_to_tags(self.text, self.spans),
                '_link': {
                    'self': url_for('api.get_model_utterance', modelId=self.model_id, utteranceId=self.id),
                    'model': url_for('api.get_model', modelId=self.model_id)
                }
            }
        return {
            'id': self.id,
            'intent_id': self.intent_id,
            'text': self.text,
            '_link': {
                'self': url_for('api.get_utterance', modelId=self.intent.model_id, intentId=self.intent_id, utteranceId=self.id),
                'intent': url_for('api.get_intent', modelId=self.intent.model_id, intentId=self.intent_id)
            }
        }
