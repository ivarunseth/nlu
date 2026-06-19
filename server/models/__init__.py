from .text_classification import TextClassification
from .named_entity_recognition import NamedEntityRecognition
from .natural_language_understanding import NaturalLanguageUnderstanding

class Model:
    """
    Factory class for NLU models.
    """
    _types = {
        'text_classification': TextClassification,
        'named_entity_recognition': NamedEntityRecognition,
        'natural_language_understanding': NaturalLanguageUnderstanding,
    }

    @staticmethod
    def _get_model_class(model_type):
        """
        Returns the factory class for the specified model type.
        """
        model_class = Model._types.get(model_type.lower())
        if not model_class:
            raise ValueError(f"Unknown Model Type: {model_type}. "
                             f"Available: {list(Model._types.keys())}")
        return model_class
    
    @staticmethod
    def create(model_type, architecture='base'):
        """
        Creates an instance of the specified model.
        """
        return Model._get_model_class(model_type).create(architecture)


    @staticmethod
    def load(model_type, path, **kwargs):
        """
        Loads a model from a path by determining its type and architecture from parameters.json.
        """
        return Model._get_model_class(model_type).load(path, **kwargs)