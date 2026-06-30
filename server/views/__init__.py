"""
View layer. Two blueprints, each driven by its own application factory:

* :data:`api`       — control plane (``server.create_application``)
* :data:`inference` — data plane (``server.create_inference_server``)
"""

from .api import api, before_app_first_request  # noqa: F401
from .triton import triton  # noqa: F401
