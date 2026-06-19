import os
import json
import shutil
import numpy as np
import tensorflow as tf

class BaseModel:
    """
    Base class for all NLU models.
    """
    SAVED_MODEL_FORMATS = {'saved_model', 'tf', 'pb'}
    WEIGHTS_FORMATS = {'weights', 'h5'}

    def __init__(self):
        self.model = None
        self.config = None
        self.parameters = {}
        self.labels = None
        self.tags = None
        self.processor = None
        self.model_type = None
        self.architecture = None
        self.history = None

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
            try:
                from onnxruntime import InferenceSession
            except ImportError as exc:
                raise RuntimeError('ONNX inference requires onnxruntime.') from exc
            return InferenceSession(
                os.path.join(path, 'model.onnx'),
                providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
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

        if hasattr(model, 'run'):
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
        # Use case specific files (tags for LU)
        if hasattr(self, 'tags') and self.tags:
            self._write_json(os.path.join(path, 'tags.json'), self.tags)
            
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

    def train(self, X, y, **kwargs):
        """
        Should be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement train()")

    def evaluate(self, X, y, **kwargs):
        """
        Should be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement evaluate()")
