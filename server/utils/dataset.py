"""
Span <-> IOB conversion for named entity recognition datasets.

Annotations are stored as half-open ``[start, end)`` character offsets into
the utterance text; IOB tags are derived from them here, one tag per
whitespace token. Training (``Training.start``) and the annotation
workspace's tag preview both call this module, so the tags a user previews
are exactly the tags a model trains on.

This module also (de)serializes a whole dataset in the interchange formats
— inline ``{entity: value}``, CoNLL/IOB, JSON spans, and the ``tags`` CSV —
sharing the same span representation so a round trip is lossless (modulo
whitespace normalization).

Parsing is **unified across model types**: every format yields the same
record shape ::

    {'line': int, 'text': str, 'intent': str|None,
     'spans': [(start, end, name)], 'error': str|None}

with the intent optional everywhere a format can carry one and an empty
``tags`` cell meaning all-``O``. The per-type semantics — "ignore the
intent" (named entity recognition) vs "require it" (language
understanding), and what a span's name resolves to — live in
``Model._read_annotated``, not here, so the same file always parses to
the same records regardless of the importing model's type.
"""
import os
import re
import io
import csv
import json

TOKEN_PATTERN = re.compile(r'\S+')

# The inline authoring markup: ``{entity: value}``. Kept in sync with the
# client's parser in AnnotationBuild.jsx so typed and imported markup agree.
INLINE_PATTERN = re.compile(r'\{\s*([^{}:]+?)\s*:\s*([^{}]*?)\s*\}')

FORMATS = ('inline', 'conll', 'json', 'csv')

# The interchange formats that can carry an intent besides the spans (CoNLL
# has no record-level field to put one in, so it is named-entity-only).
NLU_FORMATS = ('inline', 'json', 'csv')

# CSV/TSV column names accepted for the intent, tried in order; 'labels'
# first because it is the column Training.start writes.
CSV_INTENT_COLUMNS = ('labels', 'label', 'intent')

# CSV/TSV column names accepted for the utterance text, tried in order. The
# space-separated IOB tags come from a ``tags`` column; any other column (an
# intent ``label``, say) is ignored.
CSV_TEXT_COLUMNS = ('text', 'utterances', 'utterance')


ALLOWED_COLORS = os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, 'public', 'colors.txt')

# Stripped on the way in: these are handed straight to the client as an entity's
# colour, and a trailing newline survives into CSS (which tolerates it) while
# breaking any consumer that parses the hex — the contrast check that picks
# readable text on top of it reads '#ea580c\n' as malformed and defaults to
# white, which is unreadable on the palette's light colours.
with open(ALLOWED_COLORS, encoding='utf-8') as f:
    COLORS = [color.strip() for color in f if color.strip()]


def next_label_color(used_colors):
    """
    The first palette colour not already among ``used_colors``, so a fresh
    entity gets a colour distinct from every existing one. Cycles the palette
    once every colour is in use.
    """
    # Stripped on both sides: colours stored before the palette was cleaned up
    # still carry a trailing newline, and would otherwise never match a palette
    # entry — handing every new entity a colour that is already taken.
    used = {(color or '').strip().lower() for color in used_colors}
    for color in COLORS:
        if color.lower() not in used:
            return color
    return COLORS[len(used) % len(COLORS)]


def normalize_term(text):
    """
    Canonical form of an entity value or synonym: trimmed, internal
    whitespace collapsed. Catalogue comparisons are made on the lowercase of
    this form, so 'New  Delhi ' and 'new delhi' collide.
    """
    return re.sub(r'\s+', ' ', (text or '').strip())


def validate_import_spans(text, spans):
    """
    Returns the first reason ``spans`` cannot be imported over ``text`` — an
    IOB-unsafe entity name, an out-of-bounds offset, or an overlap — or
    ``None`` when the whole record is valid. Used by ``Model._read_annotated``
    to reject a record per-line instead of aborting the request.
    """
    accepted = []
    for start, end, name in sorted(spans):
        if not name or re.search(r'\s', name):
            return f'entity name "{name}" cannot contain whitespace'
        if not 0 <= start < end <= len(text):
            return f'span [{start}, {end}) is out of bounds for text of length {len(text)}'
        for other_start, other_end, _ in accepted:
            if start < other_end and end > other_start:
                return f'span [{start}, {end}) overlaps another span in the same utterance'
        accepted.append((start, end, name))
    return None


def dataset_format(filename, default='inline'):
    """Guesses an import format from a file extension (for the New Model upload)."""
    name = (filename or '').lower()
    if name.endswith(('.json', '.jsonl')):
        return 'json'
    if name.endswith('.conll'):
        return 'conll'
    if name.endswith(('.csv', '.tsv')):
        return 'csv'
    return default


def tokenize(text):
    """
    Whitespace tokens of ``text`` with their ``[start, end)`` character
    offsets. Matches ``str.split()`` and the client's ``split(/\\s+/)``.
    """
    return [(match.group(), match.start(), match.end()) for match in TOKEN_PATTERN.finditer(text)]


