# Blueprint Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the backend into seven Flask blueprints (`auth`, `dataset`, `training`, `publishing`, `analytics`, `inference`, `events`), each runnable as its own container from one image behind nginx, and retire the control-plane/data-plane/`sage`/`triton` vocabulary.

**Architecture:** One Python package, one database, one Flask image. `server/blueprints/<name>/` holds each blueprint; `create_app(*names)` mounts any subset, so `python app.py` runs everything in one process locally and compose runs one blueprint per container. URLs are `/api/<name>/…`; nginx routes by prefix. `events` is the only Socket.IO server; every other process emits through the Redis message queue.

**Tech Stack:** Flask 3.1, Flask-SocketIO 5.5 (Redis message queue), Flask-SQLAlchemy, Celery 5.5, gunicorn gevent worker, nginx, docker compose, Vite/React.

**Spec:** `docs/superpowers/specs/2026-09-17-blueprint-services-design.md`

## Global Constraints

- No commits. The owner commits; every task ends at a verified checkpoint, not a commit (project rule, overrides the skill default).
- No test suite exists. Every task verifies with `python -m py_compile`, an import/url-map check script (Task 6 creates it), and `npm run build` for frontend tasks. Do not invent a pytest suite.
- Imports inside `server/blueprints/**` are absolute (`from server.auth import token_auth`), never relative beyond the package (`from . import blueprint` is fine).
- Blueprint names, URL prefixes, compose service names and nginx locations are the same seven words: `auth`, `dataset`, `training`, `publishing`, `analytics`, `inference`, `events`.
- `FLASK_ENV` is not read anywhere after Task 4. `PORT` (default `5000`), `PUBLIC_URL` (default `http://localhost`), `INFERENCE_WORKERS` (default `2`) are the new settings.
- Image tags are `${REGISTRY}api:${TAG}`, `${REGISTRY}worker:${TAG}-cpu|cuda`, `${REGISTRY}client:${TAG}` — no project prefix.
- Celery pool stays `prefork` everywhere; `events` and `analytics` run one gunicorn worker.
- The write-only Socket.IO emitter (`server/utils/socket.py`) is created lazily, never at import time.
- The registry/serving handshake (`server/utils/registry.py`, `server/tasks/serve.py` internals) is not modified beyond renames.
- Run every command from the repo root `/Users/varunseth/Documents/git/indic-nlu` with the project venv active (`source venv/bin/activate`).

---

## File map

| Path | Change | Responsibility |
|---|---|---|
| `server/config.py` | rewrite | one `Config`; `PORT`, `PUBLIC_URL`; `ALLOWED_ENVIRONMENTS` = `{name: {redis_url, token_ttl}}` |
| `server/__init__.py` | rewrite | singletons + `create_app(*names)` |
| `app.py` | rewrite | monkey-patch, `create_app`, `python app.py [name ...]` |
| `server/blueprints/__init__.py` | create | `NAMES`, `load()`, `register_error_handlers()` |
| `server/blueprints/{auth,dataset,training,publishing,analytics,inference,events}/__init__.py` | create | blueprint object, prefix, `init_app` |
| `server/blueprints/*/<module>.py` | `git mv` from `server/views/**` | route modules, unchanged bodies except import/decorator rewrites |
| `server/blueprints/events/namespace.py` | `git mv` from `server/events.py` | Socket.IO namespace |
| `server/utils/socket.py` | create | write-only emitter |
| `server/tasks/__init__.py` | edit | apps `training`, `serving`; `WorkerTask` uses the emitter; `api` app removed |
| `server/tasks/train.py`, `server/tasks/serve.py` | `git mv` | task modules |
| `server/auth.py` | edit | `api_key_required` reads `environment` from the route |
| `server/database/instance.py`, `training.py`, `intent.py`, `entity.py`, `utterance.py`, `user.py`, `model.py` | edit | app renames, `endpoint`, `_link` removal, ownership comments |
| `server/utils/registry.py`, `server/utils/common.py`, `server/utils/telemetry.py` | edit | `Config` instead of `config_for`; stats helpers removed |
| `server/views/`, `server/database.py`, `server/events.py`, `server/utils/decorators.py`, `server/tasks/request.py` | delete | |
| `requirements/base.txt` | edit | `+ Flask-Cors` |
| `src/api/*.js`, `vite.config.js` | edit | prefixes; single proxy port |
| `nginx.conf`, `docker-compose.yml`, `docker-compose.gpu.yml`, `docker-bake.hcl`, `docker/Dockerfile.api`, `docker/Dockerfile.worker`, `.env.example` | rewrite/edit | |
| `README.md`, `CLAUDE.md` | edit | vocabulary |

---

### Task 1: Remove the dead async-dispatch feature, stats endpoint, links, and the shadowed module

**Files:**
- Delete: `server/tasks/request.py`, `server/utils/decorators.py`, `server/views/api/tasks.py`, `server/database.py`
- Modify: `server/tasks/__init__.py` (the `api = create_worker(...)` block), `server/views/api/__init__.py`, `server/utils/common.py`, `server/config.py` (`REQUEST_STATS_WINDOW`), `server/database/{user,model,training,intent,entity,utterance}.py`

**Interfaces:**
- Produces: nothing new. Removes `server.tasks.api`, `server.utils.common.add_request`, `requests_per_second`, and every `_link`/`_links` key from `to_dict()` outputs.

- [ ] **Step 1: Confirm nothing else references what is being removed**

Run:
```bash
grep -rn "tasks.request\|decorators\|apply_async(f)\|add_request\|requests_per_second\|REQUEST_STATS\|_links\|_link\b\|tasks import api\|tasks:api" server src --include=*.py --include=*.js --include=*.jsx
```
Expected: hits only in the files listed above (`server/tasks/__init__.py`, `server/tasks/request.py`, `server/utils/decorators.py`, `server/views/api/tasks.py`, `server/views/api/__init__.py`, `server/utils/common.py`, `server/config.py`, and the six database modules). Any other hit means stop and report.

- [ ] **Step 2: Delete the dead files**

```bash
git rm -q server/tasks/request.py server/utils/decorators.py server/views/api/tasks.py server/database.py
```

- [ ] **Step 3: Remove the `api` Celery app**

In `server/tasks/__init__.py` delete this block (it is between `create_worker` and `sage = create_worker(`):

```python
api = create_worker(
    'api',
    include=['server.tasks.request'],
    queues=('default',),
    task_class=None,
    task_serializer='pickle',
    result_serializer='pickle',
    accept_content=['pickle'],
)
```

- [ ] **Step 4: Remove the stats endpoint and request hook**

In `server/views/api/__init__.py` delete:
- the import line `from ...utils.common import add_request, requests_per_second  # noqa: E402`
- `request_stats = []`
- the whole `@api.before_app_request def before_request()` function
- the whole `@api.get('/stats') def get_stats()` function

In `server/utils/common.py` delete the functions `add_request` and `requests_per_second`. In `server/config.py` delete the line `REQUEST_STATS_WINDOW = 15`.

- [ ] **Step 5: Remove the `_link` / `_links` dicts from `to_dict()`**

In each of `server/database/user.py` (`'_links'`), `model.py` (`'_links'`), `training.py` (`'_links'`), `intent.py` (`'_link'`), `entity.py` (`'_link'`), `utterance.py` (two `'_link'` blocks) delete the dict entry. Each looks like:

```python
            '_link': {
                'self': url_for('api.get_intent', modelId=self.model_id, intentId=self.id),
                'model': url_for('api.get_model', modelId=self.model_id),
                'utterances': url_for('api.get_utterances', modelId=self.model_id, intentId=self.id)
            },
```

Then remove `url_for` from each file's `from flask import …` line (keep the other names). Verify:

```bash
grep -rn "url_for" server
```
Expected: no output.

- [ ] **Step 6: Verify**

```bash
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') app.py && python -c "
from server import create_application_server
app, _ = create_application_server()
rules = {str(r) for r in app.url_map.iter_rules()}
assert '/api/stats' not in rules
print('ok', len(rules), 'rules')"
```
Expected: `ok <N> rules`, no traceback.

- [ ] **Step 7: Checkpoint** — report the diff summary (`git status --short`) to the owner; do not commit.

---

### Task 2: Rename the Celery apps and task modules

**Files:**
- Rename: `server/tasks/training.py` → `server/tasks/train.py`, `server/tasks/inference.py` → `server/tasks/serve.py`
- Modify: `server/tasks/__init__.py`, `server/tasks/train.py`, `server/tasks/serve.py`, `server/database/training.py`, `server/database/instance.py`, `server/database/prediction.py`, `server/views/api/trainings.py`, `server/views/triton/inference.py`, `server/utils/telemetry.py`, `server/models/base.py`, `docker/Dockerfile.worker`

**Interfaces:**
- Produces: `server.tasks.training` (Celery app, queue `training`), `server.tasks.serving` (Celery app, queues `testing`/`production`), `server.tasks.train.train` (task), `server.tasks.serve.serve` (task, signature unchanged: `serve(model_id, path, model_type, **kwargs)`).

- [ ] **Step 1: Move the modules**

```bash
git mv server/tasks/training.py server/tasks/train.py
git mv server/tasks/inference.py server/tasks/serve.py
```

- [ ] **Step 2: Rename the apps in `server/tasks/__init__.py`**

Replace the two `create_worker` blocks with:

```python
training = create_worker(
    'training',
    include=['server.tasks.train'],
    queues=('training',),
    task_class=WorkerTask,
)


serving = create_worker(
    'serving',
    include=['server.tasks.serve'],
    queues=(
        'testing',
        'production',
    ),
    task_class=WorkerTask,
)
```

- [ ] **Step 3: Rewrite the task modules' decorators**

`server/tasks/train.py`: change `from . import sage` → `from . import training` and `@sage.task(bind=True, broadcast_model_room=True)` → `@training.task(bind=True, broadcast_model_room=True)`.

`server/tasks/serve.py`: change `from . import triton` → `from . import serving`, `@triton.task(bind=True)` → `@serving.task(bind=True)`, and `def model(self, model_id, path, model_type, **kwargs):` → `def serve(self, model_id, path, model_type, **kwargs):`. Inside the module, search for any recursive reference to the task by name (`model.apply_async`, `model.name`) and rename to `serve`.

- [ ] **Step 4: Update every importer**

First `server/database/training.py`, by hand (BSD sed cannot insert a
newline). Line 8 `from ..tasks import sage, WorkerResult, training` becomes
the two lines

```python
from ..tasks import training, WorkerResult
from ..tasks.train import train
```

line 25 `return WorkerResult(self.task_id, app=sage) if self.task_id else None`
becomes `app=training)`, and line 55 `task = training.train.apply_async(`
becomes `task = train.apply_async(` (the local variable `training` further
down the file is a `Training` row and is untouched).

Then the rest with sed:

```bash
sed -i '' \
  -e 's/from \.\.tasks import triton, WorkerResult/from ..tasks import serving, WorkerResult/' \
  -e 's/app=triton)/app=serving)/' \
  -e 's/from \.\.tasks\.inference import model/from ..tasks.serve import serve/' \
  -e 's/            model\.apply_async(/            serve.apply_async(/' \
  server/database/instance.py
sed -i '' \
  -e 's/from \.\.\.tasks\.inference import model/from ...tasks.serve import serve/' \
  -e 's/            model\.apply_async(/            serve.apply_async(/' \
  server/views/triton/inference.py
sed -i '' -e 's/from \.\.\.tasks import training as training_tasks/from ...tasks import train as training_tasks/' server/views/api/trainings.py
sed -i '' -e 's/server\.tasks:sage/server.tasks:training/; s/sage@%h/training@%h/' docker/Dockerfile.worker
```

Check:

```bash
grep -n "training\.train\|sage\|triton" server/database/training.py server/database/instance.py server/views/api/trainings.py server/views/triton/inference.py
```
Expected: no output. (`training_tasks.train.name` in `views/api/trainings.py` is correct as-is after the sed: `training_tasks` is now the `train` module.)

- [ ] **Step 5: Fix stale comments**

Replace the words in comments only:
- `server/database/prediction.py:14` — "produced by the triton app" → "produced by the inference blueprint".
- `server/utils/telemetry.py:4` — "The inference data plane (the triton app) never touches the control-plane" → "The inference blueprint never touches the".
- `server/models/base.py:560` — "two triton processes" → "two serving workers".
- `docker/Dockerfile.worker:1` — "training (`sage`, the default CMD)" → "training (`training`, the default CMD)".

