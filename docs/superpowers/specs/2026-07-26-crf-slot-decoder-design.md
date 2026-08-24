# CRF decoder for the token-tagging heads

Date: 2026-07-26
Status: approved

## Problem

The NLU slot head over-tags. On voice-assistant v0.5 (110 slot tags) the held-out
numbers are recall **0.87** but precision **0.29** — the head finds most real slot
tokens, but roughly seven in ten tokens it labels are wrong (an `O` mislabelled, or
the wrong slot type). Token accuracy (0.61) hides this because `O` dominates; F1
(0.39) and MCC (0.47) expose it. Train and validation slot F1 are close
(0.45 vs 0.39), so this is a *precision* problem, not overfitting.

A per-token softmax head predicts each position independently, so nothing forbids
structurally invalid tag sequences (`I-time` following `O`, or `I-city` following
`B-date`). A linear-chain CRF scores whole tag sequences and removes that class of
false positive. NER has the identical head shape and failure mode.

## Constraints

Publishing supports four artifact formats (`saved_model`/`h5`/`tflite`/`onnx`)
and serving dispatches across Keras, TFLite and ONNX runtimes
(`_predict_with_model`, `server/models/base.py`). Any design that puts Viterbi
control flow **inside** the graph breaks `tflite` and `onnx` export and needs
`custom_objects` on every load.

`tensorflow_addons` — the canonical `crf_log_likelihood` — is **not installed**
and is end-of-life (last release supports TF ≤ 2.14; this project runs TF 2.15).
It is not an option.

## Design

### 1. `server/models/crf.py` (new)

- `CRFTransitions(Layer)` — pass-through layer owning the `(num_tags, num_tags)`
  transition weight. Its `call` returns emissions unchanged, so the exported
  graph stays exactly what it is today and every export format keeps working.
  Gradients reach the weight because the loss references it.
- `crf_log_likelihood(emissions, tags, mask, transitions)` — forward algorithm.
- `CRFLoss(Loss)` — mean negative log-likelihood over real tokens; drop-in for
  `NonPaddingLoss` on the tag head, same `-100` masking contract.
- `viterbi_decode(emissions, transitions, legal)` — pure numpy.
- `iob_transition_mask(tags)` — legality mask from the tag vocabulary: `I-X` may
  only follow `B-X` or `I-X`, and may not start a sequence.

Masked positions are **skipped**, not treated as sequence ends: the transformer
aligners emit `-100` for `[CLS]`, `[SEP]` and every non-initial sub-word, so
masked positions appear *between* real tokens. Both the likelihood and the gold
sequence score walk the chain over unmasked positions only.

### 2. One decode path

Decoding is always Viterbi with the legality mask applied and
`transitions = learned matrix, or zeros when absent`. Viterbi + legality mask +
zero transitions *is* constrained decoding, so existing artifacts (v0.1–v0.5,
which have no sidecar) get the structural fix through the same code path with no
special-casing.

Decode runs on the **word-level** emission sequence: `_word_positions` already
maps each whitespace word to its sequence position (identity for the DNN, first
sub-word for transformers), so gathering those positions yields exactly the
sequence IOB legality is defined over. Two call sites change:
`named_entity_recognition/base.py` and `_word_tags` in
`natural_language_understanding/base.py`.

Reported span scores keep their current meaning — the softmax probability of the
chosen tag, which under Viterbi need not be the per-token argmax.

### 3. Wiring

`crf` (bool, default **true**) is added to the form registry for NLU
DNN/transformer and NER RNN/transformer, with matching backend `__init__`
defaults. When enabled, `build()` wraps the tag emissions in `CRFTransitions`
and uses `CRFLoss` in place of `NonPaddingLoss`.

**Per-token class weights are dropped for the tag head when CRF is on** —
sequence likelihood has no per-token weighting. This is expected to help
precision, since the balanced weights currently push the head toward predicting
rare tags aggressively.

### 4. Persistence

The transition matrix is written as a `crf.npy` sidecar beside `vocab.txt` /
`vectorizer.pkl`, saved and loaded in the NLU and NER **base** classes so every
architecture inherits it. The sidecar — not the graph — is the source of truth at
decode time, which is what lets TFLite and ONNX serving use the CRF at all.

## Known caveat

Live training curves (`slots_accuracy`, `slots_f1`) are Keras metrics computed on
**emissions argmax**, not Viterbi, so they understate the CRF's real quality.
Final `evaluate()` decodes with Viterbi and reports the true numbers. The gap
between the two is itself a useful signal.

## Verification

- **Brute force**: for a tiny case (3 tags, 4 timesteps) enumerate all 3⁴ tag
  sequences and assert `crf_log_likelihood` equals the exact log-partition
  function, and that `viterbi_decode` returns the true highest-scoring sequence.
  This is the correctness proof for the CRF math.
- Masking: assert a sequence with interior masked positions scores identically to
  the compacted sequence without them.
- `python -m py_compile` on every touched backend file; `npm run build`.
- A short end-to-end fit confirming loss decreases and transitions move off zero.

## Risks

Highest blast radius so far — this changes the training objective and the
inference decode for two model types. Contained by: the unchanged export graph,
the brute-force tests, and the `crf` toggle for A/B comparison. Existing
published artifacts change decode behaviour (to constrained decoding), which is
the intended improvement.