def spans_to_tags(text, spans):
    """
    Converts entity spans into one IOB tag per whitespace token of ``text``.

    ``spans`` is an iterable of ``(start, end, entity)`` character-offset
    triples. A span that cuts through a token is snapped to the whole token;
    the token holding a span's start is tagged ``B-``, later tokens ``I-``.
    """
    tags = []
    for _, start, end in tokenize(text):
        tag = 'O'
        for span_start, span_end, entity in spans:
            if start < span_end and end > span_start:
                tag = ('B-' if start <= span_start else 'I-') + entity
                break
        tags.append(tag)
    return tags


def tags_to_spans(text, tags):
    """
    Merges word-level ``B-``/``I-`` runs back into ``(start, end, entity)``
    character-offset spans over ``text``. An ``I-`` without a matching open
    span starts one, so imperfect sequences still yield usable spans.
    """
    spans, current = [], None
    for (_, start, end), tag in zip(tokenize(text), tags):
        entity = tag[2:] if tag[:2] in ('B-', 'I-') else None
        if entity and tag.startswith('I-') and current and current[2] == entity:
            current[1] = end
        elif entity:
            current = [start, end, entity]
            spans.append(current)
        else:
            current = None
    return [tuple(span) for span in spans]


# --- Per-record formatting: (text, spans) <-> one line/record -----------------
# ``spans`` is always an iterable of ``(start, end, entity)`` character-offset
# triples, matching ``Utterance.spans``.

def format_inline(text, spans):
    """
    Renders ``text`` with its spans wrapped as ``{entity: value}`` markup.
    Literal tabs are normalized to spaces (one char for one char, so the
    offsets hold): a TAB in an inline line is the intent-prefix separator,
    and a tab inside the text would corrupt the round trip.
    """
    text = text.replace('\t', ' ')
    out, cursor = [], 0
    for start, end, entity in sorted(spans):
        out.append(text[cursor:start])
        out.append('{%s: %s}' % (entity, text[start:end]))
        cursor = end
    out.append(text[cursor:])
    return ''.join(out)


def parse_inline(line):
    """
    Parses one ``{entity: value}`` line into ``(text, spans)``. Braces left
    over after the markup is stripped are malformed; the caller is told via a
    raised ``ValueError`` so it can report a per-line error.
    """
    spans, text, last = [], '', 0
    for match in INLINE_PATTERN.finditer(line):
        text += line[last:match.start()]
        value = match.group(2)
        if value:
            spans.append((len(text), len(text) + len(value), match.group(1).strip()))
            text += value
        last = match.end()
    text += line[last:]
    if '{' in text or '}' in text:
        raise ValueError('unbalanced braces in inline markup')
    return text, spans


def format_conll(text, spans):
    """Renders ``text`` as ``token<TAB>tag`` lines, one whitespace token per line."""
    tags = spans_to_tags(text, spans)
    return '\n'.join('%s\t%s' % (token, tag) for (token, _, _), tag in zip(tokenize(text), tags))


def parse_conll_block(lines):
    """
    Parses a CoNLL block (``token<whitespace>…<whitespace>tag`` lines) into
    ``(text, spans)``. The tag is the last column; a missing tag is ``O``.
    Text is reconstructed by joining tokens with single spaces.
    """
    tokens, tags = [], []
    for line in lines:
        parts = line.split()
        if not parts:
            continue
        tokens.append(parts[0])
        tags.append(parts[-1] if len(parts) > 1 else 'O')
    text = ' '.join(tokens)
    return text, tags_to_spans(text, tags)


def format_json(text, spans):
    """Renders ``text`` as a ``{text, entities:[{start,end,label}]}`` JSON record."""
    return json.dumps({
        'text': text,
        'entities': [{'start': start, 'end': end, 'label': entity} for start, end, entity in sorted(spans)]
    }, ensure_ascii=False)


def parse_json_record(line):
    """
    Parses one ``{text, intent?, entities:[{start,end,label|slot}]}`` JSON line
    into ``(text, intent|None, spans)`` with ``(start, end, name)`` spans. A
    span's name is its ``slot`` / ``label`` / ``entity`` field (first present).
    The intent is optional — the importing model decides whether to require it.
    """
    record = json.loads(line)
    text = record['text']
    intent = str(record.get('intent') or '').strip() or None
    spans = []
    for span in record.get('entities', []):
        name = str(span.get('slot') or span.get('label')
                   or span.get('entity') or '').strip()
        if not name:
            raise ValueError('every span needs a "slot", "label" or "entity" name')
        spans.append((int(span['start']), int(span['end']), name))
    return text, intent, spans


# --- Intent-aware records: (text, intent, spans) <-> one line/record ----------
# The language understanding layer over the per-record formats above: each
# record additionally carries its intent — as a TAB-separated prefix inline,
# an 'intent' field in JSON, and a 'labels' column in CSV (the exact
# three-column file Training.start writes) — and each span carries its
# **slot** (the intent-scoped role, the trained IOB tag). Spans here are the
# same ``(start, end, name)`` triples as elsewhere; the slot→entity mapping
# is not carried in the interchange.

