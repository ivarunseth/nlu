# Augmentation-into-Models Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.
> This repo has **no pytest suite** (verify Python with `python -m py_compile`).
> Per the repo owner's standing preference, **do not `git commit`** — commits
> are deferred until explicitly requested. Verification per task is
> `py_compile` on changed files plus, for the pure-logic tasks, a standalone
> script under the session scratchpad that runs without TensorFlow/Redis.

**Goal:** Move NER/NLU dataset augmentation out of the control plane into the
model preprocessing step, and ship the training inputs (authored dataset, slot
map, entity catalogue) as files under `models/{id}/{version}/data/` instead of
augmenting eagerly and passing the slot map through the Celery queue.

**Architecture:** `Training.start` writes authored data (`utterances.csv`,
inline format), `slots.json`, and `entities.json` (catalogue + augment
settings) to storage. The `sage` training task downloads the whole `data/`
dir and hands its path to `model.train`. The model parses the inline CSV,
holds out the test split, then augments **only the train split** in memory
using the catalogue/slot files — deterministic and idempotent, never persisted.

**Tech Stack:** Flask + SQLAlchemy (control plane), Celery `sage` worker,
pandas, the pluggable `store`, and `server/utils/dataset.py` inline
(`format_inline`/`parse_inline`) + IOB (`spans_to_tags`/`tags_to_spans`) helpers.

## Global Constraints

- Model code (`server/models/*`) must not import the DB models or use a Flask
  app context — it runs in workers without either.
- Inline authored format: NER `{entity: value}`; NLU `{slot: value}` + a
  separate `labels` (intent) column; TC plain text.
- Augmentation is train-split-only, seeded by `random_state`, derived only from
  the authored rows (never persisted), and dedup'd — deterministic & idempotent.
- Storage paths: `models/{model_id}/{version}/data/{utterances.csv,slots.json,entities.json}`.
- `entities.json` shape: `{enabled, unk_token, max_variants, max_total, catalogue: {entity: {kind, terms}}}`.
- `slots.json` shape: `{intent: {slot: entity}}`.

---

### Task 1: Move augmentation module into `server/models`, add the glue helper

**Files:**
- Create: `server/models/augmentation.py` (moved from `server/utils/augmentation.py`)
- Delete: `server/utils/augmentation.py`
- Verify: `/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/a3eb1e23-c3e0-4a67-8eda-820d1c963ef9/scratchpad/check_augment.py`

**Interfaces:**
- Consumes: `server/utils/dataset.py` → `normalize_term`, `tags_to_spans`, `spans_to_tags`.
- Produces (relied on by Task 2):
  - `expand(records, catalogue, unk_token='[UNK]', max_variants=20, max_total=5000, seed=42) -> list[(text, intent, spans4)]` (unchanged).
  - `augment(texts, tag_strings, intents, resolve_entity, spec) -> (list[str], list[str], list)` where
    `resolve_entity(intent, name) -> entity|None`, `spec` is the parsed
    `entities.json` dict, and the three returned lists are the **generated**
    rows only (texts, space-joined IOB tag strings, intents) — caller appends
    them to the train split. Returns empty lists when `spec['enabled']` is
    false or the catalogue is empty.

- [ ] **Step 1:** `git mv server/utils/augmentation.py server/models/augmentation.py`; change its import to `from ..utils.dataset import normalize_term`. Update the module docstring's `server/augmentation.py` references.

- [ ] **Step 2:** Append the `augment` glue helper. It reconstructs spans from
  the IOB tag strings, resolves each span's entity, calls `expand`, and
  converts generated records back to tag strings:

```python
from ..utils.dataset import tags_to_spans, spans_to_tags

def augment(texts, tag_strings, intents, resolve_entity, spec):
    """Generate augmented rows for the given (already train-split) rows.

    ``resolve_entity(intent, name)`` maps a span's trained name to its entity
    (identity for NER, the slot→entity map for NLU). ``spec`` is the parsed
    ``entities.json``. Returns (gen_texts, gen_tag_strings, gen_intents) — the
    generated rows only. Deterministic (seeded) and idempotent (derives only
    from the passed authored rows, dedup'd inside ``expand``)."""
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
    generated = expand(
        records, catalogue,
        unk_token=spec.get('unk_token', '[UNK]'),
        max_variants=spec.get('max_variants', 20),
        max_total=spec.get('max_total', 5000),
        seed=spec.get('seed', 42),
    )
    gen_texts, gen_tags, gen_intents = [], [], []
    for text, intent, spans in generated:
        gen_texts.append(text)
        gen_tags.append(' '.join(spans_to_tags(text, [(s, e, n) for s, e, n, _ in spans])))
        gen_intents.append(intent)
    return gen_texts, gen_tags, gen_intents
```

