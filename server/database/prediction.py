import time

from flask import abort

from sqlalchemy.orm import relationship

from .. import db


class Prediction(db.Model):
    """
    A single served prediction, logged by the inference data plane.

    Records are produced by the triton app, pushed onto a per-environment
    Redis telemetry queue, and batch-inserted here by the control-plane
    consumer (see ``server.telemetry``). The row is keyed by model and
    environment — the data plane never resolves the control-plane instance —
    and carries the environment and served version denormalized so history
    outlives the deployment: instances are deleted and recreated on every
    republish, and the Analyse Production tab must not reset when that
    happens. Rows only ever leave through the TELEMETRY_RETENTION_DAYS
    sweep (or with their model).
    """
    __tablename__ = 'predictions'
    __table_args__ = (
        db.Index('ix_predictions_scope', 'model_id', 'environment', 'created_at'),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    model_id = db.Column(db.String, db.ForeignKey('models.id'))
    environment = db.Column(db.String)
    # The version that actually served this prediction, as carried on the
    # route — a later redeploy to a newer version must not relabel history.
    version = db.Column(db.String)
    created_at = db.Column(db.Float, nullable=False, default=time.time)
    latency = db.Column(db.Float)
    cached = db.Column(db.Boolean)
    input = db.Column(db.JSON)
    output = db.Column(db.JSON)

    model = relationship('Model', back_populates='predictions')

    def __init__(self, **kwargs) -> None:
        super(Prediction, self).__init__(**kwargs)

    def __repr__(self) -> str:
        return f"<Prediction {self.id} ({self.model_id} v{self.version} in {self.environment})>"

    @staticmethod
    def create(data):
        prediction = Prediction()
        prediction.from_dict(data)
        return prediction

    def from_dict(self, data, partial_update=False):
        try:
            for field in ['model_id', 'environment', 'version', 'created_at',
                          'latency', 'cached', 'input', 'output']:
                setattr(self, field, data[field])
        except KeyError:
            if not partial_update:
                abort(400, '%s is missing in request body' % field)

    def to_dict(self):
        return {
            'id': self.id,
            'model_id': self.model_id,
            'environment': self.environment,
            'version': float(self.version) if self.version else None,
            'created_at': self.created_at,
            'latency': self.latency,
            'cached': self.cached,
            'input': self.input,
            'output': self.output,
        }
