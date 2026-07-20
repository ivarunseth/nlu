# Training Form Hyperparameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose every backend-supported hyperparameter in the training form (per model type × architecture), fix the backend inconsistencies that make some shown parameters inert, add a configurable `hidden_layers` Dense stack to all seven architectures, and convert all numeric form controls to sliders.

**Architecture:** Backend gains one shared `BaseModel._apply_hidden_layers` helper plus small per-architecture fixes (NER RNN real optimizer, NLU transformer loss weights + l2, NLU pruning completion). Frontend replaces the flat `ARCHITECTURE_DEFAULTS` with a composed per-(model type, architecture) parameter registry that drives all rendering.

**Tech Stack:** TensorFlow/Keras 2.15, transformers 4.37.2 (`create_optimizer`), tensorflow_model_optimization; React 19 + React-Bootstrap (Vite).

**Spec:** `docs/superpowers/specs/2026-07-19-training-form-hyperparameters-design.md`

## Global Constraints

- **NO GIT COMMITS.** The user commits manually. Wherever this plan or a skill says "commit", instead append a completion entry to `.superpowers/sdd/progress.md`. Never run `git add`/`git commit`.
- **Do not touch the user's unrelated dirty files:** `app.py`, `triton.py` (deleted), `server/tasks/__init__.py`, `server/tasks/request.py`, `server/utils/decorators.py`, `server/views/api/tasks.py`, `src/routes/home/components/ModelFormModal.jsx`, or anything under `server/models/` beyond the files this plan names (the working tree carries an uncommitted class-weighting feature there — leave it exactly as is).
- **Python:** always `./venv/bin/python3` with `PYTHONPATH=.` from the repo root (`/Users/varunseth/Documents/git/indic-nlu`). Plain `python3` or a missing `PYTHONPATH` will fail with `ModuleNotFoundError: No module named 'server'`.
- **Throwaway verification scripts** go in the session scratchpad directory (`$SCRATCH` below): `/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/2fb9357c-e814-475d-991b-98bf82dfc1f4/scratchpad`. Never commit or leave scripts inside the repo.
- **Frontend verification** is `npm run build` (there is no meaningful JS test suite). Backend syntax verification is `./venv/bin/python3 -m py_compile <files>`.
- **No browser preview** — the user tests the UI themselves.
- Transformer-backed steps download/reuse `distilbert/distilbert-base-uncased` from the HF cache; first run may take minutes. Never switch the pretrained model name.
- Subagents exploring the codebase should use the graphify skill (`graphify-out/graph.json` is prebuilt) for structure questions before falling back to grep.

---

### Task 1: `_apply_hidden_layers` helper on `BaseModel`

**Files:**
- Modify: `server/models/base.py` (insert method directly after `_prune_model`, which ends around line 115 with `return tf.keras.models.clone_model(...)`)

**Interfaces:**
- Produces: `BaseModel._apply_hidden_layers(self, x, default=None) -> tensor` — reads `self.parameters['hidden_layers']` (list of `{'units': int, 'activation': str}`); when the key is **absent** uses `default` (list or None); applies `tf.keras.layers.Dense(units, activation)` per entry to `x` in order. Every build method in Tasks 2–4 calls this.

- [ ] **Step 1: Write the failing verification script**

Write `$SCRATCH/check_hidden_helper.py`:

```python
import numpy as np
import tensorflow as tf
from server.models.base import BaseModel


class Probe(BaseModel):
    def __init__(self):
        super().__init__()


def dense_layers(x_in, x_out):
    model = tf.keras.Model(inputs=x_in, outputs=x_out)
    return [l for l in model.layers if isinstance(l, tf.keras.layers.Dense)]


probe = Probe()

# 1. Absent parameter + no default -> no-op
x_in = tf.keras.layers.Input((8,))
x = probe._apply_hidden_layers(x_in)
assert x is x_in, 'absent hidden_layers with no default must be a no-op'

# 2. Absent parameter + legacy default -> one dense from the default
x = probe._apply_hidden_layers(x_in, default=[{'units': 32, 'activation': 'tanh'}])
layers = dense_layers(x_in, x)
assert len(layers) == 1 and layers[0].units == 32
assert tf.keras.activations.serialize(layers[0].activation) == 'tanh'

# 3. Explicit parameter wins over default, applies in order, works on 3-D input
probe.parameters['hidden_layers'] = [
    {'units': 64, 'activation': 'relu'},
    {'units': 16, 'activation': 'gelu'},
]
seq_in = tf.keras.layers.Input((10, 8))
x = probe._apply_hidden_layers(seq_in, default=[{'units': 99, 'activation': 'tanh'}])
layers = dense_layers(seq_in, x)
assert [l.units for l in layers] == [64, 16]
assert x.shape.as_list() == [None, 10, 16], x.shape

# 4. Explicit empty list -> no-op even with a default
probe.parameters['hidden_layers'] = []
x = probe._apply_hidden_layers(x_in, default=[{'units': 99, 'activation': 'tanh'}])
assert x is x_in

print('OK: _apply_hidden_layers')
```

- [ ] **Step 2: Run it — expect failure**

Run: `PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_hidden_helper.py`
Expected: `AttributeError: 'Probe' object has no attribute '_apply_hidden_layers'`

- [ ] **Step 3: Add the method**

In `server/models/base.py`, immediately after the `_prune_model` method (after its final `return tf.keras.models.clone_model(...)` block, before `_save_model_file`), insert:

```python
    def _apply_hidden_layers(self, x, default=None):
        """
        Applies the configurable hidden Dense stack from
        ``parameters['hidden_layers']`` to ``x`` and returns the result.

        ``hidden_layers`` is a list of ``{'units': int, 'activation': str}``
        dicts applied in order. ``Dense`` acts on the last axis, so the same
        stack serves 2-D feature tensors and 3-D sequence tensors. When the
        parameter is absent entirely, ``default`` is used instead — the hook
        for architectures whose configurations predate ``hidden_layers`` and
        persisted a single hidden dense as ``units``/``activation``. An empty
        list is a valid no-op.
        """
        layers = self.parameters.get('hidden_layers')
        if layers is None:
            layers = default or []
        for layer in layers:
            x = tf.keras.layers.Dense(layer['units'], activation=layer['activation'])(x)
        return x
```

- [ ] **Step 4: Run the script — expect pass**

Run: `PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_hidden_helper.py`
Expected: `OK: _apply_hidden_layers`

- [ ] **Step 5: Syntax check + ledger**

Run: `./venv/bin/python3 -m py_compile server/models/base.py`
Expected: silent success. Append to `.superpowers/sdd/progress.md` under a new `## Plan: training-form-hyperparameters` heading: `- Task 1 done: _apply_hidden_layers helper in server/models/base.py, verified via check_hidden_helper.py`.

---

### Task 2: Text classification — hidden stack in all three architectures

**Files:**
- Modify: `server/models/text_classification/deep_neural_network.py`
- Modify: `server/models/text_classification/recurrent_neural_network.py`
- Modify: `server/models/text_classification/transformer.py`

**Interfaces:**
- Consumes: `self._apply_hidden_layers(x, default=None)` from Task 1.
- Produces: TC DNN `parameters` gains `'hidden_layers': []` (additive stack). TC RNN and TC transformer builds route their previously hardcoded hidden `Dense(units, activation)` through the helper with a legacy default — `units`/`activation` keep working when `hidden_layers` is absent.

- [ ] **Step 1: DNN — default parameter + build wiring**

In `server/models/text_classification/deep_neural_network.py`, in `__init__`, change the `parameters.update` dict to add the new key (keep every existing line):