Note `expand`'s `seed` comes from `spec['seed']` here (Task 3 writes it into
`entities.json`), keeping determinism self-contained in the file.

- [ ] **Step 3:** Write `check_augment.py` in the scratchpad: build a tiny
  catalogue `{'date': {'list_type': 'open', 'terms': ['tomorrow', 'monday']}}`,
  call `augment(['book for today'], ['O O B-date'], [None], lambda i, n: n, spec)`,
  assert (a) non-empty output, (b) calling it twice yields identical output
  (determinism), (c) the base row is not in the output (idempotency/dedup), and
  (d) an NLU-style resolver `lambda i, n: {'get_weather': {'date': 'day'}}[i][n]`
  with catalogue keyed by `'day'` produces substitutions.

- [ ] **Step 4:** Run `python -m py_compile server/models/augmentation.py` and
  `python <scratchpad>/check_augment.py`. Expected: compile OK; all asserts pass.

- [ ] **Step 5:** `grep -rn "utils.augmentation\|utils import augmentation" server | grep -v __pycache__` — expect no hits except the ones Task 3 will remove. (Do not commit.)

---

### Task 2: Model preprocessing — inline `load_data` + train-split-only augmentation

**Files:**
- Modify: `server/models/base.py` (`load_data` directory resolution)
- Modify: `server/models/named_entity_recognition/base.py` (`load_data`, `train`)
- Modify: `server/models/natural_language_understanding/base.py` (`load_data`, `train`)
- Modify: `server/models/text_classification/base.py` (`load_data` reads `data/utterances.csv`)
- Verify: `<scratchpad>/check_load_data.py`

**Interfaces:**
- Consumes: `augmentation.augment` (Task 1); `dataset.parse_inline`,
  `dataset.spans_to_tags`; `BaseModel._read_json`.
- Produces (relied on by Task 4): `model.train(data=<data_dir>, random_state=..., ...)`
  where `<data_dir>` contains `utterances.csv` (+ `slots.json`/`entities.json`).

- [ ] **Step 1 — BaseModel.load_data:** resolve a directory argument:

```python
def load_data(self, data):
    if isinstance(data, pd.DataFrame):
        return data
    if isinstance(data, str) and os.path.isdir(data):
        data = os.path.join(data, 'utterances.csv')
    return pd.read_csv(data)
```

- [ ] **Step 2 — a shared inline reader** on `BaseModel` (used by NER/NLU),
  keeping the DataFrame/dir resolution in one place:

```python
def _read_inline(self, data):
    """Parse the inline utterances.csv into rows of (text, spans, intent|None).
    spans are (start, end, name) triples; intent from the 'labels' column when present."""
    from ..utils.dataset import parse_inline
    frame = data if isinstance(data, pd.DataFrame) else self.load_data(data)
    intents = frame['labels'].tolist() if 'labels' in frame.columns else [None] * len(frame)
    rows = []
    for cell, intent in zip(frame['utterances'].tolist(), intents):
        text, spans = parse_inline('' if cell is None else str(cell))
        rows.append((text, spans, (str(intent) if intent is not None else None)))
    return rows
```

- [ ] **Step 3 — NER `load_data`:** parse inline into `(X, y)` with `y` as tag strings:

```python
def load_data(self, data):
    rows = self._read_inline(data)
    X = [text for text, _, _ in rows]
    y = [' '.join(spans_to_tags(text, spans)) for text, spans, _ in rows]
    return X, y
```
(import `spans_to_tags` from `...utils.dataset`.)

- [ ] **Step 4 — NER `train`:** keep the existing structure; after
  `self.X_train/self.y_train` are set (post-split), augment the train split:

```python
from ..augmentation import augment
spec = self._read_json(os.path.join(data, 'entities.json'), {}) if isinstance(data, str) and os.path.isdir(data) else {}
gen_x, gen_y, _ = augment(self.X_train, self.y_train, [None] * len(self.X_train),
                          lambda intent, name: name, spec)
self.X_train = list(self.X_train) + gen_x
self.y_train = list(self.y_train) + gen_y
X, y = self.X_train, self.y_train
```
Insert this immediately after the `self.X_train, self.y_train = X_train, y_train`
/ `self.X_test, self.y_test = X_test, y_test` lines and before `preprocess_y`.
`import os` at top.

