# Owned by the `dataset` blueprint. Other blueprints read only.
import re

from flask import abort

from .. import db
from ..utils.dataset import next_label_color, normalize_term
from ..utils.common import timestamp, format_timestamp
from ..utils import io as dataset_io

from .value import Value
from .tag import Tag
from .slot import Slot
from .utterance import Utterance
from .intent import Intent


class Entity(db.Model):
    """
    A span type: what a named entity recognition span references directly
    and what a language understanding slot maps to. Owns its authored value
    catalogue; its name becomes ``B-``/``I-`` tag suffixes, so it stays
    whitespace-free.
    """
    __tablename__ = 'entities'
    id = db.Column(db.Integer, primary_key=True)
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    name = db.Column(db.String, nullable=False)
    # Whether the entity's value space is enumerable. A 'closed' list can be
    # captured as a finite value catalogue; an 'open' list (person, place, …)
    # cannot, so training-data generation additionally teaches the model to
    # generalize with UNK variants.
    kind = db.Column(db.String, default='open')
    color = db.Column(db.String)
    description = db.Column(db.Text)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    model = db.relationship('Model', back_populates='entities')
    tags = db.relationship('Tag', cascade="all,delete", back_populates='entity', lazy='dynamic')
    values = db.relationship('Value', cascade="all,delete", back_populates='entity', lazy='dynamic')
    # A language understanding entity is referenced by the slots mapping to
    # it. The cascade implements the entity-delete semantics (MT-5) without
    # bespoke delete logic: dropping the entity takes those slots — and,
    # through Slot.tags, their spans.
    slots = db.relationship('Slot', cascade="all,delete", back_populates='entity', lazy='dynamic')

    @staticmethod
    def create(data, model):
        entity = Entity()
        entity.from_dict(data)
        # Only entities carry a value-space type; default it to 'open'.
        entity.kind = entity.kind or 'open'
        if model.entities.filter_by(name=entity.name).first():
            abort(400, f'{entity.name} label already exists, please choose a different name')
        # Read existing colours before attaching to the model so the query does
        # not autoflush the half-built entity; pick one none of them use.
        if entity.color is None:
            entity.color = next_label_color([existing.color for existing in model.entities.all()])
        entity.model = model
        entity.validate_name()
        return entity

    def validate_name(self):
        """Entity names become ``B-``/``I-`` suffixes, which cannot contain whitespace."""
        if re.search(r'\s', self.name or ''):
            suggestion = re.sub(r'\s+', '_', (self.name or '').strip())
            abort(400, f'Entity names cannot contain whitespace, try {suggestion} instead.')

    def catalogued_terms(self, exclude_value_id=None):
        """
        Lowercased, whitespace-normalized forms of every term this entity's
        catalogue already holds — canonical values and synonyms alike. Used
        to keep the catalogue ambiguity-free: no term may appear twice
        within one entity, whichever value it belongs to.
        """
        terms = set()
        for value in self.values.all():
            if exclude_value_id is not None and value.id == exclude_value_id:
                continue
            terms.add(normalize_term(value.value).lower())
            for synonym in value.synonyms.all():
                terms.add(normalize_term(synonym.text).lower())
        return terms

    def catalogue_surfaces(self, surfaces):
        """
        Insert uncatalogued surface strings as values (without synonyms) —
        the auto-cataloguing behind dataset import and span annotation.
        Comparison is the catalogue's usual one, lowercased
        ``normalize_term``, against existing values and synonyms and within
        the batch (first spelling wins). Never aborts: blanks and duplicates
        are silently skipped, so annotating can never fail because of the
        catalogue. Requires ``self.id`` (flush auto-created entities first).
        """
        taken = self.catalogued_terms()
        rows = []
        for surface in surfaces:
            term = normalize_term(surface)
            key = term.lower()
            if not term or key in taken:
                continue
            taken.add(key)
            rows.append({'entity_id': self.id, 'value': term,
                         'created_at': timestamp()})
        if rows:
            # Default batched path only: values.updated_at relies on the
            # insert-path column default, which COPY would bypass.
            dataset_io.bulk_insert(Value, rows)

    def annotation_surfaces(self):
        """
        The surface strings annotated for this entity across the dataset, as
        ``(value, slot_name|None, intent_name|None)`` rows — via ``entity_id``
        on a named entity recognition model, via the entity's slots on a
        language understanding one. Feeds the value catalogue's occurrence
        counts.
        """
        if self.model is not None and self.model.kind == 'natural_language_understanding':
            return db.session.query(Tag.value, Slot.name, Intent.name) \
                .join(Slot, Tag.slot_id == Slot.id) \
                .join(Utterance, Tag.utterance_id == Utterance.id) \
                .outerjoin(Intent, Utterance.intent_id == Intent.id) \
                .filter(Slot.entity_id == self.id).all()
        return [
            (value, None, None)
            for (value,) in db.session.query(Tag.value)
                .filter(Tag.entity_id == self.id).all()
        ]

    def from_dict(self, data, partial_update=False):
        """Import entity data from a dictionary."""
        for field in ['name', 'color', 'description']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update and field == 'name':
                    abort(400)
        # The studio form submits this as ``list_type``; accept that first and
        # fall back to ``kind`` for API/import callers. Both feed the ``kind``
        # column, whose public name is ``list_type``.
        list_type = data.get('list_type') or data.get('kind')
        if list_type:
            if list_type not in ('open', 'closed'):
                abort(400, f"Invalid list type: {list_type}. Allowed: open, closed")
            self.kind = list_type

    def to_dict(self):
        data = {
            'id': self.id,
            'model_id': self.model_id,
            'name': self.name,
            # ``list_type`` is the public name of the stored ``kind`` column;
            # emit both so API and studio-form callers agree.
            'kind': self.kind or 'open',
            'list_type': self.kind or 'open',
            'color': self.color,
            'description': self.description,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            'annotations_count': self.tags.count(),
            # The authored catalogue (values CRUD), on both model types.
            'values_count': self.values.count()
        }
        if self.model is not None and self.model.kind == 'natural_language_understanding':
            # An entity's spans live on the slots that map to it; report
            # them through that hop.
            data['slots_count'] = self.slots.count()
            data['annotations_count'] = Tag.query \
                .join(Slot, Tag.slot_id == Slot.id) \
                .filter(Slot.entity_id == self.id).count()
        return data
