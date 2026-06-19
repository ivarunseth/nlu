import os
import numpy as np
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
        self.parameters.update({
            'validation_split': validation_split,
            'epochs': epochs,
            'batch_size': batch_size,
            **{k: v for k, v in kwargs.items() if k != 'callbacks'}
        })
        y_encoded = self.preprocess_y(y)
        X_processed = self.preprocess_x(X)
        
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

        self.history = self.model.fit(
            X_processed, y_encoded,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )
        
        self.parameters['epochs'] = len(self.history.history.get('loss', []))
        return self._history_to_dict(self.history)

    def predict(self, X, **kwargs):
        """
        Generates predictions and maps them back to labels.
        """
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]

        results = []
        for pred in preds:
            idx = np.argmax(pred)
            label = self.labels[str(idx)]
            score = float(pred[idx])
            results.append({'label': label, 'score': score})
        return results

    def evaluate(self, X, y):
        """
        Standard evaluation for classification.
        Returns a JSON-serializable dictionary of metrics.
        """
        results = self.predict(X)
        y_pred = [r['label'] for r in results]
        
        cm = confusion_matrix(y, y_pred)
        acc = accuracy_score(y, y_pred)
        report = classification_report(y, y_pred, zero_division=0, output_dict=True)
        
        return {
            'accuracy': float(acc),
            'confusion_matrix': cm.tolist(),
            'report': report
        }
