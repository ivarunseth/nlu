import time
import tensorflow as tf

from ..tasks import WorkerTask


class TrainingCallback(tf.keras.callbacks.Callback):
    """
    TensorFlow callback that integrates with WorkerTask.

    Features:
    - Abort training when task is marked ABORTED.
    - Abort training when worker is shutting down.
    - Emit live training progress via SocketIO.
    - Update Celery task state.
    """

    def __init__(self, task: WorkerTask, wrapper_model=None, min_update_interval=0.1):
        super().__init__()

        self.task = task
        self.wrapper_model = wrapper_model
        self.history = {}
        self.summary = None
        self.last_update = 0
        self.min_update_interval = min_update_interval

    def on_train_begin(self, logs=None):
        if self.wrapper_model:
            self.summary = self.wrapper_model._get_summary()

    def on_epoch_begin(self, epoch, logs=None):
        self.task.check_status()

    def on_batch_begin(self, batch, logs=None):
        self.task.check_status()

    def on_epoch_end(self, epoch, logs=None):
        logs = logs or {}

        for key, value in logs.items():
            self.history.setdefault(key, []).append(float(value))

        # now = time.time()
        # epochs = self.params.get('epochs')
        
        # if (epoch + 1) == epochs or \
        #     (now - self.last_update >= self.min_update_interval):
        self.task.update_state(
            state="STARTED", 
            meta={
                "history": self.history, 
                "summary": self.summary
            }
        )
        # self.last_update = now

    def on_train_end(self, logs=None):
        self.task.check_status()
