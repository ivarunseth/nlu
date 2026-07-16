"""
Training-data generation from entity value catalogues.

The annotated model types (NER, NLU) expand their authored training rows
here, inside the model's preprocessing step, over the **train split only**
— the control plane ships the authored ``utterances.csv`` and the catalogue
(``entities.json``) to storage, and ``augment`` runs at train time.

Generation is **coverage-first**: per entity, its catalogued terms and its
span-bearing occurrences in the dataset are paired *cyclically* — row ``i``
substitutes term ``i mod |terms|`` into occurrence ``i mod |occurrences|``
for ``max(|terms|, |occurrences|)`` rows. So every term and every annotated
occurrence appears in the generated set at least once (and exactly once
when the counts allow); only the shorter side repeats, and it repeats
evenly. Because occurrences are cycled in dataset order, per-utterance
generated counts within an entity differ by at most one — the generated
set mirrors the distribution of the authored set instead of front-loading
whichever utterance enumerates first. Each generated row substitutes
exactly one span; other spans keep their authored surface.

Everything here is pure and deterministic *by construction* (cyclic, no
sampling): retraining a version reproduces the same expanded dataset, and
it derives only from the authored rows so it is idempotent.

A **record** is ``(text, intent|None, spans)`` with 4-tuple
``(start, end, name, entity)`` spans — the unified shape the import
pipeline uses. For named entity recognition ``entity == name``; for
language understanding ``name`` is the slot and ``entity`` its mapped
entity.

The **catalogue** maps each entity name to
``{'kind': 'open'|'closed', 'terms': [value/synonym, ...]}``. An
*open-list* entity contributes one extra UNK pseudo-term — every
whitespace token of the substituted span replaced by the UNK token,
preserving the token count and therefore the IOB pattern — teaching the
model that an unseen word in that position is still the entity.
"""
from ..utils.dataset import normalize_term, tags_to_spans, spans_to_tags

# Sentinel marking the UNK pseudo-term in an entity's term cycle; resolved
# per-span at substitution time (its width depends on the span's surface).
UNK = object()


def substitute(text, spans, replacements):
    """
    Splices ``replacements`` into ``text`` over the sorted, non-overlapping
    ``spans`` (4-tuples), recomputing every span's offsets. A replacement of
    ``None`` keeps the span's original surface. Returns
    ``(new_text, new_spans)``.
    """
    ordered = sorted(zip(spans, replacements), key=lambda pair: pair[0][0])
    out, new_spans, cursor, length = [], [], 0, 0
    for (start, end, name, entity), replacement in ordered:
        prefix = text[cursor:start]
        surface = text[start:end] if replacement is None else replacement
        out.append(prefix)
        out.append(surface)
        length += len(prefix)
        new_spans.append((length, length + len(surface), name, entity))
        length += len(surface)
        cursor = end
    out.append(text[cursor:])
    return ''.join(out), new_spans


def _entity_terms(entry):
    """
    The substitution cycle for one catalogue entry: its normalized,
    case-insensitively unique terms in catalogue order, plus the UNK
    pseudo-term when the entity is open-list.
    """
    terms, seen = [], set()
    for term in entry.get('terms') or []:
        term = normalize_term(term)
        key = term.lower()
        if not term or key in seen:
            continue
        seen.add(key)
        terms.append(term)
    if entry.get('kind') == 'open':
        terms.append(UNK)
    return terms


def _resolve_term(text, span, term, unk_token):
    """
    The surface a term substitutes into one span, or ``None`` when the
    substitution would be a no-op (the term already is the span's surface).
    The UNK pseudo-term widens to the span's token count so the IOB pattern
    is preserved.
    """
    surface = text[span[0]:span[1]]
    if term is UNK:
        return ' '.join([unk_token] * max(1, len(surface.split())))
    if normalize_term(term).lower() == normalize_term(surface).lower():
        return None
    return term


def expand(records, catalogue, unk_token='[UNK]'):
    """
    Generates augmented records from ``records`` (the base dataset, which
    is never modified and never included in the return value).

    Per catalogued entity, terms and span occurrences are paired cyclically
    into ``max(|terms|, |occurrences|)`` rows — full coverage of both sides,
    repeats only when one side is exhausted, spread evenly in dataset order.
    Rows are deduplicated on ``(intent, text)`` against the base dataset and
    each other; on a collision (or a term equal to the span's own surface)
    the cycle deterministically tries the subsequent terms so coverage of
    the occurrence survives whenever any term still yields a new row.
    """
    seen = {(intent, text) for text, intent, _ in records}
    generated = []

    # Every catalogued span occurrence, grouped by entity, in dataset order.
    occurrences = {}
    for index, (text, intent, spans) in enumerate(records):
        for span in sorted(spans):
            entity = span[3] or span[2]
            if entity in catalogue:
                occurrences.setdefault(entity, []).append((index, span))

    for entity, entity_occurrences in occurrences.items():
        terms = _entity_terms(catalogue[entity])
        if not terms:
            continue
        for i in range(max(len(terms), len(entity_occurrences))):
            index, span = entity_occurrences[i % len(entity_occurrences)]
            text, intent, spans = records[index]
            spans = sorted(spans)
            for shift in range(len(terms)):
                term = terms[(i + shift) % len(terms)]
                replacement = _resolve_term(text, span, term, unk_token)
                if replacement is None:
                    continue
                new_text, new_spans = substitute(
                    text, spans,
                    [replacement if other == span else None for other in spans],
                )
                key = (intent, new_text)
                if key in seen or not new_text.strip():
                    continue
                seen.add(key)
                generated.append((new_text, intent, new_spans))
                break

    return generated


def augment(texts, tag_strings, intents, resolve_entity, spec):
    """
    Generates augmented rows for the given (already train-split) rows.

    ``texts``/``tag_strings``/``intents`` are parallel lists — the utterance
    text, its space-separated IOB tags, and its intent (``None`` for named
    entity recognition). ``resolve_entity(intent, name)`` maps a span's
    trained name to the entity whose catalogue drives substitution — the
    identity for named entity recognition (the tag suffix *is* the entity),
    the intent-scoped slot→entity map for language understanding. ``spec`` is
    the parsed ``entities.json``: ``{enabled, unk_token, catalogue}``.

    Returns ``(gen_texts, gen_tag_strings, gen_intents)`` — the **generated**
    rows only (never the inputs), for the caller to append to the train split.
    Empty when augmentation is disabled or the catalogue is empty. Spans are
    reconstructed from the IOB tags (a lossless round trip with
    ``spans_to_tags``), so this needs only the stored files, never the DB.
    """
    if not spec or not spec.get('enabled', True):
        return [], [], []
    catalogue = spec.get('catalogue') or {}
    if not catalogue:
        return [], [], []

    records = []
    for text, tag_string, intent in zip(texts, tag_strings, intents):
        tags = tag_string.split() if isinstance(tag_string, str) else list(tag_string)
        spans = [
            (start, end, name, resolve_entity(intent, name))
            for start, end, name in tags_to_spans(text, tags)
        ]
        records.append((text, intent, spans))

    generated = expand(records, catalogue, unk_token=spec.get('unk_token', '[UNK]'))

    gen_texts, gen_tags, gen_intents = [], [], []
    for text, intent, spans in generated:
        gen_texts.append(text)
        gen_tags.append(' '.join(spans_to_tags(text, [(start, end, name) for start, end, name, _ in spans])))
        gen_intents.append(intent)
    return gen_texts, gen_tags, gen_intents
