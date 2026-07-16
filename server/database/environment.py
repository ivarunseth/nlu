from flask import abort, current_app

from sqlalchemy.ext.associationproxy import association_proxy

from .. import db


class Environment(db.Model):
    """
    NLU Server Envrionments database model.
    """
    __tablename__ = 'environments'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String, unique=True, nullable=False)

    instances = db.relationship('Instance', back_populates='environment', lazy='dynamic')
    models = association_proxy('instances', 'model')

    def __init__(self, **kwargs) -> None:
        super(Environment, self).__init__(**kwargs)

    def __repr__(self) -> str:
        return f"<Environment {self.name}>"

    @staticmethod
    def create(data):
        environment = Environment()
        environment.from_dict(data)
        return environment

    def from_dict(self, data, partial_update=False):
        try:
            for field in ['name']:
                setattr(self, field, data[field])
        except KeyError:
            if not partial_update:
                abort(400, '%s is missing in request body' % field)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name
        }

    @staticmethod
    def update():
        all = set(current_app.config['ALLOWED_ENVIRONMENTS'])
        available = set(environment.name for environment in Environment.query.all())

        for name in all - available:
            environ = Environment.create({'name': name})
            db.session.add(environ)

        for name in available - all:
            environment = Environment.query.filter_by(name=name).first()
            for instance in environment.instances.all():
                instance.stop()
                instance.forget()
                db.session.delete(instance)
            db.session.delete(environment)

        db.session.commit()
