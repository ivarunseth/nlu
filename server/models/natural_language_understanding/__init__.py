from ..masking import NonPaddingLoss, NonPaddingAccuracy

from .base import BaseNaturalLanguageUnderstanding
from .transformer import BERTNaturalLanguageUnderstanding
from .deep_neural_network import DNNNaturalLanguageUnderstanding


class NaturalLanguageUnderstanding:
    """
    Factory class for Natural Language Understanding models.
    """
    _architectures = {
        'base': BaseNaturalLanguageUnderstanding,
        'transformer': BERTNaturalLanguageUnderstanding,
        'deep_neural_network': DNNNaturalLanguageUnderstanding
    }

    @staticmethod
    def _get_architecture_class(architecture):
        """
        Returns the architecture class for the specified architecture.
        """
        architecture_class = NaturalLanguageUnderstanding._architectures.get(str(architecture).lower())
        if not architecture_class:
            raise ValueError(f"Unknown Natural Language Understanding model: {architecture}. "
                             f"Available: {list(NaturalLanguageUnderstanding._architectures.keys())}")
        return architecture_class

    @staticmethod
    def create(architecture='base'):
        """
        Creates an instance of the specified model.
        """
        return NaturalLanguageUnderstanding._get_architecture_class(architecture)()

    @staticmethod
    def load(path, **kwargs):
        """
        Loads a model from a path by determining its architecture from parameters.json.
        """
        architecture = BaseNaturalLanguageUnderstanding._get_architecture_type(path)
        return NaturalLanguageUnderstanding._get_architecture_class(architecture).load(path, **kwargs)