```bash
grep -rn "sage\|triton" server docker --include=* | grep -v "message\|usage\|Usage"
```
Expected: no output.

- [ ] **Step 6: Verify**

```bash
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') app.py && python -c "
from server.tasks import training, serving
from server.tasks.train import train
from server.tasks.serve import serve
assert train.name == 'server.tasks.train.train', train.name
assert serve.name == 'server.tasks.serve.serve', serve.name
assert training.main == 'training' and serving.main == 'serving'
print('ok')"
```
Expected: `ok`.

- [ ] **Step 7: Checkpoint** — report; do not commit.

---

### Task 3: Inference route carries the environment; `PUBLIC_URL` endpoint

**Files:**
- Modify: `server/config.py` (add `PUBLIC_URL`), `server/auth.py` (`api_key_required`), `server/views/triton/inference.py`, `server/database/instance.py` (`to_dict`)

**Interfaces:**
- Produces: `POST /api/infer/<environment>/<model_id>` (the `/api/infer` prefix changes to `/api/inference` in Task 11), `Config.PUBLIC_URL`, `Instance.to_dict()['endpoint'] == f"{PUBLIC_URL}/api/inference/{environment}/{model_id}"`.
- `api_key_required` now requires the wrapped view to receive `environment` and `model_id` kwargs.

- [ ] **Step 1: Add `PUBLIC_URL` to `Config`**

In `server/config.py`, inside `class Config`, after `SECRET_KEY`, add:

```python
    # The URL users reach the UI on. It is the only absolute URL the backend
    # emits: deployment endpoints are PUBLIC_URL/api/inference/<env>/<model>.
    PUBLIC_URL = os.environ.get('PUBLIC_URL', 'http://localhost').rstrip('/')
```

- [ ] **Step 2: Rewrite `api_key_required` to take the environment from the route**

In `server/auth.py` replace the body of `wrapper` with:

```python
    @wraps(f)
    def wrapper(*args, **kwargs):
        environment = kwargs.get('environment')
        model_id = kwargs.get('model_id')
        if environment not in current_app.config['ALLOWED_ENVIRONMENTS']:
            abort(404, 'Unknown environment: %s' % environment)
        token = extract_bearer_token_from_headers(request.headers)
        error = 'A valid API key is required.'
        if token and model_id:
            try:
                claims = decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])
            except ExpiredSignatureError:
                claims = None
                error = 'The API key has expired. Reset the key to mint a new one.'
            except InvalidTokenError:
                claims = None
            if claims and claims.get('model_id') == model_id \
                    and claims.get('environment') == environment:
                registry = registry_for(environment)
                route = registry.route(model_id)
                if route and route.api_key \
                    and compare_digest(token, route.api_key):
                    return f(*args, **kwargs)
        return {'error': error}, 401, \
            {'WWW-Authenticate': 'Bearer realm="Authentication Required"'}
    return wrapper
```

Add `abort` to the flask import: `from flask import g, request, session, current_app, abort`. Update the docstring's last sentence to: "The environment comes from the route, so a key minted for `testing` is rejected on `production` even before the registry lookup."

- [ ] **Step 3: Change the inference view**

In `server/views/triton/inference.py`:

```python
@triton.post('/infer/<environment>/<model_id>')
@api_key_required
def infer(environment, model_id):
    started = time.perf_counter()

    registry = registry_for(environment)
```

(delete the line `environment = current_app.config['ENVIRONMENT']`). Everything else in the function stays.

- [ ] **Step 4: Change the endpoint string**

In `server/database/instance.py` `to_dict`, delete `settings = current_app.config['ALLOWED_ENVIRONMENTS'][self.environment.name]` and replace the `'endpoint'` entry with:

```python
            'endpoint': '%s/api/inference/%s/%s' % (
                current_app.config['PUBLIC_URL'],
                self.environment.name,
                self.model_id,
            ),
```

- [ ] **Step 5: Verify**

```bash
python -m py_compile server/auth.py server/config.py server/views/triton/inference.py server/database/instance.py && python -c "
from server import create_triton_server
app = create_triton_server()
rules = [str(r) for r in app.url_map.iter_rules()]
assert '/api/infer/<environment>/<model_id>' in rules, rules
c = app.test_client()
r = c.post('/api/infer/nowhere/x', json={'inputs': ['a']})
assert r.status_code == 404 and r.json['error'].startswith('Unknown environment'), (r.status_code, r.json)
r = c.post('/api/infer/testing/x', json={'inputs': ['a']})
assert r.status_code == 401, r.status_code
print('ok')"
```
Expected: `ok`.

- [ ] **Step 6: Checkpoint** — report; do not commit.

---

### Task 4: One `Config`; `PORT`; `FLASK_ENV` gone

**Files:**
- Modify: `server/config.py`, `server/__init__.py`, `app.py`, `server/utils/registry.py`, `server/tasks/serve.py`, `vite.config.js`

**Interfaces:**
- Produces: `server.config.Config` only (no `configs`, `config_for`, `ProductionConfig`, `TestingConfig`); `Config.PORT`; `Config.ALLOWED_ENVIRONMENTS == {name: {'redis_url': str, 'token_ttl': int}}`.
- Consumes: nothing from later tasks. The two old factories keep working (without `config_name`) until Task 12 deletes them.

- [ ] **Step 1: Rewrite `server/config.py`**

Replace the whole file with:

```python
import os

from dotenv import load_dotenv
load_dotenv()


class Config(object):
    # The debug server is opt-in rather than implied by an environment name,
    # so a stack does not run the interactive debugger by accident. app.py
    # also drives its reloader off this flag.
    DEBUG = os.environ.get('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes')
    TESTING = False

    SECRET_KEY = os.environ.get('SECRET_KEY', '51f52814-0071-11e6-a247-000ec6c2372c')

    # Listen port for `python app.py` (containers always bind 5000).
    PORT = int(os.environ.get('PORT', 5000))

    # The URL users reach the UI on. It is the only absolute URL the backend
    # emits: deployment endpoints are PUBLIC_URL/api/inference/<env>/<model>.
    PUBLIC_URL = os.environ.get('PUBLIC_URL', 'http://localhost').rstrip('/')

    ALLOWED_EXTENSIONS = {'csv', 'tsv'}
    ALLOWED_MODELS = {'text_classification', 'named_entity_recognition', 'natural_language_understanding'}

    # The inference environments. Each has its own route registry (a Redis
    # URL), its own serving queue of the same name, and its own API-key TTL.
    # No HTTP process "serves" an environment: the inference blueprint reads
    # it from the request path, and serving workers from their queue.
    ALLOWED_ENVIRONMENTS = {
        name: {
            'redis_url': os.environ.get(f'REDIS_URL_{name.upper()}', 'redis://localhost:6379/0'),
            'token_ttl': int(os.environ.get(f'INFERENCE_API_KEY_TTL_{name.upper()}', token_ttl)),
        }
        for name, token_ttl in (
            ('testing', 12 * 60 * 60),
            ('production', 30 * 24 * 60 * 60),
        )
    }

    SESSION_TYPE = os.environ.get('SESSION_TYPE', 'filesystem')

    SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///indicnlu.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = os.environ.get('SQLALCHEMY_TRACK_MODIFICATIONS', False)

    SOCKETIO_MESSAGE_QUEUE = os.environ.get('SOCKETIO_MESSAGE_QUEUE', os.environ.get('CELERY_BROKER_URL', 'redis://'))

    STORAGE_PROVIDER = os.environ.get('STORAGE_PROVIDER', 'local')
    STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET', 'data')

    TOKEN_EXPIRY = 720

    INFERENCE_BATCH_SIZE = int(os.environ.get('INFERENCE_BATCH_SIZE', 32))
    INFERENCE_SLEEP = float(os.environ.get('INFERENCE_SLEEP', 0.005))
    INFERENCE_IDLE_TIMEOUT = float(os.environ.get('INFERENCE_IDLE_TIMEOUT', 300))
    INFERENCE_HEARTBEAT_INTERVAL = float(os.environ.get('INFERENCE_HEARTBEAT_INTERVAL', 5))
    INFERENCE_REQUEST_TIMEOUT = float(os.environ.get('INFERENCE_REQUEST_TIMEOUT', 30))
    INFERENCE_POLL_INTERVAL = float(os.environ.get('INFERENCE_POLL_INTERVAL', 0.01))
    INFERENCE_OUTPUT_TTL = int(os.environ.get('INFERENCE_OUTPUT_TTL', 300))
    INFERENCE_START_TTL = int(os.environ.get('INFERENCE_START_TTL', 120))
    INFERENCE_MAX_BATCH = int(os.environ.get('INFERENCE_MAX_BATCH', 256))
    INFERENCE_BATCH_TIMEOUT = float(os.environ.get('INFERENCE_BATCH_TIMEOUT', 120))

    AUGMENT_ENABLED = os.environ.get('AUGMENT_ENABLED', 'true').lower() in ('1', 'true', 'yes')
    AUGMENT_UNK_TOKEN = os.environ.get('AUGMENT_UNK_TOKEN', '[UNK]')

    TELEMETRY_BATCH_SIZE = int(os.environ.get('TELEMETRY_BATCH_SIZE', 100))
    TELEMETRY_INTERVAL = float(os.environ.get('TELEMETRY_INTERVAL', 1.0))
    TELEMETRY_RETENTION_DAYS = int(os.environ.get('TELEMETRY_RETENTION_DAYS', 30))

    DATASET_IO_BATCH_SIZE = int(os.environ.get('DATASET_IO_BATCH_SIZE', 5000))
```

- [ ] **Step 2: Point the out-of-app-context readers at `Config`**

`server/utils/registry.py`: replace `from ..config import config_for` with `from ..config import Config`, and in `registry_for` replace

```python
        config = config_for(os.environ.get('FLASK_ENV', 'production'))
        url = (config.ALLOWED_ENVIRONMENTS.get(environment) or {}).get('redis_url')
```
with
```python
        url = (Config.ALLOWED_ENVIRONMENTS.get(environment) or {}).get('redis_url')
```
Remove `import os` from that file if nothing else uses it (check with `grep -n "os\." server/utils/registry.py`).

`server/tasks/serve.py`: replace

```python
    from ..config import config_for
    config = config_for(os.environ.get('FLASK_ENV', 'production'))
    environment = kwargs.get('environment', os.environ.get('FLASK_ENV', 'production'))
```
with
```python
    from ..config import Config as config
    environment = kwargs['environment']
```
(`Instance.start()` and the inference view always pass `environment=`; a missing kwarg is a programming error and should raise.) Remove `import os` only if `grep -n "os\." server/tasks/serve.py` shows no other use.

- [ ] **Step 3: Interim factories and `app.py`**

In `server/__init__.py`: `from .config import config_for` → `from .config import Config`; both factories lose their `config_name` parameter and use `app.config.from_object(Config)`; delete the two `app.config['ENVIRONMENT'] = config_name` lines. (`create_triton_server` and `create_application_server` still exist until Task 12.)

Replace `app.py` with:

```python
# serve.py
from gevent import monkey
monkey.patch_all()

import sys


def create_app():
    """Control-plane app for the ``flask`` CLI (interim; replaced in Task 12)."""
    from server import create_application_server
    app, _ = create_application_server()
    return app


def main(arg):
    if arg == 'triton':
        from server import create_triton_server
        app = create_triton_server()
        debug = app.config['DEBUG']
        app.run(host='0.0.0.0', port=app.config['PORT'] + 1,
                debug=debug, use_reloader=debug)
    else:
        from server import create_application_server
        app, socketio = create_application_server()
        debug = app.config['DEBUG']
        socketio.run(app, host='0.0.0.0', port=app.config['PORT'],
                     debug=debug, use_reloader=debug, log_output=debug)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'api')
```

- [ ] **Step 4: Vite proxy to one port**

