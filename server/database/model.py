import io
import csv
import uuid

from datetime import timezone

import pandas as pd

from flask import abort, g, url_for, current_app

from werkzeug.utils import secure_filename

from sqlalchemy.ext.associationproxy import association_proxy
from sqlalchemy import select

from .. import db
from ..utils import dataset
from ..utils import io as dataset_io
from ..utils.dataset import validate_import_spans, next_label_color
from ..utils.common import timestamp, format_timestamp, allowed_file, api_key_expiry

from .intent import Intent
from .entity import Entity
from .utterance import Utterance
from .tag import Tag
from .slot import Slot
from .training import Training
from .environment import Environment
from .instance import Instance


class Model(db.Model):
    """The User model."""
    __tablename__ = 'models'
    id = db.Column(db.String, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    name = db.Column(db.String, nullable=False)
    kind = db.Column(db.String, default='text_classification')
    description = db.Column(db.Text)
    created_at = db.Column(db.Integer, default=timestamp)
    updated_at = db.Column(db.Integer, default=timestamp, onupdate=timestamp)

    user = db.relationship('User', back_populates='models')
    intents = db.relationship('Intent', cascade="all,delete", back_populates='model', lazy='dynamic')
    entities = db.relationship('Entity', cascade="all,delete", back_populates='model', lazy='dynamic')
    slots = db.relationship('Slot', cascade="all,delete", back_populates='model', lazy='dynamic')
    utterances = db.relationship('Utterance', cascade="all,delete", back_populates='model', lazy='dynamic')
    trainings = db.relationship('Training', cascade="all,delete", back_populates='model', lazy='dynamic')
    instances = db.relationship('Instance', cascade="all,delete", back_populates='model', lazy='dynamic')
    predictions = db.relationship('Prediction', cascade="all,delete", back_populates='model', lazy='dynamic')
    environments = association_proxy('instances', 'environment')

    @property
    def intent_list(self):
        return [intent.to_dict() for intent in self.intents.order_by(Intent.name.asc(), Intent.id.desc()).all()]

    @property
    def training_list(self):
        return [training.to_dict() for training in self.trainings.order_by(Training.created_at.desc()).all()]

    @staticmethod
    def create(data, user=None):
        """Create a new language."""
        if 'kind' in data and data['kind'] not in current_app.config['ALLOWED_MODELS']:
            abort(400, f"Invalid model kind: {data['kind']}. Allowed: {list(current_app.config['ALLOWED_MODELS'])}")
        model = Model(id=uuid.uuid4().hex)
        model.from_dict(data)
        if g.current_user.models.filter_by(name=model.name).first():
            abort(400, f'{model.name} model already exists, please choose a different name.')
        model.user = user or g.current_user
        return model

    def read(self, source, fmt=None, header=0):
        """
        Import a dataset. NER/NLU models take an annotated corpus (``source`` a
        decoded string, ``fmt`` its interchange format); classification models
        take a ``text,label`` CSV/TSV upload (``source`` a file, ``header`` from
        the request). Both return the same
        ``{'imported', 'created', 'errors'}`` summary.
        """
        if self.kind in ('named_entity_recognition',
                         'natural_language_understanding'):
            return self._read_annotated(source, fmt)
        return self._read_classification(source, header)

    def _read_classification(self, file, header):
        """
        Stream a ``text,label`` CSV/TSV in through ``bulk_insert``: read in
        ``DATASET_IO_BATCH_SIZE`` chunks, auto-create any new intent (few, kept
        as ORM rows), flush so they get ids, then COPY the chunk's utterances.
        """
        if not allowed_file(secure_filename(file.filename)):
            abort(400, 'Please upload either CSV or TSV file.')
        sep = '\t' if file.filename.endswith('.tsv') else ','
        intents = {intent.name: intent for intent in self.intents.all()}
        used_colors = [intent.color for intent in intents.values()]
        imported, created = 0, []
        for chunk in pd.read_csv(file, sep=sep, header=header,
                                 on_bad_lines='skip', skip_blank_lines=True,
                                 usecols=[0, 1], chunksize=dataset_io.batch_size()):
            chunk = chunk.dropna()
            pending = []
            for text, label in zip(chunk.iloc[:, 0].astype(str),
                                   chunk.iloc[:, 1].astype(str)):
                name = str(label)
                intent = intents.get(name)
                if intent is None:
                    color = next_label_color(used_colors)
                    intent = Intent(name=name, model=self, color=color)
                    db.session.add(intent)
                    intents[name] = intent
                    used_colors.append(color)
                    created.append(name)
                pending.append((name, text))
            db.session.flush()
            rows = [{'text': text, 'intent_id': intents[name].id}
                    for name, text in pending]
            dataset_io.bulk_insert(Utterance, rows, copy=True)
            imported += len(rows)
        return {'imported': imported, 'created': created, 'errors': []}

    def write(self, fmt='csv', object_name=None):
        """
        Export this model's dataset, streamed to a temp file, then either
        uploaded via ``store`` (when ``object_name`` is given, e.g. the training
        build) or returned as an open handle for ``flask.send_file``.

        ``fmt='training'`` writes the training-pipeline layout; otherwise the
        format is the download format — the plain ``text,label`` CSV for a
        classification model, or an annotated interchange format
        (``inline``/``conll``/``json``/``csv``) for NER/NLU.
        """
        annotated = self.kind in ('named_entity_recognition',
                                  'natural_language_understanding')
        path = dataset_io.new_temp_path()
        try:
            if fmt == 'training':
                self._write_training(path)
            elif annotated:
                self._write_annotated(path, fmt)
            else:
                self._write_classification(path)
        except BaseException:
            dataset_io.discard_temp(path)
            raise
        return dataset_io.finalize_export(path, object_name)

    def _write_classification(self, path):
        """Plain ``text,label`` export via native COPY (fallback: chunked)."""
        query = (
            select(Utterance.text.label('text'), Intent.name.label('label'))
            .join(Intent, Utterance.intent_id == Intent.id)
            .where(Intent.model_id == self.id)
            .order_by(Intent.name.asc(), Intent.id.desc(), Utterance.id.desc())
        )
        dataset_io.stream_query_to_path(query, path)

    def _write_training(self, path):
        """
        The training-pipeline dataset. Classification is a plain
        ``utterances,labels`` COPY; NER/NLU stream inline ``{name: value}``
        markup (with a ``labels`` intent column for NLU) — the shape
        ``Training.start`` used to build inline before this was generalized.
        """
        if self.kind not in ('named_entity_recognition',
                             'natural_language_understanding'):
            query = (
                select(Utterance.text.label('utterances'),
                       Intent.name.label('labels'))
                .join(Intent, Utterance.intent_id == Intent.id)
                .where(Intent.model_id == self.id)
                .order_by(Intent.created_at.desc(), Intent.id.desc(), Utterance.id.desc())
            )
            dataset_io.stream_query_to_path(query, path)
            return

        with_intent = self.kind == 'natural_language_understanding'
        columns = ['utterances', 'labels'] if with_intent else ['utterances']

        def generate():
            buffer = io.StringIO()
            writer = csv.writer(buffer)

            def flush():
                data = buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)
                return data

            writer.writerow(columns)
            yield flush()
            for utterance in self.utterances.order_by(
                    Utterance.id.desc()).yield_per(dataset_io.batch_size()):
                if not utterance.text.split():
                    continue
                if with_intent and utterance.intent is None:
                    continue
                inline = dataset.format_inline(utterance.text, utterance.spans)
                writer.writerow([inline, utterance.intent.name]
                                if with_intent else [inline])
                yield flush()

        dataset_io.write_lines_to_path(path, generate())

    def _write_annotated(self, path, fmt):
        """
        Stream an annotated dataset in ``fmt`` through the per-record formatters
        in ``server/utils/dataset.py`` (the single source of truth), one
        utterance at a time via ``yield_per`` so the whole corpus never sits in
        memory. NER and NLU share this path; NLU adds the intent (inline TAB
        prefix / JSON field / CSV ``labels`` column).
        """
        nlu = self.kind == 'natural_language_understanding'

        def utterances():
            return self.utterances.order_by(
                Utterance.id.desc()).yield_per(dataset_io.batch_size())

        def intent_name(utterance):
            return utterance.intent.name if utterance.intent else ''

        def generate():
            if fmt == 'inline':
                for utterance in utterances():
                    yield (dataset.format_inline_nlu(
                        utterance.text, intent_name(utterance), utterance.spans)
                        if nlu else dataset.format_inline(
                            utterance.text, utterance.spans)) + '\n'
            elif fmt == 'json':
                for utterance in utterances():
                    yield (dataset.format_json_nlu(
                        utterance.text,
                        intent_name(utterance),
                        utterance.spans)
                        if nlu else dataset.format_json(
                            utterance.text, utterance.spans)) + '\n'
            elif fmt == 'conll':
                first = True
                for utterance in utterances():
                    if not first:
                        yield '\n\n'
                    first = False
                    yield dataset.format_conll(utterance.text, utterance.spans)
                if not first:
                    yield '\n'
            elif fmt == 'csv':
                buffer = io.StringIO()
                writer = csv.writer(buffer)

                def flush():
                    data = buffer.getvalue()
                    buffer.seek(0)
                    buffer.truncate(0)
                    return data

                header = (['utterances', 'labels', 'tags'] if nlu
                          else ['text', 'tags'])
                writer.writerow(header)
                yield flush()
                for utterance in utterances():
                    tags = ' '.join(dataset.spans_to_tags(
                        utterance.text, utterance.spans))
                    writer.writerow([utterance.text, intent_name(utterance), tags]
                                    if nlu else [utterance.text, tags])
                    yield flush()
            else:
                abort(400, 'Unknown format: %s' % fmt)

        dataset_io.write_lines_to_path(path, generate())

    def _read_annotated(self, content, fmt):
        """
        Import an annotated dataset (NER or NLU). The parse → per-record
        validate → registry-resolve pipeline is unchanged (the safety layer);
        only materialization is batched: valid records accumulate, and each
        batch flushes the auto-created registry rows for their ids, bulk-inserts
        the utterances with ``RETURNING id``, then bulk-inserts their tags
        against those ids. A malformed or invalid record is skipped and
        reported, never failing the file.
        """
        records = dataset.parse_dataset(content, fmt)
        errors, imported, created = [], 0, []
        nlu = self.kind == 'natural_language_understanding'
        check, resolve = (self._nlu_resolver(created) if nlu
                          else self._ner_resolver(created))

        pending = []  # (text, intent_or_None, [(start, end, entity_or_None, slot_or_None)])

        def flush_pending():
            nonlocal imported
            if not pending:
                return
            db.session.flush()  # registry rows (intents/entities/slots) get ids
            utterance_rows = [
                {'text': text, 'model_id': self.id,
                 'intent_id': intent.id if intent is not None else None}
                for text, intent, _ in pending
            ]
            ids = dataset_io.bulk_insert(
                Utterance, utterance_rows, returning=Utterance.id)
            tag_rows = []
            catalogue = {}  # owning entity -> {surface strings in this batch}
            for (text, _, spans), utterance_id in zip(pending, ids):
                for start, end, entity, slot in spans:
                    # The catalogue owner: the span's entity, or the slot's
                    # mapped entity on language understanding models.
                    owner = entity if entity is not None else slot.entity
                    catalogue.setdefault(owner, {})[text[start:end]] = None
                    tag_rows.append({
                        'utterance_id': utterance_id,
                        'entity_id': entity.id if entity is not None else None,
                        'slot_id': slot.id if slot is not None else None,
                        'start': start,
                        'end': end,
                        'value': text[start:end],
                        'created_at': timestamp(),
                    })
            dataset_io.bulk_insert(Tag, tag_rows)
            for owner, values in catalogue.items():
                owner.catalogue_surfaces(values)
            imported += len(pending)
            pending.clear()

        for record in records:
            if record['error']:
                errors.append({'line': record['line'], 'error': record['error']})
                continue
            text = record['text']
            if text is None or not text.strip():
                continue
            error = validate_import_spans(text, record['spans']) or check(record)
            if error:
                errors.append({'line': record['line'], 'error': error})
                continue
            pending.append(resolve(record))
            if len(pending) >= dataset_io.batch_size():
                flush_pending()
        flush_pending()

        return {'imported': imported, 'created': created, 'errors': errors}

    def _ner_resolver(self, created):
        """
        Batched NER span resolver: a span trains under an entity named
        exactly by the span's name, auto-created (open list) when unseen.
        ``resolve`` returns ``(text, None, [(start, end, entity, None)])``
        for the batch loader instead of adding an ``Utterance``/``Tag``
        itself.
        """
        entities = {entity.name: entity for entity in self.entities.all()}
        used_colors = [entity.color for entity in entities.values()]

        def check(record):
            return None

        def resolve(record):
            text = record['text']
            spans = []
            for start, end, name in sorted(record['spans']):
                entity = entities.get(name)
                if entity is None:
                    color = next_label_color(used_colors)
                    entity = Entity(name=name, model=self, color=color, kind='open')
                    db.session.add(entity)
                    entities[name] = entity
                    created.append(name)
                    used_colors.append(color)
                spans.append((start, end, entity, None))
            return text, None, spans

        return check, resolve

    def _nlu_resolver(self, created):
        """
        Batched NLU span resolver: each record carries an intent, and its
        spans resolve to intent-scoped ``Slot`` rows. Intents, slots and
        their backing entities are auto-created; a slot maps to a same-named
        entity. Slot names stay unique per intent, so the same name under
        several intents makes a separate slot on each. ``resolve`` returns
        ``(text, intent, [(start, end, None, slot)])`` for the batch loader.
        """
        intents = {intent.name: intent for intent in self.intents.all()}
        entities = {entity.name: entity for entity in self.entities.all()}
        slots = {(slot.intent.name, slot.name): slot for slot in self.slots.all()}
        intent_colors = [intent.color for intent in intents.values()]
        entity_colors = [entity.color for entity in entities.values()]

        def resolve_entity(name):
            entity = entities.get(name)
            if entity is None:
                color = next_label_color(entity_colors)
                entity = Entity(name=name, model=self, color=color, kind='open')
                db.session.add(entity)
                entities[name] = entity
                created.append(name)
                entity_colors.append(color)
            return entity

        def check(record):
            intent_name = (record.get('intent') or '').strip()
            if not intent_name:
                return 'an intent is required'
            return None

        def resolve(record):
            text, intent_name = record['text'], record['intent'].strip()
            intent = intents.get(intent_name)
            if intent is None:
                color = next_label_color(intent_colors)
                intent = Intent(name=intent_name, model=self, color=color)
                db.session.add(intent)
                intents[intent_name] = intent
                created.append(intent_name)
                intent_colors.append(color)
            spans = []
            for start, end, slot_name in sorted(record['spans']):
                slot = slots.get((intent_name, slot_name))
                if slot is None:
                    entity = resolve_entity(slot_name)
                    slot = Slot(name=slot_name, model=self, intent=intent,
                                entity=entity, color=entity.color)
                    db.session.add(slot)
                    slots[(intent_name, slot_name)] = slot
                    created.append(slot_name)
                spans.append((start, end, None, slot))
            return text, intent, spans

        return check, resolve

    def annotation_stats(self, intent_id=None):
        """
        Dataset-health counts for the Build overview strip: entities defined,
        model-scoped utterances, how many carry at least one span, and the total
        number of annotated spans. Language understanding models count only
        their slot registry as entities, and report their intents besides.

        When ``intent_id`` is given (language understanding only), the counts are
        scoped to that one intent's workspace: its slots, the utterances authored
        under it, and the spans on those utterances.
        """
        if self.kind == 'natural_language_understanding' and intent_id is not None:
            utterances = self.utterances.filter(Utterance.intent_id == intent_id)
            return {
                'slots': self.slots.filter_by(intent_id=intent_id).count(),
                'utterances': utterances.count(),
                'annotated': utterances.filter(Utterance.tags.any()).count(),
                'spans': Tag.query.join(
                    Utterance, Tag.utterance_id == Utterance.id
                ).filter(
                    Utterance.model_id == self.id,
                    Utterance.intent_id == intent_id
                ).count(),
            }

        stats = {
            'entities': self.entities.count(),
            'utterances': self.utterances.count(),
            'annotated': self.utterances.filter(Utterance.tags.any()).count(),
            'spans': Tag.query.join(
                Utterance, Tag.utterance_id == Utterance.id
            ).filter(Utterance.model_id == self.id).count(),
        }
        if self.kind == 'natural_language_understanding':
            stats['intents'] = self.intents.count()
            stats['slots'] = self.slots.count()
            # Total distinct values across entities — the sum of each entity
            # row's values_count, i.e. distinct (entity, value) pairs.
            stats['values'] = db.session.query(Tag.value, Slot.entity_id) \
                .join(Slot, Tag.slot_id == Slot.id) \
                .join(Utterance, Tag.utterance_id == Utterance.id) \
                .filter(Utterance.model_id == self.id) \
                .distinct().count()
        return stats

    def publish(self, training_id, config, params=None, **kwargs):
        training = self.trainings.filter_by(id=training_id).first()
        if not training:
            abort(400, 'Training not found: %s' % training_id)

        training_task = training._get_task()
        if not training_task or not training_task.successful():
            abort(400, 'Training not started yet: %s' % training_id)

        for environment in Environment.query.all():
            if environment.name not in config:
                continue

            instance = self.instances.filter(Instance.environment == environment).first()

            if config[environment.name]:
                # Keep the key stable across redeploys, and the deployment
                # config stable across reloads of the environment.
                api_key, carried = None, None
                if instance:
                    instance_task = instance._get_task()
                    if instance_task:
                        if not instance.ready(instance_task):
                            if instance.training == training and \
                                instance.date_receive > training_task.date_done.replace(tzinfo=timezone.utc).timestamp():
                                continue
                            instance.stop(instance_task)
                        instance.forget(instance_task)
                    api_key = instance.api_key
                    # A key only survives the redeploy while it is still a
                    # live JWT; expired or legacy opaque keys are replaced
                    # by a freshly minted one in Instance.create().
                    expiry = api_key_expiry(api_key)
                    if not expiry or expiry <= timestamp():
                        api_key = None
                    carried = instance.config
                    db.session.delete(instance)
                    db.session.flush()

                # An explicit config from the request wins over the one
                # carried across from the deployment being replaced.
                if params is not None:
                    carried = params

                instance = Instance.create(environment, self, training, api_key=api_key, config=carried)
                db.session.add(instance)
                instance.start(**kwargs)

            elif not config[environment.name]:
                if instance:
                    instance_task = instance._get_task()
                    if instance_task:
                        if not instance.ready(instance_task):
                            instance.stop(instance_task)
                        instance.forget(instance_task)
                    db.session.delete(instance)

    def from_dict(self, data, partial_update=False):
        """Import model data from a dictionary."""
        for field in ['name', 'description', 'kind']:
            try:
                if field == 'kind' and data[field] not in current_app.config['ALLOWED_MODELS']:
                    abort(400, f"Invalid model kind: {data[field]}. Allowed: {list(current_app.config['ALLOWED_MODELS'])}")
                setattr(self, field, data[field])
            except KeyError:
                if not partial_update:
                    abort(400)

    @property
    def status(self):
        """
        The furthest environment this model has been promoted to, or ``None``
        when nothing is deployed. Ranking follows the deployment pipeline's
        order as declared in ``ALLOWED_ENVIRONMENTS`` (testing → production),
        so a model live in several environments reports the highest one it
        has reached.
        """
        order = list(current_app.config['ALLOWED_ENVIRONMENTS'])
        rank = {name: index for index, name in enumerate(order)}
        deployed = [
            instance.environment.name
            for instance in self.instances.all()
            if instance.environment is not None and instance.environment.name in rank
        ]
        if not deployed:
            return None
        return max(deployed, key=lambda name: rank[name])

    def to_dict(self):
        """Export model to a dictionary."""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'name': self.name,
            'description': self.description,
            'kind': self.kind,
            'status': self.status,
            'created_at': format_timestamp(self.created_at),
            'updated_at': format_timestamp(self.updated_at),
            '_links': {
                'self': url_for('api.get_model', modelId=self.id),
                'user': url_for('api.get_user', userId=self.user_id),
                'intents': url_for('api.get_intents', modelId=self.id),
                'trainings': url_for('api.get_trainings', modelId=self.id)
            }
        }
