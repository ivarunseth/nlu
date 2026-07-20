# Class Weighting (Text Classification) / Sample Weighting (NER, NLU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every model type in `server/models` weights training by class frequency — text classification via Keras' native `class_weight`, NER and NLU via per-position `sample_weight` arrays — using the shared (currently unused) helpers already defined on `BaseModel`, consolidating three separate ad-hoc implementations and fixing a real `NaN`-sample-weight bug found in NER's transformer architecture along the way.

**Architecture:** `BaseModel._compute_class_weights` / `_compute_sample_weights` (`server/models/base.py`) become the single source of truth for weight computation across all three model types. Text classification keeps passing a `class_weight` dict to `model.fit` (single output, natively supported by Keras). NER and NLU convert class weights into per-position `sample_weight` arrays instead (Keras does not support `class_weight` for sequence outputs or multi-output models at all), masking `-100`-padded positions to weight `0`. NER's two architectures are brought onto a single `-100` padding convention so the masking is consistent, and the masked loss/metric (`NonPaddingLoss`/`NonPaddingAccuracy`) — currently duplicated between the NER and NLU packages — is extracted into one shared `server/models/masking.py` that both packages re-export.

**Tech Stack:** Python, TensorFlow/Keras, scikit-learn (`compute_class_weight`), pandas, NumPy.

## Global Constraints