- [ ] **Step 5 — NLU `load_data`:** parse inline with intent:

```python
def load_data(self, data):
    rows = self._read_inline(data)
    X = [text for text, _, _ in rows]
    y = [(intent, ' '.join(spans_to_tags(text, spans))) for text, spans, intent in rows]
    return X, y
```

- [ ] **Step 6 — NLU `train`:** replace `self.slots = kwargs.pop('slots', None) or self.slots`
  with a read from `slots.json`, and augment the train split resolving entity via `self.slots`:

```python
if isinstance(data, str) and os.path.isdir(data):
    self.slots = self._read_json(os.path.join(data, 'slots.json'), None) or self.slots
    spec = self._read_json(os.path.join(data, 'entities.json'), {})
else:
    spec = {}
```
After the split assignment lines:
```python
from ..augmentation import augment
intents_train = [intent for intent, _ in self.y_train]
tags_train = [tags for _, tags in self.y_train]

def _entity(intent, slot):
    return (self.slots or {}).get(intent, {}).get(slot)

gen_x, gen_tags, gen_intents = augment(self.X_train, tags_train, intents_train, _entity, spec)
self.X_train = list(self.X_train) + gen_x
self.y_train = list(self.y_train) + list(zip(gen_intents, gen_tags))
X, y = self.X_train, self.y_train
```
(NLU `train` still `kwargs.pop('slots', None)` defensively removed — no longer sent, but pop-with-default keeps it inert if present.)

- [ ] **Step 7 — TC `load_data`:** ensure it reads `data/utterances.csv` via the
  base dir resolution (it has no spans). Confirm the current body calls
  `super().load_data(data)` then reads `utterances`/`labels`; if it reads a raw
  path, route it through `super().load_data(data)` so the dir resolution applies.

- [ ] **Step 8 — check_load_data.py:** write a synthetic `data/` dir
  (`utterances.csv` NER `what is the weather {date: today}`; a second NLU dir
  with `utterances,labels` + `slots.json` + `entities.json`), then:
  instantiate the base classes' `load_data` (no build/fit needed) and assert the
  parsed `(X, y)` shapes/values; call the NER/NLU train-split augment glue in
  isolation and assert generated rows carry valid tag strings the same length as
  their token counts. (No TensorFlow needed — only `load_data` + `augment`.)

- [ ] **Step 9:** `python -m py_compile` on the four modified model files;
  `python <scratchpad>/check_load_data.py`. Expected: compile OK, asserts pass.

---

### Task 3: Control plane — write the `data/` files, stop augmenting, drop `slots` kwarg

**Files:**
- Modify: `server/database/training.py` (`Training.start`; remove
  `_augmented_records`, `_record_tags`; simplify/remove `_dataset_records`)

**Interfaces:**
- Consumes: `Utterance.spans` / `.intent`, `model.entities` / `Value.terms()` /
  `Entity.list_type`, `model.slots` (`Slot.name`/`.intent.name`/`.entity.name`),
  `dataset.format_inline`, `store.put`, `current_app.config['AUGMENT_*']`.
- Produces (relied on by Task 4/2): the three `data/` files at
  `models/{path}/data/`.

- [ ] **Step 1:** Add a helper that writes one file to `models/{path}/data/<name>`:

```python
def _put_data(self, name, data):
    buffer = io.BytesIO(data.encode('utf-8')) if isinstance(data, str) else data
    store.put(bucket=current_app.config['STORAGE_BUCKET'],
              object_name=f'models/{self.path}/data/{name}', data=buffer)
```

- [ ] **Step 2:** Rewrite `start()` per model kind to write inline
  `utterances.csv` (use `csv` module for quoting; `format_inline(text, utterance.spans)`),
  plus `slots.json` (NLU) and `entities.json` (NER/NLU). Resolve `enabled` from
  `kwargs.pop('augment', None)` over `AUGMENT_ENABLED`; put `unk_token`,
  `max_variants`, `max_total`, `seed=kwargs.get('random_state', 42)`, and the
  catalogue into `entities.json`. Remove the `kwargs = {**kwargs, 'slots': ...}` line.
  The Celery enqueue (`training.train.apply_async(args=(self.path, self.model.kind), kwargs=kwargs, ...)`)
  is unchanged except `kwargs` no longer carries `slots`.

