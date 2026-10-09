import os
import numpy as np
import math
from sklearn.metrics import confusion_matrix, accuracy_score, classification_report

from ..base import BaseModel
from ..thresholds import gate_labels, label_curve, label_curves_by_name, with_labels


class BaseTextClassification(BaseModel):
    """
    Base class for Text Classification use case.
    Handles common logic for training, prediction, and evaluation.
    """
    def __init__(self):
        super().__init__()
        self.model_type = 'text_classification'

    def load_data(self, data):
        """
        Text classification reads ``utterances`` and ``labels`` columns.
        """
        data = super().load_data(data)
        X = data['utterances'].tolist()
        y = data['labels'].tolist()
        return X, y

    def preprocess_y(self, y):
        """
        Maps string labels to integer indices.
        """
        if self.labels is None:
            unique_labels = sorted(list(set(y)))
            self.labels = {str(i): label for i, label in enumerate(unique_labels)}

        inv_labels = {v: int(k) for k, v in self.labels.items()}
        return np.array([inv_labels[str(label)] for label in y])

    def train(self, data, test_split=0.2, validation_split=0.1, epochs=10, batch_size=32, **kwargs):
        """
        Generic training loop for text classification.

        Reads the data source, holds out a test split (stored on the instance as
        ``X_test``/``y_test``), and trains on the remaining data.
        """
        X, y = self.load_data(data)
        X_train, X_test, y_train, y_test = self._train_test_split(
            X, y, test_split, kwargs.get('random_state', 101)
        )
        self.X_train, self.y_train = X_train, y_train
        self.X_test, self.y_test = X_test, y_test
        X, y = X_train, y_train

        if kwargs.get('pruning', False):
            initial_sparsity = kwargs.get('initial_sparsity', 0)
            final_sparsity = kwargs.get('final_sparsity', 0.5)
            begin_step = kwargs.get('pruning_begin_step', 0)
            end_step = kwargs.get('pruning_end_step', 1000)
            if not 0 <= initial_sparsity < final_sparsity < 1:
                raise ValueError('Pruning sparsity must satisfy 0 <= initial < final < 1.')
            if begin_step < 0 or end_step <= begin_step:
                raise ValueError('Pruning end step must be greater than its begin step.')

        self.parameters.update({
            'validation_split': validation_split,
            'epochs': epochs,
            'batch_size': batch_size,
            **{k: v for k, v in kwargs.items() if k != 'callbacks'}
        })
        y_encoded = self.preprocess_y(y)

        class_weight = self._compute_class_weights(y_encoded)

        X_processed = self.preprocess_x(X)
        train_samples = max(1, int(len(y_encoded) * (1 - validation_split)))
        kwargs['num_train_steps'] = max(1, math.ceil(train_samples / batch_size) * epochs)
        
        num_classes = len(self.labels)
        self.model = self.build(num_classes=num_classes, **kwargs)
        
        summary = self._get_summary()
        if summary:
            print(summary)
        
        callbacks = kwargs.get('callbacks', [])
        if kwargs.get('early_stopping', True):
            import tensorflow as tf
            from ..metrics import monitor_mode
            monitor = kwargs.get('monitor', 'val_loss')
            callbacks.append(tf.keras.callbacks.EarlyStopping(
                monitor=monitor,
                # Keras only infers "higher is better" from names containing
                # 'acc', so f1/precision/recall/mcc would be minimised — the run
                # would stop exactly when the model started improving.
                mode=monitor_mode(monitor),
                patience=kwargs.get('patience', 3),
                restore_best_weights=True
            ))
        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            callbacks.append(tfmot.sparsity.keras.UpdatePruningStep())

        self._fit_data = (X_processed, y_encoded, validation_split)

        self.history = self.model.fit(
            X_processed, y_encoded,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            class_weight=class_weight,
            verbose=1
        )
        
        self.parameters['epochs'] = len(self.history.history.get('loss', []))

        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            self.model = tfmot.sparsity.keras.strip_pruning(self.model)

        return self._history_to_dict(self.history)

    def predict(self, X, **kwargs):
        """
        Generates predictions and maps them back to labels, ranked by score.

        ``top`` (read from kwargs, default 1) limits how many labels each
        prediction returns. It may be a single int applied to every input, or a
        per-input list aligned with ``X`` (as sent by the batched serving loop).

        ``label_threshold`` (default 0, meaning off) clears the top-ranked
        label's ``name`` when it scores below the cutoff. Like ``top`` it may
        be a scalar or a per-input list.
        """
        top = kwargs.pop('top', 1)
        threshold = kwargs.pop('label_threshold', 0.0)
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]

        tops = top if isinstance(top, (list, tuple)) else [top] * len(preds)
        thresholds = self._per_input(threshold, len(preds))

        results = []
        for pred, k, cutoff in zip(preds, tops, thresholds):
            order = np.argsort(pred)[::-1]
            if k:
                order = order[:int(k)]
            # Ranked 'labels' with 'name'/'score' entries.
            labels = [
                {'name': self.labels[str(int(idx))], 'score': float(pred[idx])}
                for idx in order
            ]
            results.append({'labels': gate_labels(labels, cutoff)})
        return results

    def evaluate(self, X, y):
        """
        Standard evaluation for classification.
        Returns a JSON-serializable dictionary of metrics.
        """
        results = self.predict(X)
        y_pred = [r['labels'][0]['name'] for r in results]
        y_score = [r['labels'][0]['score'] for r in results]

        cm = confusion_matrix(y, y_pred)
        acc = accuracy_score(y, y_pred)
        report = classification_report(y, y_pred, zero_division=0, output_dict=True)
        correct = [predicted == truth for predicted, truth in zip(y_pred, y)]

        return {
            'accuracy': float(acc),
            'confusion_matrix': cm.tolist(),
            'report': report,
            # No annotation key: this model type classifies whole utterances
            # and has no annotated head to threshold.
            'thresholds': {
                'label': with_labels(
                    label_curve(correct, y_score),
                    label_curves_by_name(y_pred, correct, y_score),
                ),
            }
        }