Replace `vite.config.js` with:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Everything the UI calls is under /api (one prefix per blueprint) or
// /socket.io. Locally `python app.py` serves all of it on PORT.
const port = process.env.PORT || 5000
const target = `http://127.0.0.1:${port}`

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': { target, changeOrigin: true },
            '/socket.io': { target, changeOrigin: true, ws: true }
        },
        watch: {
            ignored: ['**/venv/**']
        }
    }
})
```

- [ ] **Step 5: Verify**

```bash
grep -rn "FLASK_ENV\|config_for\|\['ENVIRONMENT'\]\|configs\b" server app.py vite.config.js; echo "---"
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') app.py && python -c "
from server.config import Config
assert set(Config.ALLOWED_ENVIRONMENTS) == {'testing', 'production'}
assert set(Config.ALLOWED_ENVIRONMENTS['testing']) == {'redis_url', 'token_ttl'}
assert Config.PORT == 5000
from server.utils.registry import registry_for
assert registry_for('testing').environment == 'testing'
from server import create_application_server, create_triton_server
create_application_server(); create_triton_server()
print('ok')" && npm run build 2>&1 | tail -2
```
Expected: the grep prints only the `---` line; then `ok`; then Vite's `✓ built in …`.

- [ ] **Step 6: Checkpoint** — report; do not commit.

---

### Task 5: Write-only Socket.IO emitter

**Files:**
- Create: `server/utils/socket.py`
- Modify: `server/tasks/__init__.py` (`WorkerTask.before_start`), `server/views/api/trainings.py` (`announce_training`)

**Interfaces:**
- Produces: `server.utils.socket.emitter() -> flask_socketio.SocketIO` (write-only, one per process, lazy); `server.utils.socket.emit(event: str, payload: dict, room: str, namespace: str = '/') -> None`.

- [ ] **Step 1: Create the module**

`server/utils/socket.py`:

```python
"""
Write-only Socket.IO handle for every process that is not the `events`
server (route handlers in other blueprints, Celery tasks).

Flask-SocketIO lets a process that hosts no Socket.IO server still emit:
a ``SocketIO`` built with ``message_queue`` and no app publishes to the
Redis channel the server subscribes to. One such instance per process is
enough, and it must be built lazily — prefork workers fork after import,
and an instance created before the fork would share its Redis connection
across children.
"""

from flask_socketio import SocketIO

from ..config import Config

_emitter = None


def emitter() -> SocketIO:
    global _emitter
    if _emitter is None:
        _emitter = SocketIO(
            app=None,
            message_queue=Config.SOCKETIO_MESSAGE_QUEUE,
            channel='socketio',
            async_mode='threading',
            logger=False,
            engineio_logger=False,
        )
    return _emitter


def emit(event, payload, room, namespace='/'):
    emitter().emit(event, payload, room=room, namespace=namespace)
```

- [ ] **Step 2: Use it from `WorkerTask`**

In `server/tasks/__init__.py` replace the body of `before_start`:

```python
    def before_start(self, *args, **kwargs):
        super().before_start(*args, **kwargs)
        from ..utils.socket import emitter
        self.socketio = emitter()
        self.push_status(extended=True)
```

Delete `from flask_socketio import SocketIO` from that file's imports if nothing else uses it (`grep -n SocketIO server/tasks/__init__.py`).

- [ ] **Step 3: Use it from `announce_training`**

In `server/views/api/trainings.py`: change `from ... import db, store, socketio` to `from ... import db, store` and add `from ...utils.socket import emit`. In `announce_training` replace `socketio.emit('training', {` with `emit('training', {` and the closing `}, room=user_room(g.current_user), namespace='/')` with `}, room=user_room(g.current_user))`.

- [ ] **Step 4: Verify**

```bash
python -m py_compile server/utils/socket.py server/tasks/__init__.py server/views/api/trainings.py && python -c "
import server.utils.socket as s
assert s._emitter is None, 'emitter must not be built at import'
e = s.emitter(); assert e is s.emitter()
assert e.server.manager.write_only is True
print('ok')"
```
Expected: `ok`.

- [ ] **Step 5: Checkpoint** — report; do not commit.

---

### Task 6: The `blueprints` package, `create_app(*names)`, and the `auth` blueprint

**Files:**
- Create: `server/blueprints/__init__.py`, `server/blueprints/auth/__init__.py`, scratch `check_blueprint.py`
- Rename: `server/views/api/users.py` → `server/blueprints/auth/users.py`, `server/views/api/tokens.py` → `server/blueprints/auth/tokens.py`
- Modify: `server/__init__.py` (add `create_app`), `server/views/api/__init__.py` (drop `users`, `tokens` from the import list)

**Interfaces:**
- Produces: `server.blueprints.NAMES: tuple[str, ...]`, `server.blueprints.load(name) -> module` (module has `blueprint: Blueprint | None` and optional `init_app(app)`), `server.blueprints.register_error_handlers(bp)`, `server.create_app(*names) -> Flask`, `server.CLI: bool` (`'db' in sys.argv`).
- Every later blueprint package follows the exact shape of `server/blueprints/auth/__init__.py` below.

- [ ] **Step 1: Create `server/blueprints/__init__.py`**

```python
"""
One blueprint per deployable service. Each package under this one exposes

* ``blueprint`` — a :class:`flask.Blueprint` with its ``url_prefix`` set
  (``/api/<name>``), or ``None`` for a package with no HTTP routes;
* ``init_app(app)`` — optional; process-level extras only that service
  needs (the Socket.IO server, the telemetry consumer, CORS).

``server.create_app(*names)`` mounts any subset, so one process can run
all of them (local development) or exactly one (a container). The names
here are also the URL prefixes, the nginx locations and the compose
service names.
"""

from importlib import import_module

NAMES = ('auth', 'dataset', 'training', 'publishing', 'analytics', 'inference', 'events')


def load(name):
    if name not in NAMES:
        raise ValueError('Unknown blueprint %r. Known: %s' % (name, ', '.join(NAMES)))
    return import_module(f'{__name__}.{name}')


def register_error_handlers(blueprint):
    """JSON error bodies, the same on every blueprint."""
    @blueprint.errorhandler(400)
    def bad_request(error):
        return {'error': error.description}, 400

    @blueprint.errorhandler(404)
    def not_found(error):
        return {'error': error.description}, 404

    @blueprint.errorhandler(409)
    def conflict(error):
        # Surfaced conflicts the client resolves explicitly — e.g. reassigning
        # an utterance to an intent that lacks one of its spans' slots.
        return {'error': error.description}, 409

    @blueprint.errorhandler(500)
    def internal_server_error(error):
        return {'error': error.description}, 500

    @blueprint.errorhandler(504)
    def gateway_timeout(error):
        return {'error': error.description}, 504
```

- [ ] **Step 2: Add `create_app` and `CLI` to `server/__init__.py`**

After the singletons (`socketio`, `redis`, `store`) and before `create_application_server`, add:

```python
# True under the `flask` CLI (`flask db upgrade`): blueprints skip their
# background work then, so a migration command boots nothing.
CLI = 'db' in sys.argv


def create_app(*names):
    """
    The Flask app for the given blueprints (default: all of them).

    One process, any subset: `python app.py` mounts everything for local
    development; each container mounts exactly one. Blueprint packages that
    define ``init_app`` get it called here, after registration.
    """
    from . import blueprints

    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)
    from . import database  # noqa: F401 — registers the models
    migrate.init_app(app, db, directory='./migrations')

    Session(app)
    store.init_app(app)

    for name in names or blueprints.NAMES:
        package = blueprints.load(name)
        if package.blueprint is not None:
            app.register_blueprint(package.blueprint)
        init_app = getattr(package, 'init_app', None)
        if init_app is not None:
            init_app(app)

    return app
```

- [ ] **Step 3: Create the `auth` package and move its modules**

```bash
mkdir -p server/blueprints/auth
git mv server/views/api/users.py server/blueprints/auth/users.py
git mv server/views/api/tokens.py server/blueprints/auth/tokens.py
```

`server/blueprints/auth/__init__.py`:

```python
"""Sign-up, sign-in and session tokens. Owns the `user` table."""

from flask import Blueprint

from server.blueprints import register_error_handlers

blueprint = Blueprint('auth', __name__, url_prefix='/api/auth')
register_error_handlers(blueprint)

from . import users, tokens  # noqa: E402,F401
```

- [ ] **Step 4: Rewrite the moved modules' imports and decorators**

This sed is the one every later task reuses for its own modules:

```bash
sed -i '' \
  -e 's/^from \.\.\. import /from server import /' \
  -e 's/^from \.\.\.\([a-z]\)/from server.\1/' \
  -e 's/^from \. import api$/from . import blueprint/' \
  -e 's/@api\./@blueprint./g' \
  server/blueprints/auth/users.py server/blueprints/auth/tokens.py
grep -n "^from\|^import\|^@" server/blueprints/auth/users.py server/blueprints/auth/tokens.py
```
Expected: every `from` line starts with `from flask`, `from server`, or `from . import blueprint`; every route decorator is `@blueprint.<method>(...)`.

- [ ] **Step 5: Drop `users`, `tokens` from the old blueprint's import list**

In `server/views/api/__init__.py` change
`from . import instances, users, tokens, models, intents, entities, slots, values, utterances, tags, dataset, trainings, analytics  # noqa: E402,F401`
to
`from . import instances, models, intents, entities, slots, values, utterances, tags, dataset, trainings, analytics  # noqa: E402,F401`.

- [ ] **Step 6: Write the check script (used by Tasks 6–12)**

`/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad/check_blueprint.py`:

```python
"""usage: python check_blueprint.py <name> [expected-route ...]

Mounts one blueprint with server.create_app and asserts every rule sits under
/api/<name>/ (events: no rules, Socket.IO attached). Extra args are routes that
must be present, e.g. /api/auth/tokens.
"""
import sys
name, *expected = sys.argv[1:]

from server import create_app
app = create_app(name)
rules = sorted(str(r) for r in app.url_map.iter_rules() if r.endpoint != 'static')

if name == 'events':
    assert not rules, rules
    assert 'socketio' in app.extensions, 'Socket.IO server not attached'
else:
    assert rules, 'no routes registered'
    bad = [r for r in rules if not r.startswith(f'/api/{name}/')]
    assert not bad, f'routes outside /api/{name}/: {bad}'
    for route in expected:
        assert route in rules, f'missing {route}; have:\n' + '\n'.join(rules)
print(f'{name}: ok ({len(rules)} routes)')
for r in rules:
    print('  ', r)
```

- [ ] **Step 7: Verify**

```bash
S=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') app.py \
 && python $S/check_blueprint.py auth /api/auth/tokens /api/auth/users '/api/auth/users/<userId>' /api/auth/users/forgot-password \
 && python -c "
from server import create_app
from server.blueprints.auth import blueprint
app = create_app('auth')
# Blueprint error handlers fire only for requests routed into the blueprint,
# so check registration directly rather than probing an unrouted URL.
assert {400, 404, 409, 500, 504} <= set(blueprint.error_handler_spec[None]), blueprint.error_handler_spec
c = app.test_client()
r = c.post('/api/auth/tokens'); assert r.status_code == 401 and r.json['error'], (r.status_code, r.data)
print('handlers ok')" \
 && python -c "from server import create_application_server; create_application_server(); print('legacy ok')"
```
Expected: `auth: ok (5 routes)` with the list, `handlers ok`, `legacy ok`.

- [ ] **Step 8: Checkpoint** — report; do not commit.

---

### Task 7: The `dataset` blueprint

**Files:**
- Create: `server/blueprints/dataset/__init__.py`
- Rename: `server/views/api/{models,intents,entities,slots,values,utterances,tags,dataset}.py` → `server/blueprints/dataset/…`
- Modify: `server/views/api/__init__.py` (import list), `server/database/{model,intent,entity,slot,value,utterance,tag}.py` (ownership comment)

**Interfaces:**
- Consumes: `register_error_handlers`, the sed from Task 6 Step 4.
- Produces: routes under `/api/dataset/` — `/models`, `/models/<modelId>`, `/models/<modelId>/{intents,entities,slots,utterances,dataset}`, `/models/<modelId>/tags/{stats,export,import}`, `/models/<modelId>/entities/<entityId>/values`, `/models/<modelId>/intents/<intentId>/utterances`.

- [ ] **Step 1: Create the package and move the modules**

```bash
mkdir -p server/blueprints/dataset
for m in models intents entities slots values utterances tags dataset; do
  git mv server/views/api/$m.py server/blueprints/dataset/$m.py
done
```

`server/blueprints/dataset/__init__.py`:

