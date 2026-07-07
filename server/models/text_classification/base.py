import os
import numpy as np
import math
from sklearn.metrics import confusion_matrix, accuracy_score, classification_report

from ..base import BaseModel

class BaseTextClassification(BaseModel):
    """
    Base class for Text Classification use case.
    Handles common logic for training, prediction, and evaluation.
    """
    def __init__(self):
        super().__init__()
        self.model_type = 'text_classification'

    def preprocess_y(self, y):
        """
        Maps string labels to integer indices.
        """
        if self.labels is None:
            unique_labels = sorted(list(set(y)))
            self.labels = {str(i): label for i, label in enumerate(unique_labels)}
        
        inv_labels = {v: int(k) for k, v in self.labels.items()}
        return np.array([inv_labels[str(label)] for label in y])

    def train(self, X, y, validation_split=0.1, epochs=10, batch_size=32, **kwargs):
        """
        Generic training loop for text classification.
        """
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
            callbacks.append(tf.keras.callbacks.EarlyStopping(
                monitor=kwargs.get('monitor', 'val_loss'),
                patience=kwargs.get('patience', 3),
                restore_best_weights=True
            ))
        if kwargs.get('pruning', False):
            import tensorflow_model_optimization as tfmot
            callbacks.append(tfmot.sparsity.keras.UpdatePruningStep())

        self.history = self.model.fit(
            X_processed, y_encoded,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
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
        """
        top = kwargs.pop('top', 1)
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]

        tops = top if isinstance(top, (list, tuple)) else [top] * len(preds)

        results = []
        for pred, k in zip(preds, tops):
            order = np.argsort(pred)[::-1]
            if k:
                order = order[:int(k)]
            # 'outputs' with 'label'/'score' entries: a model-agnostic shape
            # other use cases can adopt, rather than a classification-specific
            # 'labels'/'name'.
            outputs = [
                {'label': self.labels[str(int(idx))], 'score': float(pred[idx])}
                for idx in order
            ]
            results.append({'outputs': outputs})
        return results

    def evaluate(self, X, y):
        """
        Standard evaluation for classification.
        Returns a JSON-serializable dictionary of metrics.
        """
        results = self.predict(X)
        y_pred = [r['outputs'][0]['label'] for r in results]
        
        cm = confusion_matrix(y, y_pred)
        acc = accuracy_score(y, y_pred)
        report = classification_report(y, y_pred, zero_division=0, output_dict=True)
        
        return {
            'accuracy': float(acc),
            'confusion_matrix': cm.tolist(),
            'report': report
        }