```python
        self.parameters.update({
            'max_tokens': 10000,
            'sequence_length': 100,
            'embedding_dims': 64,
            'dropout': 0.2,
            'learning_rate': 1e-3,
            'weight_decay_rate': 0,
            'num_warmup_steps': 0,
            'hidden_layers': []
        })
```

In `build`, between the second dropout and the output head — currently:

```python
        outputs = tf.keras.layers.Dropout(dropout)(outputs)
        
        labels = tf.keras.layers.Dense(num_classes, activation='softmax', name="labels")(outputs)
```

insert the stack:

```python
        outputs = tf.keras.layers.Dropout(dropout)(outputs)
        outputs = self._apply_hidden_layers(outputs)

        labels = tf.keras.layers.Dense(num_classes, activation='softmax', name="labels")(outputs)
```

(There are two `Dropout(dropout)` lines in this build; the insertion point is the **second** one, right before the `labels =` head.)

- [ ] **Step 2: RNN — route the hidden dense through the helper**

In `server/models/text_classification/recurrent_neural_network.py` `build`, replace:

```python
        outputs = tf.keras.layers.Dense(units, activation=activation)(outputs)
```

with:

```python
        # units keeps sizing the recurrent layer above; the hidden dense that
        # historically reused it generalises into the hidden_layers stack,
        # falling back to the legacy single dense for old configurations.
        outputs = self._apply_hidden_layers(
            outputs, default=[{'units': units, 'activation': activation}]
        )
```

Leave the `units = self.parameters.get('units', 64)` and `activation = self.parameters.get('activation', 'relu')` reads in place — the fallback needs them. Do **not** add `hidden_layers` to this file's `__init__` defaults (its absence is what triggers the legacy fallback).

- [ ] **Step 3: Transformer — route the hidden dense through the helper**

In `server/models/text_classification/transformer.py` `build`, replace:

```python
        outputs = tf.keras.layers.Dense(units, activation=activation)(outputs)
```

with:

```python
        outputs = self._apply_hidden_layers(
            outputs, default=[{'units': units, 'activation': activation}]
        )
```

Leave the `units`/`activation` variable reads and everything else (l2 head, pruning, optimizer) unchanged. Do **not** add `hidden_layers` to `__init__` defaults.

- [ ] **Step 4: Verification script**

Write `$SCRATCH/check_tc_hidden.py`:

```python
import numpy as np
import tensorflow as tf
from server.models.text_classification import TextClassification

STACK = [{'units': 48, 'activation': 'relu'}, {'units': 24, 'activation': 'tanh'}]
TEXTS = ['book a flight', 'play some music', 'what is the weather', 'set an alarm'] * 4
Y = np.array([0, 1, 2, 3] * 4)


def dense_units(model):
    return [l.units for l in model.layers if isinstance(l, tf.keras.layers.Dense)]


# --- DNN: additive stack ---
dnn = TextClassification.create('deep_neural_network')
dnn.labels = {0: 'a', 1: 'b', 2: 'c', 3: 'd'}
X = dnn.preprocess_x(TEXTS)
model = dnn.build(num_classes=4, hidden_layers=STACK)
assert dense_units(model) == [48, 24, 4], dense_units(model)
model.fit(X, Y, epochs=1, batch_size=4, verbose=0)

# --- DNN default: no stack, graph as before ---
dnn2 = TextClassification.create('deep_neural_network')
dnn2.labels = dnn.labels
dnn2.preprocess_x(TEXTS)
assert dense_units(dnn2.build(num_classes=4)) == [4]

# --- RNN: stack replaces the single hidden dense ---
rnn = TextClassification.create('recurrent_neural_network')
rnn.labels = dnn.labels
X = rnn.preprocess_x(TEXTS)
model = rnn.build(num_classes=4, hidden_layers=STACK)
assert dense_units(model) == [48, 24, 4], dense_units(model)
model.fit(X, Y, epochs=1, batch_size=4, verbose=0)

# --- RNN legacy fallback: no hidden_layers -> Dense(units, activation) ---
rnn2 = TextClassification.create('recurrent_neural_network')
rnn2.labels = dnn.labels
rnn2.preprocess_x(TEXTS)
assert 'hidden_layers' not in rnn2.parameters
model = rnn2.build(num_classes=4, units=40, activation='tanh')
assert dense_units(model) == [40, 4], dense_units(model)

print('OK: text classification hidden layers')
```

Run: `PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_tc_hidden.py`
Expected: `OK: text classification hidden layers`

- [ ] **Step 5: Transformer spot-check (slow, pretrained download/cache)**

Run:

```bash
PYTHONPATH=. ./venv/bin/python3 - <<'EOF'
import tensorflow as tf
from server.models.text_classification import TextClassification
bert = TextClassification.create('transformer')
bert.labels = {0: 'a', 1: 'b'}
model = bert.build(num_classes=2, hidden_layers=[{'units': 96, 'activation': 'gelu'}, {'units': 32, 'activation': 'relu'}])
units = [l.units for l in model.layers if isinstance(l, tf.keras.layers.Dense)]
assert units == [96, 32, 2], units
# legacy fallback
bert2 = TextClassification.create('transformer')
bert2.labels = bert.labels
model2 = bert2.build(num_classes=2, units=128, activation='tanh')
units2 = [l.units for l in model2.layers if isinstance(l, tf.keras.layers.Dense)]
assert units2 == [128, 2], units2
print('OK: TC transformer hidden layers')
EOF
```

Expected: `OK: TC transformer hidden layers`

- [ ] **Step 6: Syntax check + ledger**

Run: `./venv/bin/python3 -m py_compile server/models/text_classification/deep_neural_network.py server/models/text_classification/recurrent_neural_network.py server/models/text_classification/transformer.py`
Expected: silent success. Ledger: `- Task 2 done: TC hidden_layers wired (DNN additive, RNN/transformer with legacy fallback), verified via check_tc_hidden.py + transformer spot-check`.

---

### Task 3: NER — real optimizer for the RNN + hidden stack

**Files:**
- Modify: `server/models/named_entity_recognition/recurrent_neural_network.py`
- Modify: `server/models/named_entity_recognition/base.py`
- Modify: `server/models/named_entity_recognition/transformer.py`

**Interfaces:**
- Consumes: `self._apply_hidden_layers(x, default=None)` from Task 1.
- Produces: NER RNN honors `learning_rate`/`weight_decay_rate`/`num_warmup_steps` via `transformers.create_optimizer`; NER base `train` sets `kwargs['num_train_steps']` before `build`; both NER builds support `hidden_layers` (RNN additive, transformer with legacy `units` fallback).

- [ ] **Step 1: NER base — compute `num_train_steps`**

In `server/models/named_entity_recognition/base.py`:

First check the imports: `grep -n "^import math" server/models/named_entity_recognition/base.py`. If there is no hit, add `import math` alongside the other stdlib imports at the top of the file (next to `import os`).

Then in `train`, immediately after these existing lines:

```python
        flat_labels = np.concatenate([np.asarray(seq) for seq in y_encoded])
        class_weights = self._compute_class_weights(flat_labels)
```

insert (mirroring `text_classification/base.py`):

```python
        train_samples = max(1, int(len(y_encoded) * (1 - validation_split)))
        kwargs['num_train_steps'] = max(1, math.ceil(train_samples / batch_size) * epochs)
```

