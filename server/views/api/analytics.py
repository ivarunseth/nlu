"""
Read-only aggregation endpoints backing the Analyse page.

Everything here is computed from data that already exists — intents,
entities, utterances, tagged spans, each training's stored task result and the
telemetry rows the consumer persists — so the serving hot path is never
touched. Metrics reuse the same result fields History reads (accuracy,
evaluation.{train,test}.report / confusion_matrix) so both pages
reconcile exactly.

Every endpoint branches on ``model.kind``: classification aggregates
label-owned utterances and top label/score outputs, named entity
recognition aggregates annotated spans and ``{tags, entities}`` outputs,
and natural language understanding composes both — intent distribution
plus slot spans on the dataset side, ranked ``intents`` plus slot
``entities`` on the telemetry side.
"""

import re
import statistics
import time
import unicodedata

from collections import Counter
from itertools import combinations

import pandas as pd

from datetime import timezone

from flask import request, g, abort, current_app
from celery import states

from ...auth import token_auth
from ...database import Entity, Intent, Prediction, Slot, Tag, Training, Utterance
from ...utils.common import format_timestamp
from ...utils.dataset import spans_to_tags, parse_inline
from ...utils.telemetry import persist, sweep

from ... import db, store
from . import api

# Report keys that are aggregates, not labels.
REPORT_AGGREGATES = ('accuracy', 'macro avg', 'weighted avg')

NER = 'named_entity_recognition'
NLU = 'natural_language_understanding'

RECENT_MAX = 50


def _get_model(modelId):
    model = g.current_user.models.filter_by(id=modelId).first()
    if model is None:
        abort(404, 'Model not found: %s' % modelId)
    return model


def _get_results(model):
    """(training, result) for every successful run, oldest version first."""
    results = []
    for training in model.trainings.order_by(Training.version.asc()).all():
        task = training._get_task()
        if not task or task.status != states.SUCCESS:
            continue
        result = task.result
        if isinstance(result, dict):
            results.append((training, task, result))
    return results


def _get_report(result, split):
    evaluation = result.get('evaluation') or {}
    report = (evaluation.get(split) or {}).get('report')
    if report is None and split == 'test':
        report = result.get('report')
    return report if isinstance(report, dict) else {}


def _get_matrix(result, split):
    evaluation = result.get('evaluation') or {}
    matrix = (evaluation.get(split) or {}).get('confusion_matrix')
    if matrix is None and split == 'test':
        matrix = result.get('confusion_matrix')
    return matrix if isinstance(matrix, list) else None


def _get_accuracy(result, split='test'):
    evaluation = result.get('evaluation') or {}
    accuracy = (evaluation.get(split) or {}).get('accuracy')
    if accuracy is None and split == 'test':
        accuracy = result.get('accuracy')
    return accuracy


def _report_labels(report):
    return [name for name, metrics in report.items()
            if isinstance(metrics, dict) and name not in REPORT_AGGREGATES]


def _entity_scores(report):
    """Per-entity F1 from a token-level report, collapsing ``B-``/``I-`` rows.

    The stored named entity recognition report scores IOB tags. For the
    per-label views the ``B-X``/``I-X`` rows are merged into one ``X`` score,
    weighted by tag support, and the ``O`` filler tag is dropped.
    """
    groups = {}
    for name in _report_labels(report):
        if name == 'O':
            continue
        entity = name[2:] if name[:2] in ('B-', 'I-') else name
        groups.setdefault(entity, []).append(report[name])
    scores = {}
    for entity, rows in groups.items():
        support = sum(row.get('support') or 0 for row in rows)
        if support:
            value = sum((row.get('f1-score') or 0) * (row.get('support') or 0)
                        for row in rows) / support
        else:
            value = statistics.mean([row.get('f1-score') or 0 for row in rows])
        scores[entity] = round(value, 4)
    return scores


def _avg(report, key):
    metrics = report.get(key)
    if not isinstance(metrics, dict):
        return None
    return {
        'precision': metrics.get('precision'),
        'recall': metrics.get('recall'),
        'f1': metrics.get('f1-score')
    }


