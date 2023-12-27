import os

from flask import request, abort, current_app

from ..auth import token_optional_auth
from ..models import LanguageModel, Language
from ..tasks import train
from ..utils import allowed_file, allowed_language

from . import api


@api.post('/training/<model_id>/<language_name>')
@token_optional_auth.login_required
def training(model_id, language_name):
    if not allowed_language(language_name):
        abort(400, f'{language_name} language is not supported yet')
    language = Language.query.filter_by(name=language_name).first()
    if language is None:
        abort(404, f'Language not found: {language_name}')
    language_model = LanguageModel.query.filter_by(model_id=model_id, language=language).first()
    if language_model is None:
        abort(404, f'LanguageModel not found: {model_id} ({language_name})')
    if not 'dataset' in request.files:
        abort(400, 'Dataset missing in request files')
    dataset = request.files.get('dataset')
    if not allowed_file(dataset.filename):
        abort(400, f'File extension not allowed: {dataset.filename}')
    filepath = os.path.join(current_app.config['MODELS_DIRECTORY'], language_model.path, 'input.csv')
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    dataset.save(filepath)
    train.apply_async(args=(filepath,), kwargs={'name': language_model.model.name, 'language': language_name})
    return {'message': 'task accepted'}, 202