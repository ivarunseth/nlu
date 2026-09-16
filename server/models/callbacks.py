import time
import tensorflow as tf

from ..tasks import WorkerTask


class AbortCallback(tf.keras.callbacks.Callback):
    """
    Stops training when the task has been aborted or the worker is shutting
    down.
    """

    def __init__(self, task: WorkerTask, min_check_interval=2.0):
        super().__init__()
        self.task = task
        self.min_check_interval = min_check_interval
        self.last_check = 0

    def on_train_begin(self, logs=None):
        self.task.check_status()

    def on_epoch_begin(self, epoch, logs=None):
        self.task.check_status()
        self.last_check = time.monotonic()

    def on_train_batch_end(self, batch, logs=None):
        now = time.monotonic()
        if now - self.last_check >= self.min_check_interval:
            self.last_check = now
            self.task.check_status()

    def on_train_end(self, logs=None):
        self.task.check_status()


class StatusCallback(tf.keras.callbacks.Callback):

    def __init__(
        self,
        task: WorkerTask,
        wrapper_model=None,
        min_update_interval=0.5,
    ):
        super().__init__()

        self.task = task
        self.wrapper_model = wrapper_model
        self.min_update_interval = min_update_interval

        self.history = {}
        self.summary = None
        # Where the run is inside the current epoch, for the live progress
        # bar: batches advance it between the per-epoch history points.
        self.progress = None
        self.last_update = 0

    def _push(self):
        self.task.update_state(
            state=self.task.AsyncResult(self.task.request.id).state,
            meta={
                "history": self.history,
                "summary": self.summary,
                "progress": self.progress,
            },
        )

    def on_train_begin(self, logs=None):
        if self.wrapper_model:
            self.summary = self.wrapper_model._get_summary()

        for key, value in self._initial_metrics().items():
            self.history.setdefault(key, []).append(float(value))

        self._push()
        self.last_update = time.time()

    def _initial_metrics(self):
        """
        Evaluate the freshly built (untrained) model to produce an epoch-0
        baseline. The train/validation portions are split off exactly the way
        ``model.fit(validation_split=...)`` does — the last fraction of the
        data — so the metric keys line up with the live per-epoch history
        ('loss'/'accuracy' for the train split, 'val_*' for validation).
        """
        data = getattr(self.wrapper_model, '_fit_data', None) if self.wrapper_model else None
        if not data or self.model is None:
            return {}

        X, y, validation_split = data
        try:
            n = self._num_samples(X)
            split_at = int(n * (1.0 - validation_split)) if validation_split else n

            metrics = {}
            if split_at > 0:
                metrics.update(self.model.evaluate(
                    self._slice(X, 0, split_at), self._slice(y, 0, split_at),
                    return_dict=True, verbose=0
                ))
            if split_at < n:
                for key, value in self.model.evaluate(
                    self._slice(X, split_at, n), self._slice(y, split_at, n),
                    return_dict=True, verbose=0
                ).items():
                    metrics[f'val_{key}'] = value
            return metrics
        except Exception:
            # A baseline is a nicety; never let it break the training run.
            return {}

    @staticmethod
    def _num_samples(data):
        while isinstance(data, (list, tuple)):
            data = data[0]
        if isinstance(data, dict):
            data = next(iter(data.values()))
        return len(data)

    @staticmethod
    def _slice(data, start, stop):
        """Slice the sample axis of an array, or a list/dict of arrays."""
        if isinstance(data, dict):
            return {key: StatusCallback._slice(value, start, stop) for key, value in data.items()}
        if isinstance(data, (list, tuple)):
            return type(data)(StatusCallback._slice(value, start, stop) for value in data)
        return data[start:stop]

    def on_epoch_begin(self, epoch, logs=None):
        self.progress = {
            "epoch": epoch + 1,
            "epochs": self.params.get("epochs"),
            "batch": 0,
            "batches": self.params.get("steps"),
        }

    def on_train_batch_end(self, batch, logs=None):
        if self.progress is None:
            return
        self.progress["batch"] = batch + 1
        now = time.time()
        if now - self.last_update >= self.min_update_interval:
            self._push()
            self.last_update = now

    def on_epoch_end(self, epoch, logs=None):
        logs = logs or {}

        for key, value in logs.items():
            self.history.setdefault(key, []).append(float(value))

        if self.progress is not None:
            self.progress["batch"] = self.progress.get("batches") or self.progress["batch"]

        now = time.time()
        epochs = self.params.get("epochs")

        if (
            (epoch + 1) == epochs
            or now - self.last_update >= self.min_update_interval
        ):
            self._push()
            self.last_update = now