def _annotation_scores(block):
    """
    Normalizes an evaluation's annotation metrics (``slots`` for language
    understanding, ``entities`` for named entity recognition) to
    ``{accuracy, precision, recall, f1, labels: {name: f1}}``.

    Reads both the current shape — exact-match scores on the block itself, per
    name under ``labels``, token view under ``tokens`` — and the shape stored by
    artifacts trained before that, which nested the scores under ``entity`` with
    the per-name breakdown keyed ``slots``. Stored evaluations are never
    rewritten, so both must keep working.
    """
    block = block or {}
    legacy = block.get('entity') or {}
    scores = legacy or block
    labels = (legacy.get('slots') if legacy else block.get('labels')) or {}
    accuracy = (block.get('tokens') or {}).get('accuracy', block.get('accuracy'))
    return {
        'accuracy': accuracy,
        'precision': scores.get('precision'),
        'recall': scores.get('recall'),
        'f1': scores.get('f1'),
        'labels': {
            name: metrics.get('f1')
            for name, metrics in labels.items()
            if isinstance(metrics, dict)
        }
    }


def _date_done(task):
    date = task.date_done
    if not date:
        return None
    return date.replace(tzinfo=timezone.utc).astimezone(tz=None).strftime('%d/%m/%Y - %H:%M:%S')


