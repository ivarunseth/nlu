import numpy as np
from sklearn.metrics import confusion_matrix, accuracy_score, classification_report

from ..base import BaseModel

class BaseNamedEntityRecognition(BaseModel):
    """
    Base class for Named Entity Recognition (NER).
    Handles label alignment and sequence-level evaluation.
    """
    def __init__(self):
        super().__init__()
        self.model_type = 'named_entity_recognition'

    def load_data(self, data):
        """
        Named entity recognition reads ``utterances`` and ``tags`` columns.
        """
        data = super().load_data(data)
        X = data['utterances'].tolist()
        y = data['tags'].tolist()
        return X, y

    def predict(self, X, **kwargs):
        """
        Generates predictions for the given input.
        """
        preds = super().predict(X, **kwargs)
        if isinstance(preds, list):
            preds = preds[0]
        if hasattr(preds, 'logits'):
            preds = preds.logits.numpy()

        results = []
        for i in range(len(X)):
            slot_indices = np.argmax(preds[i], axis=-1)
            slot_tags = [self.labels[str(idx)] for idx in slot_indices]
            results.append(slot_tags)
        return results

    def evaluate(self, X, y, **kwargs):
        """
        Evaluates model performance on a test set.
        Returns a JSON-serializable dictionary.
        """
        y_true = []
        for tags in y:
            if isinstance(tags, str):
                y_true.append(tags.split())
            else:
                y_true.append(tags)

        y_pred_all = self.predict(X)
        
        # Flatten and align for evaluation (similar to LU slots)
        y_true_flat = [tag for sublist in y_true for tag in sublist]
        y_pred_flat = []
        for pred, true in zip(y_pred_all, y_true):
            y_pred_flat.extend(pred[:len(true)])

        acc = accuracy_score(y_true_flat, y_pred_flat)
        report = classification_report(y_true_flat, y_pred_flat, zero_division=0, output_dict=True)
        cm = confusion_matrix(y_true_flat, y_pred_flat)

        return {
            'accuracy': float(acc),
            'confusion_matrix': cm.tolist(),
            'report': report
        }

    def preprocess_y(self, y):
        """
        Maps token-level string labels to integer indices.
        y is expected to be a list of lists (or space-separated strings).
        """
        if self.labels is None:
            all_tags = []
            for tags in y:
                if isinstance(tags, str):
                    all_tags.extend(tags.split())
                else:
                    all_tags.extend(tags)
            unique_tags = sorted(list(set(all_tags)))
            self.labels = {str(i): tag for i, tag in enumerate(unique_tags)}
        
        inv_labels = {v: int(k) for k, v in self.labels.items()}
        
        processed_y = []
        for tags in y:
            if isinstance(tags, str):
                tags = tags.split()
            processed_y.append([inv_labels[str(tag)] for tag in tags])
        return processed_y

    def train(self, data, test_split=0.2, validation_split=0.1, epochs=10, batch_size=32, **kwargs):
        """
        Standard training loop for token classification.

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

        self.parameters.update({
            'validation_split': validation_split,
            'epochs': epochs,
            'batch_size': batch_size,
            **{k: v for k, v in kwargs.items() if k != 'callbacks'}
        })
        y_encoded = self.preprocess_y(y)
        X_processed, y_aligned = self.tokenize_and_align(X, y_encoded)
        
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
            X_processed, y_aligned,
            validation_split=validation_split,
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )
        
        self.parameters['epochs'] = len(self.history.history.get('loss', []))
        return self._history_to_dict(self.history)

    def tokenize_and_align(self, X, y):
        """
        To be implemented by subclasses to handle tokenizer-specific alignment.
        """
        raise NotImplementedError