```python
"""
Models and everything a labelled dataset is made of: intents, entities,
slots, values, utterances, tags, and import/export. Owns the `model`,
`intent`, `entity`, `slot`, `value`, `utterance` and `tag` tables.
"""

from flask import Blueprint

from server.blueprints import register_error_handlers

blueprint = Blueprint('dataset', __name__, url_prefix='/api/dataset')
register_error_handlers(blueprint)

from . import models, intents, entities, slots, values, utterances, tags, dataset  # noqa: E402,F401
```

- [ ] **Step 2: Rewrite imports and decorators**

```bash
sed -i '' \
  -e 's/^from \.\.\. import /from server import /' \
  -e 's/^from \.\.\.\([a-z]\)/from server.\1/' \
  -e 's/^from \. import api$/from . import blueprint/' \
  -e 's/@api\./@blueprint./g' \
  server/blueprints/dataset/*.py
grep -n "^from \.\.\|@api\." server/blueprints/dataset/*.py
```
Expected: no output. (`from .utterances import _replace_annotations` in `dataset.py` is a single-dot import and stays.)

- [ ] **Step 3: Remove the modules from the old blueprint**

In `server/views/api/__init__.py` the import line becomes:
`from . import instances, trainings, analytics  # noqa: E402,F401`

- [ ] **Step 4: Ownership comments**

Add as the first line after the module docstring/imports (line 1 if there is no docstring) of each of `server/database/model.py`, `intent.py`, `entity.py`, `slot.py`, `value.py`, `utterance.py`, `tag.py`, `synonym.py`:

```python
# Owned by the `dataset` blueprint. Other blueprints read only.
```

- [ ] **Step 5: Verify**

```bash
S=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') \
 && python $S/check_blueprint.py dataset /api/dataset/models '/api/dataset/models/<modelId>' '/api/dataset/models/<modelId>/dataset' '/api/dataset/models/<modelId>/tags/export' '/api/dataset/models/<modelId>/entities/<entityId>/values' \
 && python -c "from server import create_application_server; create_application_server(); print('legacy ok')"
```
Expected: `dataset: ok (… routes)` listing 40-ish routes, then `legacy ok`.

- [ ] **Step 6: Checkpoint** — report; do not commit.

---

### Task 8: The `training` blueprint

**Files:**
- Create: `server/blueprints/training/__init__.py`
- Rename: `server/views/api/trainings.py` → `server/blueprints/training/trainings.py`
- Modify: `server/views/api/__init__.py`, `server/database/training.py` (ownership comment)

**Interfaces:**
- Produces: `/api/training/trainings/active`, `/api/training/models/<modelId>/trainings[/<trainingId>[/start|/stop|/data]]`.

- [ ] **Step 1: Create the package and move the module**

```bash
mkdir -p server/blueprints/training
git mv server/views/api/trainings.py server/blueprints/training/trainings.py
```

`server/blueprints/training/__init__.py`:

```python
"""
Training runs: create, start, stop, inspect. Owns the `training` table;
enqueues onto the `training` Celery queue; announces runs over Socket.IO
through the message queue (the `events` blueprint hosts the server).
"""

from flask import Blueprint

from server.blueprints import register_error_handlers

blueprint = Blueprint('training', __name__, url_prefix='/api/training')
register_error_handlers(blueprint)

from . import trainings  # noqa: E402,F401
```

- [ ] **Step 2: Rewrite imports and decorators**

```bash
sed -i '' \
  -e 's/^from \.\.\. import /from server import /' \
  -e 's/^from \.\.\.\([a-z]\)/from server.\1/' \
  -e 's/^from \. import api$/from . import blueprint/' \
  -e 's/@api\./@blueprint./g' \
  server/blueprints/training/trainings.py
grep -n "^from \.\.\|@api\." server/blueprints/training/trainings.py
```
Expected: no output.

- [ ] **Step 3: Remove from the old blueprint; ownership comment**

`server/views/api/__init__.py` import line → `from . import instances, analytics  # noqa: E402,F401`.

`server/database/training.py`, first line: `# Owned by the `training` blueprint. `publishing` and `analytics` read only.`

- [ ] **Step 4: Verify**

```bash
S=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') \
 && python $S/check_blueprint.py training /api/training/trainings/active '/api/training/models/<modelId>/trainings' '/api/training/models/<modelId>/trainings/<trainingId>/start' \
 && python -c "from server import create_application_server; create_application_server(); print('legacy ok')"
```
Expected: `training: ok (8 routes)`, `legacy ok`.

- [ ] **Step 5: Checkpoint** — report; do not commit.

---

### Task 9: The `publishing` blueprint

**Files:**
- Create: `server/blueprints/publishing/__init__.py`
- Rename: `server/views/api/instances.py` → `server/blueprints/publishing/instances.py`
- Modify: `server/views/api/__init__.py` (import list and `before_app_first_request`), `server/database/{instance,environment}.py` (ownership comment)

**Interfaces:**
- Produces: `/api/publishing/models/<modelId>/instances[/<int:instanceId>]`; `publishing.init_app(app)` runs `Environment.update()` unless `server.CLI`.

- [ ] **Step 1: Create the package and move the module**

```bash
mkdir -p server/blueprints/publishing
git mv server/views/api/instances.py server/blueprints/publishing/instances.py
```

`server/blueprints/publishing/__init__.py`:

```python
"""
Deployments: publish a trained version into an environment, rotate its
API key, stop it. Owns the `instance` and `environment` tables and is the
only writer of inference routes into the registry (`Instance.start`).
"""

from flask import Blueprint

from server import CLI
from server.blueprints import register_error_handlers

blueprint = Blueprint('publishing', __name__, url_prefix='/api/publishing')
register_error_handlers(blueprint)

from . import instances  # noqa: E402,F401


def init_app(app):
    # Sync the `environments` table to ALLOWED_ENVIRONMENTS. Skipped under
    # the flask CLI, where the table may not exist yet.
    if CLI:
        return
    from server.database import Environment
    with app.app_context():
        Environment.update()
```

- [ ] **Step 2: Rewrite imports and decorators**

```bash
sed -i '' \
  -e 's/^from \.\.\. import /from server import /' \
  -e 's/^from \.\.\.\([a-z]\)/from server.\1/' \
  -e 's/^from \. import api$/from . import blueprint/' \
  -e 's/@api\./@blueprint./g' \
  server/blueprints/publishing/instances.py
grep -n "^from \.\.\|@api\." server/blueprints/publishing/instances.py
```
Expected: no output.

- [ ] **Step 3: Old blueprint: drop `instances` and the `Environment.update()` call**

`server/views/api/__init__.py`: import line → `from . import analytics  # noqa: E402,F401`; in `before_app_first_request` delete the three lines

```python
    with app.app_context():
        from ...database import Environment
        Environment.update()
```

- [ ] **Step 4: Ownership comments**

`server/database/instance.py` and `server/database/environment.py`, first line: `# Owned by the `publishing` blueprint. Other blueprints read only.`

- [ ] **Step 5: Verify**

```bash
S=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') \
 && python $S/check_blueprint.py publishing '/api/publishing/models/<modelId>/instances' '/api/publishing/models/<modelId>/instances/<int:instanceId>' \
 && python -c "from server import create_application_server; create_application_server(); print('legacy ok')"
```
Expected: `publishing: ok (4 routes)`, `legacy ok`. (`init_app` runs `Environment.update()` against the local sqlite DB — if `instance/indicnlu.db` is not migrated, run `flask db upgrade` first.)

- [ ] **Step 6: Checkpoint** — report; do not commit.

---

### Task 10: The `analytics` blueprint and the telemetry consumer

**Files:**
- Create: `server/blueprints/analytics/__init__.py`
- Rename: `server/views/api/analytics.py` → `server/blueprints/analytics/analytics.py`
- Modify: `server/blueprints/analytics/analytics.py` (route paths), `server/views/api/__init__.py`, `server/database/prediction.py` (ownership comment)

**Interfaces:**
- Produces: `/api/analytics/models/<modelId>/{dataset,versions,confusions,live,coverage}`; `analytics.init_app(app)` spawns `server.utils.telemetry.consume(app)` with `gevent.spawn` unless `server.CLI`.

- [ ] **Step 1: Create the package and move the module**

```bash
mkdir -p server/blueprints/analytics
git mv server/views/api/analytics.py server/blueprints/analytics/analytics.py
```

`server/blueprints/analytics/__init__.py`:

```python
"""
Dashboards over the dataset, training history and live predictions.
Read-only on every other blueprint's tables; owns `prediction`, which is
written only by the telemetry consumer this package starts.
"""

import gevent
from flask import Blueprint

from server import CLI
from server.blueprints import register_error_handlers

blueprint = Blueprint('analytics', __name__, url_prefix='/api/analytics')
register_error_handlers(blueprint)

from . import analytics  # noqa: E402,F401


def init_app(app):
    # One consumer per process drains every environment's telemetry queue
    # into `prediction` rows. Run this blueprint with one gunicorn worker;
    # more are harmless (they share the queue) but pointless.
    if CLI:
        return
    from server.utils.telemetry import consume
    gevent.spawn(consume, app)
```

- [ ] **Step 2: Rewrite imports, decorators, and drop the redundant `/analytics/` path segment**

```bash
sed -i '' \
  -e 's/^from \.\.\. import /from server import /' \
  -e 's/^from \.\.\.\([a-z]\)/from server.\1/' \
  -e 's/^from \. import api$/from . import blueprint/' \
  -e 's/@api\./@blueprint./g' \
  -e "s#/models/<modelId>/analytics/#/models/<modelId>/#g" \
  server/blueprints/analytics/analytics.py
grep -n "^from \.\.\|@api\.\|/analytics/" server/blueprints/analytics/analytics.py
```
Expected: no output.

- [ ] **Step 3: Old blueprint: nothing left**

`server/views/api/__init__.py`: delete the `from . import analytics` line entirely, and delete the whole `before_app_first_request` function and its `from ...utils.telemetry import consume` / `socketio.start_background_task(consume, app)` lines. Leave the `api = Blueprint('api', __name__)` and the error handlers (they go in Task 12). In `server/__init__.py`, `create_application_server` still imports `before_app_first_request` — change that import to `from .views import api as api_bp` and delete the two lines `if 'db' not in sys.argv: before_app_first_request(app, socketio)`.

- [ ] **Step 4: Ownership comment**

`server/database/prediction.py`, first line: `# Owned by the `analytics` blueprint (written by its telemetry consumer). Others read only.`

- [ ] **Step 5: Verify**

```bash
S=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') \
 && python $S/check_blueprint.py analytics '/api/analytics/models/<modelId>/dataset' '/api/analytics/models/<modelId>/live' '/api/analytics/models/<modelId>/coverage' \
 && python -c "from server import create_application_server; create_application_server(); print('legacy ok')"
```
Expected: `analytics: ok (5 routes)`, `legacy ok`. The consumer greenlet is spawned but the process exits before it needs Redis.

- [ ] **Step 6: Checkpoint** — report; do not commit.

---

### Task 11: The `inference` and `events` blueprints

**Files:**
- Create: `server/blueprints/inference/__init__.py`, `server/blueprints/events/__init__.py`
- Rename: `server/views/triton/inference.py` → `server/blueprints/inference/inference.py`, `server/events.py` → `server/blueprints/events/namespace.py`
- Modify: `requirements/base.txt` (`Flask-Cors`), `server/blueprints/inference/inference.py`, `server/__init__.py` (`create_triton_server` import path — interim)

**Interfaces:**
- Produces: `POST /api/inference/<environment>/<model_id>`; `events.init_app(app)` attaches the `server.socketio` server with the Redis message queue and the `Event('/')` namespace.

- [ ] **Step 1: Add Flask-Cors**

```bash
pip install Flask-Cors==6.0.1 && grep -n "^Flask-" requirements/base.txt
```
Insert `Flask-Cors==6.0.1` into `requirements/base.txt` in alphabetical position (between `Flask==3.1.0` and `Flask-HTTPAuth==4.8.0`). If pip resolves a different latest 6.x, pin what it installed.

- [ ] **Step 2: Create the `inference` package and move the view**

```bash
mkdir -p server/blueprints/inference
git mv server/views/triton/inference.py server/blueprints/inference/inference.py
```

`server/blueprints/inference/__init__.py`:

