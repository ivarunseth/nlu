import numpy as np
from sklearn.metrics import accuracy_score, classification_report

from ..base import BaseModel

class BaseNaturalLanguageUnderstanding(BaseModel):
    """
    Base class for Natural Language Understanding (Intent + Slots).
    """
    def __init__(self):
        super().__init__()
        self.tags = None
        self.model_type = 'natural_language_understanding'

    def load_data(self, data):
        """
        Natural language understanding reads ``utterances``, ``labels`` and
        ``tags`` columns. ``y`` is a list of ``(intent, slots)`` pairs.
        """
        data = super().load_data(data)
        X = data['utterances'].tolist()
        y = list(zip(data['labels'].tolist(), data['tags'].tolist()))
        return X, y

    def preprocess_y(self, y):
        """
        Maps (intent, slots) pairs to indices.
        y is expected to be a list of tuples/lists: [(intent, slots), ...]
        """
        if self.labels is None or self.tags is None:
            intents = sorted(list(set(intent for intent, _ in y)))
            self.labels = {str(i): intent for i, intent in enumerate(intents)}
            
            all_tags = []
            for _, slots in y:
                if isinstance(slots, str):
                    all_tags.extend(slots.split())
                else:
                    all_tags.extend(slots)
            unique_tags = sorted(list(set(all_tags)))
            self.tags = {str(i): tag for i, tag in enumerate(unique_tags)}
            
        inv_labels = {v: int(k) for k, v in self.labels.items()}
        inv_tags = {v: int(k) for k, v in self.tags.items()}
        
        y_intents = np.array([inv_labels[str(intent)] for intent, _ in y])
        y_slots = []
        for _, slots in y:
            if isinstance(slots, str):
                slots = slots.split()
            y_slots.append([inv_tags[str(tag)] for tag in slots])
            
        return y_intents, y_slots

    def train(self, data, test_split=0.2, validation_split=0.1, epochs=10, batch_size=32, **kwargs):
        """
        Standard training loop for joint intent and slot filling.

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

    def tokenize_and_align(self, X, y_slots):
        raise NotImplementedError

    def predict(self, X, **kwargs):
        """
        Generates predictions for intent and slots.
        """
        intent_preds, slot_preds = super().predict(X, **kwargs)
        
        results = []

        for i in range(len(X)):
            intent_idx = np.argmax(intent_preds[i])
            intent_label = self.labels[str(intent_idx)]
            
            # For slots, we need to handle the alignment (ignore -100 if it was BERT)
            # But for simple prediction return, we can just return all or try to align back.
            # Here we just return the most likely tag for each token.
            slot_indices = np.argmax(slot_preds[i], axis=-1)
            slot_tags = [self.tags[str(idx)] for idx in slot_indices]
            
            results.append({
                'intent': intent_label,
                'slots': slot_tags
            })
        return results

    def evaluate(self, X, y, **kwargs):
        """
        Evaluates model performance for both intent and slots.
        Returns a JSON-serializable dictionary.
        """
        y_intents_true = [intent for intent, _ in y]
        y_slots_true = []
        for _, slots in y:
            if isinstance(slots, str):
                y_slots_true.append(slots.split())
            else:
                y_slots_true.append(slots)

        results = self.predict(X)
        y_intents_pred = [r['intent'] for r in results]
        y_slots_pred = [r['slots'] for r in results]

        # Intent evaluation
        intent_acc = accuracy_score(y_intents_true, y_intents_pred)
        intent_report = classification_report(y_intents_true, y_intents_pred, zero_division=0, output_dict=True)

        # Slot evaluation (flattened)
        y_slots_true_flat = [tag for sublist in y_slots_true for tag in sublist]
        
        # Simple evaluation for now: only compare first N tags where N is len of true slots
        y_slots_pred_clipped = []
        for pred, true in zip(y_slots_pred, y_slots_true):
            y_slots_pred_clipped.extend(pred[:len(true)])
        
        slot_acc = accuracy_score(y_slots_true_flat, y_slots_pred_clipped)
        slot_report = classification_report(y_slots_true_flat, y_slots_pred_clipped, zero_division=0, output_dict=True)

        return {
            'intent': {
                'accuracy': float(intent_acc),
                'report': intent_report
            },
            'slots': {
                'accuracy': float(slot_acc),
                'report': slot_report
            }
        }