- No test framework exists in this repo (`pytest` is not installed, no `tests/` directory) — per `CLAUDE.md`, verify Python changes with `python -m py_compile`; there is no pytest suite to add tests to. Each task below instead uses a throwaway, uncommitted verification script (matching the pattern used in `docs/superpowers/specs/2026-07-16-auto-catalogue-values-design.md`'s testing section) run with the project's venv interpreter: `./venv/bin/python3`.
- Run all commands from the repo root (`/Users/varunseth/Documents/git/indic-nlu`). **Every script run (not `py_compile`) needs `PYTHONPATH=.` set** — running `./venv/bin/python3 /tmp/some_script.py` by absolute path puts the script's own directory on `sys.path[0]`, not the cwd, so `import server` fails with `ModuleNotFoundError` even when your shell's cwd is the repo root. Confirmed empirically while writing this plan. `py_compile` doesn't execute imports, so it doesn't need this.
- Do not add a configuration toggle for weighting — it stays hardcoded on, matching the existing (pre-refactor) convention in `text_classification/base.py` and `named_entity_recognition/base.py`.
- **Do not run `git commit` without the user's explicit go-ahead at that point in the session**, even though each task below ends with a "Commit" step — per this user's standing preference, stage the change and show what would be committed, then wait for explicit confirmation before actually committing.
- Design reference: `docs/superpowers/specs/2026-07-17-class-and-sample-weighting-design.md`.

---

### Task 1: Consolidate text classification's class weights onto `BaseModel._compute_class_weights`

**Files:**
- Modify: `server/models/text_classification/base.py`
- Verify: temporary script, e.g. `/tmp/verify_task1.py` (not committed)

**Interfaces:**
- Consumes: `BaseModel._compute_class_weights(labels) -> dict[int, float]` — already implemented at `server/models/base.py:363-388`, taking a 1-D array-like of integer class ids and returning `{class_id: weight}` via sklearn's `"balanced"` scheme. Not being modified by this task.
- Produces: no change to any downstream consumer — `class_weight` is still a local `dict` passed straight into `model.fit(..., class_weight=class_weight)` in the same method.

- [ ] **Step 1: Write the verification script**

Create `/tmp/verify_task1.py`:

```python
import numpy as np
import pandas as pd

from server.models.text_classification.base import BaseTextClassification


class _FakeKerasModel:
    def __init__(self):
        self.fit_calls = []

    def fit(self, X, y, **kwargs):
        self.fit_calls.append(kwargs)

        class _History:
            history = {'loss': [0.0]}

        return _History()


class FakeTC(BaseTextClassification):
    def __init__(self):
        super().__init__()
        self.architecture = 'fake'

    def preprocess_x(self, X):
        return np.arange(len(X), dtype=np.int32).reshape(-1, 1)

    def build(self, num_classes, **kwargs):
        return _FakeKerasModel()


# 20 'x' rows, 5 'y' rows: 'y' (label id 1, since sorted(['x','y']) == ['x','y'])
# is the minority class and must get the larger balanced weight.
df = pd.DataFrame({
    'utterances': [f'text {i}' for i in range(25)],
    'labels': ['x'] * 20 + ['y'] * 5,
})

tc = FakeTC()
tc.train(df, epochs=1, batch_size=4, test_split=0.2, validation_split=0.0, early_stopping=False)

class_weight = tc.model.fit_calls[0]['class_weight']
print('class_weight:', class_weight)
assert set(class_weight.keys()) == {0, 1}, class_weight
assert class_weight[1] > class_weight[0], 'minority class (y=1) must get a larger weight'
print('OK')
```

- [ ] **Step 2: Run it against the current code to confirm it passes as a baseline**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task1.py`
Expected: prints `class_weight: {...}` then `OK` (the existing inline implementation already computes this correctly — this step just proves the fake-model harness itself works before you refactor).

- [ ] **Step 3: Replace the inline computation with the shared helper**

In `server/models/text_classification/base.py`, remove the now-unused import (around line 5):

```python
from sklearn.utils.class_weight import compute_class_weight
```

Then replace this block (around lines 70-80):

```python
        y_encoded = self.preprocess_y(y)

        classes = np.unique(y_encoded)
        
        class_weights = compute_class_weight(
            class_weight="balanced",
            classes=classes,
            y=y_encoded
        )
        
        class_weight = dict(zip(classes, class_weights))
```

with:

```python
        y_encoded = self.preprocess_y(y)

        class_weight = self._compute_class_weights(y_encoded)
```

- [ ] **Step 4: Re-run the verification script to confirm no regression**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task1.py`
Expected: same output as Step 2 — `class_weight: {...}` then `OK`.

- [ ] **Step 5: `py_compile` check**

Run: `./venv/bin/python3 -m py_compile server/models/text_classification/base.py`
Expected: exits with no output (success).

- [ ] **Step 6: Stage and prepare the commit (hold for explicit approval per Global Constraints)**

```bash
git add server/models/text_classification/base.py
git status
```

Then show the user the staged diff and wait for explicit confirmation before running `git commit`.

---

### Task 2: Consolidate NER's sample-weight computation and fix the `NaN`-weight bug

**Files:**
- Modify: `server/models/named_entity_recognition/base.py`
- Verify: temporary script, e.g. `/tmp/verify_task2.py` (not committed)

**Interfaces:**
- Consumes: `BaseModel._compute_class_weights(labels) -> dict[int, float]` and `BaseModel._compute_sample_weights(labels, class_weights, ignore_value=None) -> np.ndarray` (same shape as `labels`) — both already implemented at `server/models/base.py:363-433`. Not being modified by this task.
- Produces: `sample_weight` array (shape matching `y_aligned`) passed to `model.fit(..., sample_weight=sample_weight)` in the same method. Task 4 (RNN padding fix) relies on this task already masking `ignore_value=-100` correctly.

- [ ] **Step 1: Write the verification script that reproduces the current bug**

Create `/tmp/verify_task2.py`. This uses a fake NER subclass so the test exercises `BaseNamedEntityRecognition.train()`'s shared logic directly, without needing a real (network-dependent) tokenizer — the `-100` padding it injects mimics exactly what the transformer architecture already does in `tokenize_and_align`:

```python
import numpy as np
import pandas as pd

from server.models.named_entity_recognition.base import BaseNamedEntityRecognition


class _FakeKerasModel:
    def __init__(self):
        self.fit_calls = []

    def fit(self, X, y, **kwargs):
        self.fit_calls.append({'y': y, **kwargs})

        class _History:
            history = {'loss': [0.0]}

        return _History()


class FakeNER(BaseNamedEntityRecognition):
    """Stubs the architecture-specific seams so train()'s shared logic runs
    without a real tokenizer/model, injecting -100 padding like the
    transformer architecture does."""

    SEQ_LEN = 4

    def __init__(self):
        super().__init__()
        self.architecture = 'fake'

    def preprocess_x(self, X):
        return np.arange(len(X), dtype=np.int32).reshape(-1, 1)

    def tokenize_and_align(self, X, y):
        aligned = []
        for labels in y:
            labels = list(labels[:self.SEQ_LEN])
            labels += [-100] * (self.SEQ_LEN - len(labels))
            aligned.append(labels)
        return self.preprocess_x(X), np.array(aligned, dtype=np.int32)

    def build(self, num_classes, **kwargs):
        return _FakeKerasModel()


# Every utterance is shorter than SEQ_LEN=4 tokens, so every train row is
# guaranteed to carry at least one -100 padded position regardless of which
# rows the (randomized) train/test split picks.
df = pd.DataFrame({'utterances': [
    'flight to {city: Delhi}',
    'flight to {city: Mumbai}',
    'cancel order',
    'cancel {city: Chennai} order',
]})

ner = FakeNER()
ner.train(df, epochs=1, batch_size=2, test_split=0.25, validation_split=0.0, early_stopping=False)

y_aligned = ner.model.fit_calls[0]['y']
sample_weight = ner.model.fit_calls[0]['sample_weight']
print('y_aligned:\n', y_aligned)
print('sample_weight:\n', sample_weight)
assert (y_aligned == -100).any(), 'test setup must produce at least one padded (-100) position'
assert not np.isnan(sample_weight).any(), 'sample_weight must never contain NaN'
assert (sample_weight[y_aligned == -100] == 0).all(), 'padded positions must get weight 0'
assert (sample_weight[y_aligned != -100] > 0).all(), 'real positions must get a positive weight'
print('OK')
```

Note: this installation's scikit-learn (1.9.0, confirmed via `./venv/bin/python3 -c "import sklearn; print(sklearn.__version__)"`) rejects `test_size=0.0` outright (`InvalidParameterError`, a `ValueError` subclass — it doesn't fall through `BaseModel._train_test_split`'s except-and-retry-without-stratify path since the retry call keeps the same invalid `test_size`), so `test_split=0.25` is used here rather than `0.0`.

- [ ] **Step 2: Run it to confirm it currently fails**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task2.py`
Expected (confirmed empirically while writing this plan): prints `y_aligned` and `sample_weight` arrays — the latter showing `nan` at every position where `y_aligned` is `-100` — then `AssertionError: sample_weight must never contain NaN`. This reproduces the bug described in the design doc.

- [ ] **Step 3: Fix `named_entity_recognition/base.py`**

Remove the now-unused import (around line 7):

```python
from sklearn.utils.class_weight import compute_class_weight
```

Replace this block (around lines 210-226):

```python
        y_encoded = self.preprocess_y(y)
        X_processed, y_aligned = self.tokenize_and_align(X, y_encoded)


        flat_labels = np.concatenate([np.asarray(seq) for seq in y_encoded])

        classes = np.unique(flat_labels)

        weights = compute_class_weight(
            class_weight="balanced",
            classes=classes,
            y=flat_labels,
        )

        class_weight = dict(zip(classes, weights))

        sample_weight = np.vectorize(class_weight.get)(y_aligned).astype(np.float32)
        
        num_classes = len(self.labels)
```

with:

```python
        y_encoded = self.preprocess_y(y)
        X_processed, y_aligned = self.tokenize_and_align(X, y_encoded)

        flat_labels = np.concatenate([np.asarray(seq) for seq in y_encoded])
        class_weights = self._compute_class_weights(flat_labels)
        sample_weight = self._compute_sample_weights(y_aligned, class_weights, ignore_value=-100)

        num_classes = len(self.labels)
```

- [ ] **Step 4: Re-run the verification script to confirm the fix**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task2.py`
Expected (confirmed empirically while writing this plan): prints `sample_weight` with `0.0` at every `-100` position in `y_aligned` and finite positive weights everywhere else, then `OK`.

- [ ] **Step 5: `py_compile` check**

Run: `./venv/bin/python3 -m py_compile server/models/named_entity_recognition/base.py`
Expected: exits with no output.

- [ ] **Step 6: Stage and prepare the commit (hold for explicit approval)**

```bash
git add server/models/named_entity_recognition/base.py
git status
```

Show the staged diff to the user and wait for explicit confirmation before `git commit`.

---

### Task 3: Extract `NonPaddingLoss`/`NonPaddingAccuracy` into a shared `server/models/masking.py`

**Files:**
- Create: `server/models/masking.py`
- Modify: `server/models/named_entity_recognition/__init__.py`
- Modify: `server/models/named_entity_recognition/transformer.py`
- Modify: `server/models/natural_language_understanding/__init__.py`
- Verify: temporary script, e.g. `/tmp/verify_task3.py` (not committed)

**Context:** these two classes currently exist as **two byte-identical copies** — a `NonPaddingLoss` + `NonPaddingAccuracy` pair defined in `natural_language_understanding/__init__.py`, and a lone `NonPaddingLoss` defined locally in `named_entity_recognition/transformer.py`. This task collapses both into one shared module (the user chose this over mirroring a third copy into the NER package). Four modules import these classes today, all via the intra-package form `from . import NonPaddingLoss, NonPaddingAccuracy`: `named_entity_recognition/transformer.py`, `natural_language_understanding/transformer.py`, `natural_language_understanding/deep_neural_network.py`, and (after Task 4) `named_entity_recognition/recurrent_neural_network.py`. Each package's `__init__.py` will re-export from the shared module so that intra-package form keeps working unchanged.

**Interfaces:**
- Produces: `server.models.masking.NonPaddingLoss` and `server.models.masking.NonPaddingAccuracy` — the single definition of the masked sparse-categorical loss / token-accuracy metric, shared by both the NER and NLU packages. Task 4 imports both via the NER package's re-export (`from . import NonPaddingLoss, NonPaddingAccuracy`).

- [ ] **Step 1: Write the verification script**

Create `/tmp/verify_task3.py`:

```python
import numpy as np
import tensorflow as tf

from server.models import masking
from server.models.named_entity_recognition import NonPaddingLoss, NonPaddingAccuracy
import server.models.named_entity_recognition.transformer as ner_transformer
import server.models.natural_language_understanding as nlu_pkg
import server.models.natural_language_understanding.deep_neural_network as nlu_dnn

# 1. Single source of truth: every package/module exposes the SAME class
#    objects as the shared masking module (no duplicate definitions anywhere).
assert NonPaddingLoss is masking.NonPaddingLoss
assert NonPaddingAccuracy is masking.NonPaddingAccuracy
assert ner_transformer.NonPaddingLoss is masking.NonPaddingLoss
assert ner_transformer.NonPaddingAccuracy is masking.NonPaddingAccuracy
assert nlu_pkg.NonPaddingLoss is masking.NonPaddingLoss
assert nlu_pkg.NonPaddingAccuracy is masking.NonPaddingAccuracy
assert nlu_dnn.NonPaddingLoss is masking.NonPaddingLoss
assert nlu_dnn.NonPaddingAccuracy is masking.NonPaddingAccuracy

# 2. Functional: masking behaves correctly on a tiny synthetic batch.
# y_true: 2 sequences x 4 positions; -100 marks padding/sub-word positions.
y_true = tf.constant([[0, 1, -100, -100], [1, 1, 0, -100]], dtype=tf.int32)
y_pred = tf.constant([
    [[0.9, 0.1], [0.1, 0.9], [0.5, 0.5], [0.5, 0.5]],
    [[0.2, 0.8], [0.1, 0.9], [0.3, 0.7], [0.5, 0.5]],
], dtype=tf.float32)

loss_fn = NonPaddingLoss()
loss_value = float(loss_fn(y_true, y_pred))
assert np.isfinite(loss_value), loss_value
print('loss:', loss_value)

metric = NonPaddingAccuracy()
metric.update_state(y_true, y_pred)
accuracy = float(metric.result())
# 5 real (non -100) positions: [0,0],[0,1],[1,0],[1,1] correct, [1,2] wrong (true=0, pred argmax=1) -> 4/5
assert abs(accuracy - 0.8) < 1e-6, accuracy
print('accuracy:', accuracy)

print('OK')
```

- [ ] **Step 2: Run it against the current code to confirm it fails**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task3.py`
Expected: `ModuleNotFoundError: No module named 'server.models.masking'` (the shared module doesn't exist yet). This confirms the script fails before the `OK` for the right reason.

- [ ] **Step 3: Create `server/models/masking.py`**

Create the file with exactly this content:

```python
import tensorflow as tf


class NonPaddingLoss(tf.keras.losses.Loss):
    """
    Sparse categorical cross-entropy for a sequence-labelling head (NER tags
    or NLU slots) that ignores padded / sub-word positions.

    Aligned labels use ``-100`` for special tokens, every non-initial sub-word,
    and (for architectures without sub-word tokenization) sequence padding —
    see each architecture's ``tokenize_and_align``. Those positions are masked
    out so they contribute nothing to the loss, and the remaining per-token
    losses are averaged over the real tokens only. Without this, plain
    ``sparse_categorical_crossentropy`` treats ``-100`` as a class index and
    fails ("label value of -100 outside the valid range").
    """

    def __init__(self, name='non_padding_loss'):
        super().__init__(name=name)

    def call(self, y_true, y_pred):
        loss_fn = tf.keras.losses.SparseCategoricalCrossentropy(
            from_logits=False, reduction=tf.keras.losses.Reduction.NONE
        )
        y_true = tf.cast(y_true, tf.int32)
        mask = tf.cast(y_true >= 0, y_pred.dtype)
        # relu() maps the ignored -100 labels to a valid class index; the mask
        # then zeroes their contribution before the loss is reduced.
        per_token = loss_fn(tf.nn.relu(y_true), y_pred) * mask
        return tf.reduce_sum(per_token) / tf.maximum(tf.reduce_sum(mask), 1.0)


class NonPaddingAccuracy(tf.keras.metrics.Metric):
    """
    Token accuracy for a sequence-labelling head (NER tags or NLU slots) that
    ignores the ``-100`` padded / sub-word positions, mirroring
    :class:`NonPaddingLoss` so the reported accuracy reflects only the real
    tokens (otherwise the padding, which dominates a max-length sequence, would
    swamp the number).
    """

    def __init__(self, name='accuracy', **kwargs):
        super().__init__(name=name, **kwargs)
        self.correct = self.add_weight(name='correct', initializer='zeros')
        self.total = self.add_weight(name='total', initializer='zeros')

    def update_state(self, y_true, y_pred, sample_weight=None):
        y_true = tf.cast(tf.reshape(y_true, [-1]), tf.int32)
        y_pred = tf.cast(tf.reshape(tf.argmax(y_pred, axis=-1), [-1]), tf.int32)
        mask = tf.cast(y_true >= 0, tf.float32)
        matches = tf.cast(tf.equal(y_true, y_pred), tf.float32) * mask
        self.correct.assign_add(tf.reduce_sum(matches))
        self.total.assign_add(tf.reduce_sum(mask))

    def result(self):
        return tf.math.divide_no_nan(self.correct, self.total)

    def reset_state(self):
        self.correct.assign(0.0)
        self.total.assign(0.0)
```

- [ ] **Step 4: Route the NER package through the shared module — `named_entity_recognition/__init__.py`**

Replace the entire contents of `server/models/named_entity_recognition/__init__.py` with:

```python
from ..masking import NonPaddingLoss, NonPaddingAccuracy

from .base import BaseNamedEntityRecognition
from .recurrent_neural_network import RNNNamedEntityRecognition
from .transformer import BERTNamedEntityRecognition

class NamedEntityRecognition:
    """
    Factory class for Named Entity Recognition models.
    """
    _architectures = {
        'base': BaseNamedEntityRecognition,
        'recurrent_neural_network': RNNNamedEntityRecognition,
        'transformer': BERTNamedEntityRecognition
    }

    @staticmethod
    def _get_architecture_class(architecture):
        """
        Returns the architecture class for the specified architecture.
        """
        architecture_class = NamedEntityRecognition._architectures.get(str(architecture).lower())
        if not architecture_class:
            raise ValueError(f"Unknown Named Entity Recognition model: {architecture}. "
                             f"Available: {list(NamedEntityRecognition._architectures.keys())}")
        return architecture_class

    @staticmethod
    def create(architecture='base'):
        """
        Creates an instance of the specified model.
        """
        return NamedEntityRecognition._get_architecture_class(architecture)()

    @staticmethod
    def load(path, **kwargs):
        """
        Loads a model from a path by determining its architecture from parameters.json.
        """
        architecture = BaseNamedEntityRecognition._get_architecture_type(path)
        return NamedEntityRecognition._get_architecture_class(architecture).load(path, **kwargs)
```

(The `from ..masking import ...` line must stay *before* the `from .base import ...` / `from .recurrent_neural_network import ...` / `from .transformer import ...` lines — those submodules do `from . import NonPaddingLoss, NonPaddingAccuracy`, so the names must already be bound in this package's namespace when they import. `server.models.masking` imports only tensorflow, so importing it while `server.models` is still initializing is safe. This mirrors the existing ordering discipline in `natural_language_understanding/__init__.py`.)

- [ ] **Step 5: Update `named_entity_recognition/transformer.py` to use the shared classes**

Replace the top of the file (the imports through the end of the local `NonPaddingLoss` class, roughly lines 1-39):

```python
import numpy as np
import tensorflow as tf
from transformers import AutoConfig, AutoTokenizer, TFAutoModelForTokenClassification as AutoModel, create_optimizer
from .base import BaseNamedEntityRecognition

PRETRAINED_MODELS = [
    'distilbert/distilbert-base-uncased',
    'distilbert-base-uncased',
    'bert-base-uncased',
    'bert-base-multilingual-cased',
    'ai4bharat/indic-bert',
    'google/muril-base-cased'
]


class NonPaddingLoss(tf.keras.losses.Loss):
    """
    Sparse categorical cross-entropy that ignores padded / sub-word positions.

    Aligned labels use ``-100`` for special tokens and every non-initial
    sub-word (see :meth:`BERTNamedEntityRecognition.tokenize_and_align`). Those
    positions are masked out so they contribute nothing to the loss, and the
    remaining per-token losses are averaged over the real tokens only.
    """

    def __init__(self, name='non_padding_loss'):
        super().__init__(name=name)

    def call(self, y_true, y_pred):
        loss_fn = tf.keras.losses.SparseCategoricalCrossentropy(
            from_logits=False, reduction=tf.keras.losses.Reduction.NONE
        )
        y_true = tf.cast(y_true, tf.int32)
        mask = tf.cast(y_true >= 0, y_pred.dtype)
        # relu() maps the ignored -100 labels to a valid class index; the mask
        # then zeroes their contribution before the loss is reduced.
        per_token = loss_fn(tf.nn.relu(y_true), y_pred) * mask
        return tf.reduce_sum(per_token) / tf.maximum(tf.reduce_sum(mask), 1.0)
```

with:

```python
import numpy as np
import tensorflow as tf
from transformers import AutoConfig, AutoTokenizer, TFAutoModelForTokenClassification as AutoModel, create_optimizer
from .base import BaseNamedEntityRecognition
from . import NonPaddingLoss, NonPaddingAccuracy

PRETRAINED_MODELS = [
    'distilbert/distilbert-base-uncased',
    'distilbert-base-uncased',
    'bert-base-uncased',
    'bert-base-multilingual-cased',
    'ai4bharat/indic-bert',
    'google/muril-base-cased'
]
```

(everything from `class BERTNamedEntityRecognition(BaseNamedEntityRecognition):` onward is unchanged. The `from . import NonPaddingLoss, NonPaddingAccuracy` resolves through the NER package's new re-export from Step 4 — the import form is identical to what NLU's architecture modules already use.)

Then find `model.compile(optimizer=optimizer, loss=NonPaddingLoss())` inside `build()` (around line 216) and change it to also report accuracy, which this architecture currently doesn't:

```python
        model.compile(optimizer=optimizer, loss=NonPaddingLoss(), metrics=[NonPaddingAccuracy()])
        return model
```

- [ ] **Step 6: Route the NLU package through the shared module — `natural_language_understanding/__init__.py`**

This file currently *defines* `NonPaddingLoss` and `NonPaddingAccuracy` locally (the second copy this task eliminates). Delete the `import tensorflow as tf` line at the top **and** both class definitions (`class NonPaddingLoss(...)` through the end of `class NonPaddingAccuracy(...)`), and in their place — immediately above the existing `from .base import BaseNaturalLanguageUnderstanding` line — insert:

```python
from ..masking import NonPaddingLoss, NonPaddingAccuracy
```

After the edit the top of the file reads:

```python
from ..masking import NonPaddingLoss, NonPaddingAccuracy

from .base import BaseNaturalLanguageUnderstanding
from .transformer import BERTNaturalLanguageUnderstanding
from .deep_neural_network import DNNNaturalLanguageUnderstanding


class NaturalLanguageUnderstanding:
```

(everything from `class NaturalLanguageUnderstanding:` onward is unchanged. `import tensorflow as tf` was only used by the two deleted classes — the factory class does not reference `tf`, so removing it is safe; `py_compile` and Step 7's identity assertions will catch it if anything still needs `tf`. The re-export line must stay above the `from .transformer` / `from .deep_neural_network` lines, which do `from . import NonPaddingLoss, NonPaddingAccuracy`.)

- [ ] **Step 7: Re-run the verification script to confirm it passes**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task3.py`
Expected: all identity assertions pass, then prints `loss: <float>`, `accuracy: 0.8`, then `OK`.

- [ ] **Step 8: `py_compile` check**

Run: `./venv/bin/python3 -m py_compile server/models/masking.py server/models/named_entity_recognition/__init__.py server/models/named_entity_recognition/transformer.py server/models/natural_language_understanding/__init__.py`
Expected: exits with no output.

- [ ] **Step 9: Stage and prepare the commit (hold for explicit approval)**

```bash
git add server/models/masking.py server/models/named_entity_recognition/__init__.py server/models/named_entity_recognition/transformer.py server/models/natural_language_understanding/__init__.py
git status
```

Show the staged diff to the user and wait for explicit confirmation before `git commit`.

---

### Task 4: Fix RNN NER's padding to `-100` and compile with the shared masked loss/metric

**Files:**
- Modify: `server/models/named_entity_recognition/recurrent_neural_network.py`
- Verify: temporary script, e.g. `/tmp/verify_task4.py` (not committed)

**Interfaces:**
- Consumes: `NonPaddingLoss`, `NonPaddingAccuracy` from Task 3 (`from . import NonPaddingLoss, NonPaddingAccuracy`); **also requires Task 2 already applied to `named_entity_recognition/base.py`.** Confirmed empirically while writing this plan: if this task's `-100` padding change is tested against `BaseNamedEntityRecognition.train()` *before* Task 2's fix lands, the old buggy inline `sample_weight` computation produces `NaN` for the newly-introduced `-100` positions and training loss goes `NaN` — the exact same bug Task 2 fixes, now hitting the RNN architecture too. Do these tasks in order (2 before 4); do not attempt Task 4 standalone against an unpatched `base.py`.
- Produces: `RNNNamedEntityRecognition.tokenize_and_align` now pads with `-100` instead of `0` — this is the shape Task 2's `sample_weight = self._compute_sample_weights(y_aligned, class_weights, ignore_value=-100)` was already written to mask correctly, and this task is what makes that masking meaningful for the RNN architecture (previously a no-op for RNN, since `-100` never appeared in its `y_aligned`).

- [ ] **Step 1: Write the verification script**

Create `/tmp/verify_task4.py`. This is an end-to-end run of the real RNN NER architecture (no network access needed — `TextVectorization` is fit from scratch) on a tiny, deliberately imbalanced synthetic dataset (`city` spans are rare relative to `O` tags), which is exactly the combination this whole plan is meant to make numerically stable:

```python
import numpy as np
import pandas as pd

from server.models.named_entity_recognition import NamedEntityRecognition

df = pd.DataFrame({'utterances': [
    'book a {city: Delhi} flight to {city: Mumbai}',
    'cancel my order please',
    'find me a {city: Chennai} hotel',
    'thanks for the help',
    'i want to go to {city: Pune} today',
    'cancel that request now',
    'show flights to {city: Goa} tomorrow',
    'no changes needed today',
]})

model = NamedEntityRecognition.create('recurrent_neural_network')
history = model.train(
    df, epochs=2, batch_size=2, test_split=0.25, validation_split=0.0, early_stopping=False
)

print('history:', history)
assert all(np.isfinite(v) for v in history['loss']), history['loss']
assert all(np.isfinite(v) for v in history['accuracy']), history['accuracy']
print('OK')
```

- [ ] **Step 2: Run it against the current code**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task4.py`
Expected: currently passes (loss/accuracy finite) — the RNN architecture doesn't yet hit the `-100` path at all, so this step is a baseline confirming the harness runs cleanly before the change. Note the printed `history` values for comparison in Step 4.

- [ ] **Step 3: Fix `recurrent_neural_network.py`**

Add the shared-classes import (around line 5, after `from .base import BaseNamedEntityRecognition`):

```python
from .base import BaseNamedEntityRecognition
from . import NonPaddingLoss, NonPaddingAccuracy
```

Replace the padding value in `tokenize_and_align` (around lines 37-47):

```python
    def tokenize_and_align(self, X, y):
        """
        Standard padding/truncation for RNN.
        """
        X_processed = self.preprocess_x(X)
        seq_len = self.parameters.get('sequence_length', 128)
        
        y_padded = []
        for labels in y:
            if len(labels) > seq_len:
                y_padded.append(labels[:seq_len])
            else:
                y_padded.append(labels + [0] * (seq_len - len(labels)))
        return X_processed, np.array(y_padded)
```

with:

```python
    def tokenize_and_align(self, X, y):
        """
        Standard padding/truncation for RNN. Padded positions use ``-100``,
        matching the transformer architecture's convention, so
        ``NonPaddingLoss``/``NonPaddingAccuracy`` and the sample-weight
        computation in ``BaseNamedEntityRecognition.train`` exclude them —
        ``0`` would collide with a real tag id.
        """
        X_processed = self.preprocess_x(X)
        seq_len = self.parameters.get('sequence_length', 128)
        
        y_padded = []
        for labels in y:
            if len(labels) > seq_len:
                y_padded.append(labels[:seq_len])
            else:
                y_padded.append(labels + [-100] * (seq_len - len(labels)))
        return X_processed, np.array(y_padded)
```

Replace the compile call in `build()` (around line 71):

```python
        model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
        return model
```

with:

```python
        model.compile(optimizer='adam', loss=NonPaddingLoss(), metrics=[NonPaddingAccuracy()])
        return model
```

- [ ] **Step 4: Re-run the verification script to confirm no regression**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task4.py`
Expected (confirmed empirically while writing this plan, with both Task 2's and this task's fix in place): prints a `history` dict with finite `loss`/`accuracy` values (numerically different from Step 2's run, since padded positions are now excluded from both — that's expected and correct), then `OK`. If instead you see `nan` losses here, the most likely cause is Task 2's fix not actually being present in `named_entity_recognition/base.py` yet — see the ordering note above.

- [ ] **Step 5: `py_compile` check**

Run: `./venv/bin/python3 -m py_compile server/models/named_entity_recognition/recurrent_neural_network.py`
Expected: exits with no output.

- [ ] **Step 6: Stage and prepare the commit (hold for explicit approval)**

```bash
git add server/models/named_entity_recognition/recurrent_neural_network.py
git status
```

Show the staged diff to the user and wait for explicit confirmation before `git commit`.

---

### Task 5: Wire intent + slot sample weights into NLU's joint training loop

**Files:**
- Modify: `server/models/natural_language_understanding/base.py`
- Verify: temporary script, e.g. `/tmp/verify_task5.py` (not committed)

**Interfaces:**
- Consumes: `BaseModel._compute_class_weights`, `BaseModel._compute_sample_weights` (same helpers as Tasks 1/2).
- Produces: none consumed by a later task — this is the last piece of feature wiring described in the design.

- [ ] **Step 1: Write the verification script**

Create `/tmp/verify_task5.py`. This is an end-to-end run of the real DNN NLU architecture (no network access needed) — the point of a real run here, rather than a fake-model capture like Task 2, is to prove Keras actually accepts a dict-keyed `sample_weight` for this specific multi-output model, which is the one genuinely new (untested-in-this-codebase) call shape in the whole plan:

```python
import numpy as np
import pandas as pd

from server.models.natural_language_understanding import NaturalLanguageUnderstanding

df = pd.DataFrame({
    'utterances': [
        'book a flight to {city: Delhi}',
        'cancel my order',
        'book a flight to {city: Mumbai}',
        'i want to cancel this',
        'reserve a table in {city: Chennai}',
        'please cancel my booking',
        'book tickets to {city: Pune}',
        'cancel it now',
    ],
    'labels': ['book', 'cancel', 'book', 'cancel', 'book', 'cancel', 'book', 'cancel'],
})

model = NaturalLanguageUnderstanding.create('deep_neural_network')
history = model.train(
    df, epochs=2, batch_size=2, test_split=0.25, validation_split=0.0, early_stopping=False
)

print('history keys:', list(history.keys()))
assert all(np.isfinite(v) for v in history['loss']), history['loss']
print('OK')
```

- [ ] **Step 2: Run it against the current code to confirm it fails**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task5.py`
Expected: this currently **succeeds** too (there's no weighting wired in yet to break anything) — this step is a baseline run. Note the printed `history keys` list for comparison; the point of this task is not to change whether training succeeds, but to change *how* it weights the loss. The real proof point is Step 4 succeeding once `sample_weight` is wired in without Keras raising a shape/key error.

- [ ] **Step 3: Wire weighting into `natural_language_understanding/base.py`**

Replace this block (around lines 109-139):

```python
        y_intents, y_slots = self.preprocess_y(y)
        X_processed, y_slots_aligned = self.tokenize_and_align(X, y_slots)

        num_labels = len(self.labels)
        num_tags = len(self.tags)

        self.model = self.build(num_labels=num_labels, num_tags=num_tags, **kwargs)

        summary = self._get_summary()
        if summary:
            print(summary)

        callbacks = kwargs.get('callbacks', [])
        if kwargs.get('early_stopping', True):
            import tensorflow as tf
            callbacks.append(tf.keras.callbacks.EarlyStopping(
                monitor=kwargs.get('monitor', 'val_loss'),
                patience=kwargs.get('patience', 3),
                restore_best_weights=True
            ))

        self._fit_data = (X_processed, [y_intents, y_slots_aligned], validation_split)

        self.history = self.model.fit(
            X_processed, [y_intents, y_slots_aligned],
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )

        self.parameters['epochs'] = len(self.history.history.get('loss', []))
        return self._history_to_dict(self.history)
```

with:

```python
        y_intents, y_slots = self.preprocess_y(y)
        X_processed, y_slots_aligned = self.tokenize_and_align(X, y_slots)

        intent_class_weights = self._compute_class_weights(y_intents)
        intent_sample_weight = self._compute_sample_weights(y_intents, intent_class_weights)

        flat_slot_labels = np.concatenate([np.asarray(seq) for seq in y_slots])
        slot_class_weights = self._compute_class_weights(flat_slot_labels)
        slot_sample_weight = self._compute_sample_weights(
            y_slots_aligned, slot_class_weights, ignore_value=-100
        )

        num_labels = len(self.labels)
        num_tags = len(self.tags)

        self.model = self.build(num_labels=num_labels, num_tags=num_tags, **kwargs)

        summary = self._get_summary()
        if summary:
            print(summary)

        callbacks = kwargs.get('callbacks', [])
        if kwargs.get('early_stopping', True):
            import tensorflow as tf
            callbacks.append(tf.keras.callbacks.EarlyStopping(
                monitor=kwargs.get('monitor', 'val_loss'),
                patience=kwargs.get('patience', 3),
                restore_best_weights=True
            ))

        self._fit_data = (X_processed, [y_intents, y_slots_aligned], validation_split)

        self.history = self.model.fit(
            X_processed, [y_intents, y_slots_aligned],
            sample_weight={'intents': intent_sample_weight, 'slots': slot_sample_weight},
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )

        self.parameters['epochs'] = len(self.history.history.get('loss', []))
        return self._history_to_dict(self.history)
```

(`np` is already imported at the top of this file — no new import needed. The dict keys `'intents'`/`'slots'` match the `name=` given to each architecture's output `Dense` layer in both `transformer.py` and `deep_neural_network.py`.)

- [ ] **Step 4: Re-run the verification script to confirm it still works with weighting wired in**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task5.py`
Expected (confirmed empirically while writing this plan — Keras does accept the dict-keyed `sample_weight` for this multi-output model, training completes with finite `loss`, `intents_loss`, `slots_loss`): same successful shape as Step 2 — `history keys: [...]` then `OK`. If Keras rejected the dict-keyed `sample_weight`, this would raise instead (e.g. a `ValueError` about sample weight structure) — that would mean the output layer names don't match `'intents'`/`'slots'` as assumed and needs investigating before proceeding.

- [ ] **Step 5: `py_compile` check**

Run: `./venv/bin/python3 -m py_compile server/models/natural_language_understanding/base.py`
Expected: exits with no output.

- [ ] **Step 6: Stage and prepare the commit (hold for explicit approval)**

```bash
git add server/models/natural_language_understanding/base.py
git status
```

Show the staged diff to the user and wait for explicit confirmation before `git commit`.

---

### Task 6: Full sweep verification

**Files:** none modified — this task only verifies Tasks 1-5 together.

- [ ] **Step 1: `py_compile` every touched file at once**

Run:
```bash
cd /Users/varunseth/Documents/git/indic-nlu && ./venv/bin/python3 -m py_compile \
  server/models/base.py \
  server/models/masking.py \
  server/models/text_classification/base.py \
  server/models/named_entity_recognition/base.py \
  server/models/named_entity_recognition/__init__.py \
  server/models/named_entity_recognition/transformer.py \
  server/models/named_entity_recognition/recurrent_neural_network.py \
  server/models/natural_language_understanding/__init__.py \
  server/models/natural_language_understanding/base.py
```
Expected: exits with no output.

- [ ] **Step 2: Re-run all five task verification scripts back to back**

```bash
cd /Users/varunseth/Documents/git/indic-nlu && for f in verify_task1 verify_task2 verify_task3 verify_task4 verify_task5; do
  echo "=== $f ==="; PYTHONPATH=. ./venv/bin/python3 /tmp/$f.py || exit 1
done
```
Expected: each prints its own `OK` with no assertion errors.

- [ ] **Step 3 (optional, network-dependent — run manually if you have internet access): BERT-backed smoke tests**

These exercise the two architectures that pull a pretrained encoder from Hugging Face (`distilbert-base-uncased`), which is the exact code path Task 2 fixed. Not required for task completion since network access can't be assumed, but worth running once if available:

```python
# /tmp/verify_task6_transformer.py
import numpy as np
import pandas as pd

from server.models.named_entity_recognition import NamedEntityRecognition
from server.models.natural_language_understanding import NaturalLanguageUnderstanding

ner_df = pd.DataFrame({'utterances': [
    'book a {city: Delhi} flight to {city: Mumbai}',
    'cancel my order please',
    'find me a {city: Chennai} hotel',
    'thanks for the help',
]})
ner = NamedEntityRecognition.create('transformer')
ner_history = ner.train(ner_df, epochs=1, batch_size=2, test_split=0.25, validation_split=0.0, early_stopping=False)
assert all(np.isfinite(v) for v in ner_history['loss']), ner_history['loss']
print('NER transformer OK:', ner_history)

nlu_df = pd.DataFrame({
    'utterances': [
        'book a flight to {city: Delhi}',
        'cancel my order',
        'book a flight to {city: Mumbai}',
        'i want to cancel this',
    ],
    'labels': ['book', 'cancel', 'book', 'cancel'],
})
nlu = NaturalLanguageUnderstanding.create('transformer')
nlu_history = nlu.train(nlu_df, epochs=1, batch_size=2, test_split=0.25, validation_split=0.0, early_stopping=False)
assert all(np.isfinite(v) for v in nlu_history['loss']), nlu_history['loss']
print('NLU transformer OK:', nlu_history)
```

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task6_transformer.py`
Expected: downloads `distilbert-base-uncased` (first run only, cached after), then prints `NER transformer OK: {...}` and `NLU transformer OK: {...}` with finite losses.

- [ ] **Step 4: Clean up scratch files**

```bash
rm -f /tmp/verify_task1.py /tmp/verify_task2.py /tmp/verify_task3.py /tmp/verify_task4.py /tmp/verify_task5.py /tmp/verify_task6_transformer.py
```

- [ ] **Step 5: Final summary for the user**

Report which tasks are committed, which are staged-and-pending-approval, and — if Step 3 was run — whether the BERT-backed smoke tests passed.

---

### Task 7: Fix inert token/slot weighting — fold class weights into `NonPaddingLoss`

**Why:** The final whole-branch review found (and the controller empirically confirmed in the venv) that per-token `sample_weight` is **inert** for the NER-tag and NLU-slot heads. `NonPaddingLoss.call()` returns a fully-reduced *scalar*; Keras applies `sample_weight` *after* `call()`, so `scalar_L × sample_weight` re-averages to `L × mean(W)` — a per-batch constant that leaves the gradient direction unweighted. Proof: two sample-weights with equal total but different per-token distribution produced a byte-identical loss. Text-classification weighting (Keras-native `class_weight`) and NLU-**intent** weighting (standard per-sample cross-entropy + `(batch,)` sample_weight) are unaffected and correct.

**Fix (user-chosen):** fold the per-class weights directly into `NonPaddingLoss` — multiply the per-token losses by their class weight *before* the scalar reduction, preserving the existing "mean over real tokens" normalization — and stop passing `sample_weight` for the token/slot heads. The intent head keeps its working `sample_weight`. Controller pre-verified in the venv: folded weighting is effective (upweighting class 1 vs class 0 changes the loss), `NonPaddingLoss()` with no args is byte-identical to the old behavior (backward-compat for load-time rebuilds), and Keras accepts a partial `sample_weight={'intents': ...}` dict for the multi-output NLU model.

**Files:**
- Modify: `server/models/masking.py`
- Modify: `server/models/named_entity_recognition/base.py`
- Modify: `server/models/named_entity_recognition/recurrent_neural_network.py`
- Modify: `server/models/named_entity_recognition/transformer.py`
- Modify: `server/models/natural_language_understanding/base.py`
- Modify: `server/models/natural_language_understanding/deep_neural_network.py`
- Modify: `server/models/natural_language_understanding/transformer.py`
- Verify: temporary script `/tmp/verify_task7.py` (not committed)

**Interfaces:**
- `NonPaddingLoss.__init__(self, class_weights=None, name='non_padding_loss')` — `class_weights` is an optional 1-D sequence indexed by class id (length = num classes/tags). `None` → uniform (old behavior). Load-time rebuilds call it with no args → uniform, which is correct since the loss is irrelevant to inference.
- NER `build(self, num_classes, class_weights=None, **kwargs)`; NLU `build(..., num_tags, slot_class_weights=None, **kwargs)`. Passed as an **explicit** keyword (not through `**kwargs`) so it is never persisted into `parameters.json`.

- [ ] **Step 1: Write the verification script**

Create `/tmp/verify_task7.py` — proves (a) the loss reweights per class, (b) backward-compat, (c) end-to-end NER-RNN + NLU-DNN train finite with the new wiring:

```python
import numpy as np
import pandas as pd
import tensorflow as tf

from server.models.masking import NonPaddingLoss
from server.models.named_entity_recognition import NamedEntityRecognition
from server.models.natural_language_understanding import NaturalLanguageUnderstanding

# (a) folded weights are EFFECTIVE + (b) backward-compat
y_true = tf.constant([[0, 1, -100], [1, 0, -100]], tf.int32)
y_pred = tf.constant([[[0.7, 0.3], [0.4, 0.6], [0.5, 0.5]],
                      [[0.2, 0.8], [0.9, 0.1], [0.5, 0.5]]], tf.float32)
uniform = float(NonPaddingLoss(class_weights=[1., 1.])(y_true, y_pred))
none_arg = float(NonPaddingLoss()(y_true, y_pred))
up1 = float(NonPaddingLoss(class_weights=[1., 10.])(y_true, y_pred))
up0 = float(NonPaddingLoss(class_weights=[10., 1.])(y_true, y_pred))
assert abs(none_arg - uniform) < 1e-6, (none_arg, uniform)          # backward-compat
assert abs(up1 - up0) > 1e-6, (up1, up0)                            # depends on WHICH class -> effective
print('loss reweighting effective: uniform=%.4f up1=%.4f up0=%.4f' % (uniform, up1, up0))

# (c) end-to-end NER RNN (imbalanced: city spans rare) finite
ner_df = pd.DataFrame({'utterances': [
    'book a {city: Delhi} flight to {city: Mumbai}', 'cancel my order please',
    'find me a {city: Chennai} hotel', 'thanks for the help',
    'i want to go to {city: Pune} today', 'cancel that request now',
    'show flights to {city: Goa} tomorrow', 'no changes needed today']})
ner = NamedEntityRecognition.create('recurrent_neural_network')
h = ner.train(ner_df, epochs=2, batch_size=2, test_split=0.25, validation_split=0.0, early_stopping=False)
assert all(np.isfinite(v) for v in h['loss']), h['loss']
print('NER RNN finite:', h['loss'])

# (c) end-to-end NLU DNN finite (intent sample_weight kept, slot weights folded)
nlu_df = pd.DataFrame({
    'utterances': ['book a flight to {city: Delhi}', 'cancel my order',
                   'book a flight to {city: Mumbai}', 'i want to cancel this',
                   'reserve a table in {city: Chennai}', 'please cancel my booking',
                   'book tickets to {city: Pune}', 'cancel it now'],
    'labels': ['book', 'cancel', 'book', 'cancel', 'book', 'cancel', 'book', 'cancel']})
nlu = NaturalLanguageUnderstanding.create('deep_neural_network')
h2 = nlu.train(nlu_df, epochs=2, batch_size=2, test_split=0.25, validation_split=0.0, early_stopping=False)
assert all(np.isfinite(v) for v in h2['loss']), h2['loss']
print('NLU DNN finite:', h2['loss'])
print('OK')
```

Run: `PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task7.py` — expected `OK` (against current code it FAILS at the `abs(up1-up0) > 1e-6` assertion, since current `NonPaddingLoss` ignores class_weights — it takes no such argument, so it will actually raise `TypeError: __init__() got an unexpected keyword argument 'class_weights'` first; that is the expected RED).

- [ ] **Step 2: Edit `server/models/masking.py` — fold class weights into `NonPaddingLoss`**

Replace the whole `NonPaddingLoss` class with:

```python
class NonPaddingLoss(tf.keras.losses.Loss):
    """
    Sparse categorical cross-entropy for a sequence-labelling head (NER tags
    or NLU slots) that ignores padded / sub-word positions and, optionally,
    weights each real token by its class.

    Aligned labels use ``-100`` for special tokens, every non-initial sub-word,
    and (for architectures without sub-word tokenization) sequence padding —
    see each architecture's ``tokenize_and_align``. Those positions are masked
    out so they contribute nothing to the loss, and the remaining per-token
    losses are averaged over the real tokens only. Without the mask, plain
    ``sparse_categorical_crossentropy`` treats ``-100`` as a class index and
    fails ("label value of -100 outside the valid range").

    ``class_weights`` (a 1-D sequence indexed by class id, or ``None`` for
    uniform) is folded in here — the per-token losses are multiplied by their
    class weight *before* the scalar reduction. This is deliberate rather than
    relying on Keras' ``sample_weight``: because this loss reduces to a scalar
    itself, a per-token ``sample_weight`` applied afterward re-averages to
    ``loss * mean(weight)`` — a per-batch constant that leaves the gradient
    direction unweighted. Folding the weights in before reduction makes rare
    classes actually count more. ``None`` reproduces the old unweighted
    behavior exactly (used at load time, where the loss is irrelevant to
    inference).
    """

    def __init__(self, class_weights=None, name='non_padding_loss'):
        super().__init__(name=name)
        self.class_weights = (
            None if class_weights is None
            else tf.constant(list(class_weights), dtype=tf.float32)
        )

    def call(self, y_true, y_pred):
        loss_fn = tf.keras.losses.SparseCategoricalCrossentropy(
            from_logits=False, reduction=tf.keras.losses.Reduction.NONE
        )
        y_true = tf.cast(y_true, tf.int32)
        mask = tf.cast(y_true >= 0, y_pred.dtype)
        # relu() maps the ignored -100 labels to a valid class index; the mask
        # then zeroes their contribution before the loss is reduced.
        safe = tf.nn.relu(y_true)
        per_token = loss_fn(safe, y_pred) * mask
        if self.class_weights is not None:
            per_token = per_token * tf.gather(self.class_weights, safe)
        return tf.reduce_sum(per_token) / tf.maximum(tf.reduce_sum(mask), 1.0)
```

(Leave `NonPaddingAccuracy` unchanged.)

- [ ] **Step 3: Edit `server/models/named_entity_recognition/base.py` — build the vector, drop the sample_weight**

Replace this block (the class-weight/sample-weight computation, ~lines 212-214, which currently reads):

```python
        flat_labels = np.concatenate([np.asarray(seq) for seq in y_encoded])
        class_weights = self._compute_class_weights(flat_labels)
        sample_weight = self._compute_sample_weights(y_aligned, class_weights, ignore_value=-100)

        num_classes = len(self.labels)
        self.model = self.build(num_classes=num_classes, **kwargs)
```

with:

```python
        flat_labels = np.concatenate([np.asarray(seq) for seq in y_encoded])
        class_weights = self._compute_class_weights(flat_labels)

        num_classes = len(self.labels)
        class_weight_vector = [class_weights.get(index, 1.0) for index in range(num_classes)]
        self.model = self.build(num_classes=num_classes, class_weights=class_weight_vector, **kwargs)
```

And remove `sample_weight=sample_weight,` from the `self.model.fit(...)` call (leave every other fit argument unchanged):

```python
        self.history = self.model.fit(
            X_processed, y_aligned,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )
```

- [ ] **Step 4: Edit `server/models/named_entity_recognition/recurrent_neural_network.py`**

Change the build signature `def build(self, num_classes, **kwargs):` to `def build(self, num_classes, class_weights=None, **kwargs):`, and change the compile call:

```python
        model.compile(optimizer='adam', loss=NonPaddingLoss(class_weights=class_weights), metrics=[NonPaddingAccuracy()])
```

- [ ] **Step 5: Edit `server/models/named_entity_recognition/transformer.py`**

Change the build signature `def build(self, num_classes, **kwargs):` to `def build(self, num_classes, class_weights=None, **kwargs):`, and change the compile call:

```python
        model.compile(optimizer=optimizer, loss=NonPaddingLoss(class_weights=class_weights), metrics=[NonPaddingAccuracy()])
```

- [ ] **Step 6: Edit `server/models/natural_language_understanding/base.py` — keep intent sample_weight, fold slot weights**

Replace this block (currently ~lines 112-119 + the build call):

```python
        intent_class_weights = self._compute_class_weights(y_intents)
        intent_sample_weight = self._compute_sample_weights(y_intents, intent_class_weights)

        flat_slot_labels = np.concatenate([np.asarray(seq) for seq in y_slots])
        slot_class_weights = self._compute_class_weights(flat_slot_labels)
        slot_sample_weight = self._compute_sample_weights(
            y_slots_aligned, slot_class_weights, ignore_value=-100
        )

        num_labels = len(self.labels)
        num_tags = len(self.tags)

        self.model = self.build(num_labels=num_labels, num_tags=num_tags, **kwargs)
```

with:

```python
        intent_class_weights = self._compute_class_weights(y_intents)
        intent_sample_weight = self._compute_sample_weights(y_intents, intent_class_weights)

        flat_slot_labels = np.concatenate([np.asarray(seq) for seq in y_slots])
        slot_class_weights = self._compute_class_weights(flat_slot_labels)

        num_labels = len(self.labels)
        num_tags = len(self.tags)
        slot_class_weight_vector = [slot_class_weights.get(index, 1.0) for index in range(num_tags)]

        self.model = self.build(
            num_labels=num_labels, num_tags=num_tags,
            slot_class_weights=slot_class_weight_vector, **kwargs
        )
```

And in the `self.model.fit(...)` call, change the `sample_weight` argument from both heads to intents only:

```python
            sample_weight={'intents': intent_sample_weight},
```

(Leave the positional target `[y_intents, y_slots_aligned]` and every other fit argument unchanged. Keras applies weight 1 to the omitted `slots` output; its class weighting now lives in the folded loss.)

- [ ] **Step 7: Edit `server/models/natural_language_understanding/deep_neural_network.py`**

Change the build signature `def build(self, num_labels, num_tags, **kwargs):` to `def build(self, num_labels, num_tags, slot_class_weights=None, **kwargs):`, and change the slot loss:

```python
        loss = {
            "intents": tf.keras.losses.SparseCategoricalCrossentropy(),
            "slots": NonPaddingLoss(class_weights=slot_class_weights),
        }
```

- [ ] **Step 8: Edit `server/models/natural_language_understanding/transformer.py`**

Change the build signature `def build(self, num_labels, num_tags, **kwargs):` to `def build(self, num_labels, num_tags, slot_class_weights=None, **kwargs):`, and change the slot loss:

```python
        loss = {
            'intents': tf.keras.losses.SparseCategoricalCrossentropy(from_logits=False),
            'slots': NonPaddingLoss(class_weights=slot_class_weights)
        }
```

- [ ] **Step 9: Run the verification + py_compile sweep**

Run: `cd /Users/varunseth/Documents/git/indic-nlu && PYTHONPATH=. ./venv/bin/python3 /tmp/verify_task7.py` → expected `OK` (reweighting effective, both trains finite).

Run the py_compile sweep over all seven touched files:
```bash
./venv/bin/python3 -m py_compile \
  server/models/masking.py \
  server/models/named_entity_recognition/base.py \
  server/models/named_entity_recognition/recurrent_neural_network.py \
  server/models/named_entity_recognition/transformer.py \
  server/models/natural_language_understanding/base.py \
  server/models/natural_language_understanding/deep_neural_network.py \
  server/models/natural_language_understanding/transformer.py
```
Expected: no output.

- [ ] **Step 10: Do NOT commit** (no-commit mode). Leave edits in the working tree; report.