```python
"""
Prediction. The one blueprint that never imports SQLAlchemy: it reads the
deployment's route from the environment's registry (Redis), hands inputs
to the serving worker over Redis, and pushes telemetry for `analytics` to
persist. CORS is open because deployments are called from anywhere with an
API key.
"""

from flask import Blueprint
from flask_cors import CORS

from server.blueprints import register_error_handlers

blueprint = Blueprint('inference', __name__, url_prefix='/api/inference')
register_error_handlers(blueprint)
CORS(blueprint, origins='*', methods=['POST', 'OPTIONS'],
     allow_headers=['Authorization', 'Content-Type'])

from . import inference  # noqa: E402,F401
```

- [ ] **Step 3: Rewrite the view's imports, decorator, and path**

```bash
sed -i '' \
  -e 's/^from \.\.\. import /from server import /' \
  -e 's/^from \.\.\.\([a-z]\)/from server.\1/' \
  -e 's/^from \. import triton$/from . import blueprint/' \
  -e "s#@triton.post('/infer/<environment>/<model_id>')#@blueprint.post('/<environment>/<model_id>')#" \
  server/blueprints/inference/inference.py
grep -n "^from\|^@" server/blueprints/inference/inference.py
```
Expected: `from server.auth import api_key_required`, `from server.utils.registry import registry_for`, `from server.utils import telemetry`, `from . import blueprint`, `@blueprint.post('/<environment>/<model_id>')`, `@api_key_required`. Also confirm the lazy-launch import inside the function reads `from server.tasks.serve import serve`.

Then verify the view does not import the database anywhere:

```bash
grep -n "database\|sqlalchemy\| db" server/blueprints/inference/*.py
```
Expected: no output.

- [ ] **Step 4: Create the `events` package**

```bash
mkdir -p server/blueprints/events
git mv server/events.py server/blueprints/events/namespace.py
sed -i '' -e 's/^from \.auth import/from server.auth import/' server/blueprints/events/namespace.py
```

`server/blueprints/events/__init__.py`:

```python
"""
The Socket.IO server — the only process that hosts /socket.io. Every other
process emits through the Redis message queue (server.utils.socket), and
this one fans those messages out to the browsers in the right rooms.

Long-polling needs a client's requests to keep hitting one process, so run
exactly one gunicorn worker for this blueprint.
"""

from server import socketio
from .namespace import Event

blueprint = None


def init_app(app):
    socketio.init_app(app,
                      manage_session=False,
                      message_queue=app.config['SOCKETIO_MESSAGE_QUEUE'])
    socketio.on_namespace(Event('/'))
```

- [ ] **Step 5: Interim wiring for the old factories**

In `server/__init__.py`:
- `create_application_server`: delete the lines `from .events import Event` and `socketio.on_namespace(Event('/'))`, replace them with `from .blueprints.events.namespace import Event` and `socketio.on_namespace(Event('/'))`.
- `create_triton_server`: replace `from .views import triton as triton_bp` / `app.register_blueprint(triton_bp, url_prefix='/api')` with `from .blueprints.inference import blueprint as inference_bp` / `app.register_blueprint(inference_bp)`.
- `server/views/__init__.py`: delete the line `from .triton import triton  # noqa: F401`.
- `git rm -rq server/views/triton`.

- [ ] **Step 6: Verify**

```bash
S=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') \
 && python $S/check_blueprint.py inference '/api/inference/<environment>/<model_id>' \
 && python $S/check_blueprint.py events \
 && python -c "
from server import create_app
app = create_app('inference'); c = app.test_client()
r = c.options('/api/inference/testing/x', headers={'Origin': 'http://x', 'Access-Control-Request-Method': 'POST'})
assert r.headers.get('Access-Control-Allow-Origin') == '*', dict(r.headers)
r = c.post('/api/inference/nowhere/x', json={'inputs': ['a']}); assert r.status_code == 404 and 'environment' in r.json['error'], r.json
r = c.post('/api/inference/testing/x', json={'inputs': ['a']}); assert r.status_code == 401
print('inference ok')"
```
Expected: `inference: ok (1 routes)`, `events: ok (0 routes)`, `inference ok`.

- [ ] **Step 7: Checkpoint** — report; do not commit.

---

### Task 12: Delete the old factories and `server/views`; final `app.py`; migrations still work

**Files:**
- Delete: `server/views/` (whole tree)
- Modify: `server/__init__.py`, `app.py`, `server/database/__init__.py` (docstring), `server/database/user.py` (ownership comment)

**Interfaces:**
- Produces: `app.create_app(*names)` (gunicorn / flask CLI entry), `python app.py [name ...]`.

- [ ] **Step 1: Delete the old view tree and factories**

```bash
git rm -rq server/views
```

In `server/__init__.py` delete `create_application_server` and `create_triton_server` entirely. The file now ends with `create_app`. Remove the `import os` if unused (`redis = StrictRedis(host=os.environ.get(...))` still uses it — keep in that case).

- [ ] **Step 2: Final `app.py`**

```python
from gevent import monkey
monkey.patch_all()

import sys


def create_app(*names):
    """
    gunicorn / flask-CLI entry: `gunicorn "app:create_app('dataset')"`,
    `flask db upgrade` (which discovers this by name and mounts everything,
    with background work skipped — see server.CLI).
    """
    from server import create_app as factory
    return factory(*names)


def main(names):
    """`python app.py [name ...]` — the named blueprints, default all, on PORT."""
    app = create_app(*names)
    debug = app.config['DEBUG']
    port = app.config['PORT']
    if 'socketio' in app.extensions:
        # The events blueprint is mounted: serve through Socket.IO so the
        # WebSocket upgrade works under the dev server.
        from server import socketio
        socketio.run(app, host='0.0.0.0', port=port,
                     debug=debug, use_reloader=debug, log_output=debug)
    else:
        app.run(host='0.0.0.0', port=port, debug=debug, use_reloader=debug)


if __name__ == '__main__':
    main(sys.argv[1:])
```

- [ ] **Step 3: Docstrings and the last ownership comment**

`server/database/__init__.py` docstring first line: `SQLAlchemy models for the control plane.` → `SQLAlchemy models. Each module states which blueprint owns (writes) its table.`

`server/database/user.py`, first line: `# Owned by the `auth` blueprint. Other blueprints read only.`

- [ ] **Step 4: Verify everything mounts, alone and together, and the CLI still finds the app**

```bash
S=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad
grep -rn "create_application_server\|create_triton_server\|server\.views\|from \.views\|sage\|triton" server app.py; echo "--- (expect nothing above)"
python -m py_compile $(git ls-files 'server/**/*.py' 'server/*.py') app.py \
 && for b in auth dataset training publishing analytics inference events; do python $S/check_blueprint.py $b | head -1; done \
 && python -c "
from app import create_app
app = create_app()
rules = {str(r) for r in app.url_map.iter_rules() if r.endpoint != 'static'}
prefixes = {r.split('/')[2] for r in rules}
assert prefixes == {'auth','dataset','training','publishing','analytics','inference'}, prefixes
assert 'socketio' in app.extensions
print('all-in-one ok', len(rules), 'routes')" \
 && flask db current 2>&1 | tail -1
```
Expected: the grep prints nothing; seven `<name>: ok` lines; `all-in-one ok …`; `flask db current` prints the head revision (proves the CLI discovers `create_app()` and `CLI` skipped the background work).

- [ ] **Step 5: Checkpoint** — report; do not commit.

---

### Task 13: Frontend API prefixes

**Files:**
- Modify: `src/api/{users,tokens,models,intents,entities,slots,values,utterances,tags,dataset,trainings,instances,analytics}.js`

**Interfaces:**
- Consumes: the route table from Tasks 6–11.

- [ ] **Step 1: Rewrite the base paths**

```bash
sed -i '' -e 's#"/api/users#"/api/auth/users#g; s#`/api/users#`/api/auth/users#g' src/api/users.js
sed -i '' -e 's#"/api/tokens#"/api/auth/tokens#g' src/api/tokens.js
for f in models intents entities slots values utterances tags dataset; do
  sed -i '' -e 's#"/api/models#"/api/dataset/models#g; s#`/api/models#`/api/dataset/models#g' src/api/$f.js
