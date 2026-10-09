"""
SQLAlchemy models. Each module states which blueprint owns (writes) its table.

Each model lives in its own module; they are re-exported here so the rest
of the codebase keeps importing them from ``server.database`` unchanged.
Importing this package registers every model with the declarative registry,
which is what ``server`` relies on when it does ``from . import database``.
"""

from .tag import Tag
from .slot import Slot
from .synonym import Synonym
from .value import Value
from .utterance import Utterance
from .intent import Intent
from .entity import Entity
from .environment import Environment
from .instance import Instance
from .training import Training
from .prediction import Prediction
from .model import Model
from .user import User

__all__ = [
    'User',
    'Model',
    'Intent',
    'Entity',
    'Value',
    'Synonym',
    'Slot',
    'Utterance',
    'Tag',
    'Training',
    'Instance',
    'Environment',
    'Prediction',
]
