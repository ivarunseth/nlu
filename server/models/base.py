import os
import json
import pandas as pd
import numpy as np
import tensorflow as tf
import onnxruntime as ort

from sklearn.utils import compute_class_weight

class BaseModel:    
    """
    Base class for all NLU models.
    """
    SAVED_MODEL_FORMATS = {'saved_model', 'tf', 'pb'}
    WEIGHTS_FORMATS = {'weights', 'h5'}

    def __init__(self):
        self.X_train = None
        self.y_train = None
        self.X_test = None
        self.y_test = None
        self.model = None
        self.config = None
        self.parameters = {}
        self.labels = None
        self.tags = None
        # Language understanding only: the {intent: {slot: entity}} map
        # persisted with the artifact so inference can report each predicted
        # slot's entity. Metadata for enrichment — never a training input.
        self.slots = None
        self.processor = None
        self.model_type = None
        self.architecture = None
        self.history = None
        # Processed (inputs, targets, validation_split) handed to model.fit;
        # TrainingCallback reads it to compute an untrained baseline.
        self._fit_data = None

    @staticmethod
    def _read_json(path, default=None):
        if not os.path.exists(path):
            return default
        with open(path, 'r', encoding='utf-8') as file:
            return json.load(file)

    @staticmethod
    def _write_json(path, data):
        def default(obj):
            if isinstance(obj, (np.ndarray, np.generic)):
                return obj.tolist() if isinstance(obj, np.ndarray) else obj.item()
            return str(obj)

        with open(path, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=4, default=default)

    @staticmethod
    def _create_directory(path):
        os.makedirs(path, exist_ok=True)

    def _history_to_dict(self, history):
        history_dict = history.history if hasattr(history, 'history') else history or {}
        return {key: np.asarray(value).tolist() for key, value in history_dict.items()}

    def _get_summary(self):
        """
        Returns the model summary as a string.
        """
        if isinstance(self.model, tf.keras.Model):
            summary = []
            self.model.summary(print_fn=lambda line: summary.append(line))
            return '\n'.join(summary)
        return None

    def _write_summary(self, path):
        summary = self._get_summary()
        if summary:
            with open(os.path.join(path, 'summary.txt'), 'w', encoding='utf-8') as file:
                file.write(summary)

    def _prune_model(self, model: tf.keras.models.Model):
        import tensorflow_model_optimization as tfmot
        from tensorflow_model_optimization.python.core.sparsity.keras import pruning_wrapper

        class MaskAgnosticPruneLowMagnitude(pruning_wrapper.PruneLowMagnitude):
            """
            ``Dense.call()`` takes no ``mask``, but the wrapper's ``**kwargs``
            call signature makes Keras forward any propagated mask (e.g. from
            an ``Embedding(mask_zero=True)``) into it, which it then blindly
            delegates. Drop the mask before delegating; loss-level masking is
            handled separately via the ``-100`` sentinel.
            """
            def __init__(self, layer, **kwargs):
                super().__init__(layer, **kwargs)
                # tfmot force-prefixes the wrapper's name; restore the wrapped
                # layer's own name so dict-keyed losses/metrics (e.g. NLU's
                # 'intents'/'slots' heads) still resolve model output names.
                self._name = layer.name

            def call(self, inputs, training=None, **kwargs):
                kwargs.pop('mask', None)
                return super().call(inputs, training=training, **kwargs)

        pruning_schedule = tfmot.sparsity.keras.PolynomialDecay(
            initial_sparsity=self.parameters.get("initial_sparsity", 0),
            final_sparsity=self.parameters.get("final_sparsity", 0.5),
            begin_step=self.parameters.get("pruning_begin_step", 0),
            end_step=self.parameters.get("pruning_end_step", 1000),
            frequency=self.parameters.get("pruning_frequency", 100),
        )

        def apply_pruning(layer):
            # Only Dense layers are wrapped. tensorflow_model_optimization is
            # backed by the parallel tf_keras package, and its PruneRegistry
            # does not recognise this package's recurrent layers — wrapping
            # LSTM/GRU directly raises "unsupported layer", and cloning a
            # Bidirectional via from_config deserialises its inner RNN into
            # tf_keras classes this package's Bidirectional then rejects. So
            # recurrent weights stay dense; the Dense stack and heads (where
            # most weights live for these models) are pruned.
            if isinstance(layer, tf.keras.layers.Dense):
                return MaskAgnosticPruneLowMagnitude(
                    layer,
                    pruning_schedule=pruning_schedule,
                )

            return layer

        return tf.keras.models.clone_model(
            model,
            clone_function=apply_pruning
        )

    def _metrics(self, num_classes, masked=False):
        """
        Per-epoch metrics for one head, from ``parameters['metrics']``.

        ``parameters`` is updated with the training kwargs before ``build()``
        runs, so the selection is readable here the same way the loss weights
        are. ``masked=True`` selects the sequence-labelling variants, which
        ignore the ``-100`` padding / sub-word positions. Unknown or empty
        selections fall back to accuracy — see ``normalize_metrics``.
        """
        from .metrics import build_metrics
        return build_metrics(self.parameters.get('metrics'), num_classes, masked=masked)

    def _hidden_layer(self, config, sequences):
        """
        Builds one layer of the hidden stack from a ``hidden_layers`` entry.

        ``sequences`` says whether the layer receives a 3-D
        (batch, time, features) tensor. Recurrent types are only valid there,
        and always return sequences so the stack stays shape-preserving on
        the time axis for the token-level heads and pooling that follow it.
        """
        layer_type = config.get('type', 'dense')
        if layer_type == 'dense':
            return tf.keras.layers.Dense(config['units'], activation=config['activation'])
        if layer_type in ('lstm', 'gru'):
            if not sequences:
                raise ValueError(
                    "Hidden layer type '%s' needs sequence input, but this "
                    "model's hidden stack runs on pooled features — use 'dense'."
                    % layer_type
                )
            recurrent = tf.keras.layers.LSTM if layer_type == 'lstm' else tf.keras.layers.GRU
            return recurrent(config['units'], activation=config['activation'], return_sequences=True)
        raise ValueError("Unknown hidden layer type: %r" % layer_type)

    def _apply_hidden_layers(self, x, default=None):
        """
        Applies the configurable hidden stack from
        ``parameters['hidden_layers']`` to ``x`` and returns the result.

        ``hidden_layers`` is a list of
        ``{'units': int, 'activation': str, 'type': str}`` dicts applied in
        order; ``type`` is optional and defaults to ``'dense'``. ``Dense``
        acts on the last axis, so it serves 2-D feature tensors and 3-D
        sequence tensors alike; ``'lstm'``/``'gru'`` are valid only on 3-D
        sequence tensors (see ``_hidden_layer``). When the parameter is
        absent entirely, ``default`` is used instead — the hook for
        architectures whose configurations predate ``hidden_layers`` and
        persisted a single hidden dense as ``units``/``activation``. An empty
        list is a valid no-op.
        """
        layers = self.parameters.get('hidden_layers')
        if layers is None:
            layers = default or []
        # return_sequences=True keeps recurrent layers rank-preserving, so
        # one rank check covers the whole stack.
        sequences = len(x.shape) == 3
        for layer in layers:
            x = self._hidden_layer(layer, sequences)(x)
        return x

    def _save_model_file(self, path, save_format):
        save_format = (save_format or 'saved_model').lower()
        if save_format == 'keras':
            save_format = 'saved_model'

        if save_format in self.SAVED_MODEL_FORMATS:
            self.model.save(os.path.join(path, 'model'), include_optimizer=False)
        elif save_format in self.WEIGHTS_FORMATS:
            self.model.save_weights(os.path.join(path, 'tf_model.h5'))
        elif save_format == 'tflite':
            converter = tf.lite.TFLiteConverter.from_keras_model(self.model)
            converter.target_spec.supported_ops = [
                tf.lite.OpsSet.TFLITE_BUILTINS,
                tf.lite.OpsSet.SELECT_TF_OPS
            ]
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            with tf.io.gfile.GFile(os.path.join(path, 'model.tflite'), 'wb') as file:
                file.write(converter.convert())
        elif save_format == 'onnx':
            try:
                import tf2onnx
                from onnxruntime.quantization import quant_pre_process, quantize_dynamic
            except ImportError as exc:
                raise RuntimeError('ONNX export requires tf2onnx and onnxruntime.') from exc

            model_path = os.path.join(path, 'model.onnx')
            tf2onnx.convert.from_keras(self.model, output_path=model_path)
            quant_pre_process(model_path, model_path, skip_symbolic_shape=True)
            quantize_dynamic(model_path, model_path)

    @classmethod
    def _load_model_file(cls, path, save_format, build_model=None, use_signature_runner=False):
        save_format = (save_format or 'saved_model').lower()
        if save_format == 'keras':
            save_format = 'saved_model'

        if save_format in cls.SAVED_MODEL_FORMATS:
            return tf.keras.models.load_model(os.path.join(path, 'model'), compile=False)
        if save_format in cls.WEIGHTS_FORMATS:
            if build_model is None:
                raise ValueError('A build_model callback is required to load weights format.')
            model = build_model()
            model.load_weights(os.path.join(path, 'tf_model.h5'))
            return model
        if save_format == 'tflite':
            model = tf.lite.Interpreter(os.path.join(path, 'model.tflite'))
            if use_signature_runner:
                return model.get_signature_runner(*model.get_signature_list())
            model.allocate_tensors()
            return model
        if save_format == 'onnx':
            available = ort.get_available_providers()
            providers = [provider for provider in (
                'CUDAExecutionProvider',
                'CPUExecutionProvider',
            ) if provider in available]
            return ort.InferenceSession(
                os.path.join(path, 'model.onnx'),
                providers=providers or None,
            )
        raise ValueError(f'Invalid save format: {save_format}.')

    def _predict_with_model(self, inputs, output_names=None):
        model = self.model
        if isinstance(model, tf.keras.Model):
            return model.predict(inputs, verbose=0)

        if isinstance(model, tf.lite.Interpreter):
            input_details = model.get_input_details()
            if isinstance(inputs, dict):
                values = []
                for detail in input_details:
                    detail_name = detail.get('name', '')
                    matched_name = next((name for name in inputs if name in detail_name), None)
                    values.append(inputs[matched_name] if matched_name else inputs[sorted(inputs.keys())[len(values)]])
            elif isinstance(inputs, (list, tuple)):
                values = list(inputs)
            else:
                values = [inputs]

            for i, detail in enumerate(input_details):
                model.resize_tensor_input(detail['index'], values[i].shape)
            model.allocate_tensors()
            for i, detail in enumerate(input_details):
                model.set_tensor(detail['index'], values[i])
            model.invoke()
            outputs = [model.get_tensor(detail['index']) for detail in model.get_output_details()]
            return outputs[0] if len(outputs) == 1 else outputs

        if isinstance(model, ort.InferenceSession):
            if not isinstance(inputs, dict):
                input_names = [input_meta.name for input_meta in model.get_inputs()]
                values = list(inputs) if isinstance(inputs, (list, tuple)) else [inputs]
                inputs = dict(zip(input_names, values))
            return model.run(output_names=output_names, input_feed=inputs)

        outputs = model(**inputs)
        if hasattr(outputs, 'values'):
            outputs = list(outputs.values())
        return outputs[0] if len(outputs) == 1 else outputs

    def save(self, path, save_format='tf'):
        """
        Saves the model, labels, and parameters.
        """
        save_format = (save_format or 'saved_model').lower()
        if save_format == 'keras':
            save_format = 'saved_model'

        self._create_directory(path)
        self.parameters.update({
            'model_type': self.model_type,
            'architecture': self.architecture,
            'save_format': save_format
        })
        
        self._write_json(os.path.join(path, 'labels.json'), self.labels)
        # Use case specific files (tags + slot→entity map for LU)
        if hasattr(self, 'tags') and self.tags:
            self._write_json(os.path.join(path, 'tags.json'), self.tags)
        if getattr(self, 'slots', None):
            self._write_json(os.path.join(path, 'slots.json'), self.slots)

        self._write_json(os.path.join(path, 'parameters.json'), self.parameters)

        if self.model:
            self._save_model_file(path, save_format)
            self._write_summary(path)
        if self.history:
            self._write_json(os.path.join(path, 'history.json'), self._history_to_dict(self.history))

    @classmethod
    def _get_architecture_type(cls, path):
        """
        Reads the architecture from parameters.json in the given path.
        """
        parameters = cls._read_json(os.path.join(path, 'parameters.json'), {})
        return parameters.get('architecture', 'base')

    @classmethod
    def load(cls, path, **kwargs):
        """
        Loads the model configuration and labels.
        """
        parameters = cls._read_json(os.path.join(path, 'parameters.json'), {})
        labels = cls._read_json(os.path.join(path, 'labels.json'))

        instance = cls()
        instance.parameters = parameters
        instance.labels = labels

        # Load tags if they exist (common for LU models)
        tags_path = os.path.join(path, 'tags.json')
        if os.path.exists(tags_path):
            instance.tags = cls._read_json(tags_path)

        # The LU intent → slot → entity map, when the artifact carries one.
        slots_path = os.path.join(path, 'slots.json')
        if os.path.exists(slots_path):
            instance.slots = cls._read_json(slots_path)

        instance.model_type = parameters.get('model_type')
        instance.architecture = parameters.get('architecture')

        return instance

    def predict(self, X, **kwargs):
        """
        Generates predictions for the given input.
        """
        return self._predict_with_model(self.preprocess_x(X))

    def preprocess_x(self, X):
        """
        Should be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement preprocess_x()")

    def build(self, **kwargs):
        """
        Should be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement build()")

    def _read_frame(self, data):
        """
        Resolves a data source to a ``pandas.DataFrame``. ``data`` may be a
        ``DataFrame``, a path to ``utterances.csv``, or the **data directory**
        the training task downloads (its ``utterances.csv`` is read). Not
        overridden — subclass ``load_data`` shapes ``(X, y)`` on top of it.
        """
        if isinstance(data, pd.DataFrame):
            return data
        if isinstance(data, str) and os.path.isdir(data):
            data = os.path.join(data, 'utterances.csv')
        return pd.read_csv(data)

    def load_data(self, data):
        """
        Reads a data source into a ``pandas.DataFrame``. The columns each model
        type reads and the shape of ``y`` are defined by the subclass
        ``load_data()`` (text classification reads the frame directly; the
        annotated types parse the inline markup via ``_read_inline``).
        """
        return self._read_frame(data)

    def _read_inline(self, data):
        """
        Parses the inline ``utterances.csv`` into ``(text, spans, intent)``
        rows: ``spans`` are ``(start, end, name)`` triples (the name a span
        trains under — its entity for named entity recognition, its slot for
        language understanding), and ``intent`` comes from the ``labels``
        column when the file carries one (else ``None``). The inline authoring
        markup is the same ``{name: value}`` form the annotation workspace and
        the dataset exporter use, so the round trip is lossless.
        """
        from ..utils.dataset import parse_inline
        frame = data if isinstance(data, pd.DataFrame) else self._read_frame(data)
        intents = frame['labels'].tolist() if 'labels' in frame.columns else [None] * len(frame)
        rows = []
        for cell, intent in zip(frame['utterances'].tolist(), intents):
            text, spans = parse_inline('' if cell is None else str(cell))
            rows.append((text, spans, str(intent) if intent is not None else None))
        return rows

    def _train_test_split(self, X, y, test_split=0.2, random_state=101):
        """
        Splits ``(X, y)`` into train and test sets.

        Falls back to a non-stratified split when stratification is not possible
        (e.g. sequence labels), and skips splitting entirely for tiny datasets.
        Returns ``(X_train, X_test, y_train, y_test)``.
        """
        if len(X) <= 2:
            return X, [], y, []

        from sklearn.model_selection import train_test_split
        try:
            return train_test_split(
                X, y, test_size=test_split, random_state=random_state, stratify=y
            )
        except ValueError:
            return train_test_split(
                X, y, test_size=test_split, random_state=random_state
            )

    @staticmethod
    def _compute_class_weights(labels):
        """
        Computes balanced class weights.

        Parameters
        ----------
        labels : array-like
            1D iterable of integer class ids.

        Returns
        -------
        dict
            {class_id: weight}
        """
        labels = np.asarray(labels)

        classes = np.unique(labels)

        weights = compute_class_weight(
            class_weight="balanced",
            classes=classes,
            y=labels,
        )

        return dict(zip(classes.tolist(), weights.tolist()))

    @staticmethod
    def _compute_sample_weights(labels, class_weights):
        """
        Builds per-sample weights from class weights: each label is mapped to
        its class weight. Works for any label shape.

        Parameters
        ----------
        labels : ndarray

        class_weights : dict

        Returns
        -------
        ndarray
            Same shape as labels.
        """
        labels = np.asarray(labels)

        sample_weights = np.ones(labels.shape, dtype=np.float32)
        sample_weights[:] = np.vectorize(class_weights.get)(labels)

        return sample_weights

    @staticmethod
    def _scored_annotations(text, tags, scores):
        """
        The annotations of one tagged input, as ``(start, end, name, score)``.

        Built on the shared ``tags_to_spans`` so an annotation means exactly
        the same thing at inference, in the metrics and on the threshold
        curve — three places that must agree for a threshold fitted on one to
        be meaningful in the others. The score is the mean over the tokens the
        annotation covers.

        ``tags`` and ``scores`` must be one per word. ``_decode_tags`` sizes
        both to the word count so every caller satisfies this, but a caller
        that did not would get annotations built from the full tag sequence and
        scored from a short one — silently mis-scored rather than obviously
        broken, which is the one failure this shared builder exists to rule
        out. Cheaper to refuse than to debug.
        """
        from ..utils.dataset import tokenize, tags_to_spans

        if len(tags) != len(scores):
            raise ValueError(
                'tags and scores must be one per word, got %d and %d'
                % (len(tags), len(scores))
            )

        tokens = tokenize(text)
        annotations = []
        for start, end, name in tags_to_spans(text, tags):
            member = [
                score for (_, token_start, token_end), score in zip(tokens, scores)
                if token_start < end and token_end > start
            ]
            annotations.append((start, end, name, float(np.mean(member)) if member else 0.0))
        return annotations

    @staticmethod
    def _annotation_threshold(gold, predicted):
        """
        The precision-recall curve for one annotated head, with its per-name
        summaries attached.

        ``gold`` is one iterable of ``(start, end, name)`` per input and
        ``predicted`` one iterable of ``(start, end, name, score)``. Both must
        come from the shared annotation builder, so the curve's
        ``threshold: 0`` point reproduces ``_annotation_metrics`` exactly —
        that identity is what lets a threshold read off this curve mean the
        same thing as the number in the Reports tab.
        """
        from .thresholds import annotation_curve, annotation_curves_by_name, with_labels

        gold = [set(item) for item in gold]
        predicted = [list(item) for item in predicted]
        return with_labels(
            annotation_curve(gold, predicted),
            annotation_curves_by_name(gold, predicted),
        )

    @staticmethod
    def _per_input(value, count):
        """
        Expands a serving option to one value per input.

        The serving loop batches requests that arrived with different options,
        so it passes a list aligned with the inputs; a direct caller passes a
        scalar, the way ``top`` already does.

        A short list is padded with 0.0 rather than truncated: a batch can mix
        envelopes from two serving workers mid-restart, where the older one
        omits the key entirely. Padding fails to "off", which serves the
        missing requests ungated; truncating would drop their outputs and time
        those requests out instead.
        """
        if isinstance(value, (list, tuple)):
            return list(value) + [0.0] * max(0, count - len(value))
        return [value] * count

    @staticmethod
    def _annotation_tallies(X, y_true, y_pred):
        """
        Per-name ``{true, pred, match}`` counts over whole annotations, where an
        annotation matches only when its name *and* both boundaries agree.

        The tallies rather than the scores are the primitive, so a caller that
        needs to re-group them (language understanding rolling slots up by
        entity) sums exact integers instead of trying to invert rounded rates.

        ``y_true``/``y_pred`` are per-input lists of word-level IOB tags.
        """
        from ..utils.dataset import tags_to_spans

        totals = {}
        for text, true_tags, pred_tags in zip(X, y_true, y_pred):
            true_annotations = set(tags_to_spans(text, true_tags))
            pred_annotations = set(tags_to_spans(text, pred_tags))
            for name in {name for _, _, name in true_annotations | pred_annotations}:
                counts = totals.setdefault(name, {'true': 0, 'pred': 0, 'match': 0})
                true_named = {a for a in true_annotations if a[2] == name}
                pred_named = {a for a in pred_annotations if a[2] == name}
                counts['true'] += len(true_named)
                counts['pred'] += len(pred_named)
                counts['match'] += len(true_named & pred_named)
        return totals

    @classmethod
    def _annotation_metrics(cls, X, y_true, y_pred):
        """
        Exact-match precision/recall/F1 over whole annotations, shared by the
        annotated model types — keyed by slot name for language understanding
        and by entity name for named entity recognition, since that is what
        each trains its tags under.

        This is the number the product experiences: a slot is filled with
        ``text[start:end]``, so an annotation off by one word yields the wrong
        value outright, where token scoring would award partial credit for it.

        Returns ``{precision, recall, f1, support, labels: {name: {...}}}``.
        """
        return cls._metrics_from_tallies(cls._annotation_tallies(X, y_true, y_pred))

    @classmethod
    def _metrics_from_tallies(cls, totals):
        """Overall + per-name scores from ``{name: {true, pred, match}}``."""
        overall = {'true': 0, 'pred': 0, 'match': 0}
        for counts in totals.values():
            for key in overall:
                overall[key] += counts[key]
        return {
            **cls._prf(overall),
            'labels': {name: cls._prf(counts) for name, counts in sorted(totals.items())}
        }

    @staticmethod
    def _prf(counts):
        """
        Precision/recall/F1/support from ``{true, pred, match}`` tallies.

        Rounded to 6 decimals, not 4: this is the same match/pred/true
        arithmetic the threshold curve runs at threshold 0 (see
        ``BaseModel._annotation_threshold``), and that curve rounds to 6
        decimals. A coarser rounding here would make the Reports tab and the
        Thresholds tab show different numbers for what is exactly the same
        computation.
        """
        precision = counts['match'] / counts['pred'] if counts['pred'] else 0.0
        recall = counts['match'] / counts['true'] if counts['true'] else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        return {
            'precision': round(precision, 6),
            'recall': round(recall, 6),
            'f1': round(f1, 6),
            'support': counts['true']
        }

    def train(self, data, **kwargs):
        """
        Should be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement train()")

    def evaluate(self, X, y, **kwargs):
        """
        Should be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement evaluate()")
