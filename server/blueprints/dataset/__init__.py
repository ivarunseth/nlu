"""
Models and everything a labelled dataset is made of: intents, entities,
slots, values, utterances, tags, and import/export. Owns the `model`,
`intent`, `entity`, `slot`, `value`, `utterance` and `tag` tables.
"""

from flask import Blueprint

from server.blueprints import register_error_handlers, register_status_route

blueprint = Blueprint('dataset', __name__, url_prefix='/api/dataset')
register_error_handlers(blueprint)
register_status_route(blueprint)

from . import models, intents, entities, slots, values, utterances, tags, dataset  # noqa: E402,F401