(The NER transformer's `_num_train_steps` still derives its own value from `X_train`; this kwarg is the RNN's optimizer horizon and the transformer's fallback.)

- [ ] **Step 2: NER RNN — imports, defaults, build**

In `server/models/named_entity_recognition/recurrent_neural_network.py`:

Add the import after the existing `from . import NonPaddingLoss, NonPaddingAccuracy` line:

```python
from transformers import create_optimizer
```

Replace the `__init__` parameters dict:

```python
        self.parameters.update({
            'max_tokens': 10000,
            'sequence_length': 128,
            'embedding_dims': 64,
            'lstm_dims': 100,
            'dropout': 0.2,
            'learning_rate': 1e-3,
            'weight_decay_rate': 0,
            'num_warmup_steps': 0,
            'hidden_layers': []
        })
```

Replace the whole `build` method body (from `self.parameters.update(kwargs)` through `return model`) with:

```python
        self.parameters.update(kwargs)
        vocab_size = len(self.processor.get_vocabulary())
        embedding_dims = self.parameters.get('embedding_dims', 64)
        lstm_dims = self.parameters.get('lstm_dims', 100)
        dropout = self.parameters.get('dropout', 0.2)
        sequence_length = self.parameters.get('sequence_length', 128)

        # Sequential can't thread a tensor through _apply_hidden_layers, so
        # the stack is materialised as a layer list; semantics match the
        # helper (empty/absent list is a no-op).
        hidden = [
            tf.keras.layers.Dense(layer['units'], activation=layer['activation'])
            for layer in self.parameters.get('hidden_layers', [])
        ]

        model = tf.keras.Sequential([
            tf.keras.layers.Input(shape=(sequence_length,), dtype=tf.int32),
            tf.keras.layers.Embedding(input_dim=vocab_size, output_dim=embedding_dims),
            tf.keras.layers.Dropout(dropout),
            tf.keras.layers.Bidirectional(tf.keras.layers.LSTM(lstm_dims, return_sequences=True)),
            tf.keras.layers.Dropout(dropout),
            *hidden,
            tf.keras.layers.Dense(num_classes, activation='softmax', name='dense_output')
        ])

        optimizer, _ = create_optimizer(
            init_lr=self.parameters.get('learning_rate', 1e-3),
            num_train_steps=self.parameters.get('num_train_steps', 1000),
            weight_decay_rate=self.parameters.get('weight_decay_rate', 0),
            num_warmup_steps=self.parameters.get('num_warmup_steps', 0)
        )

        model.compile(optimizer=optimizer, loss=NonPaddingLoss(class_weights=class_weights), metrics=[NonPaddingAccuracy()])
        return model
```

- [ ] **Step 3: NER transformer — route the hidden dense through the helper**

In `server/models/named_entity_recognition/transformer.py` `build`, replace:

```python
        hidden = tf.keras.layers.Dense(self.parameters.get('units', 768), activation='tanh')(sequence_output)
```

with:

```python
        hidden = self._apply_hidden_layers(
            sequence_output,
            default=[{'units': self.parameters.get('units', 768), 'activation': 'tanh'}]
        )
```

The following `Dropout` and l2 output head stay exactly as they are. Do **not** add `hidden_layers` to this file's `__init__` defaults (absence triggers the legacy fallback).

- [ ] **Step 4: Verification script**

Write `$SCRATCH/check_ner.py`:

```python
import numpy as np
import tensorflow as tf
from server.models.named_entity_recognition import NamedEntityRecognition

TEXTS = ['john lives in paris', 'acme hired mary', 'flight to delhi tomorrow', 'call bob now'] * 4

rnn = NamedEntityRecognition.create('recurrent_neural_network')
rnn.labels = {0: 'O', 1: 'B-PER', 2: 'B-LOC'}
X = rnn.preprocess_x(TEXTS)
seq_len = X.shape[1]
y = np.full((len(TEXTS), seq_len), -100, dtype=np.int32)
y[:, :4] = np.random.randint(0, 3, size=(len(TEXTS), 4))

model = rnn.build(
    num_classes=3,
    hidden_layers=[{'units': 40, 'activation': 'relu'}],
    learning_rate=5e-3, num_train_steps=100
)

# 1. Optimizer is no longer the hardcoded plain Adam
name = type(model.optimizer).__name__
assert name == 'AdamWeightDecay', name

# 2. learning_rate is honored (warmup 0 -> schedule(0) == init_lr; at
# iteration 0 the plain attribute read gives the same value)
lr = model.optimizer.learning_rate
lr0 = float(lr(0)) if callable(lr) else float(lr)
assert abs(lr0 - 5e-3) < 1e-9, lr0

# 3. Hidden stack present: Dense(40) then the softmax head
units = [l.units for l in model.layers if isinstance(l, tf.keras.layers.Dense)]
assert units == [40, 3], units

# 4. Trains without NaN (masked loss + -100 padding + stack)
history = model.fit(X, y, epochs=1, batch_size=4, verbose=0)
assert np.isfinite(history.history['loss'][0])

print('OK: NER RNN optimizer + hidden layers')
```

Run: `PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_ner.py`
Expected: `OK: NER RNN optimizer + hidden layers`

- [ ] **Step 5: NER transformer spot-check**

Run:

```bash
PYTHONPATH=. ./venv/bin/python3 - <<'EOF'
import tensorflow as tf
from server.models.named_entity_recognition import NamedEntityRecognition
bert = NamedEntityRecognition.create('transformer')
bert.labels = {0: 'O', 1: 'B-PER'}
model = bert.build(num_classes=2, hidden_layers=[{'units': 64, 'activation': 'relu'}, {'units': 32, 'activation': 'tanh'}])
units = [l.units for l in model.layers if isinstance(l, tf.keras.layers.Dense)]
assert units == [64, 32, 2], units
bert2 = NamedEntityRecognition.create('transformer')
bert2.labels = bert.labels
model2 = bert2.build(num_classes=2, units=100)
units2 = [l.units for l in model2.layers if isinstance(l, tf.keras.layers.Dense)]
assert units2 == [100, 2], units2
print('OK: NER transformer hidden layers')
EOF
```

Expected: `OK: NER transformer hidden layers`

- [ ] **Step 6: Syntax check + ledger**

Run: `./venv/bin/python3 -m py_compile server/models/named_entity_recognition/base.py server/models/named_entity_recognition/recurrent_neural_network.py server/models/named_entity_recognition/transformer.py`
Expected: silent success. Ledger: `- Task 3 done: NER RNN create_optimizer + num_train_steps in base + hidden_layers both archs, verified via check_ner.py + transformer spot-check`.

---

### Task 4: NLU — loss weights, l2, pruning completion, hidden stack, architecture-string bug

**Files:**
- Modify: `server/models/natural_language_understanding/base.py`
- Modify: `server/models/natural_language_understanding/deep_neural_network.py`
- Modify: `server/models/natural_language_understanding/transformer.py`

**Interfaces:**
- Consumes: `self._apply_hidden_layers(x, default=None)` from Task 1.
- Produces: NLU transformer honors `intent_loss_weight`/`slot_loss_weight`/`l2` and supports `hidden_layers` (legacy `units`/`activation` fallback); NLU DNN supports `hidden_layers` (additive) and its `pruning` path completes; NLU DNN's `architecture` string is fixed.

- [ ] **Step 1: DNN — fix the architecture-string bug**

In `server/models/natural_language_understanding/deep_neural_network.py` `__init__`, replace:

```python
        self.architecture = '   '
```

with:

```python
        self.architecture = 'deep_neural_network'
```

(Pre-existing bug found during the audit: three spaces instead of the architecture name, which corrupts `parameters.json` and breaks factory `load` for saved NLU DNN artifacts.)

- [ ] **Step 2: DNN — default parameter + build wiring**

Same file, `__init__` parameters dict — add the new key (keep every existing line, including the trailing-comma style):

```python
        self.parameters.update({
            'max_tokens': 10000,
            'sequence_length': 100,
            'embedding_dims': 64,
            'units': 64,
            'dropout': 0.2,
            'learning_rate': 1e-3,
            'weight_decay_rate': 0,
            'num_warmup_steps': 0,
            'intent_loss_weight': 1.0,
            'slot_loss_weight': 1.0,
            'hidden_layers': [],
        })
```

In `build`, after the **second** `x = tf.keras.layers.Dropout(dropout)(x)` (the one right after the bidirectional LSTM, immediately before `intents = tf.keras.layers.GlobalAveragePooling1D()(x)`), insert:

```python
        x = self._apply_hidden_layers(x)
```

so the stack feeds both the pooled intent head and the per-token slot head.

- [ ] **Step 3: Transformer — defaults, hidden stack, l2 heads, loss weights**

In `server/models/natural_language_understanding/transformer.py`:

`__init__` parameters dict — add three keys:

```python
        self.parameters.update({
            'pretrained_model': PRETRAINED_MODELS[0],
            'sequence_length': 128,
            'trainable': False,
            'units': 768,
            'dropout': 0.15,
            'l2': 0.01,
            'intent_loss_weight': 1.0,
            'slot_loss_weight': 1.0,
            'learning_rate': 2e-5,
            'num_train_steps': 1000,
            'weight_decay_rate': 0.01,
            'num_warmup_steps': 0
        })
```

In `build`, replace the hardcoded trunk dense:

```python
        sequences = tf.keras.layers.Dense(
            self.parameters.get('units', 768), 
            activation=self.parameters.get('activation', 'relu')
        )(sequences)
```

with:

```python
        sequences = self._apply_hidden_layers(
            sequences,
            default=[{
                'units': self.parameters.get('units', 768),
                'activation': self.parameters.get('activation', 'relu')
            }]
        )
```

Replace the two output heads to add l2 (matching the TC/NER transformers):

```python
        regularizer = tf.keras.regularizers.l2(self.parameters.get('l2', 0.01))

        # Intent head
        intents = tf.keras.layers.GlobalAveragePooling1D()(sequences)

        intents = tf.keras.layers.Dense(
            num_labels, activation='softmax',
            kernel_regularizer=regularizer, name='intents'
        )(intents)
        
        # Slot head
        slots = tf.keras.layers.Dense(
            num_tags, activation='softmax',
            kernel_regularizer=regularizer, name='slots'
        )(sequences)
```

Replace the compile call at the end of `build`:

```python
        model.compile(
            optimizer=optimizer,
            loss=loss,
            loss_weights={
                'intents': self.parameters.get('intent_loss_weight', 1.0),
                'slots': self.parameters.get('slot_loss_weight', 1.0)
            },
            metrics=metrics
        )
```

- [ ] **Step 4: NLU base — pruning validation, callback, strip**

In `server/models/natural_language_understanding/base.py` `train`:

(a) After `X, y = self.X_train, self.y_train` (end of the augmentation block) and before `self.parameters.update({...})`, insert the same validation TC base uses:

```python
        if kwargs.get('pruning', False):
            initial_sparsity = kwargs.get('initial_sparsity', 0)
            final_sparsity = kwargs.get('final_sparsity', 0.5)
            begin_step = kwargs.get('pruning_begin_step', 0)
            end_step = kwargs.get('pruning_end_step', 1000)
            if not 0 <= initial_sparsity < final_sparsity < 1:
                raise ValueError('Pruning sparsity must satisfy 0 <= initial < final < 1.')
            if begin_step < 0 or end_step <= begin_step:
                raise ValueError('Pruning end step must be greater than its begin step.')
```

(b) After the existing early-stopping block:

```python
        callbacks = kwargs.get('callbacks', [])
        if kwargs.get('early_stopping', True):
            import tensorflow as tf
            callbacks.append(tf.keras.callbacks.EarlyStopping(
                monitor=kwargs.get('monitor', 'val_loss'),
                patience=kwargs.get('patience', 3),
                restore_best_weights=True
            ))
```

append:

```python
        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            callbacks.append(tfmot.sparsity.keras.UpdatePruningStep())
```

(c) After `self.parameters['epochs'] = len(self.history.history.get('loss', []))` and before `return self._history_to_dict(self.history)`, insert:

```python
        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            self.model = tfmot.sparsity.keras.strip_pruning(self.model)
```

- [ ] **Step 5: Verification script**

Write `$SCRATCH/check_nlu.py`:

```python
import numpy as np
import tensorflow as tf
from server.models.natural_language_understanding import NaturalLanguageUnderstanding

TEXTS = ['book a flight to paris', 'play jazz music', 'weather in delhi', 'wake me at seven'] * 4

# --- DNN: architecture string, hidden stack, pruning build+fit+strip ---
dnn = NaturalLanguageUnderstanding.create('deep_neural_network')
assert dnn.architecture == 'deep_neural_network', repr(dnn.architecture)
dnn.labels = {0: 'book', 1: 'play', 2: 'weather', 3: 'alarm'}
dnn.tags = {0: 'O', 1: 'B-city', 2: 'B-time'}
X = dnn.preprocess_x(TEXTS)
seq_len = X.shape[1]
y_int = np.array([0, 1, 2, 3] * 4)
y_slt = np.full((len(TEXTS), seq_len), -100, dtype=np.int32)
y_slt[:, :4] = np.random.randint(0, 3, size=(len(TEXTS), 4))

model = dnn.build(num_labels=4, num_tags=3,
                  hidden_layers=[{'units': 40, 'activation': 'relu'}],
                  pruning=True, pruning_end_step=10)
import tensorflow_model_optimization as tfmot
model.fit(X, [y_int, y_slt], epochs=1, batch_size=4, verbose=0,
          callbacks=[tfmot.sparsity.keras.UpdatePruningStep()])
stripped = tfmot.sparsity.keras.strip_pruning(model)
assert not any('prune_low_magnitude' in l.name for l in stripped.layers)
assert any(isinstance(l, tf.keras.layers.Dense) and l.units == 40 for l in stripped.layers)
print('OK: NLU DNN')

# --- Transformer: loss weights honored, l2 on heads, hidden stack ---
bert = NaturalLanguageUnderstanding.create('transformer')
bert.labels = dnn.labels
bert.tags = dnn.tags
model = bert.build(num_labels=4, num_tags=3,
                   intent_loss_weight=2.0, slot_loss_weight=0.5,
                   l2=0.0,  # kill regularization so the loss identity below is exact
                   hidden_layers=[{'units': 64, 'activation': 'relu'}])
Xb = bert.preprocess_x(TEXTS)
yb = np.full((len(TEXTS), 128), -100, dtype=np.int32)
yb[:, 1:5] = np.random.randint(0, 3, size=(len(TEXTS), 4))
results = model.evaluate(Xb, [y_int, yb], batch_size=4, verbose=0, return_dict=True)
combined = 2.0 * results['intents_loss'] + 0.5 * results['slots_loss']
assert abs(results['loss'] - combined) < 1e-3, (results['loss'], combined)
units = [l.units for l in model.layers if isinstance(l, tf.keras.layers.Dense)]
assert 64 in units, units
# legacy fallback: no hidden_layers -> Dense(units, activation)
bert2 = NaturalLanguageUnderstanding.create('transformer')
bert2.labels = dnn.labels
bert2.tags = dnn.tags
model2 = bert2.build(num_labels=4, num_tags=3, units=100)
units2 = [l.units for l in model2.layers if isinstance(l, tf.keras.layers.Dense)]
assert 100 in units2, units2
print('OK: NLU transformer')
```

Run: `PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_nlu.py`
Expected: `OK: NLU DNN` then `OK: NLU transformer`

- [ ] **Step 6: Syntax check + ledger**

Run: `./venv/bin/python3 -m py_compile server/models/natural_language_understanding/base.py server/models/natural_language_understanding/deep_neural_network.py server/models/natural_language_understanding/transformer.py`
Expected: silent success. Ledger: `- Task 4 done: NLU loss_weights + l2 + pruning wiring + hidden_layers + architecture-string bugfix, verified via check_nlu.py`.

---

### Task 5: Backend integration sweep

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: everything Tasks 1–4 produced.

- [ ] **Step 1: Import sweep**

Run: `PYTHONPATH=. ./venv/bin/python3 -c "import server.models; from server.models.text_classification import TextClassification; from server.models.named_entity_recognition import NamedEntityRecognition; from server.models.natural_language_understanding import NaturalLanguageUnderstanding; print('imports OK')"`
Expected: `imports OK`

- [ ] **Step 2: Re-run all three task scripts back-to-back**

Run:

```bash
PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_hidden_helper.py && \
PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_tc_hidden.py && \
PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_ner.py && \
PYTHONPATH=. ./venv/bin/python3 $SCRATCH/check_nlu.py
```

Expected: all four `OK:` lines, exit 0.

- [ ] **Step 3: Default-graph regression check**

Confirm that with **no** kwargs, each architecture still builds its pre-change layer sequence (hidden stacks default empty / legacy fallback). Run:

```bash
PYTHONPATH=. ./venv/bin/python3 - <<'EOF'
import tensorflow as tf
from server.models.text_classification import TextClassification
from server.models.named_entity_recognition import NamedEntityRecognition

def dense_units(model):
    return [l.units for l in model.layers if isinstance(l, tf.keras.layers.Dense)]

texts = ['alpha beta', 'gamma delta', 'epsilon zeta', 'eta theta']

dnn = TextClassification.create('deep_neural_network'); dnn.labels = {0: 'a', 1: 'b'}
dnn.preprocess_x(texts)
assert dense_units(dnn.build(num_classes=2)) == [2]

rnn = TextClassification.create('recurrent_neural_network'); rnn.labels = dnn.labels
rnn.preprocess_x(texts)
assert dense_units(rnn.build(num_classes=2)) == [64, 2]

ner = NamedEntityRecognition.create('recurrent_neural_network'); ner.labels = {0: 'O', 1: 'B-X'}
ner.preprocess_x(texts)
assert dense_units(ner.build(num_classes=2)) == [2]

print('OK: default graphs unchanged')
EOF
```

Expected: `OK: default graphs unchanged`

- [ ] **Step 4: Ledger**

Ledger: `- Task 5 done: integration sweep green (imports, all task scripts, default-graph regression)`.

---

### Task 6: Frontend — parameter registry, sliders, hidden-layers editor

**Files:**
- Modify: `src/routes/model/routes/history/History.jsx`

**Interfaces:**
- Consumes: the backend parameter names exactly as defined in Tasks 2–4 (`hidden_layers` as `[{units, activation}]`, `intent_loss_weight`, `slot_loss_weight`, `l2`, `recurrent_layer`, `bidirectional`, `recurrent_dropout`, `lstm_dims`, `units`).
- Produces: the training-config modal renders entirely from `resolveParameters(modelType, architecture)`; `handleTrain` still POSTs the flat `paramters` object to `/api/models/:id/trainings/:id/start`.

**Anchor map (line numbers from the current file):** constants block to replace spans `ARCHITECTURES_BY_MODEL` (~line 224) through `PARAMETER_TABS` (~line 428), keeping `PRETRAINED_MODELS` (215), `ARCHITECTURE_LABELS` (363), `SAVE_FORMAT_OPTIONS` (400), and `TrainingField` (432). Component-level helpers to replace live between ~line 1616 (`architectureOptions`) and ~1794 (`renderSwitchControl`), and the modal form body at ~2302–2436.

- [ ] **Step 1: Replace the metadata constants**

Delete `ARCHITECTURE_DEFAULTS`, `getDefaultParameters`, `getTrainingStartParameters`, `PARAMETER_DOCS`, `PARAMETER_LABELS`, and `PARAMETER_TABS`. Keep `PRETRAINED_MODELS`, `ARCHITECTURE_LABELS`, `SAVE_FORMAT_OPTIONS`, `TrainingField` where they are. Insert in their place:

```jsx
const ARCHITECTURES_BY_MODEL = {
    text_classification: ['deep_neural_network', 'recurrent_neural_network', 'transformer'],
    named_entity_recognition: ['recurrent_neural_network', 'transformer'],
    natural_language_understanding: ['deep_neural_network', 'transformer']
};

const ACTIVATION_OPTIONS = [['relu', 'ReLU'], ['tanh', 'Tanh'], ['gelu', 'GELU'], ['elu', 'ELU']];

const MONITOR_OPTIONS = [
    ['accuracy', 'accuracy'],
    ['loss', 'loss'],
    ['val_accuracy', 'validation accuracy'],
    ['val_loss', 'validation loss']
];

// NLU compiles per-head metrics (intents_accuracy / slots_accuracy), so plain
// accuracy is not a valid early-stopping monitor there.
const NLU_MONITOR_OPTIONS = [['loss', 'loss'], ['val_loss', 'validation loss']];

const MAX_HIDDEN_LAYERS = 6;
const HIDDEN_LAYER_UNITS = { min: 16, max: 1024, step: 16 };

// Every form field is declared here and rendered generically:
// { control: 'slider' | 'select' | 'switch' | 'layers', tab, default,
//   min/max/step (sliders), scale: 'log' (sliders), options (selects),
//   label, help, showIf?(params) }
const COMMON_PARAMETERS = {
    test_split: { control: 'slider', tab: 'data', default: 0.2, min: 0.05, max: 0.5, step: 0.05, label: 'Test split', help: 'Fraction of the dataset held out to evaluate the trained model.' },
    validation_split: { control: 'slider', tab: 'data', default: 0.1, min: 0, max: 0.5, step: 0.05, label: 'Validation split', help: 'Fraction of the training data used to validate the model after each epoch.' },
    epochs: { control: 'slider', tab: 'schedule', default: 100, min: 1, max: 1000, step: 1, label: 'Epochs', help: 'Maximum number of passes over the training data.' },
    batch_size: { control: 'slider', tab: 'schedule', default: 32, min: 4, max: 128, step: 4, label: 'Batch size', help: 'Number of examples processed per optimisation step.' },
    learning_rate: { control: 'slider', tab: 'schedule', scale: 'log', default: 0.001, min: 0.000001, max: 0.01, label: 'Learning rate', help: 'Step size the optimiser uses to update the weights.' },
    weight_decay_rate: { control: 'slider', tab: 'schedule', default: 0, min: 0, max: 0.1, step: 0.001, label: 'Weight decay', help: 'L2 penalty applied by the optimiser to keep weights small. Zero disables it.' },
    num_warmup_steps: { control: 'slider', tab: 'schedule', default: 0, min: 0, max: 5000, step: 10, label: 'Warmup steps', help: 'Steps over which the learning rate ramps up from zero before decaying.' },
    early_stopping: { control: 'switch', tab: 'callbacks', default: true, label: 'Early stopping', help: 'Stop training early once the monitored metric stops improving, keeping the best weights.' },
    monitor: { control: 'select', tab: 'callbacks', default: 'val_loss', options: MONITOR_OPTIONS, label: 'Monitor', help: 'Metric watched by early stopping.', showIf: (params) => params.early_stopping },
    patience: { control: 'slider', tab: 'callbacks', default: 10, min: 1, max: 50, step: 1, label: 'Patience', help: 'Epochs without improvement before training is stopped.', showIf: (params) => params.early_stopping },
    save_format: { control: 'select', tab: 'export', default: 'tf', options: SAVE_FORMAT_OPTIONS, label: 'Save format', help: 'Format the trained model is exported in for download and serving.' }
};

const PRUNING_PARAMETERS = {
    pruning: { control: 'switch', tab: 'callbacks', default: false, label: 'Weight pruning', help: 'Gradually zero out low-magnitude weights during training to produce a smaller, faster model.' },
    initial_sparsity: { control: 'slider', tab: 'callbacks', default: 0, min: 0, max: 0.9, step: 0.05, label: 'Initial sparsity', help: 'Fraction of weights zeroed when pruning begins.', showIf: (params) => params.pruning },
    final_sparsity: { control: 'slider', tab: 'callbacks', default: 0.5, min: 0.1, max: 0.95, step: 0.05, label: 'Final sparsity', help: 'Fraction of weights zeroed by the end of pruning.', showIf: (params) => params.pruning },
    pruning_begin_step: { control: 'slider', tab: 'callbacks', default: 0, min: 0, max: 10000, step: 100, label: 'Pruning begin step', help: 'Training step at which pruning starts.', showIf: (params) => params.pruning },
    pruning_end_step: { control: 'slider', tab: 'callbacks', default: 1000, min: 100, max: 50000, step: 100, label: 'Pruning end step', help: 'Training step at which pruning stops.', showIf: (params) => params.pruning },
    pruning_frequency: { control: 'slider', tab: 'callbacks', default: 100, min: 1, max: 1000, step: 1, label: 'Pruning frequency', help: 'Number of steps between sparsity updates.', showIf: (params) => params.pruning }
};

const hiddenLayersField = (defaultLayers) => ({
    control: 'layers', tab: 'model', default: defaultLayers,
    label: 'Hidden layers',
    help: 'Extra dense layers applied just before the output head — configure units and activation per layer.'
});

const ARCHITECTURE_PARAMETERS = {
    deep_neural_network: {
        max_tokens: { control: 'slider', tab: 'model', default: 10000, min: 1000, max: 50000, step: 1000, label: 'Max tokens', help: 'Maximum vocabulary size of the tokenizer. Less frequent tokens are dropped.' },
        sequence_length: { control: 'slider', tab: 'model', default: 100, min: 16, max: 512, step: 4, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
        embedding_dims: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'Embedding dimensions', help: 'Size of the learned word embedding vectors.' },
        dropout: { control: 'slider', tab: 'model', default: 0.2, min: 0, max: 0.9, step: 0.05, label: 'Dropout rate', help: 'Fraction of units randomly dropped during training to reduce overfitting.' },
        hidden_layers: hiddenLayersField([])
    },
    recurrent_neural_network: {
        max_tokens: { control: 'slider', tab: 'model', default: 10000, min: 1000, max: 50000, step: 1000, label: 'Max tokens', help: 'Maximum vocabulary size of the tokenizer. Less frequent tokens are dropped.' },
        sequence_length: { control: 'slider', tab: 'model', default: 100, min: 16, max: 512, step: 4, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
        embedding_dims: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'Embedding dimensions', help: 'Size of the learned word embedding vectors.' },
        dropout: { control: 'slider', tab: 'model', default: 0.2, min: 0, max: 0.9, step: 0.05, label: 'Dropout rate', help: 'Fraction of units randomly dropped during training to reduce overfitting.' },
        hidden_layers: hiddenLayersField([])
    },
    transformer: {
        pretrained_model: { control: 'select', tab: 'model', default: PRETRAINED_MODELS[0], options: PRETRAINED_MODELS.map((name) => [name, name]), label: 'Pretrained model', help: 'Pretrained encoder the transformer is initialised from.' },
        trainable: { control: 'switch', tab: 'model', default: false, label: 'Trainable encoder', help: 'Fine-tune the pretrained encoder weights during training. Slower per epoch, but usually more accurate.' },
        sequence_length: { control: 'slider', tab: 'model', default: 128, min: 16, max: 512, step: 16, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
        dropout: { control: 'slider', tab: 'model', default: 0.15, min: 0, max: 0.9, step: 0.05, label: 'Dropout rate', help: 'Fraction of units randomly dropped during training to reduce overfitting.' },
        l2: { control: 'slider', tab: 'model', default: 0.01, min: 0, max: 0.1, step: 0.001, label: 'L2 regularisation', help: 'L2 penalty on the output head weights.' },
        hidden_layers: hiddenLayersField([{ units: 768, activation: 'relu' }]),
        epochs: { ...COMMON_PARAMETERS.epochs, default: 5, max: 100 },
        batch_size: { ...COMMON_PARAMETERS.batch_size, default: 16 },
        learning_rate: { ...COMMON_PARAMETERS.learning_rate, default: 0.00002, max: 0.001 },
        weight_decay_rate: { ...COMMON_PARAMETERS.weight_decay_rate, default: 0.01 },
        patience: { ...COMMON_PARAMETERS.patience, default: 3 }
    }
};

// Per-model-type patches over the architecture metadata. A field listed here
// replaces the base entry wholesale; new fields append.
const TYPE_OVERRIDES = {
    text_classification: {
        deep_neural_network: {
            epochs: { ...COMMON_PARAMETERS.epochs, default: 200 },
            ...PRUNING_PARAMETERS
        },
        recurrent_neural_network: {
            recurrent_layer: { control: 'select', tab: 'model', default: 'lstm', options: [['lstm', 'LSTM'], ['gru', 'GRU']], label: 'Recurrent layer', help: 'Type of recurrent cell.' },
            bidirectional: { control: 'switch', tab: 'model', default: true, label: 'Bidirectional', help: 'Process the sequence in both directions.' },
            units: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'Recurrent units', help: 'Number of units in the recurrent layer.' },
            recurrent_dropout: { control: 'slider', tab: 'model', default: 0.2, min: 0, max: 0.9, step: 0.05, label: 'Recurrent dropout', help: 'Dropout applied to the recurrent state transitions.' },
            hidden_layers: hiddenLayersField([{ units: 64, activation: 'relu' }]),
            ...PRUNING_PARAMETERS
        },
        transformer: {
            ...PRUNING_PARAMETERS
        }
    },
    named_entity_recognition: {
        recurrent_neural_network: {
            sequence_length: { control: 'slider', tab: 'model', default: 128, min: 16, max: 512, step: 4, label: 'Sequence length', help: 'Maximum number of tokens per example. Longer inputs are truncated, shorter ones padded.' },
            lstm_dims: { control: 'slider', tab: 'model', default: 100, min: 16, max: 512, step: 4, label: 'LSTM dimensions', help: 'Number of units in the bidirectional LSTM layer.' }
        },
        transformer: {
            hidden_layers: hiddenLayersField([{ units: 768, activation: 'tanh' }])
        }
    },
    natural_language_understanding: {
        deep_neural_network: {
            units: { control: 'slider', tab: 'model', default: 64, min: 16, max: 512, step: 16, label: 'LSTM units', help: 'Number of units in the bidirectional LSTM layer.' },
            intent_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Intent loss weight', help: 'Relative weight of the intent head in the combined loss.' },
            slot_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Slot loss weight', help: 'Relative weight of the slot head in the combined loss.' },
            monitor: { ...COMMON_PARAMETERS.monitor, options: NLU_MONITOR_OPTIONS },
            ...PRUNING_PARAMETERS
        },
        transformer: {
            intent_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Intent loss weight', help: 'Relative weight of the intent head in the combined loss.' },
            slot_loss_weight: { control: 'slider', tab: 'schedule', default: 1, min: 0, max: 5, step: 0.1, label: 'Slot loss weight', help: 'Relative weight of the slot head in the combined loss.' },
            monitor: { ...COMMON_PARAMETERS.monitor, options: NLU_MONITOR_OPTIONS }
        }
    }
};

// Resolved field metadata for one (model type, architecture) pair. Later
// spreads replace matching keys but keep their original insertion position,
// so tab ordering stays stable.
const resolveParameters = (modelType, architecture) => {
    const type = ARCHITECTURES_BY_MODEL[modelType] ? modelType : 'text_classification';
    return {
        ...COMMON_PARAMETERS,
        ...(ARCHITECTURE_PARAMETERS[architecture] || {}),
        ...(TYPE_OVERRIDES[type]?.[architecture] || {})
    };
};

const cloneDefault = (value) => (
    Array.isArray(value) ? value.map((item) => ({ ...item })) : value
);

const resolveDefaults = (modelType, architecture) => {
    const params = { architecture };
    Object.entries(resolveParameters(modelType, architecture)).forEach(([key, metadata]) => {
        params[key] = cloneDefault(metadata.default);
    });
    return params;
};

const getDefaultParameters = (modelType = 'text_classification') => {
    const architecture = ARCHITECTURES_BY_MODEL[modelType]?.[0] || 'deep_neural_network';
    return resolveDefaults(modelType, architecture);
};

const clampNumber = (value, { min, max }) => {
    let clamped = value;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    return clamped;
};

// Coerces a value carried over from a previous training run into something
// the declared control can represent (sliders clamp, selects fall back to
// the default, layer lists are sanitised entry by entry).
const clampParameterValue = (metadata, value) => {
    if (metadata.control === 'layers') {
        if (!Array.isArray(value)) return cloneDefault(metadata.default);
        return value.slice(0, MAX_HIDDEN_LAYERS).map((layer) => ({
            units: clampNumber(Number(layer?.units) || HIDDEN_LAYER_UNITS.min, HIDDEN_LAYER_UNITS),
            activation: ACTIVATION_OPTIONS.some(([option]) => option === layer?.activation)
                ? layer.activation
                : 'relu'
        }));
    }
    if (metadata.control === 'slider') {
        return typeof value === 'number' ? clampNumber(value, metadata) : metadata.default;
    }
    if (metadata.control === 'select') {
        return metadata.options.some(([option]) => option === value) ? value : metadata.default;
    }
    if (metadata.control === 'switch') return Boolean(value);
    return value;
};

const getTrainingStartParameters = (modelType = 'text_classification', training = null) => {
    // Trainings recorded before the rename stored the value as max_seq_len.
    const { max_seq_len, ...previousParameters } = training?.kwargs || {};
    if (max_seq_len !== undefined && previousParameters.sequence_length === undefined) {
        previousParameters.sequence_length = max_seq_len;
    }
    const availableArchitectures = ARCHITECTURES_BY_MODEL[modelType] || ARCHITECTURES_BY_MODEL.text_classification;
    const architecture = availableArchitectures.includes(previousParameters.architecture)
        ? previousParameters.architecture
        : availableArchitectures[0];
    const registry = resolveParameters(modelType, architecture);
    const params = resolveDefaults(modelType, architecture);

    // Runs that predate hidden_layers stored the hidden dense as
    // units/activation; migrate them where units isn't a first-class field
    // (i.e. everywhere except the recurrent/LSTM sizes).
    if (registry.hidden_layers && previousParameters.hidden_layers === undefined && !registry.units) {
        const { units, activation } = previousParameters;
        if (units !== undefined || activation !== undefined) {
            const fallback = params.hidden_layers[0] || { units: 64, activation: 'relu' };
            previousParameters.hidden_layers = [{
                units: units ?? fallback.units,
                activation: activation ?? fallback.activation
            }];
        }
    }

    Object.entries(registry).forEach(([key, metadata]) => {
        if (previousParameters[key] === undefined) return;
        params[key] = clampParameterValue(metadata, previousParameters[key]);
    });
    params.architecture = architecture;
    return params;
};

// Sliders cannot leave their declared ranges, so only cross-field rules are
// validated. Keys map to the offending field for inline display.
const validateParameters = (params) => {
    const errors = {};
    if (params.pruning) {
        if (!(params.initial_sparsity < params.final_sparsity)) {
            errors.final_sparsity = 'Final sparsity must be greater than initial sparsity.';
        }
        if (!(params.pruning_end_step > params.pruning_begin_step)) {
            errors.pruning_end_step = 'Must be greater than the pruning begin step.';
        }
    }
    return errors;
};

const LOG_SLIDER_RESOLUTION = 100;
const toLogPosition = (metadata, value) => Math.round(
    LOG_SLIDER_RESOLUTION * Math.log(value / metadata.min) / Math.log(metadata.max / metadata.min)
);
const fromLogPosition = (metadata, position) => Number(
    (metadata.min * Math.pow(metadata.max / metadata.min, position / LOG_SLIDER_RESOLUTION)).toPrecision(2)
);

const formatSliderValue = (metadata, value) => {
    if (typeof value !== 'number') return String(value);
    if (metadata.scale === 'log' || (value !== 0 && Math.abs(value) < 0.001)) return value.toExponential();
    return String(value);
};
```

- [ ] **Step 2: Replace the component-level form helpers**

Inside the `History` component, delete `monitorOptions`, `handleArchitectureChange`, `validateParameter`, `getEditableNumberFields`, `renderNumberControl`, the old `renderSliderControl`, and the old `renderSwitchControl`, plus the range-validation branches of `updateParameter` and `handleContinueTraining`. Replace with:

```jsx
    const architectureOptions = ARCHITECTURES_BY_MODEL[model?.kind || 'text_classification'] || ['deep_neural_network'];
    const registry = resolveParameters(model?.kind, paramters.architecture);

    const updateParameter = (field, value) => {
        const next = { ...paramters, [field]: value };
        setParameters(next);
        setParameterErrors(validateParameters(next));
    };

    const handleArchitectureChange = (architecture) => {
        setParameters({
            ...resolveDefaults(model?.kind, architecture),
            save_format: paramters.save_format
        });
        setParameterErrors({});
    };

    const renderSliderControl = (field, metadata) => {
        const value = typeof paramters[field] === 'number' ? paramters[field] : metadata.default;
        const isLog = metadata.scale === 'log';
        return (
            <Form.Group className="mb-3" controlId={`training-${field}`}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                    <Form.Label className="small fw-bold mb-0">{metadata.label}</Form.Label>
                    <span className="small text-muted font-monospace">{formatSliderValue(metadata, value)}</span>
                </div>
                <Form.Range
                    min={isLog ? 0 : metadata.min}
                    max={isLog ? LOG_SLIDER_RESOLUTION : metadata.max}
                    step={isLog ? 1 : metadata.step}
                    value={isLog ? toLogPosition(metadata, value) : value}
                    onChange={(e) => updateParameter(
                        field,
                        isLog ? fromLogPosition(metadata, parseInt(e.target.value)) : parseFloat(e.target.value)
                    )}
                />
                {parameterErrors[field] && (
                    <div className="small text-danger">{parameterErrors[field]}</div>
                )}
                <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>{metadata.help}</Form.Text>
            </Form.Group>
        );
    };

    const renderSwitchControl = (field, metadata) => (
        <div className="mb-3">
            <Form.Check
                type="switch"
                id={`training-${field}`}
                className="small"
                label={metadata.label}
                checked={Boolean(paramters[field])}
                onChange={(e) => updateParameter(field, e.target.checked)}
            />
            <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>{metadata.help}</Form.Text>
        </div>
    );

    const renderSelectControl = (field, metadata) => (
        <TrainingField id={`training-${field}`} label={metadata.label} help={metadata.help}>
            <Form.Select
                size="sm"
                value={paramters[field]}
                onChange={(e) => updateParameter(field, e.target.value)}
            >
                {metadata.options.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                ))}
            </Form.Select>
        </TrainingField>
    );

    const renderHiddenLayersControl = (field, metadata) => {
        const layers = Array.isArray(paramters[field]) ? paramters[field] : [];
        const updateLayer = (index, patch) => updateParameter(
            field,
            layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer))
        );
        return (
            <Form.Group className="mb-3" controlId={`training-${field}`}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                    <Form.Label className="small fw-bold mb-0">{metadata.label}</Form.Label>
                    <Button
                        variant="light"
                        size="sm"
                        className="border py-0 px-2 small"
                        disabled={layers.length >= MAX_HIDDEN_LAYERS}
                        onClick={() => updateParameter(field, [...layers, { units: 64, activation: 'relu' }])}
                    >
                        <PlusLg />&nbsp;layer
                    </Button>
                </div>
                {layers.length === 0 && (
                    <div className="small text-muted fst-italic mb-1">
                        No hidden layers — the network connects straight to the output head.
                    </div>
                )}
                {layers.map((layer, index) => (
                    <div key={index} className="d-flex align-items-center gap-2 mb-2">
                        <span className="small text-muted font-monospace" style={{ width: '1.25rem' }}>{index + 1}</span>
                        <Form.Range
                            className="flex-grow-1"
                            min={HIDDEN_LAYER_UNITS.min}
                            max={HIDDEN_LAYER_UNITS.max}
                            step={HIDDEN_LAYER_UNITS.step}
                            value={layer.units}
                            onChange={(e) => updateLayer(index, { units: parseInt(e.target.value) })}
                        />
                        <span className="small text-muted font-monospace text-end" style={{ width: '3rem' }}>{layer.units}</span>
                        <Form.Select
                            size="sm"
                            style={{ width: '6.5rem' }}
                            value={layer.activation}
                            onChange={(e) => updateLayer(index, { activation: e.target.value })}
                        >
                            {ACTIVATION_OPTIONS.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </Form.Select>
                        <Button
                            variant="link"
                            className="p-0 text-danger"
                            aria-label={`Remove layer ${index + 1}`}
                            onClick={() => updateParameter(field, layers.filter((_, i) => i !== index))}
                        >
                            <Trash />
                        </Button>
                    </div>
                ))}
                <Form.Text className="text-muted d-block" style={{ fontSize: '0.7rem' }}>{metadata.help}</Form.Text>
            </Form.Group>
        );
    };

    const renderTabFields = (tab) => (
        <Row>
            {Object.entries(registry)
                .filter(([, metadata]) => metadata.tab === tab)
                .map(([field, metadata]) => {
                    if (metadata.showIf && !metadata.showIf(paramters)) return null;
                    const fullWidth = ['switch', 'layers'].includes(metadata.control) || field === 'pretrained_model';
                    return (
                        <Col sm={fullWidth ? 12 : 6} key={field}>
                            {metadata.control === 'slider' && renderSliderControl(field, metadata)}
                            {metadata.control === 'switch' && renderSwitchControl(field, metadata)}
                            {metadata.control === 'select' && renderSelectControl(field, metadata)}
                            {metadata.control === 'layers' && renderHiddenLayersControl(field, metadata)}
                        </Col>
                    );
                })}
        </Row>
    );

    const handleContinueTraining = (event) => {
        event.preventDefault();
        const errors = validateParameters(paramters);
        setParameterErrors(errors);
        if (Object.keys(errors).length > 0) {
            setTrainingTab('callbacks');
            return;
        }
        setShowStartConfirmation(true);
    };
```

Keep `handleOpenStartTraining`, `handleCloseStartTraining`, `handleBackToParameters`, `handleTrain` unchanged. Replace `formatSummaryValue` and `trainingSummary` with:

```jsx
    // Every parameter sent to the server, recapped in the start confirmation.
    const formatSummaryValue = (field, value) => {
        if (field === 'architecture') return ARCHITECTURE_LABELS[value] || value;
        if (field === 'hidden_layers') {
            return Array.isArray(value) && value.length > 0
                ? value.map((layer) => `${layer.units}·${layer.activation}`).join(' → ')
                : 'none';
        }
        if (typeof value === 'boolean') return value ? 'on' : 'off';
        return String(value);
    };

    const trainingSummary = Object.entries(paramters).map(([field, value]) => [
        field,
        registry[field]?.label || field.replace(/_/g, ' '),
        formatSummaryValue(field, value)
    ]);
```

- [ ] **Step 3: Replace the modal form body**

Replace the entire `<Tabs ...>` block inside the training-configuration `<Form noValidate onSubmit={handleContinueTraining}>` (everything between `<div style={{ minHeight: '18rem' }}>` and its closing `</div>`) with:

```jsx
                                <Tabs
                                    variant="pills"
                                    activeKey={trainingTab}
                                    onSelect={(key) => setTrainingTab(key)}
                                    className="small mb-3"
                                    justify
                                >
                                    <Tab eventKey="data" title="Data">
                                        {renderTabFields('data')}
                                    </Tab>
                                    <Tab eventKey="model" title="Model">
                                        <TrainingField
                                            id="training-architecture"
                                            label="Architecture"
                                            help="Network architecture the model is built with. Changing it resets the settings below to the architecture defaults."
                                        >
                                            <Form.Select
                                                size="sm"
                                                value={paramters.architecture}
                                                onChange={(e) => handleArchitectureChange(e.target.value)}
                                            >
                                                {architectureOptions.map((architecture) => (
                                                    <option key={architecture} value={architecture}>
                                                        {ARCHITECTURE_LABELS[architecture] || architecture}
                                                    </option>
                                                ))}
                                            </Form.Select>
                                        </TrainingField>
                                        {renderTabFields('model')}
                                    </Tab>
                                    <Tab eventKey="schedule" title="Schedule">
                                        {renderTabFields('schedule')}
                                    </Tab>
                                    <Tab eventKey="callbacks" title="Callbacks">
                                        {renderTabFields('callbacks')}
                                    </Tab>
                                    <Tab eventKey="export" title="Export">
                                        {renderTabFields('export')}
                                    </Tab>
                                </Tabs>
```

The CANCEL/CONTINUE button row below the tabs and the confirmation body above stay unchanged.

- [ ] **Step 4: Dead-reference sweep**

Run: `grep -n "ARCHITECTURE_DEFAULTS\|PARAMETER_DOCS\|PARAMETER_LABELS\|PARAMETER_TABS\|renderNumberControl\|getEditableNumberFields\|validateParameter\b\|monitorOptions" src/routes/model/routes/history/History.jsx`
Expected: no output (all deleted symbols fully gone; `validateParameters` — plural — is the only survivor and is not matched by `validateParameter\b`).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exit 0. Vite warnings are fine; errors are not.

- [ ] **Step 6: Ledger**

Ledger: `- Task 6 done: History.jsx registry + sliders + hidden-layers editor, npm run build green`.

---

## Self-review checklist (run after all tasks)

- Every parameter named in the spec's frontend section is present in the registry: `recurrent_layer`, `bidirectional`, `units` (TC RNN + NLU DNN), `recurrent_dropout`, `lstm_dims`, `l2`, `intent_loss_weight`, `slot_loss_weight`, `hidden_layers`, plus all pre-existing fields.
- No `model?.kind` conditionals remain inside the training modal JSX.
- `grep -rn "hidden_layers" server/models/` shows: base helper, TC DNN default `[]`, TC RNN/TC transformer/NER transformer/NLU transformer fallback call sites, NER RNN default `[]` + Sequential loop, NLU DNN default `[]`.
- `npm run build` and the Task 5 sweep both green.
