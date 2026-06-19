import numpy as np
from transformers import AutoConfig, AutoTokenizer, TFAutoModelForTokenClassification as AutoModel, create_optimizer
from .base import BaseNamedEntityRecognition

PRETRAINED_MODELS = [
    'distilbert/distilbert-base-uncased',
    'distilbert-base-uncased',
    'bert-base-uncased',
    'bert-base-multilingual-cased',
    'ai4bharat/indic-bert',
    'google/muril-base-cased'
]

class BERTNamedEntityRecognition(BaseNamedEntityRecognition):
    """
    BERT-based architecture for Named Entity Recognition (NER).
    """
    def __init__(self):
        super().__init__()
        self.architecture = 'transformer'
        self.parameters.update({
            'pretrained_model': PRETRAINED_MODELS[0],
            'max_seq_len': 128,
            'trainable': False,
            'learning_rate': 2e-5,
            'num_train_steps': 1000,
            'weight_decay_rate': 0.01,
            'num_warmup_steps': 0
        })

    def preprocess_x(self, X):
        """
        Tokenizes text for BERT.
        """
        if self.processor is None:
            pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
            self.processor = AutoTokenizer.from_pretrained(pretrained_model)
        
        # BERT for token classification typically expects split words if we want to align
        # But here we handle string inputs.
        tokenized = self.processor(
            X,
            truncation=True,
            padding='max_length',
            max_length=self.parameters.get('max_seq_len', 128),
            return_tensors='np'
        )
        return {k: np.asarray(v).astype(np.int32) for k, v in tokenized.items()}

    def tokenize_and_align(self, X, y):
        """
        Aligns labels with BERT tokens.
        """
        if self.processor is None:
            pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
            self.processor = AutoTokenizer.from_pretrained(pretrained_model)

        tokenized_inputs = self.processor(
            X, 
            truncation=True, 
            padding='max_length', 
            max_length=self.parameters.get('max_seq_len', 128),
            is_split_into_words=False # Assuming string inputs
        )
        
        labels = []
        for i, label in enumerate(y):
            word_ids = tokenized_inputs.word_ids(batch_index=i)
            previous_word_idx = None
            label_ids = []
            for word_idx in word_ids:
                if word_idx is None:
                    label_ids.append(-100)
                elif word_idx != previous_word_idx:
                    label_ids.append(label[word_idx] if word_idx < len(label) else -100)
                else:
                    label_ids.append(-100)
                previous_word_idx = word_idx
            labels.append(label_ids)
            
        return {k: np.array(v) for k, v in tokenized_inputs.items()}, np.array(labels)

    def build(self, num_classes, **kwargs):
        """
        Builds the BERT Token Classification model.
        """
        self.parameters.update(kwargs)
        pretrained_model = self.parameters.get('pretrained_model', 'distilbert/distilbert-base-uncased')
        config = AutoConfig.from_pretrained(pretrained_model, num_labels=num_classes)
        self.config = config
        model = AutoModel.from_pretrained(pretrained_model, config=config)
        model.trainable = self.parameters.get('trainable', False)
        
        # Use transformers optimizer
        optimizer, _ = create_optimizer(
            init_lr=self.parameters.get('learning_rate', 2e-5),
            num_train_steps=self.parameters.get('num_train_steps', 1000),
            weight_decay_rate=self.parameters.get('weight_decay_rate', 0.01),
            num_warmup_steps=self.parameters.get('num_warmup_steps', 0)
        )
        
        # Token classification loss handles -100 ignored indices
        model.compile(optimizer=optimizer) 
        return model

    def save(self, path, save_format='tf'):
        super().save(path, save_format)
        if self.processor:
            self.processor.save_pretrained(path)
        if self.config:
            self.config.save_pretrained(path)

    @classmethod
    def load(cls, path, **kwargs):
        """
        Loads BERT model and tokenizer.
        """
        instance = super().load(path, **kwargs)
        
        # BERT specific loading
        instance.processor = AutoTokenizer.from_pretrained(path)
        instance.tokenizer = instance.processor
        instance.config = AutoConfig.from_pretrained(path)
        
        save_format = instance.parameters.get('save_format', 'tf')
        instance.model = cls._load_model_file(
            path,
            save_format,
            build_model=lambda: instance.build(num_classes=len(instance.labels)),
            use_signature_runner=kwargs.get('use_signature_runner', False)
        )
        return instance