def _histogram(values, bins=12):
    if not values:
        return []
    low, high = min(values), max(values)
    width = max(1, -(-(high - low + 1) // bins))
    counts = Counter((value - low) // width for value in values)
    return [
        {'lo': low + i * width, 'hi': low + (i + 1) * width - 1, 'n': counts.get(i, 0)}
        for i in range(max(counts) + 1)
    ]


def _normalize(text):
    # Drop punctuation by Unicode category rather than \W, which would also
    # strip the combining marks Indic scripts are written with.
    stripped = ''.join(c for c in text.lower() if not unicodedata.category(c).startswith('P'))
    return re.sub(r'\s+', ' ', stripped).strip()


def _imbalance(labels):
    """Largest-to-smallest count ratio over the non-empty labels."""
    filled = sorted((label for label in labels if label['count']), key=lambda label: label['count'])
    if not filled:
        return None
    smallest, largest = filled[0], filled[-1]
    return {
        'ratio': round(largest['count'] / smallest['count'], 1),
        'min': {'name': smallest['name'], 'count': smallest['count']},
        'max': {'name': largest['name'], 'count': largest['count']}
    }


def _lengths(texts):
    return {
        'chars': _histogram([len(text) for text in texts]),
        'tokens': _histogram([len(text.split()) for text in texts])
    }


@api.get('/models/<modelId>/analytics/dataset')
@token_auth.login_required
def get_dataset_analytics(modelId):
    """Class/entity distribution, totals, duplicates, lengths and vocabulary."""
    model = _get_model(modelId)
    if model.kind == NER:
        return _annotation_dataset_analytics(model)
    if model.kind == NLU:
        return _nlu_dataset_analytics(model)

    counts = db.session.query(Intent.id, Intent.name, Intent.color, db.func.count(Utterance.id)) \
        .outerjoin(Utterance, Utterance.intent_id == Intent.id) \
        .filter(Intent.model_id == model.id) \
        .group_by(Intent.id).order_by(Intent.name.asc()).all()
    labels = [{'id': id, 'name': name, 'color': color, 'count': count}
              for id, name, color, count in counts]

    pairs = db.session.query(Utterance.text, Intent.name) \
        .join(Intent, Utterance.intent_id == Intent.id) \
        .filter(Intent.model_id == model.id).all()

    sizes = [label['count'] for label in labels]
    imbalance = _imbalance(labels)

    # Exact duplicates share the stripped text; near duplicates only differ
    # in case, punctuation or spacing. The same text under two labels is a
    # likely labelling conflict.
    groups = {}
    for text, label in pairs:
        groups.setdefault(text.strip(), []).append(label)
    items = [
        {'text': text, 'labels': sorted(set(names)), 'n': len(names)}
        for text, names in groups.items() if len(names) > 1
    ]
    items.sort(key=lambda item: (-item['n'], item['text']))
    normalized = {}
    for text in groups:
        normalized.setdefault(_normalize(text), set()).add(text)
    duplicates = {
        'exact': sum(len(names) - 1 for names in groups.values() if len(names) > 1),
        'near': sum(len(texts) - 1 for texts in normalized.values() if len(texts) > 1),
        'conflicts': sum(1 for item in items if len(item['labels']) > 1),
        'items': items[:50]
    }

    vocab = Counter()
    label_vocab = {}
    for text, label in pairs:
        tokens = text.lower().split()
        vocab.update(tokens)
        label_vocab.setdefault(label, Counter()).update(tokens)

    return {
        'kind': model.kind,
        'labels': labels,
        'totals': {
            'utterances': len(pairs),
            'labels': len(labels),
            'empty': sum(1 for size in sizes if size == 0),
            'mean': round(statistics.mean(sizes), 1) if sizes else 0,
            'median': statistics.median(sizes) if sizes else 0
        },
        'imbalance': imbalance,
        'duplicates': duplicates,
        'lengths': _lengths([text for text, _ in pairs]),
        'vocab': {
            'unique': len(vocab),
            'top': vocab.most_common(20),
            'labels': {name: counter.most_common(10) for name, counter in label_vocab.items()}
        }
    }, 200


def _annotation_dataset_analytics(model):
    """The named entity recognition dataset read: spans instead of ownership.

    The distribution counts annotated spans per entity over model-scoped
    utterances. The extra ``annotation`` block carries the span-health
    aggregates the Dataset tab renders: coverage, span lengths,
    entity/outside token split and co-occurrence.
    """
    counts = db.session.query(Entity.id, Entity.name, Entity.color, db.func.count(Tag.id)) \
        .outerjoin(Tag, Tag.entity_id == Entity.id) \
        .filter(Entity.model_id == model.id) \
        .group_by(Entity.id).order_by(Entity.name.asc()).all()
    labels = [{'id': id, 'name': name, 'color': color, 'count': count}
              for id, name, color, count in counts]

    texts = [text for (text,) in db.session.query(Utterance.text)
             .filter(Utterance.model_id == model.id).all()]
    spans = db.session.query(Tag.utterance_id, Entity.name, Tag.value) \
        .join(Entity, Tag.entity_id == Entity.id) \
        .join(Utterance, Tag.utterance_id == Utterance.id) \
        .filter(Utterance.model_id == model.id).all()

    sizes = [label['count'] for label in labels]

    # Repeated sentences are still worth surfacing, but spans cannot conflict
    # the way a second label on the same text does in classification.
    groups = Counter(text.strip() for text in texts)
    items = [
        {'text': text, 'labels': [], 'n': count}
        for text, count in groups.items() if count > 1
    ]
    items.sort(key=lambda item: (-item['n'], item['text']))
    normalized = {}
    for text in groups:
        normalized.setdefault(_normalize(text), set()).add(text)
    duplicates = {
        'exact': sum(count - 1 for count in groups.values() if count > 1),
        'near': sum(len(texts_) - 1 for texts_ in normalized.values() if len(texts_) > 1),
        'conflicts': 0,
        'items': items[:50]
    }

    vocab = Counter()
    for text in texts:
        vocab.update(text.lower().split())
    label_vocab = {}
    for _, name, value in spans:
        label_vocab.setdefault(name, Counter()).update((value or '').lower().split())

    by_utterance = {}
    span_lengths = []
    entity_tokens = 0
    for utterance_id, name, value in spans:
        by_utterance.setdefault(utterance_id, set()).add(name)
        tokens = len((value or '').split())
        span_lengths.append(tokens)
        entity_tokens += tokens
    annotated = len(by_utterance)
    total_tokens = sum(len(text.split()) for text in texts)
    cooccurrence = Counter()
    for names in by_utterance.values():
        for a, b in combinations(sorted(names), 2):
            cooccurrence[(a, b)] += 1

    return {
        'kind': model.kind,
        'labels': labels,
        'totals': {
            'utterances': len(texts),
            'labels': len(labels),
            'empty': sum(1 for size in sizes if size == 0),
            # Spans per entity, mirroring utterances per label above.
            'mean': round(statistics.mean(sizes), 1) if sizes else 0,
            'median': statistics.median(sizes) if sizes else 0
        },
        'imbalance': _imbalance(labels),
        'duplicates': duplicates,
        'lengths': _lengths(texts),
        'vocab': {
            'unique': len(vocab),
            'top': vocab.most_common(20),
            'labels': {name: counter.most_common(10) for name, counter in label_vocab.items()}
        },
        'annotation': {
            'annotated': annotated,
            'coverage': round(annotated / len(texts), 4) if texts else 0,
            'spans': len(spans),
            'span_lengths': _histogram(span_lengths),
            'tokens': {
                'total': total_tokens,
                'entity': entity_tokens,
                'outside': max(total_tokens - entity_tokens, 0)
            },
            'cooccurrence': [
                {'a': a, 'b': b, 'count': count}
                for (a, b), count in cooccurrence.most_common(20)
            ]
        }
    }, 200


def _nlu_dataset_analytics(model):
    """The language understanding dataset read: both lenses over one set.

    ``labels`` is the intent distribution (utterances per intent, the
    classification shape) and ``slots`` the slot distribution (spans per
    slot); the ``annotation`` block carries the same span-health aggregates
    the named entity recognition read produces, plus the intent<->slot
    co-occurrence, and ``intents`` reports how many utterances carry one.
    """
    intent_counts = db.session.query(Intent.id, Intent.name, Intent.color, db.func.count(Utterance.id)) \
        .outerjoin(Utterance, Utterance.intent_id == Intent.id) \
        .filter(Intent.model_id == model.id) \
        .group_by(Intent.id).order_by(Intent.name.asc()).all()
    labels = [{'id': id, 'name': name, 'color': color, 'count': count}
              for id, name, color, count in intent_counts]

    # Spans per slot, from the intent-scoped Slot registry.
    slot_counts = db.session.query(Slot.id, Slot.name, Slot.color, db.func.count(Tag.id)) \
        .outerjoin(Tag, Tag.slot_id == Slot.id) \
        .filter(Slot.model_id == model.id) \
        .group_by(Slot.id).order_by(Slot.name.asc()).all()
    slots = [{'id': id, 'name': name, 'color': color, 'count': count}
             for id, name, color, count in slot_counts]

    # Spans and distinct surface values per entity, through the slots that
    # map to it — the per-entity value-diversity read (AL-1).
    # `list_type` rides along so the Analyse overview can compare how an entity
    # is declared against how it actually behaves: an open list whose values
    # barely vary is really a catalogue, and a closed list where almost every
    # mention is unique is not enumerable at all.
    entity_counts = db.session.query(
        Entity.id, Entity.name, Entity.color, Entity.kind,
        db.func.count(Tag.id),
        db.func.count(db.func.distinct(Tag.value))
    ) \
        .outerjoin(Slot, Slot.entity_id == Entity.id) \
        .outerjoin(Tag, Tag.slot_id == Slot.id) \
        .filter(Entity.model_id == model.id) \
        .group_by(Entity.id).order_by(Entity.name.asc()).all()
    # `kind` is the stored column; `list_type` is its public name, and a NULL
    # kind means open — same normalization Entity.to_dict applies, so the two
    # surfaces cannot disagree.
    entities = [{'id': id, 'name': name, 'color': color, 'list_type': kind or 'open',
                 'count': count, 'values': values}
                for id, name, color, kind, count, values in entity_counts]

    pairs = db.session.query(Utterance.id, Utterance.text, Intent.name) \
        .outerjoin(Intent, Utterance.intent_id == Intent.id) \
        .filter(Utterance.model_id == model.id).all()
    texts = [text for _, text, _ in pairs]
    intent_of = {utterance_id: intent for utterance_id, _, intent in pairs}
    spans = db.session.query(Tag.utterance_id, Slot.name, Tag.value) \
        .join(Slot, Tag.slot_id == Slot.id) \
        .join(Utterance, Tag.utterance_id == Utterance.id) \
        .filter(Utterance.model_id == model.id).all()

    sizes = [label['count'] for label in labels]

    # Same-text-under-two-intents is a labelling conflict, exactly as in
    # classification.
    groups = {}
    for _, text, intent in pairs:
        groups.setdefault(text.strip(), []).append(intent or '?')
    items = [
        {'text': text, 'labels': sorted(set(names)), 'n': len(names)}
        for text, names in groups.items() if len(names) > 1
    ]
    items.sort(key=lambda item: (-item['n'], item['text']))
    normalized = {}
    for text in groups:
        normalized.setdefault(_normalize(text), set()).add(text)
    duplicates = {
        'exact': sum(len(names) - 1 for names in groups.values() if len(names) > 1),
        'near': sum(len(texts_) - 1 for texts_ in normalized.values() if len(texts_) > 1),
        'conflicts': sum(1 for item in items if len(item['labels']) > 1),
        'items': items[:50]
    }

    vocab = Counter()
    label_vocab = {}
    for _, text, intent in pairs:
        tokens = text.lower().split()
        vocab.update(tokens)
        if intent:
            label_vocab.setdefault(intent, Counter()).update(tokens)

    by_utterance = {}
    span_lengths = []
    entity_tokens = 0
    intent_slots = Counter()
    for utterance_id, name, value in spans:
        by_utterance.setdefault(utterance_id, set()).add(name)
        tokens = len((value or '').split())
        span_lengths.append(tokens)
        entity_tokens += tokens
        intent = intent_of.get(utterance_id)
        if intent:
            intent_slots[(intent, name)] += 1
    annotated = len(by_utterance)
    total_tokens = sum(len(text.split()) for text in texts)
    cooccurrence = Counter()
    for names in by_utterance.values():
        for a, b in combinations(sorted(names), 2):
            cooccurrence[(a, b)] += 1
    with_intent = sum(1 for _, _, intent in pairs if intent)

    return {
        'kind': model.kind,
        'labels': labels,
        'slots': slots,
        'entities': entities,
        'totals': {
            'utterances': len(pairs),
            'labels': len(labels),
            'empty': sum(1 for size in sizes if size == 0),
            'mean': round(statistics.mean(sizes), 1) if sizes else 0,
            'median': statistics.median(sizes) if sizes else 0
        },
        'imbalance': _imbalance(labels),
        'duplicates': duplicates,
        'lengths': _lengths(texts),
        'vocab': {
            'unique': len(vocab),
            'top': vocab.most_common(20),
            'labels': {name: counter.most_common(10) for name, counter in label_vocab.items()}
        },
        'intents': {
            'with_intent': with_intent,
            'coverage': round(with_intent / len(pairs), 4) if pairs else 0
        },
        'annotation': {
            'annotated': annotated,
            'coverage': round(annotated / len(texts), 4) if texts else 0,
            'spans': len(spans),
            'span_lengths': _histogram(span_lengths),
            'tokens': {
                'total': total_tokens,
                'entity': entity_tokens,
                'outside': max(total_tokens - entity_tokens, 0)
            },
            'cooccurrence': [
                {'a': a, 'b': b, 'count': count}
                for (a, b), count in cooccurrence.most_common(20)
            ],
            # Which slots each intent's utterances carry — the joint shape
            # of the dataset at a glance.
            'intent_slots': [
                {'intent': intent, 'slot': slot, 'count': count}
                for (intent, slot), count in intent_slots.most_common(20)
            ]
        }
    }, 200


@api.get('/models/<modelId>/analytics/versions')
@token_auth.login_required
def get_version_analytics(modelId):
    """Per-successful-version quality metrics and the best-version pick.

    For named entity recognition the report is token-level over IOB tags, so
    accuracy is token accuracy and the per-label scores are collapsed to one
    F1 per entity (``_entity_scores``).
    """
    model = _get_model(modelId)

    versions = []
    for training, task, result in _get_results(model):
        report = _get_report(result, 'test')
        accuracy = _get_accuracy(result)
        train_accuracy = _get_accuracy(result, 'train')
        gap = None
        if accuracy is not None and train_accuracy is not None:
            gap = round(train_accuracy - accuracy, 4)
        if model.kind == NER:
            label_scores = _entity_scores(report)
        else:
            label_scores = {
                name: report[name].get('f1-score')
                for name in _report_labels(report)
            }
        version = {
            'id': training.id,
            'version': float(training.version),
            'created_at': format_timestamp(training.created_at),
            'date_done': _date_done(task),
            'accuracy': accuracy,
            'train_accuracy': train_accuracy,
            'gap': gap,
            'macro': _avg(report, 'macro avg'),
            'weighted': _avg(report, 'weighted avg'),
            'labels': label_scores
        }
        if model.kind == NLU:
            # The joint model's top-level metrics are its intent metrics; the
            # slot half reports the exact-match scores (an annotation counts
            # only when its slot and both boundaries match).
            evaluation = ((result.get('evaluation') or {}).get('test') or {})
            version['slots'] = _annotation_scores(evaluation.get('slots'))
        versions.append(version)

    # Objective: test accuracy, tie-broken by macro F1.
    scored = [v for v in versions if v['accuracy'] is not None]
    best = max(
        scored,
        key=lambda v: (v['accuracy'], (v['macro'] or {}).get('f1') or 0),
        default=None
    )
    return {
        'kind': model.kind,
        'versions': versions,
        'best': best and {
            'id': best['id'],
            'version': best['version'],
            'accuracy': best['accuracy'],
            'f1': (best['macro'] or {}).get('f1')
        }
    }, 200


@api.get('/models/<modelId>/analytics/confusions')
@token_auth.login_required
def get_confusion_analytics(modelId):
    """Class pairs confused across the last N versions' test matrices.

    Named entity recognition matrices are over IOB tags, so the pairs read
    as tag confusions (e.g. ``B-artist`` predicted as ``O``).
    """
    model = _get_model(modelId)
    window = request.args.get('window', 5, type=int)

    results = list(reversed(_get_results(model)))
    if window > 0:
        results = results[:window]

    pairs = {}
    included = []
    for training, _, result in results:
        matrix = _get_matrix(result, 'test')
        labels = _report_labels(_get_report(result, 'test'))
        if not matrix or len(matrix) != len(labels):
            continue
        included.append(float(training.version))
        for i, row in enumerate(matrix):
            for j, count in enumerate(row):
                if i == j or not count:
                    continue
                pair = pairs.setdefault((labels[i], labels[j]), {
                    'actual': labels[i],
                    'predicted': labels[j],
                    'count': 0,
                    'versions': 0
                })
                pair['count'] += count
                pair['versions'] += 1

    ranked = sorted(pairs.values(), key=lambda pair: (-pair['versions'], -pair['count']))
    return {'kind': model.kind, 'pairs': ranked[:30], 'window': len(included), 'versions': included}, 200


def _quantile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * q
    low = int(index)
    high = min(low + 1, len(ordered) - 1)
    return round(ordered[low] + (ordered[high] - ordered[low]) * (index - low), 2)


@api.get('/models/<modelId>/analytics/live')
@token_auth.login_required
def get_live_analytics(modelId):
    """Live-traffic telemetry: throughput, latency, errors, confidence, mix.

    Each row carries its model, environment and served version itself, so
    history spans every deployment that ever ran — republishing (which
    replaces the control-plane instance) never resets the tab. Everything
    else is derived from the stored ``output`` JSON: classification
    predictions carry ranked ``labels`` (top name/score), named entity
    recognition ones carry ``entities`` (span mix and span scores),
    failures carry ``error``/``type``.

    Persistence normally happens in the background consumer; draining on
    read here is the safety net for environments whose consumer is down,
    and guarantees the response reflects everything captured so far.
    """
    model = _get_model(modelId)
    environment = request.args.get('environment')
    hours = min(max(request.args.get('hours', 24, type=int), 1), 24 * 30)

    # Maintenance is best-effort: a locked database must not take the
    # dashboard down — records wait in Redis and are retried on the next
    # pass by the consumer or the next read here.
    try:
        drained = persist()
        sweep(current_app.config['TELEMETRY_RETENTION_DAYS'])
    except Exception:
        db.session.rollback()
        current_app.logger.exception('telemetry maintenance failed')
        drained = 0

    now = time.time()
    since = now - hours * 3600
    scope = Prediction.query.filter(
        Prediction.model_id == model.id,
        Prediction.created_at >= since,
    )
    if environment:
        scope = scope.filter(Prediction.environment == environment)
    rows = scope.order_by(Prediction.created_at.asc()).all()

    # ~48 points regardless of the window, never finer than a minute.
    bucket = max(60, hours * 75)
    start = int(since // bucket) * bucket
    series = {t: {'t': t, 'count': 0, 'errors': 0}
              for t in range(start, int(now) + bucket, bucket)}

    ner = model.kind == NER
    nlu = model.kind == NLU
    latencies, scores, slot_scores = [], [], []
    labels, slot_labels, entity_labels, errors, environments = \
        Counter(), Counter(), Counter(), Counter(), Counter()
    cache_hits = 0
    served = 0
    span_count, span_empty = 0, 0
    for row in rows:
        output = row.output if isinstance(row.output, dict) else {}
        error = output.get('error')
        slot = series.get(int(row.created_at // bucket) * bucket)
        if slot:
            slot['count'] += 1
            if error:
                slot['errors'] += 1
        environments[row.environment] += 1
        if row.cached:
            cache_hits += 1
        if row.latency is not None:
            latencies.append(row.latency)
        if error:
            errors[output.get('type') or 'Error'] += 1
            continue
        served += 1
        if ner:
            entities = output.get('entities') or []
            span_count += len(entities)
            if not entities:
                span_empty += 1
            for entity in entities:
                if entity.get('entity'):
                    labels[entity['entity']] += 1
                if entity.get('score') is not None:
                    scores.append(entity['score'])
        elif nlu:
            # Joint outputs: the top intent feeds the label mix and the
            # confidence read; the reconstructed slot spans feed their own
            # mix and score distribution.
            ranked = output.get('intents') or []
            top = ranked[0] if ranked and isinstance(ranked[0], dict) else None
            if top:
                if top.get('name'):
                    labels[top['name']] += 1
                if top.get('score') is not None:
                    scores.append(top['score'])
            entities = output.get('entities') or []
            span_count += len(entities)
            if not entities:
                span_empty += 1
            for entity in entities:
                # Spans are keyed by 'slot' (+ its 'entity' type); rows
                # logged before the split carried the slot under 'name'.
                slot = entity.get('slot') or entity.get('name')
                if slot:
                    slot_labels[slot] += 1
                if entity.get('entity'):
                    entity_labels[entity['entity']] += 1
                if entity.get('score') is not None:
                    slot_scores.append(entity['score'])
        else:
            ranked = output.get('labels') or []
            top = ranked[0] if ranked and isinstance(ranked[0], dict) else None
            if top:
                if top.get('name'):
                    labels[top['name']] += 1
                if top.get('score') is not None:
                    scores.append(top['score'])

    def _score_bins(values):
        bins = [{'lo': i / 10, 'hi': (i + 1) / 10, 'n': 0} for i in range(10)]
        for value in values:
            bins[min(max(int(value * 10), 0), 9)]['n'] += 1
        return bins

    confidence = _score_bins(scores)

    recent = [row.to_dict() for row in rows[-RECENT_MAX:][::-1]]

    return {
        'kind': model.kind,
        'total': len(rows),
        'errors': sum(errors.values()),
        'cache_hits': cache_hits,
        'latency': {
            'avg': round(statistics.mean(latencies), 2) if latencies else None,
            'p50': _quantile(latencies, 0.5),
            'p95': _quantile(latencies, 0.95),
            'p99': _quantile(latencies, 0.99),
            'max': max(latencies) if latencies else None
        },
        'series': list(series.values()),
        'bucket': bucket,
        'hours': hours,
        'labels': labels.most_common(20),
        'errors_by_type': errors.most_common(10),
        'environments': sorted(environments.items()),
        'confidence': confidence,
        # Span volume so the entity mix can be read against request volume.
        'spans': {
            'total': span_count,
            'empty': span_empty,
            'mean': round(span_count / served, 2) if served else None
        } if ner or nlu else None,
        # The slot half of language understanding traffic: predicted-slot
        # mix, predicted-entity mix and span-score distribution beside the
        # intent-level reads.
        'slot_labels': slot_labels.most_common(20) if nlu else None,
        'entity_labels': entity_labels.most_common(20) if nlu else None,
        'slot_confidence': _score_bins(slot_scores) if nlu else None,
        'recent': recent,
        'drained': drained
    }, 200


@api.get('/models/<modelId>/analytics/coverage')
@token_auth.login_required
def get_coverage_analytics(modelId):
    """Current dataset compared against a version's authored training snapshot.

    The snapshot is the authored ``utterances.csv`` (inline markup), parsed
    back into the same shape the DB side is counted in: (text, label) for
    classification, (text, IOB tag string) for named entity recognition,
    (text, intent, IOB tags) for language understanding — so a re-annotated
    span or a moved intent registers as one removal plus one addition. Both
    sides are authored data (augmentation, now a train-time detail, no longer
    inflates the diff).
    """
    model = _get_model(modelId)
    training = model.trainings.filter_by(id=request.args.get('training_id', type=int)).first()
    if training is None:
        abort(404, 'Training not found')
    data = store.get(current_app.config['STORAGE_BUCKET'], f'models/{training.path}/data/utterances.csv')
    if data is None:
        abort(404, 'Training snapshot not available')

    # The snapshot is the authored inline utterances.csv; parse each row back
    # into (text, IOB tags) — the same shape the DB side is counted in — so a
    # re-annotated span or a moved intent registers as one removal plus one
    # addition, base-vs-base (augmentation no longer inflates the diff).
    frame = pd.read_csv(data)
    cells = frame['utterances'].tolist()
    labels = frame['labels'].astype(str).tolist() if 'labels' in frame.columns else [None] * len(cells)

    def _snapshot_tags():
        for cell in cells:
            text, spans = parse_inline('' if pd.isna(cell) else str(cell))
            yield text, ' '.join(spans_to_tags(text, spans))

    if model.kind == NLU:
        snapshot = Counter(
            (text, label, tags)
            for label, (text, tags) in zip(labels, _snapshot_tags())
        )
        current = Counter(
            (utterance.text, utterance.intent.name,
             ' '.join(spans_to_tags(utterance.text, utterance.spans)))
            for utterance in model.utterances.all()
            if utterance.text.split() and utterance.intent is not None
        )
    elif model.kind == NER:
        snapshot = Counter(_snapshot_tags())
        current = Counter(
            (utterance.text, ' '.join(spans_to_tags(utterance.text, utterance.spans)))
            for utterance in model.utterances.all() if utterance.text.split()
        )
    else:
        snapshot = Counter(
            (str(cell), label) for cell, label in zip(cells, labels)
        )
        current = Counter(
            (text, name) for text, name in db.session.query(Utterance.text, Intent.name)
            .join(Intent, Utterance.intent_id == Intent.id)
            .filter(Intent.model_id == model.id).all()
        )
    return {
        'version': float(training.version),
        'added': sum((current - snapshot).values()),
        'removed': sum((snapshot - current).values()),
        'snapshot': sum(snapshot.values()),
        'current': sum(current.values())
    }, 200
