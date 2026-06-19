from .base import BaseTextClassification
from .deep_neural_network import DNNTextClassification
from .transformer import BERTTextClassification

class TextClassification:
    """
    Factory class for Text Classification models.
    """
    _architectures = {
        'base': BaseTextClassification,
        'deep_neural_network': DNNTextClassification,
        'transformer': BERTTextClassification
    }

    @staticmethod
    def _get_architecture_class(architecture):
        """
        Returns the architecture class for the specified architecture.
        """
        architecture_class = TextClassification._architectures.get(str(architecture).lower())
        if not architecture_class:
            raise ValueError(f"Unknown Text Classification model: {architecture}. "
                             f"Available: {list(TextClassification._architectures.keys())}")
        return architecture_class

    @staticmethod
    def create(architecture='base'):
        """
        Creates an instance of the specified model.
        """
        return TextClassification._get_architecture_class(architecture)()

    @staticmethod
    def load(path, **kwargs):
        """
        Loads a model from a path by determining its architecture from parameters.json.
        """
        architecture = BaseTextClassification._get_architecture_type(path)
        return TextClassification._get_architecture_class(architecture).load(path, **kwargs)