- [ ] **Step 3:** Build the catalogue directly from the DB (not from records):

```python
catalogue = {}
for entity in self.model.entities.all():
    terms = []
    for value in entity.values.all():
        terms.extend(value.terms())
    catalogue[entity.name] = {'list_type': entity.list_type or 'open', 'terms': terms}
```
and the slot map:
```python
slot_map = {}
for slot in self.model.slots.all():
    slot_map.setdefault(slot.intent.name, {})[slot.name] = slot.entity.name
```

- [ ] **Step 4:** Delete `_augmented_records`, `_record_tags`, and `_dataset_records`
  (its only callers were the augmentation lines being removed). Remove the
  `from ..utils import augmentation` import.

- [ ] **Step 5:** `python -m py_compile server/database/training.py`, and a
  scratchpad check that feeds a couple of fake `(text, spans, intent)` rows
  through `format_inline` + `parse_inline` and confirms a lossless round trip
  (guards the inline write path without needing the DB/app).

---

### Task 4: Training task — download the `data/` dir, pass it + `random_state`

**Files:**
- Modify: `server/tasks/training.py`

- [ ] **Step 1:** Replace the single-file fetch with a directory fetch:

```python
data_dir = os.path.join(directory, 'data')
store.fget_dir(bucket, f'models/{path}/data', data_dir)
```

- [ ] **Step 2:** Pass the dir + forward `random_state` to `model.train`:

```python
history = model.train(
    data=data_dir,
    test_split=test_split, validation_split=validation_split,
    epochs=epochs, batch_size=batch_size, early_stopping=early_stopping,
    monitor=monitor, patience=patience, callbacks=callbacks,
    random_state=random_state, **kwargs,
)
```
The final `store.fput_dir(bucket, f'models/{path}', directory)` is unchanged —
`directory` now contains `data/` as a subfolder, so it is preserved on re-upload.

- [ ] **Step 3:** `python -m py_compile server/tasks/training.py`.

---

### Task 5: Readers — training-data download & coverage analytics

**Files:**
- Modify: `server/views/api/trainings.py` (`get_training_data`)
- Modify: `server/views/api/analytics.py` (`get_coverage_analytics`)

- [ ] **Step 1 — get_training_data:** change the object name to
  `f'models/{training.path}/data/utterances.csv'`; keep `mimetype='text/csv'`.

- [ ] **Step 2 — get_coverage_analytics:** read
  `f'models/{training.path}/data/utterances.csv'` and parse the **inline** file
  into the comparable tuples instead of reading `frame.iloc[:, i]` columns:

```python
from ...utils.dataset import parse_inline, spans_to_tags
frame = pd.read_csv(data)
labels = frame['labels'].tolist() if 'labels' in frame.columns else [None] * len(frame)
snapshot_rows = []
for cell, label in zip(frame['utterances'].tolist(), labels):
    text, spans = parse_inline('' if cell is None else str(cell))
    tag_string = ' '.join(spans_to_tags(text, spans))
    snapshot_rows.append((text, str(label) if label is not None else None, tag_string))
```
Then build `snapshot` as `Counter((t, tag) ...)` for NER/TC or
`Counter((t, intent, tag) ...)` for NLU, matching the existing `current`
tuples. (TC snapshot: `(text, intent)` — for TC there are no tags; read the
`labels` column as the intent and keep the current `(text, name)` comparison.)

- [ ] **Step 3:** `python -m py_compile server/views/api/trainings.py server/views/api/analytics.py`.

---

## Self-Review

- **Spec coverage:** issue 1 (augmentation → models) = Tasks 1–3; issue 2
  (slots + `data/` folder) = Tasks 3–4; inline authored format = Tasks 2–3, 5;
  train-split-only = Task 2; readers = Task 5. No spec section unmapped.
- **Type consistency:** `augment(...)` signature identical in Task 1 (def) and
  Task 2 (calls); `spec`/`catalogue`/`slots` shapes match the Global Constraints;
  `_read_inline`/`_read_json`/`_put_data` names consistent across tasks.
- **Placeholders:** none — Step 7 (TC) is a conditional confirm-or-route, stated
  concretely; Step 8/5 checks specify exact assertions.

## Final verification (after all tasks)

- `python -m py_compile` across every changed file in one command.
- `python -m py_compile` the whole `server/` tree to catch stragglers.
- Run both scratchpad checks. Do **not** commit; report results and hand back.