done
sed -i '' -e 's#"/api/trainings#"/api/training/trainings#g; s#`/api/models#`/api/training/models#g' src/api/trainings.js
sed -i '' -e 's#`/api/models#`/api/publishing/models#g' src/api/instances.js
sed -i '' -e 's#`/api/models/\${modelId}/analytics/#`/api/analytics/models/${modelId}/#g' src/api/analytics.js
grep -n '"/api\|`/api' src/api/*.js | grep -v "/api/auth/\|/api/dataset/\|/api/training/\|/api/publishing/\|/api/analytics/"
```
Expected: no output (every literal now carries a blueprint prefix). `src/api/inference.js` has no `/api` literal and is untouched.

- [ ] **Step 2: Cross-check every frontend path against the server's url map**

```bash
python - <<'EOF'
import re, glob, sys
from app import create_app
app = create_app()
rules = [str(r) for r in app.url_map.iter_rules() if r.endpoint != 'static']
patterns = [re.compile('^' + re.sub(r'<[^>]+>', '[^/]+', r) + '$') for r in rules]
missing = []
for f in glob.glob('src/api/*.js'):
    for lit in re.findall(r'[`"](/api/[^`"?]*)[`"]', open(f).read()):
        path = re.sub(r'\$\{[^}]+\}', 'X', lit)
        if not any(p.match(path) for p in patterns):
            missing.append((f, lit))
print('missing:', missing)
sys.exit(1 if missing else 0)
EOF
```
Expected: `missing: []`.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -3
```
Expected: `✓ built in …`.

- [ ] **Step 4: Checkpoint** — report; do not commit.

---

### Task 14: nginx, compose, bake, Dockerfiles, `.env.example`

**Files:**
- Rewrite: `nginx.conf`, `docker-compose.yml`, `docker-compose.gpu.yml`, `docker-bake.hcl`, `.env.example`
- Modify: `docker/Dockerfile.api` (header, `EXPOSE`, `CMD`), `docker/Dockerfile.worker` (CMD already renamed in Task 2)

**Interfaces:**
- Consumes: `app:create_app('<name>')`, `server.tasks:training`, `server.tasks:serving`, `Config.PUBLIC_URL`, `INFERENCE_WORKERS`.

- [ ] **Step 1: `nginx.conf`**

```nginx
# Mirrors the Vite dev proxy (vite.config.js): the SPA is static; each
# /api/<blueprint>/ prefix goes to the compose service of that name, and
# /socket.io/ to `events`, the one process that hosts Socket.IO. Inference
# (/api/inference/<environment>/<model_id>) is proxied like the rest, so no
# backend port is published.

server {
    listen 80;
    server_name _;

    # Resolve services through Docker's embedded DNS at request time (a
    # variable in proxy_pass forces that), so nginx starts and stays up
    # whether or not a service is running or has been recreated.
    resolver 127.0.0.11 valid=10s ipv6=off;

    root /usr/share/nginx/html;
    index index.html;

    client_max_body_size 64m;

    # Inherited by every location below that sets no proxy_set_header of
    # its own (nginx inherits the whole block or none of it).
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location /api/auth/ {
        set $auth http://auth:5000;
        proxy_pass $auth;
    }

    location /api/dataset/ {
        set $dataset http://dataset:5000;
        proxy_pass $dataset;
        # Import/export of a large dataset is slow.
        proxy_read_timeout 300s;
    }

    location /api/training/ {
        set $training http://training:5000;
        proxy_pass $training;
    }

    location /api/publishing/ {
        set $publishing http://publishing:5000;
        proxy_pass $publishing;
    }

    location /api/analytics/ {
        set $analytics http://analytics:5000;
        proxy_pass $analytics;
        proxy_read_timeout 300s;
    }

    location /api/inference/ {
        set $inference http://inference:5000;
        proxy_pass $inference;
        # Must exceed INFERENCE_BATCH_TIMEOUT (120 s): a cold model that is
        # still loading is waited for, not failed.
        proxy_read_timeout 150s;
    }

    # No blueprint claims it.
    location /api/ {
        return 404;
    }

    location /socket.io/ {
        set $events http://events:5000;
        proxy_pass $events;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }

    # Hashed assets are immutable; everything else falls through to the SPA.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: `docker-compose.yml`**

```yaml
# Single-host deployment: one container per process. Three images
# (docker/Dockerfile.client, .api, .worker); one service per image carries
# `build:` and the rest run the tag it produces, because parallel builds
# of one tag race on the export step:
#
#   client           -> client image (nginx + built UI)
#   api              -> api image    (runs the migrations, then exits)
#   training-worker  -> worker image (the only one with TensorFlow)
#
#   docker compose up -d --build                              # CPU workers
#   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build   # CUDA host
#
# UI on http://localhost/. nginx proxies /api/<blueprint>/ to the service
# of that name and /socket.io/ to `events`; only `client` (and flower, on
# loopback) publishes a host port. Deployment endpoints are
# PUBLIC_URL/api/inference/<environment>/<model_id>, so PUBLIC_URL must be
# the name users reach the UI on.
#
# Host-specific values in .env (localhost Redis, sqlite) are overridden per
# service below; python-dotenv never overrides a variable that is already
# set, so the compose values win inside the containers.

x-postgres-env: &postgres-env
  POSTGRES_USER: ${POSTGRES_USER:-indicnlu}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-indicnlu}
  POSTGRES_DB: ${POSTGRES_DB:-indicnlu}

x-env: &env
  FLASK_DEBUG: "false"
  SQLALCHEMY_DATABASE_URI: postgresql://${POSTGRES_USER:-indicnlu}:${POSTGRES_PASSWORD:-indicnlu}@postgres:5432/${POSTGRES_DB:-indicnlu}
  CELERY_RESULT_BACKEND: db+postgresql://${POSTGRES_USER:-indicnlu}:${POSTGRES_PASSWORD:-indicnlu}@postgres:5432/${POSTGRES_DB:-indicnlu}
  REDIS_HOST: redis
  REDIS_PORT: "6379"
  REDIS_DB: "0"
  CELERY_BROKER_URL: redis://redis:6379/0
  SOCKETIO_MESSAGE_QUEUE: redis://redis:6379/0
  # config.py defaults these to localhost (never empty), so registry_for()
  # never falls back to the shared client — they must point at the service.
  REDIS_URL_TESTING: redis://redis:6379/0
  REDIS_URL_PRODUCTION: redis://redis:6379/0
  STORAGE_PROVIDER: ${STORAGE_PROVIDER:-local}
  STORAGE_BUCKET: ${STORAGE_BUCKET:-data}
  PUBLIC_URL: ${PUBLIC_URL:-http://localhost}

x-python: &python
  env_file: .env
  environment: *env
  volumes:
    # The `local` storage provider resolves STORAGE_BUCKET against the
    # working directory (/app), so every service shares one bucket.
    - data:/app/data
  restart: unless-stopped

x-depends: &depends
  redis:
    condition: service_healthy
  postgres:
    condition: service_healthy
  api:
    condition: service_completed_successfully

# One blueprint per service, all from the api image, under gunicorn's
# gevent worker on port 5000: `gunicorn "app:create_app('<name>')"`.
x-blueprint: &blueprint
  <<: *python
  image: ${REGISTRY:-}api:${TAG:-latest}
  depends_on: *depends

# Celery workers from the worker image; WORKER_DEVICE selects the cpu
# (default) or cuda variant — docker-compose.gpu.yml sets cuda.
x-worker: &worker
  <<: *python
  image: ${REGISTRY:-}worker:${TAG:-latest}-${WORKER_DEVICE:-cpu}
  depends_on: *depends

services:
  redis:
    image: redis:7-alpine
    command: redis-server --save 60 1 --appendonly yes
    volumes:
      - redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment: *postgres-env
    volumes:
      - postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-indicnlu} -d ${POSTGRES_DB:-indicnlu}"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  # Builds the api image, applies the migrations, exits. Every blueprint
  # and worker waits for it, so a fresh volume is migrated before anything
  # starts.
  api:
    <<: *python
    image: ${REGISTRY:-}api:${TAG:-latest}
    build:
      context: .
      dockerfile: docker/Dockerfile.api
    command: flask db upgrade
    restart: "no"
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

  auth:
    <<: *blueprint
    command: gunicorn -k gevent -w 1 -b 0.0.0.0:5000 --timeout 120 "app:create_app('auth')"

  dataset:
    <<: *blueprint
    # Import/export can hold a request for minutes; --timeout is gunicorn's
    # worker heartbeat, so it must outlast them.
    command: gunicorn -k gevent -w 1 -b 0.0.0.0:5000 --timeout 300 "app:create_app('dataset')"

  training:
    <<: *blueprint
    command: gunicorn -k gevent -w 1 -b 0.0.0.0:5000 --timeout 120 "app:create_app('training')"

  publishing:
    <<: *blueprint
    command: gunicorn -k gevent -w 1 -b 0.0.0.0:5000 --timeout 120 "app:create_app('publishing')"

  # Also runs the telemetry consumer, so keep one worker.
  analytics:
    <<: *blueprint
    command: gunicorn -k gevent -w 1 -b 0.0.0.0:5000 --timeout 300 "app:create_app('analytics')"

  # Stateless (the request/serve handshake lives in Redis), so several
  # gunicorn workers are fine.
  inference:
    <<: *blueprint
    command: gunicorn -k gevent -w ${INFERENCE_WORKERS:-2} -b 0.0.0.0:5000 --timeout 120 "app:create_app('inference')"

  # The Socket.IO server. One worker: long-polling needs a client's
  # requests to hit one process.
  events:
    <<: *blueprint
    command: gunicorn -k gevent -w 1 -b 0.0.0.0:5000 --timeout 300 "app:create_app('events')"

  # Celery monitoring. Both Celery apps share the broker and the workers
  # run with -E, so one flower sees the training, testing and production
  # queues and can inspect, revoke and terminate tasks. Published on
  # loopback by default; set FLOWER_BIND=0.0.0.0 together with
  # FLOWER_BASIC_AUTH=user:password in .env to reach it from elsewhere.
  flower:
    <<: *blueprint
    # flower 2.x returns 401 for every /api/* call — which the UI's revoke and
    # shutdown buttons use — unless auth is configured or
    # FLOWER_UNAUTHENTICATED_API is set. It also splits FLOWER_BASIC_AUTH on
    # ',' even when empty, which would enable auth with an unmatchable
    # credential. So: credentials set → use them; empty → drop the variable
    # and open the API. Keep FLOWER_BIND on loopback unless auth is set.
    command: sh -c 'if [ -n "$$FLOWER_BASIC_AUTH" ]; then :; else unset FLOWER_BASIC_AUTH; export FLOWER_UNAUTHENTICATED_API=true; fi; exec celery -A server.tasks:training flower --port=5555'
    environment:
      <<: *env
      FLOWER_BASIC_AUTH: ${FLOWER_BASIC_AUTH:-}
    ports:
      - "${FLOWER_BIND:-127.0.0.1}:${FLOWER_PORT:-5555}:5555"
    depends_on:
      redis:
        condition: service_healthy

  # Training worker; builds the worker image. Prefork with
  # max_tasks_per_child=1 (WorkerConfig) gives every training run a fresh
  # process; one at a time keeps a single host from oversubscribing its
  # CPUs/GPU.
  training-worker:
    <<: *worker
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
      args:
        DEVICE: ${WORKER_DEVICE:-cpu}
    command: celery -A server.tasks:training worker -E -Q training -P prefork -c 1 -l INFO -Ofair -n training@%h

  # Serving workers: one per environment queue. Each serving task holds one
  # model for the life of its process, so the pool size is the number of
  # models that can be live at once in that environment.
  serving-worker-testing:
    <<: *worker
    command: celery -A server.tasks:serving worker -E -Q testing -P prefork -l INFO -Ofair -n serving-testing@%h

  serving-worker-production:
    <<: *worker
    command: celery -A server.tasks:serving worker -E -Q production -P prefork -l INFO -Ofair -n serving-production@%h

  # Static frontend + reverse proxy (nginx.conf).
  client:
    build:
      context: .
      dockerfile: docker/Dockerfile.client
    image: ${REGISTRY:-}client:${TAG:-latest}
    ports:
      - "${CLIENT_PORT:-80}:80"
    restart: unless-stopped

volumes:
  data:
  redis:
  postgres:
```

- [ ] **Step 3: `docker-compose.gpu.yml`**

```yaml
# Override for the CUDA deployment host (linux/amd64 with the NVIDIA
# Container Toolkit):
#
#   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
#
# Switches every worker to the cuda variant of the worker image and grants
# the GPUs. Nothing else in the stack changes. Multi-GPU scheduling is not
# handled here: all three services see every GPU.

x-worker-gpu: &worker-gpu
  image: ${REGISTRY:-}worker:${TAG:-latest}-cuda
  gpus: all

services:
  training-worker:
    <<: *worker-gpu
    build:
      args:
        DEVICE: cuda

  serving-worker-testing:
    <<: *worker-gpu

  serving-worker-production:
    <<: *worker-gpu
```

- [ ] **Step 4: `docker-bake.hcl`**

Replace the targets and groups (keep the header comment and the two `variable` blocks):

```hcl
group "default" {
  targets = ["client", "api", "training-worker"]
}

group "cuda" {
  targets = ["worker-cuda"]
}

group "all" {
  targets = ["client", "api", "training-worker", "worker-cuda"]
}

target "client" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}client:${TAG}"]
}

target "api" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}api:${TAG}"]
}

// CPU worker: compose's `training-worker` service with both arches.
target "training-worker" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}worker:${TAG}-cpu"]
  args = {
    DEVICE = "cpu"
  }
}

// CUDA worker: same Dockerfile, TensorFlow's [and-cuda] wheels. x86_64 only.
target "worker-cuda" {
  inherits  = ["training-worker"]
  platforms = ["linux/amd64"]
  tags      = ["${REGISTRY}worker:${TAG}-cuda"]
  args = {
    DEVICE = "cuda"
  }
}
```

- [ ] **Step 5: `docker/Dockerfile.api`**

Header comment (lines 1–6) becomes:

```dockerfile
# Everything that is Flask/Celery without the ML stack: the seven
# blueprints (docker-compose.yml runs one per container via
# `app:create_app('<name>')`), `flask db upgrade`, and flower. Servers run
# under gunicorn's gevent worker on 5000.
```

`EXPOSE 5001 5002 5003 5004` → `EXPOSE 5000`. The trailing comment and CMD become:

```dockerfile
# Default: every blueprint in one process (compose overrides per service).
CMD ["gunicorn", "-k", "gevent", "-w", "1", "-b", "0.0.0.0:5000", "--timeout", "300", "app:create_app()"]
```

- [ ] **Step 6: `.env.example`**

Replace the file with:

```bash
# Copy to .env. Loaded by python-dotenv for the host processes and by
# docker-compose.yml (env_file + ${VAR} interpolation) for the containers.
# Compose overrides the host-specific values (Redis, database) per service,
# so the same .env serves both ways of running the stack.

# Interactive debugger and reloader. Host development only; compose forces
# it off.
FLASK_DEBUG=true

# Port `python app.py` listens on (containers always bind 5000). The Vite
# dev server proxies to it.
PORT=5000

# Signs user sessions and deployment API keys. Change it.
SECRET_KEY=change-me

# ── Database ─────────────────────────────────────────────────
# Host processes: relative sqlite paths resolve under ./instance.
SQLALCHEMY_DATABASE_URI=sqlite:///indicnlu.db
CELERY_RESULT_BACKEND=db+sqlite:///instance/indicnlu.db

# Compose: credentials for the postgres service; the backend URIs are
# derived from these.
POSTGRES_USER=indicnlu
POSTGRES_PASSWORD=indicnlu
POSTGRES_DB=indicnlu

# ── Redis ────────────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
CELERY_BROKER_URL=redis://localhost:6379/0
SOCKETIO_MESSAGE_QUEUE=redis://localhost:6379/0
# Per-environment inference registries. config.py defaults these to
# localhost; compose points them at the redis service.
# REDIS_URL_TESTING=redis://localhost:6379/0
# REDIS_URL_PRODUCTION=redis://localhost:6379/0

# ── Storage ──────────────────────────────────────────────────
# `local` writes artifacts under ./<STORAGE_BUCKET> (a shared volume in
# compose). Other providers: s3, gcs, azure, minio, ftp, sftp, akamai.
STORAGE_PROVIDER=local
STORAGE_BUCKET=data

# ── Public address ───────────────────────────────────────────
# The URL users reach the UI on. Deployment endpoints are
# PUBLIC_URL/api/inference/<environment>/<model_id>, so on a real
# deployment set this to the host's public name, e.g. http://nlu.example.com.
PUBLIC_URL=http://localhost

# Port nginx publishes the UI on (compose only).
CLIENT_PORT=80

# ── Containers ───────────────────────────────────────────────
# Image name prefix and tag (compose + docker-bake.hcl). Empty REGISTRY
# means plain local tags, e.g. api:latest.
REGISTRY=
TAG=latest
# cpu | cuda — which worker image variant compose builds and runs. The CUDA
# host uses docker-compose.gpu.yml, which forces cuda.
WORKER_DEVICE=cpu
# gunicorn worker processes for the inference service.
INFERENCE_WORKERS=2
# Celery monitoring UI. Published on loopback only unless FLOWER_BIND is
# 0.0.0.0 — do that only together with FLOWER_BASIC_AUTH=user:password,
# because without credentials flower's API (task submit, worker shutdown)
# is open to whoever reaches the port.
FLOWER_BIND=127.0.0.1
FLOWER_PORT=5555
FLOWER_BASIC_AUTH=
```

- [ ] **Step 7: Verify the configs resolve and the images build**

The Docker credential helper hangs on this machine; use the credsStore-free config prepared in this session:

```bash
export DOCKER_CONFIG=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/f9bf1933-f474-4ea6-8982-42af79943170/scratchpad/dockercfg
[ -d "$DOCKER_CONFIG" ] || { mkdir -p "$DOCKER_CONFIG"; python3 -c "import json;c=json.load(open('$HOME/.docker/config.json'));c.pop('credsStore',None);c.pop('credHelpers',None);json.dump(c,open('$DOCKER_CONFIG/config.json','w'))"; ln -sfn ~/.docker/cli-plugins "$DOCKER_CONFIG/cli-plugins"; ln -sfn ~/.docker/contexts "$DOCKER_CONFIG/contexts"; }
docker compose config --format json | python3 -c "
import json,sys;c=json.load(sys.stdin)
names=set(c['services'])
assert names=={'redis','postgres','api','auth','dataset','training','publishing','analytics','inference','events','flower','training-worker','serving-worker-testing','serving-worker-production','client'}, names
ports={n:[p['published'] for p in s.get('ports',[])] for n,s in c['services'].items() if s.get('ports')}
assert set(ports)=={'client','flower'}, ports
builds={n for n,s in c['services'].items() if 'build' in s}
assert builds=={'api','training-worker','client'}, builds
for n in ('auth','dataset','training','publishing','analytics','inference','events'):
    assert c['services'][n]['image']=='api:latest' and 'api' in c['services'][n]['depends_on'], n
print('compose ok')"
docker compose -f docker-compose.yml -f docker-compose.gpu.yml config --format json | python3 -c "
import json,sys;c=json.load(sys.stdin)
for n in ('training-worker','serving-worker-testing','serving-worker-production'): assert c['services'][n]['image']=='worker:latest-cuda', n
print('gpu ok')"
docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all 2>/dev/null | sed -n '/^{/,$p' | python3 -c "
import json,sys;c=json.load(sys.stdin)
assert set(c['target'])=={'client','api','training-worker','worker-cuda'}, set(c['target'])
print('bake ok')"
docker compose build 2>&1 | grep -E "Built|ERROR"
docker run --rm client:latest nginx -t 2>&1 | tail -1
```
Expected: `compose ok`, `gpu ok`, `bake ok`, three `Built` lines (`api:latest`, `worker:latest-cpu`, `client:latest`), and `nginx: configuration file /etc/nginx/nginx.conf test is successful`.

- [ ] **Step 8: Checkpoint** — report; do not commit.

---

### Task 14b: Per-environment inference services and Redis instances (amendment)

Owner request made during Task 14; spec section "Inference" and "Compose and nginx" carry the amended design. The blueprint code does not change — the environment already comes from the URL and `registry_for(env)` already reads `REDIS_URL_<ENV>` — so this is compose + nginx only.

**Files:**
- Modify: `docker-compose.yml`, `nginx.conf`, `.env.example`

**Interfaces:**
- Produces: compose services `inference-testing`, `inference-production` (replacing `inference`), `redis-testing`, `redis-production` (alongside `redis`); nginx locations `/api/inference/testing/` and `/api/inference/production/`; `/socket.io/` restates `X-Forwarded-Proto`.

- [ ] **Step 1: `docker-compose.yml` — Redis per environment**

Replace the two registry lines in `x-env`:

```yaml
  # config.py defaults these to localhost (never empty), so registry_for()
  # never falls back to the shared client — they must point at the service.
  REDIS_URL_TESTING: redis://redis:6379/0
  REDIS_URL_PRODUCTION: redis://redis:6379/0
```
with
```yaml
  # One registry per inference environment, each on its own Redis. `redis`
  # itself stays the Celery broker and the Socket.IO message queue.
  # config.py defaults these to localhost (never empty), so registry_for()
  # never falls back to the shared client — they must point at the service.
  REDIS_URL_TESTING: redis://redis-testing:6379/0
  REDIS_URL_PRODUCTION: redis://redis-production:6379/0
```

Add a Redis anchor directly above `x-depends`:

```yaml
x-redis: &redis
  image: redis:7-alpine
  command: redis-server --save 60 1 --appendonly yes
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 10
  restart: unless-stopped

```

Extend `x-depends` so every blueprint and worker waits for all three:

```yaml
x-depends: &depends
  redis:
    condition: service_healthy
  redis-testing:
    condition: service_healthy
  redis-production:
    condition: service_healthy
  postgres:
    condition: service_healthy
  api:
    condition: service_completed_successfully
```

Replace the `redis:` service block with three services using the anchor:

```yaml
  # Celery broker + Socket.IO message queue.
  redis:
    <<: *redis
    volumes:
      - redis:/data

  # Inference registries, one per environment (routes, request/response
  # queues, telemetry queue). Separate instances so one environment's
  # load never touches the other's.
  redis-testing:
    <<: *redis
    volumes:
      - redis-testing:/data

  redis-production:
    <<: *redis
    volumes:
      - redis-production:/data
```

`flower`'s own `depends_on` (only `redis`) stays as is. Add `redis-testing:` and `redis-production:` under top-level `volumes:`.

- [ ] **Step 2: `docker-compose.yml` — inference per environment**

Replace the `inference:` service (and its comment) with:

```yaml
  # Inference, one container per environment — like the serving workers.
  # nginx routes /api/inference/<environment>/ to the matching one. The
  # process is stateless (the request/serve handshake lives in that
  # environment's Redis), so several gunicorn workers are fine.
  inference-testing:
    <<: *blueprint
    command: gunicorn -k gevent -w ${INFERENCE_WORKERS:-2} -b 0.0.0.0:5000 --timeout 120 "app:create_app('inference')"

  inference-production:
    <<: *blueprint
    command: gunicorn -k gevent -w ${INFERENCE_WORKERS:-2} -b 0.0.0.0:5000 --timeout 120 "app:create_app('inference')"
```

In the header comment, change "`auth`, `dataset`, … one blueprint each" wording only if it names `inference` alone; make sure it reads that `inference-<environment>` and `redis-<environment>` exist per environment. Keep the rest of the header.

- [ ] **Step 3: `nginx.conf`**

Replace the `location /api/inference/ { … }` block with:

```nginx
    # One inference service per environment, like the serving workers.
    # Must exceed INFERENCE_BATCH_TIMEOUT (120 s): a cold model that is
    # still loading is waited for, not failed. Any other environment falls
    # through to the /api/ 404 below.
    location /api/inference/testing/ {
        set $inference_testing http://inference-testing:5000;
        proxy_pass $inference_testing;
        proxy_read_timeout 150s;
    }

    location /api/inference/production/ {
        set $inference_production http://inference-production:5000;
        proxy_pass $inference_production;
        proxy_read_timeout 150s;
    }
```

In the `/socket.io/` location add `proxy_set_header X-Forwarded-Proto $scheme;` after the `X-Forwarded-For` line, and update the header comment's last sentence to say the environment prefix picks the inference container.

- [ ] **Step 4: `.env.example`**

Under `# ── Redis ───` replace the two commented registry lines and their comment with:

```bash
# Per-environment inference registries. Host default: the same local Redis
# for both. Compose runs one Redis per environment (redis-testing,
# redis-production) and sets these to point at them.
# REDIS_URL_TESTING=redis://localhost:6379/0
# REDIS_URL_PRODUCTION=redis://localhost:6379/0
```

and change the `INFERENCE_WORKERS` comment to `# gunicorn worker processes per inference-<environment> service.`

- [ ] **Step 5: Verify**

```bash
export DOCKER_CONFIG=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/f9bf1933-f474-4ea6-8982-42af79943170/scratchpad/dockercfg
docker compose config --format json | python3 -c "
import json,sys;c=json.load(sys.stdin)
names=set(c['services'])
assert names=={'redis','redis-testing','redis-production','postgres','api','auth','dataset','training','publishing','analytics','inference-testing','inference-production','events','flower','training-worker','serving-worker-testing','serving-worker-production','client'}, names
ports={n for n,s in c['services'].items() if s.get('ports')}
assert ports=={'client','flower'}, ports
builds={n for n,s in c['services'].items() if 'build' in s}
assert builds=={'api','training-worker','client'}, builds
env=c['services']['inference-testing']['environment']
assert env['REDIS_URL_TESTING']=='redis://redis-testing:6379/0' and env['REDIS_URL_PRODUCTION']=='redis://redis-production:6379/0', env
for n in ('inference-testing','publishing','serving-worker-testing'):
    d=c['services'][n]['depends_on']; assert {'redis','redis-testing','redis-production','postgres','api'}<=set(d), (n,d)
assert set(c['volumes'])=={'data','redis','redis-testing','redis-production','postgres'}, set(c['volumes'])
print('compose ok')"
docker compose -f docker-compose.yml -f docker-compose.gpu.yml config >/dev/null && echo 'gpu ok'
docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all >/dev/null 2>&1 && echo 'bake ok'
docker compose build client 2>&1 | grep -E "Built|ERROR"
docker run --rm client:latest sh -c 'nginx -t 2>&1 | tail -1; grep -c "inference-testing\|inference-production" /etc/nginx/conf.d/default.conf; grep -A8 "location /socket.io/" /etc/nginx/conf.d/default.conf | grep -c X-Forwarded-Proto'
```
Expected: `compose ok`, `gpu ok`, `bake ok`, `client:latest Built`, `test is successful`, `2`, `1`.

- [ ] **Step 6: Checkpoint** — report; do not commit.

---

### Task 15: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README "How it fits together" and "Running locally" step 4**

Replace README lines 31–39 (`### How it fits together` section) with:

```markdown
### How it fits together

The backend is seven Flask blueprints under [server/blueprints/](server/blueprints/), one per deployable service, all served from one image. The name of a blueprint is its URL prefix (`/api/<name>/`), its nginx location and its compose service:

- **auth** — sign-up, sign-in, session tokens.
- **dataset** — models and everything a labelled dataset is made of (intents, entities, slots, values, utterances, tags, import/export).
- **training** — training runs; enqueues onto the `training` Celery queue.
- **publishing** — deployments: writes a route into the environment's registry (Redis) and launches the serving task.
- **analytics** — dashboards; runs the telemetry consumer that persists predictions.
- **inference** — `POST /api/inference/<environment>/<model_id>`: reads the route from Redis, hands inputs to the serving worker over Redis, never touches the database.
- **events** — the Socket.IO server (`/socket.io`); every other process emits through the Redis message queue.
- **Workers** — the `training` Celery app runs training (`training` queue); the `serving` app runs serving tasks, one worker per environment queue (`testing`, `production`). A serving task loads a model once and answers batches until it is unpublished, superseded, or idle.
```

Replace step 4 of "Running locally" with:

```markdown
4. **Start the processes**, each in its own terminal (there is no process manager):

   ```bash
   python app.py                                                       # every blueprint in one process, :5000
   celery -A server.tasks:training worker -Q training -P prefork -c 1  # training worker
   celery -A server.tasks:serving  worker -Q testing  -P prefork       # serving worker, testing
   ```

   `python app.py training` (any blueprint names) runs a subset. To also serve `production` locally, run a second serving worker with `-Q production`.
```

And in step 5 replace the proxy sentence with: "The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:${PORT}`."

- [ ] **Step 2: README compose table and commands**

Replace the service table with:

```markdown
| Service | Role | Published port |
|---|---|---|
| `client` | nginx: built UI, proxies `/api/<blueprint>/` and `/socket.io/` | `80` (`CLIENT_PORT`) |
| `api` | builds the Flask image, runs `flask db upgrade`, exits | — |
| `auth`, `dataset`, `training`, `publishing`, `analytics`, `inference`, `events` | one blueprint each (gunicorn, gevent) | — |
| `flower` | Celery monitoring for every queue | `127.0.0.1:5555` (`FLOWER_BIND`, `FLOWER_PORT`) |
| `training-worker` | training worker (builds the worker image) | — |
| `serving-worker-testing` / `serving-worker-production` | serving workers | — |
| `redis`, `postgres` | with healthchecks and named volumes | — |
```

Update the image table's first column to `client`, `api`, `worker:<tag>-cpu` / `-cuda`. In "Useful commands" change `docker compose logs -f api worker` → `docker compose logs -f dataset training-worker` and `docker compose restart worker-testing` → `docker compose restart serving-worker-testing`.

- [ ] **Step 3: README developer notes**

Replace the first two bullets under "Notes for developers" with:

```markdown
- **Inference endpoints go through nginx.** A deployment's endpoint is `PUBLIC_URL/api/inference/<environment>/<model_id>`; set `PUBLIC_URL` to the host's public name.
- **Environments are inference environments.** `testing` / `production` each have a route registry (`REDIS_URL_<ENV>`), a serving queue of the same name and an API-key TTL (`ALLOWED_ENVIRONMENTS` in [server/config.py](server/config.py)). No HTTP process "serves" an environment: `inference` reads it from the URL, serving workers from their queue. Adding one means editing that dict and running a serving worker on the new queue.
- **One Socket.IO server.** Only `events` hosts `/socket.io`; everything else emits through `server/utils/socket.py` (the Redis message queue). Keep `events` at one gunicorn worker.
```

- [ ] **Step 4: CLAUDE.md**

Rewrite these sections (keep "What this is", "Devices", "ML models", "Data model", "Frontend", "Conventions" as they are, except the path fixes noted):

"Commands → Backend" becomes:

```markdown
Backend — there is **no process manager**; each of these is a separate long-running process, all reading the same `.env`:
- `python app.py [name ...]` — the named blueprints (default: all seven) in one process on `PORT` (default 5000). Inside containers each blueprint runs alone under gunicorn's gevent worker: `gunicorn "app:create_app('<name>')"`.
- `flask db upgrade` — apply migrations. The CLI discovers `create_app()` in [app.py](app.py); `server.CLI` is true then and blueprints skip their background work (telemetry consumer, environment sync). Prefer hand-written migrations over `flask db migrate` — autogenerate proposes dropping Celery's result-backend tables (`taskmeta`/`tasksetmeta`), which Celery owns.
- Celery workers ([server/tasks/__init__.py](server/tasks/__init__.py)): the `training` app serves the `training` queue (`celery -A server.tasks:training worker -Q training`); the `serving` app serves the `testing`/`production` queues, one worker per queue. `worker_max_tasks_per_child=1` — every serving/training task runs in a fresh process, which only the default **prefork** pool provides, so keep that pool everywhere.
- Requires a running **Redis** (broker, Socket.IO message queue, inference registry) and the SQLAlchemy DB as Celery result backend.
```

"Containers" paragraph: replace the sentence about services with "`docker compose up -d --build` runs one process per container: `api` builds the Flask image and runs the migrations; `auth`, `dataset`, `training`, `publishing`, `analytics`, `inference`, `events` run one blueprint each from it; `training-worker` builds the worker image and `serving-worker-<env>` reuse it; `client` is nginx ([nginx.conf](nginx.conf) routes `/api/<blueprint>/` by prefix and `/socket.io/` to `events`). Only `client` and flower publish ports. Image tags are `${REGISTRY}api|worker|client:${TAG}`." Drop the `TRITON_WORKERS`/`INFERENCE_HOST`/5002-5004 sentences; mention `INFERENCE_WORKERS` and `PUBLIC_URL` instead.

"## Architecture: two planes" becomes "## Architecture: blueprints" — the blueprint table from the spec (name, prefix, owns, reads, `init_app`), followed by the two invariants: `events` is the only Socket.IO server (everything else emits through `server/utils/socket.py`), and `inference` never imports SQLAlchemy. Keep "The Registry" and "Request → prediction flow" subsections, with these path fixes: `server/registry.py` → `server/utils/registry.py`; `server/database.py` → `server/database/instance.py`; "the infer view" → "the inference blueprint"; `server/tasks/inference.py` → `server/tasks/serve.py` (task `serve`); `server/telemetry.py` → `server/utils/telemetry.py`, "started in server/views/api/__init__.py" → "started by `analytics.init_app`"; "control-plane background consumer" → "the analytics service's consumer".

"## Environments" becomes:

```markdown
## Environments

`testing` / `production` are inference environments, not process configs. `ALLOWED_ENVIRONMENTS` in [server/config.py](server/config.py) gives each a `redis_url` (its registry) and an API-key TTL; the serving queue has the same name. `FLASK_ENV` is not read. The `inference` blueprint takes the environment from the URL (`/api/inference/<environment>/<model_id>`), serving workers from `-Q`. `Environment.update()` (run by `publishing.init_app`) syncs the DB `environments` table to that dict. Adding an environment means editing the dict and running a serving worker on the new queue. Deployment options are validated in `Instance.clean` / `default_options` and are the same in both environments.

A version is validated in `testing` before it is promoted to `production`: the Test tab queries whatever is deployed in `testing`, while deploying and stopping happen only on the Publish tab.
```

"Data model" heading path: `server/database.py` → `server/database/` (package; one module per model, each with an ownership comment naming its blueprint). `server/tagging.py` → check with `ls server/utils/dataset.py` and point at the module that defines `spans_to_tags`.

- [ ] **Step 5: Verify no stale vocabulary remains in docs**

```bash
grep -n "triton\|sage\|control plane\|data plane\|control-plane\|data-plane\|INFERENCE_HOST\|TRITON_WORKERS\|FLASK_ENV\|5001\|5002\|5004\|server/views\|create_application_server" README.md CLAUDE.md .env.example docker-compose.yml nginx.conf vite.config.js
```
Expected: no output. (The `docs/superpowers/` history is not touched.)

- [ ] **Step 6: Checkpoint** — report; do not commit.

---

### Task 16: End-to-end smoke test through nginx

**Files:**
- Create: scratch `smoke.sh`

- [ ] **Step 1: Bring the stack up**

```bash
export DOCKER_CONFIG=/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/f9bf1933-f474-4ea6-8982-42af79943170/scratchpad/dockercfg
[ -f .env ] || cp .env.example .env
# A stack with the previous service names may still be running under the
# same project name; its containers would be orphans and hold port 80.
docker compose down --remove-orphans 2>&1 | tail -2
docker compose up -d --build 2>&1 | tail -5
sleep 15
docker compose ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}"
```
Expected: `api` is `exited (0)`; every other service `running`; `client` on port `${CLIENT_PORT:-80}`. If a blueprint container restarts, read `docker compose logs <name>` and fix before continuing.

- [ ] **Step 2: The smoke script**

`/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad/smoke.sh`:

```bash
#!/bin/bash
# Every request goes through nginx on $BASE; a JSON body proves the request
# reached a Flask blueprint (nginx's own 404 is HTML).
set -u
BASE=${BASE:-http://localhost}
EMAIL="smoke-$(date +%s)@example.com"; PASS=smoke-pass
fail=0
check() { # name, expected-status, actual-status, body
  if [ "$2" = "$3" ] && echo "$4" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "ok   $1 ($3)"; else echo "FAIL $1: expected $2 got $3: $4"; fail=1; fi; }
req() { # method url [curl args...] -> sets STATUS BODY
  BODY=$(curl -s -o /tmp/smoke.body -w '%{http_code}' -X "$1" "$BASE$2" "${@:3}"); STATUS=$BODY; BODY=$(cat /tmp/smoke.body); }

req POST /api/auth/users -d "email=$EMAIL" -d "password=$PASS";       check "auth: create user" 201 "$STATUS" "$BODY"
req POST /api/auth/tokens -u "$EMAIL:$PASS";                          check "auth: token" 200 "$STATUS" "$BODY"
TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
H="Authorization: Bearer $TOKEN"
req GET /api/dataset/models -H "$H";                                  check "dataset: list models" 200 "$STATUS" "$BODY"
req GET /api/dataset/models/nope -H "$H";                             check "dataset: 404 is JSON" 404 "$STATUS" "$BODY"
req GET /api/training/trainings/active -H "$H";                       check "training: active" 200 "$STATUS" "$BODY"
req GET /api/publishing/models/nope/instances -H "$H";                check "publishing: 404 is JSON" 404 "$STATUS" "$BODY"
req GET /api/analytics/models/nope/dataset -H "$H";                   check "analytics: 404 is JSON" 404 "$STATUS" "$BODY"
S=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/inference/nowhere/nope" -H "Content-Type: application/json" -d '{"inputs":["a"]}'); [ "$S" = 404 ] && echo "ok   inference: unknown environment -> nginx 404" || { echo "FAIL unknown env: $S"; fail=1; }
req POST /api/inference/testing/nope -H "Content-Type: application/json" -d '{"inputs":["a"]}'
                                                                      check "inference-testing: no key" 401 "$STATUS" "$BODY"
req POST /api/inference/production/nope -H "Content-Type: application/json" -d '{"inputs":["a"]}'
                                                                      check "inference-production: no key" 401 "$STATUS" "$BODY"
S=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/nothing/here");  [ "$S" = 404 ] && echo "ok   nginx: unclaimed /api/ -> 404" || { echo "FAIL nginx 404: $S"; fail=1; }
S=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/inference/testing/nope");  # CORS preflight
P=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/api/inference/testing/nope" -H "Origin: http://x" -H "Access-Control-Request-Method: POST"); [ "$P" = 200 ] && echo "ok   inference: preflight" || { echo "FAIL preflight: $P"; fail=1; }
E=$(curl -s "$BASE/socket.io/?EIO=4&transport=polling"); echo "$E" | grep -q '"sid"' && echo "ok   events: engine.io handshake" || { echo "FAIL socket.io: $E"; fail=1; }
S=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/");                   [ "$S" = 200 ] && echo "ok   client: SPA" || { echo "FAIL SPA: $S"; fail=1; }
exit $fail
```

- [ ] **Step 3: Run it**

```bash
bash /private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/5faf7d74-3260-479c-97f0-097a2bf2791d/scratchpad/smoke.sh
```
Expected: every line starts with `ok`, exit 0.

- [ ] **Step 4: Confirm the workers registered and the consumer is alive**

```bash
docker compose logs training-worker serving-worker-testing 2>&1 | grep -E "ready|training@|serving-testing@" | tail -3
docker compose exec redis-testing redis-cli ping; docker compose exec redis-production redis-cli ping
docker compose logs analytics 2>&1 | grep -iE "error|traceback" | head
```
Expected: `celery@training … ready` and `celery@serving-testing … ready` lines; no errors from `analytics`.

- [ ] **Step 5: Tear down and hand over**

```bash
docker compose down
```
Report the smoke output to the owner. The owner runs the UI check (sign in, create a model, train, publish, test) and commits.

---

## Self-review

**Spec coverage.** Layout → T6–T12; factory/entrypoints → T6, T12; blueprints table incl. `init_app` extras → T9 (`Environment.update`), T10 (consumer via `gevent.spawn`, `CLI` guard), T11 (CORS, Socket.IO server); Socket.IO via message queue + `utils/socket.py` → T5; inference route + `PUBLIC_URL` + `flask-cors` → T3, T11; configuration (one `Config`, `PORT`, no `FLASK_ENV`, `INFERENCE_WORKERS`) → T4, T14; database ownership comments → T7–T12; names (Celery apps, task modules, compose services, image tags, bake targets) → T2, T14; compose/nginx (ports, depends_on, timeouts, 404) → T14; frontend → T13 (Vite in T4); removed items → T1, T12; documentation → T15; verification → every task + T16.

**Placeholders.** None: every code step carries the code, every verify step its command and expected output.

**Type/name consistency.** `server.CLI` (T6) used by T9/T10; `register_error_handlers` (T6) used by T7–T11; `emit`/`emitter` (T5) used by T5 only (WorkerTask, trainings); `serve` task name (T2) used by T3's importers and T11's grep; `create_app(*names)` (T6/T12) used by compose commands (T14) and the check script; check script path is the same in T6–T12.
