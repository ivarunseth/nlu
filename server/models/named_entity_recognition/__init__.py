from ..masking import NonPaddingLoss, NonPaddingAccuracy

from .base import BaseNamedEntityRecognition
from .recurrent_neural_network import RNNNamedEntityRecognition
from .transformer import BERTNamedEntityRecognition

class NamedEntityRecognition:
    """
    Factory class for Named Entity Recognition models.
    """
    _architectures = {
        'base': BaseNamedEntityRecognition,
        'recurrent_neural_network': RNNNamedEntityRecognition,
        'transformer': BERTNamedEntityRecognition
    }

    @staticmethod
    def _get_architecture_class(architecture):
        """
        Returns the architecture class for the specified architecture.
        """
        architecture_class = NamedEntityRecognition._architectures.get(str(architecture).lower())
        if not architecture_class:
            raise ValueError(f"Unknown Named Entity Recognition model: {architecture}. "
                             f"Available: {list(NamedEntityRecognition._architectures.keys())}")
        return architecture_class

    @staticmethod
    def create(architecture='base'):
        """
        Creates an instance of the specified model.
        """
        return NamedEntityRecognition._get_architecture_class(architecture)()

    @staticmethod
    def load(path, **kwargs):
        """
        Loads a model from a path by determining its architecture from parameters.json.
        """
        architecture = BaseNamedEntityRecognition._get_architecture_type(path)
        return NamedEntityRecognition._get_architecture_class(architecture).load(path, **kwargs)
