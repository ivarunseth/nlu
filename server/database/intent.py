import pandas as pd

from flask import abort, url_for

from werkzeug.utils import secure_filename

from sqlalchemy import select

from .. import db
from ..utils import io as dataset_io
from ..utils.dataset import next_label_color
from ..utils.common import timestamp, format_timestamp, allowed_file

from .utterance import Utterance


class Intent(db.Model):
    """
    A whole-utterance class: what a classification model predicts (its
    "labels" in the UI copy) and the intent head of a language understanding
    model. Owns its utterances; on language understanding models it also
    scopes the slots annotators tag on those utterances.
    """
    __tablename__ = 'intents'
    id = db.Column(db.Integer, primary_key=True)
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    name = db.Column(db.String, nullable=False)
    color = db.Column(db.String)
    description = db.Column(db.Text)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    model = db.relationship('Model', back_populates='intents')
    utterances = db.relationship('Utterance', cascade="all,delete", back_populates='intent', lazy='dynamic')
    # Slots are intent-scoped. The cascade implements the intent-delete
    # semantics (MT-5) without bespoke delete logic: dropping the intent
    # takes its slots — and, through Slot.tags, their spans.
    slots = db.relationship('Slot', cascade="all,delete", back_populates='intent', lazy='dynamic')

    @property
    def utterance_list(self):
        return [utterance.to_dict() for utterance in self.utterances.order_by(Utterance.id.desc()).all()]

    @staticmethod
    def create(data, model):
        intent = Intent()
        intent.from_dict(data)
        if model.intents.filter_by(name=intent.name).first():
            abort(400, f'{intent.name} label already exists, please choose a different name')
        # Read existing colours before attaching to the model so the query does
        # not autoflush the half-built intent; pick one none of them use.
        if intent.color is None:
            intent.color = next_label_color([existing.color for existing in model.intents.all()])
        intent.model = model
        return intent

    def read(self, file, header=0):
        """
        Import this intent's rows from a ``text,label`` CSV/TSV: keep only rows
        whose label matches this intent's name, batch-inserted via
        ``bulk_insert``. Returns the number imported.
        """
        if not allowed_file(secure_filename(file.filename)):
            abort(400, 'Please upload either CSV or TSV file.')
        db.session.flush()  # ensure self.id for a freshly-created intent
        sep = '\t' if file.filename.endswith('.tsv') else ','
        imported = 0
        for chunk in pd.read_csv(file, sep=sep, header=header,
                                 skip_blank_lines=True, usecols=[0, 1],
                                 chunksize=dataset_io.batch_size()):
            mask = chunk.iloc[:, 1].astype(str).values == str(self.name)
            texts = chunk.iloc[mask, 0].astype(str).tolist()
            rows = [{'text': text, 'intent_id': self.id} for text in texts]
            if rows:
                dataset_io.bulk_insert(Utterance, rows, copy=True)
                imported += len(rows)
        return imported

    def write(self, object_name=None):
        """
        Export this intent's utterances as a ``text,label`` CSV, streamed via
        native COPY (fallback: chunked). Returns an open handle for
        ``flask.send_file`` unless ``object_name`` routes it through ``store``.
        """
        query = (
            select(Utterance.text.label('text'),
                   db.literal(self.name).label('label'))
            .where(Utterance.intent_id == self.id)
            .order_by(Utterance.id.desc())
        )
        path = dataset_io.new_temp_path()
        try:
            dataset_io.stream_query_to_path(query, path)
        except BaseException:
            dataset_io.discard_temp(path)
            raise
        return dataset_io.finalize_export(path, object_name)

    def from_dict(self, data, partial_update=False):
        """Import intent data from a dictionary."""
        for field in ['name', 'color', 'description']:
            try:
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update and field == 'name':
                    abort(400)

    def to_dict(self):
        data = {
            'id': self.id,
            'model_id': self.model_id,
            'name': self.name,
            'color': self.color,
            'description': self.description,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            'utterances_count': self.utterances.count(),
            '_link': {
                'self': url_for('api.get_intent', modelId=self.model_id, intentId=self.id),
                'model': url_for('api.get_model', modelId=self.model_id),
                'utterances': url_for('api.get_utterances', modelId=self.model_id, intentId=self.id)
            }
        }
        if self.model is not None and self.model.kind == 'natural_language_understanding':
            data['slots_count'] = self.slots.count()
        return data