def format_inline_nlu(text, intent, spans):
    """Renders one record as ``intent<TAB>text`` with ``{name: value}`` markup."""
    return '%s\t%s' % (intent, format_inline(text, spans))


def parse_inline_record(line):
    """
    Parses one inline line into ``(text, intent|None, spans)`` with
    ``(start, end, name)`` spans. An ``intent<TAB>`` prefix is optional: with a
    TAB the (non-empty) prefix is the intent; the importing model decides
    whether to require or ignore it. Span carriers are ``{name: value}``.
    """
    intent = None
    if '\t' in line:
        prefix, _, line = line.partition('\t')
        if not prefix.strip():
            raise ValueError('the intent prefix before the TAB cannot be empty')
        intent = prefix.strip()
    text, spans = parse_inline(line)
    return text, intent, spans


def format_json_nlu(text, intent, spans):
    """Renders one record as ``{text, intent, entities:[{start,end,label}]}``."""
    return json.dumps({
        'text': text,
        'intent': intent,
        'entities': [{'start': start, 'end': end, 'label': name}
                     for start, end, name in sorted(spans)]
    }, ensure_ascii=False)


# --- Dataset-level (de)serialization ------------------------------------------


def _record(line, text=None, intent=None, spans=None, error=None):
    """One unified parse record; the single shape every format yields."""
    return {'line': line, 'text': text, 'intent': intent,
            'spans': spans or [], 'error': error}


def parse_dataset(content, fmt='inline'):
    """
    Parses a dataset file into unified records, one per source line/block::

        {'line': <1-based source line>, 'text': str, 'intent': str|None,
         'spans': [(start, end, name)], 'error': str|None}

    The same file parses to the same records whichever model type imports
    it; requiring or ignoring the intent, and what a span's name resolves
    to, is the importer's concern. Malformed lines yield a record with
    ``error`` set (and no ``text``) rather than aborting the whole file, so
    the caller can report a per-line summary.
    """
    if fmt == 'conll':
        return _parse_conll_dataset(content)
    if fmt == 'csv':
        return _parse_csv_dataset(content)

    per_line = {'inline': parse_inline_record, 'json': parse_json_record}.get(fmt)
    if per_line is None:
        raise ValueError('Unknown format: %s' % fmt)

    records = []
    for number, line in enumerate(content.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            text, intent, spans = per_line(line)
            records.append(_record(number, text=text, intent=intent, spans=spans))
        except (ValueError, KeyError, TypeError) as error:
            records.append(_record(number, error=str(error) or 'could not parse line'))
    return records


def _parse_conll_dataset(content):
    """
    Splits a CoNLL file into blank-line-separated blocks, tracking line
    numbers. CoNLL has no record-level field for an intent, so records
    carry ``intent=None`` and bare span names.
    """
    records, block, start = [], [], None

    def flush(block, start):
        text, spans = parse_conll_block(block)
        records.append(_record(start, text=text, spans=spans))

    for number, line in enumerate(content.splitlines(), start=1):
        if line.strip():
            if start is None:
                start = number
            block.append(line)
        elif block:
            flush(block, start)
            block, start = [], None
    if block:
        flush(block, start)
    return records


def _parse_csv_dataset(content):
    """
    Parses the ``tags`` CSV, the cross-type interchange shape: a
    ``text|utterances|utterance`` column, an *optional*
    ``labels|label|intent`` column, and a ``tags`` column of space-separated
    IOB where an **empty cell means all-`O`** — so the same file imports the
    same rows on a named entity recognition and a language understanding
    model. Leading ``#`` comment lines are skipped. A row whose tag count
    does not match its token count is reported per-line, not fatal.
    """
    lines = content.splitlines()
    comments = []
    while lines and lines[0].lstrip().startswith('#'):
        comments.append(lines.pop(0))

    reader = csv.DictReader(io.StringIO('\n'.join(lines)))
    fieldnames = reader.fieldnames or []
    text_column = next((name for name in CSV_TEXT_COLUMNS if name in fieldnames), None)
    intent_column = next((name for name in CSV_INTENT_COLUMNS if name in fieldnames), None)
    if text_column is None or 'tags' not in fieldnames:
        columns = ' or '.join(CSV_TEXT_COLUMNS)
        return [_record(1, error=f"CSV needs a header with a '{columns}' column and a 'tags' column")]

    records = []
    for row in reader:
        line = reader.line_num + len(comments)
        text = (row.get(text_column) or '').strip()
        if not text:
            continue
        intent = (row.get(intent_column) or '').strip() or None if intent_column else None
        tags = (row.get('tags') or '').split()
        tokens = text.split()
        if tags and len(tokens) != len(tags):
            records.append(_record(line, error=f'{len(tags)} tags for {len(tokens)} tokens'))
            continue
        spans = [(start, end, name)
                 for start, end, name in tags_to_spans(text, tags)]
        records.append(_record(line, text=text, intent=intent, spans=spans))
    return records
