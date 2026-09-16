# Split Docker Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `docker/Dockerfile` with three role-specific images (client, api, worker) built from split requirements files, driven by one compose file, a bake overlay, and a GPU override.

**Architecture:** Requirements are split into `base` / `api` / `worker` / `worker-cuda` with `-r` includes and platform markers, so each image and the native venv install from the same pins. Three Dockerfiles under `docker/`; `docker-compose.yml` is the only source of build contexts, `docker-bake.hcl` layers platforms on top of it, `docker-compose.gpu.yml` switches the worker to the CUDA variant and grants GPUs. Servers move from `python app.py` to gunicorn's gevent worker inside containers; a `flower` service is added.

**Tech Stack:** Docker Compose v2.40 (bake-backed builds), BuildKit/buildx, python:3.11-slim, node:22-bookworm-slim, nginx:1.27-alpine, gunicorn 23 + gevent, Celery 5.5 + flower 2, TensorFlow 2.15, torch 2.8 (CPU wheels).

**Spec:** `docs/superpowers/specs/2026-09-16-split-docker-images-design.md`

## Global Constraints

- Every version pin is copied verbatim from the current `requirements.txt`; the only deviation is `tensorflow==2.15.0.post1` on `sys_platform == "linux" and platform_machine == "x86_64"`.
- Removed packages (must appear in no file): Flask-Mail, Flask-APScheduler, APScheduler, tzlocal, uuid6, openpyxl, et_xmlfile, xlrd, gevent-websocket. `gevent-websocket` in particular must be absent: engineio's gevent driver picks it over `simple-websocket` when importable, and under gunicorn's plain `-k gevent` worker that path raises on every WebSocket upgrade.
- No `tensorflow-metal` anywhere.
- torch is CPU-only on every platform: `--extra-index-url https://download.pytorch.org/whl/cpu`, `torch==2.8.0+cpu` on linux/x86_64, `torch==2.8.0` elsewhere.
- Images: `python:3.11-slim` for api and worker, non-root `appuser`, `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`. No compiler in either image unless a build proves a wheel is missing.
- Celery pool is always `-P prefork` (`worker_max_tasks_per_child=1` needs it).
- Control plane runs `gunicorn -k gevent -w 1`; data planes `gunicorn -k gevent -w ${TRITON_WORKERS:-2}`.
- Image names: `${REGISTRY:-}indic-nlu-client:${TAG:-latest}`, `${REGISTRY:-}indic-nlu-api:${TAG:-latest}`, `${REGISTRY:-}indic-nlu-worker:${TAG:-latest}-<cpu|cuda>`. `REGISTRY` defaults to empty; nothing is pushed.
- `docker/Dockerfile` and `supervisord.conf` are deleted; `supervisor` is installed nowhere.
- **Do not `git commit`.** The user commits themselves (standing instruction). Each task ends with a verification step instead.
- All commands run from the repo root `/Users/varunseth/Documents/git/indic-nlu`. The host builds `linux/arm64` images; the CUDA image is only verifiable on the deployment host.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `requirements/base.txt` | create | runtime shared by every Python process |
| `requirements/api.txt` | create | `-r base.txt` + flower |
| `requirements/worker.txt` | create | `-r base.txt` + ML stack (CPU, all platforms) |
| `requirements/worker-cuda.txt` | create | `-r worker.txt` + `tensorflow[and-cuda]` |
| `requirements.txt` | rewrite | `-r requirements/worker.txt` (native venv) |
| `docker/Dockerfile.client` | create | Vite build → nginx |
| `docker/Dockerfile.api` | create | control plane / data planes / migrate / flower |
| `docker/Dockerfile.worker` | create | sage + serving workers, `ARG DEVICE` |
| `docker-compose.yml` | rewrite | services, single source of build contexts |
| `docker-compose.gpu.yml` | create | CUDA override |
| `docker-bake.hcl` | create | platforms/tags overlay over compose |
| `.env.example` | modify | new keys |
| `docker/Dockerfile`, `supervisord.conf` | delete | superseded |
| `README.md`, `CLAUDE.md` | modify | container docs |

---

### Task 1: Split the requirements

**Files:**
- Create: `requirements/base.txt`, `requirements/api.txt`, `requirements/worker.txt`, `requirements/worker-cuda.txt`
- Modify: `requirements.txt` (replace whole content)

**Interfaces:**
- Produces: the four files above, consumed by the Dockerfiles in Tasks 3–4 by exact path. `requirements.txt` stays the host-venv entrypoint.

- [ ] **Step 1: Write the pin-accounting check (the "test")**

Save as `/private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/acb1cab1-f127-4fd2-98cb-8cd3d2373568/scratchpad/check_reqs.py`. It asserts: every old pin is either in exactly one new file or in the removed set; no new pin is unknown; no duplicates across files; removed names appear nowhere; tensorflow appears with both markers.

```python
import re, sys, subprocess
from pathlib import Path

REMOVED = {"flask-mail", "flask-apscheduler", "apscheduler", "tzlocal", "uuid6",
           "openpyxl", "et-xmlfile", "xlrd", "gevent-websocket"}
norm = lambda n: n.lower().replace("_", "-")

old = subprocess.run(["git", "show", "HEAD:requirements.txt"], capture_output=True, text=True, check=True).stdout
old_pins = {norm(l.split("==")[0]): l.strip() for l in old.splitlines() if "==" in l}

def pins(path):
    out = []
    for l in Path(path).read_text().splitlines():
        l = l.split("#")[0].strip()
        if not l or l.startswith("-"):
            continue
        name = re.split(r"[=;\[]", l)[0].strip()
        out.append((norm(name), l))
    return out

files = {f: pins(f"requirements/{f}") for f in ["base.txt", "api.txt", "worker.txt", "worker-cuda.txt"]}
seen = {}
errors = []
for f, ps in files.items():
    for name, line in ps:
        if name in REMOVED:
            errors.append(f"{f}: removed package present: {line}")
        if name not in old_pins:
            errors.append(f"{f}: not in old requirements: {line}")
        if name == "tensorflow":
            continue  # marker lines, checked below
        if name in seen and seen[name] != f:
            errors.append(f"{name} pinned in both {seen[name]} and {f}")
        seen[name] = f
        old_ver = old_pins[name].split("==")[1]
        if name != "torch" and not line.startswith(old_pins[name]):
            errors.append(f"{f}: pin changed: {line} (was {old_pins[name]})")
for name in old_pins:
    if name not in seen and name not in REMOVED and name != "tensorflow":
        errors.append(f"old pin dropped without being in REMOVED: {name}")

worker = Path("requirements/worker.txt").read_text()
for needle in ['tensorflow==2.15.0.post1; sys_platform == "linux" and platform_machine == "x86_64"',
               'tensorflow==2.15.0; sys_platform != "linux" or platform_machine != "x86_64"',
               'torch==2.8.0+cpu; sys_platform == "linux" and platform_machine == "x86_64"',
               'torch==2.8.0; sys_platform != "linux" or platform_machine != "x86_64"',
               "--extra-index-url https://download.pytorch.org/whl/cpu"]:
    if needle not in worker:
        errors.append(f"worker.txt missing line: {needle}")
if "tensorflow[and-cuda]==2.15.0.post1" not in Path("requirements/worker-cuda.txt").read_text():
    errors.append("worker-cuda.txt missing tensorflow[and-cuda]==2.15.0.post1")
if Path("requirements.txt").read_text().strip().splitlines()[-1] != "-r requirements/worker.txt":
    errors.append("requirements.txt must end with -r requirements/worker.txt")
for m in ("metal", "supervisor"):
    if m in (worker + Path("requirements/base.txt").read_text()).lower():
        errors.append(f"forbidden word in requirements: {m}")
print("\n".join(errors) or "OK")
sys.exit(1 if errors else 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `venv/bin/python /private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/acb1cab1-f127-4fd2-98cb-8cd3d2373568/scratchpad/check_reqs.py`
Expected: `FileNotFoundError` for `requirements/base.txt`.

- [ ] **Step 3: Create `requirements/base.txt`**

```
# Runtime shared by every Python process (control plane, data planes,
# Celery workers, flower). Pins mirror the versions the project was
# developed against; pip picks the platform wheel.

# ── direct ────────────────────────────────────────────────────
alembic==1.16.4
azure-storage-blob==12.26.0
boto3==1.43.26
celery==5.5.3
Flask==3.1.0
Flask-HTTPAuth==4.8.0
Flask-Migrate==4.1.0
Flask-Session==0.8.0
Flask-SocketIO==5.5.1
Flask-SQLAlchemy==3.1.1
gevent==25.5.1
google-cloud-storage==3.3.0
gunicorn==23.0.0
kombu==5.5.4
minio==7.2.16
numpy==1.26.4
pandas==2.3.1
paramiko==3.5.0
psycopg2-binary==2.9.10
PyJWT==2.10.1
pysftp==0.2.9
python-dotenv==1.1.1
redis==6.4.0
requests==2.32.5
SQLAlchemy==2.0.43
Werkzeug==3.1.3

# ── transitive ────────────────────────────────────────────────
# gevent-websocket is deliberately absent: engineio prefers it when
# importable, and under gunicorn's plain `-k gevent` worker that path
# fails on WebSocket upgrades. simple-websocket is the driver we use.
amqp==5.3.1
argon2-cffi==25.1.0
argon2-cffi-bindings==25.1.0
azure-core==1.35.0
bcrypt==4.3.0
bidict==0.23.1
billiard==4.2.1
blinker==1.9.0
botocore==1.43.26
cachelib==0.13.0
cachetools==5.5.2
certifi==2025.8.3
cffi==1.17.1
charset-normalizer==3.4.3
click==8.2.1
click-didyoumean==0.3.1
click-plugins==1.1.1.2
click-repl==0.3.0
cryptography==45.0.6
google-api-core==2.25.1
google-auth==2.40.3
google-cloud-core==2.4.3
google-crc32c==1.7.1
google-resumable-media==2.7.2
googleapis-common-protos==1.70.0
greenlet==3.2.4
h11==0.16.0
idna==3.10
isodate==0.7.2
itsdangerous==2.2.0
Jinja2==3.1.6
jmespath==1.1.0
Mako==1.3.10
MarkupSafe==3.0.2
msgspec==0.19.0
packaging==25.0
prompt_toolkit==3.0.51
proto-plus==1.26.1
protobuf==4.25.8
pyasn1==0.6.1
pyasn1_modules==0.4.2
pycparser==2.22
pycryptodome==3.23.0
PyNaCl==1.5.0
python-dateutil==2.9.0.post0
python-engineio==4.12.2
python-socketio==5.13.0
pytz==2025.2
rsa==4.9.1
s3transfer==0.18.0
simple-websocket==1.1.0
six==1.17.0
typing_extensions==4.14.1
tzdata==2025.2
urllib3==2.5.0
vine==5.1.0
wcwidth==0.2.13
wsproto==1.2.0
zope.event==5.1.1
zope.interface==7.2
```

- [ ] **Step 4: Create `requirements/api.txt`**

```
# Control plane, data planes, migrations and flower (docker/Dockerfile.api).
-r base.txt

flower==2.0.1
# flower's own
humanize==4.12.3
prometheus_client==0.22.1
tornado==6.5.2
```

- [ ] **Step 5: Create `requirements/worker.txt`**

```
# Training and serving workers (docker/Dockerfile.worker, DEVICE=cpu) and the
# native venv (requirements.txt). CPU on every platform; the CUDA image adds
# requirements/worker-cuda.txt on top.
-r base.txt

# torch only converts PyTorch hub checkpoints to TF weights
# (transformers' TFAutoModel.from_pretrained), a CPU job. The PyPI x86_64
# wheel would drag in the nvidia-* CUDA 12 / cuDNN 9 libraries, which
# clash with TF 2.15's own CUDA 12.2 / cuDNN 8.9 set, so linux/x86_64
# takes the CPU wheel from PyTorch's index. aarch64 and macOS wheels are
# CPU-only already.
--extra-index-url https://download.pytorch.org/whl/cpu
torch==2.8.0+cpu; sys_platform == "linux" and platform_machine == "x86_64"
torch==2.8.0; sys_platform != "linux" or platform_machine != "x86_64"

# 2.15.0.post1 exists only for linux/x86_64: it fixes the 2.15.0 wheel not
# finding CUDA libraries installed via the [and-cuda] extra. On macOS the
# tensorflow wheel depends on tensorflow-macos; pip resolves that itself.
# tensorflow-metal is intentionally not installed (see CLAUDE.md).
tensorflow==2.15.0.post1; sys_platform == "linux" and platform_machine == "x86_64"
tensorflow==2.15.0; sys_platform != "linux" or platform_machine != "x86_64"

# ── direct ────────────────────────────────────────────────────
h5py==3.16.0
huggingface_hub==0.36.2
joblib==1.5.3
keras==2.15.0
onnx==1.18.0
onnxruntime==1.22.1
safetensors==0.7.0
scikit-learn==1.9.0
scipy==1.17.1
tensorflow-estimator==2.15.0
tensorflow-io-gcs-filesystem==0.37.1
tensorflow-model-optimization==0.8.0
tf2onnx==1.17.0
tokenizers==0.15.2
transformers==4.37.2

# ── transitive ────────────────────────────────────────────────
absl-py==1.4.0
astunparse==1.6.3
attrs==26.1.0
coloredlogs==15.0.1
dm-tree==0.1.10
filelock==3.29.1
flatbuffers==25.12.19
fsspec==2026.4.0
gast==0.7.0
google-auth-oauthlib==1.2.2
google-pasta==0.2.0
grpcio==1.81.0
hf-xet==1.5.0
humanfriendly==10.0
libclang==18.1.1
Markdown==3.10.2
ml-dtypes==0.2.0
mpmath==1.3.0
narwhals==2.22.1
networkx==3.6.1
oauthlib==3.3.1
opt_einsum==3.4.0
PyYAML==6.0.3
regex==2026.5.9
requests-oauthlib==2.0.0
sympy==1.14.0
tensorboard==2.15.2
tensorboard-data-server==0.7.2
termcolor==3.3.0
threadpoolctl==3.6.0
tqdm==4.68.1
wrapt==1.14.2
```

- [ ] **Step 6: Create `requirements/worker-cuda.txt`**

```
# CUDA worker (docker/Dockerfile.worker with DEVICE=cuda). linux/x86_64 only.
# The [and-cuda] extra installs the nvidia-* wheels TF 2.15 was built
# against; the pin matches worker.txt's linux/x86_64 marker so the resolver
# sees a single TensorFlow version.
-r worker.txt

tensorflow[and-cuda]==2.15.0.post1
```

- [ ] **Step 7: Rewrite `requirements.txt`**

```
# Native (host) install: everything, CPU. Split by role under requirements/
# for the container images. See docker/Dockerfile.api and Dockerfile.worker.
-r requirements/worker.txt
```

- [ ] **Step 8: Run the check**

Run: `venv/bin/python /private/tmp/claude-501/-Users-varunseth-Documents-git-indic-nlu/acb1cab1-f127-4fd2-98cb-8cd3d2373568/scratchpad/check_reqs.py`
Expected: `OK`.

- [ ] **Step 9: Resolve against the existing venv (macOS)**

Run: `venv/bin/pip install --dry-run -r requirements.txt 2>&1 | tail -5`
Expected: ends with `Would install …` listing nothing, or only packages already satisfied — no `ERROR: … conflicting dependencies`. (The venv already holds these versions, so this proves the marker lines and `-r` chain parse and resolve on darwin; it does not download anything.)

---

### Task 2: `docker/Dockerfile.client`

**Files:**
- Create: `docker/Dockerfile.client`

**Interfaces:**
- Produces: image serving `/usr/share/nginx/html` with `docker/nginx.conf`; compose service `web` builds it (Task 5).

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Static SPA behind nginx. The build stage runs Vite; the runtime stage is
# nginx with docker/nginx.conf, which proxies /api and /socket.io to the
# control plane the same way the Vite dev server does (vite.config.js).
# Inference endpoints are absolute URLs the browser calls directly and are
# not proxied here.

FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PATH="/app/node_modules/.bin:${PATH}"

COPY package*.json ./
RUN npm ci

COPY vite.config.js index.html ./
COPY src/ ./src/
COPY public/ ./public/

RUN npm run build


FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
```

- [ ] **Step 2: Build it**

Run: `docker build -f docker/Dockerfile.client -t indic-nlu-client:latest .`
Expected: exits 0; last lines show `naming to docker.io/library/indic-nlu-client:latest`.

- [ ] **Step 3: Verify the bundle and config are in the image**

Run: `docker run --rm indic-nlu-client:latest sh -c 'ls /usr/share/nginx/html/index.html /usr/share/nginx/html/assets | head -3 && nginx -t'`
Expected: `index.html` listed, at least one hashed asset, and `nginx: configuration file /etc/nginx/nginx.conf test is successful`. (`nginx -t` fails on `resolver 127.0.0.11` only at runtime, not at config test, so this is a valid check.)

---

### Task 3: `docker/Dockerfile.api`

**Files:**
- Create: `docker/Dockerfile.api`

**Interfaces:**
- Consumes: `requirements/base.txt`, `requirements/api.txt` (Task 1).
- Produces: image `indic-nlu-api` whose default CMD is the control plane on 5001; compose overrides `command` for `triton-*`, `migrate`, `flower` (Task 5).

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Control plane and everything else that is Flask/Celery without the ML
# stack: /api + Socket.IO (default CMD), the two inference data planes,
# `flask db upgrade`, and flower. docker-compose.yml overrides `command`
# per service. Servers run under gunicorn's gevent worker; the control
# plane keeps one worker process because Socket.IO long-polling needs a
# client's requests to reach the same process.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN useradd -m -s /bin/bash appuser

# Every package here ships manylinux wheels for amd64 and arm64, so no
# compiler is installed. If a build ever fails on a missing wheel, add
# build-essential to this image only.
COPY requirements/base.txt requirements/api.txt requirements/
RUN pip install --upgrade pip \
    && pip install -r requirements/api.txt

COPY --chown=appuser:appuser server/ ./server/
COPY --chown=appuser:appuser migrations/ ./migrations/
COPY --chown=appuser:appuser app.py .
# server/utils/dataset.py reads the label palette from public/colors.txt
COPY --chown=appuser:appuser public/colors.txt ./public/colors.txt

# Writable for the non-root user: the local storage provider's bucket (a
# volume in compose; an empty named volume inherits this ownership), the
# sqlite instance folder and the filesystem session store.
RUN mkdir -p /app/data /app/instance /app/flask_session \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 5001 5002 5003 5004

# create_app() returns the Flask app with socketio.init_app applied, i.e.
# the Socket.IO-wrapped WSGI app, so gunicorn can serve it directly.
CMD ["gunicorn", "-k", "gevent", "-w", "1", "-b", "0.0.0.0:5001", "--timeout", "300", "app:create_app()"]
```

- [ ] **Step 2: Build it**

Run: `docker build -f docker/Dockerfile.api -t indic-nlu-api:latest .`
Expected: exits 0.

- [ ] **Step 3: Prove the dependency tree is consistent and the ML stack is absent**

Run:
```bash
docker run --rm indic-nlu-api:latest sh -c 'pip check && python -c "import flask, flask_socketio, celery, redis, gevent, gunicorn, pandas, psycopg2, boto3, minio, azure.storage.blob, google.cloud.storage, pysftp, flower; print(\"imports ok\")" && python -c "import tensorflow" 2>&1 | tail -1'
```
Expected: `No broken requirements found.`, `imports ok`, then `ModuleNotFoundError: No module named 'tensorflow'`.

- [ ] **Step 4: Prove the app factories import under gunicorn's worker**

Run:
```bash
docker run --rm -e FLASK_ENV=testing -e SECRET_KEY=x indic-nlu-api:latest python -c "
from gevent import monkey; monkey.patch_all()
import app, server
a = app.create_app(); print('api', type(a.wsgi_app).__name__)
t = server.create_triton_server(); print('triton', t.url_map.bind('x').match('/api/infer/abc', method='POST')[0])
"
```
Expected: `api _SocketIOMiddleware` and `triton` followed by the infer endpoint name (e.g. `triton.infer`). Redis is not reachable here; `create_app` does not connect at import time. If it does, run with `--network host` against a local Redis instead.

- [ ] **Step 5: Record the size**

Run: `docker image ls indic-nlu-api:latest --format '{{.Size}}'`
Expected: well under 1 GB (the old single image was several GB). Note the value for the README.

---

### Task 4: `docker/Dockerfile.worker`

**Files:**
- Create: `docker/Dockerfile.worker`

**Interfaces:**
- Consumes: `requirements/base.txt`, `worker.txt`, `worker-cuda.txt` (Task 1).
- Produces: image `indic-nlu-worker:<tag>-cpu` (and `-cuda` when `DEVICE=cuda`); default CMD is the sage worker; compose overrides for `worker-testing`/`worker-production` (Task 5). Build arg name `DEVICE` is what compose and bake pass.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Celery workers: training (`sage`, the default CMD) and model serving
# (`triton`, one worker per environment queue; docker-compose.yml overrides
# `command`). This is the only image that carries TensorFlow and friends.
#
# DEVICE=cpu (default) installs requirements/worker.txt and builds for
# linux/amd64 and linux/arm64. DEVICE=cuda adds requirements/worker-cuda.txt
# (TensorFlow's [and-cuda] wheels) and is linux/amd64 only; run it with
# docker-compose.gpu.yml, which grants the GPUs.

FROM python:3.11-slim

ARG DEVICE=cpu

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN useradd -m -s /bin/bash appuser

COPY requirements/ requirements/
RUN pip install --upgrade pip \
    && if [ "$DEVICE" = "cuda" ]; then \
         pip install -r requirements/worker-cuda.txt; \
       else \
         pip install -r requirements/worker.txt; \
       fi

# No app.py or migrations: the worker builds its app context through
# server.create_application_server (server/tasks/request.py).
COPY --chown=appuser:appuser server/ ./server/
# server/utils/dataset.py reads the label palette from public/colors.txt
COPY --chown=appuser:appuser public/colors.txt ./public/colors.txt

RUN mkdir -p /app/data /app/instance \
    && chown -R appuser:appuser /app

USER appuser

# Prefork is required: worker_max_tasks_per_child=1 gives every training
# or serving task a fresh process, which only this pool provides.
CMD ["celery", "-A", "server.tasks:sage", "worker", "-E", "-Q", "training", "-P", "prefork", "-c", "1", "-l", "INFO", "-Ofair", "-n", "sage@%h"]
```

- [ ] **Step 2: Build the CPU variant**

Run: `docker build -f docker/Dockerfile.worker -t indic-nlu-worker:latest-cpu .`
Expected: exits 0. (Downloads ~1 GB of wheels the first time.)

- [ ] **Step 3: Prove imports, pip consistency, and that torch is CPU-only**

Run:
```bash
docker run --rm indic-nlu-worker:latest-cpu sh -c 'pip check && python -c "
import tensorflow as tf, torch, transformers, sklearn, onnx, onnxruntime, tf2onnx, tensorflow_model_optimization, h5py
from server.models import Model
print(\"tf\", tf.__version__, \"torch\", torch.__version__, \"cuda\", torch.cuda.is_available())
" && pip list 2>/dev/null | grep -ci nvidia'
```
Expected: `No broken requirements found.`; `tf 2.15.0 torch 2.8.0 cuda False` (on arm64; on amd64 `tf 2.15.0.post1 torch 2.8.0+cpu`); final line `0` (no nvidia-* packages in the CPU image). If any import fails with a missing shared library (`libgomp.so.1`, `libGL`), add exactly that apt package to this Dockerfile with a comment naming the importer, rebuild, and re-run.

- [ ] **Step 4: Prove the serving-side import path works too**

Run:
```bash
docker run --rm indic-nlu-worker:latest-cpu python -c "import server.tasks.training, server.tasks.inference; print('tasks ok')"
```
Expected: `tasks ok`.

- [ ] **Step 5: Print the resolved CUDA plan without building it (amd64 only, optional here)**

Run: `docker build -f docker/Dockerfile.worker --build-arg DEVICE=cuda --platform linux/amd64 -t indic-nlu-worker:latest-cuda . 2>&1 | tail -3`
This cross-builds under emulation and downloads ~3 GB; it is allowed to be skipped on the Mac. If run, expected: exits 0 and `docker run --rm --platform linux/amd64 indic-nlu-worker:latest-cuda pip check` prints `No broken requirements found.`. GPU visibility can only be checked on the deployment host (Task 8, step 6).

---

### Task 5: Compose files and `.env.example`

**Files:**
- Modify: `docker-compose.yml` (replace whole content)
- Create: `docker-compose.gpu.yml`
- Modify: `.env.example` (append a section)

**Interfaces:**
- Consumes: the three Dockerfiles (Tasks 2–4), build arg `DEVICE`.
- Produces: service names `web`, `api`, `triton-testing`, `triton-production`, `migrate`, `flower`, `sage`, `worker-testing`, `worker-production`, `redis`, `postgres`; image names per Global Constraints. Task 6's bake file references `web`, `api`, `sage` by these names.

- [ ] **Step 1: Rewrite `docker-compose.yml`**

```yaml
# Single-host deployment: every process the platform is made of runs in its
# own container. Three images (docker/Dockerfile.client, .api, .worker) —
# only one service per image carries `build:`; the rest run the tag it
# produces, because parallel builds of one tag race on the export step.
#
#   docker compose up -d --build                              # CPU workers
#   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build   # CUDA host
#
# UI on http://localhost/ (nginx, proxies /api and /socket.io to `api`).
# Inference endpoints are absolute URLs the browser calls directly, so the
# two data planes publish 5002 (testing) and 5004 (production). Set
# INFERENCE_HOST in .env to the host's public name on a real deployment.
#
# Host-specific values in .env (localhost Redis, sqlite) are overridden per
# service below; python-dotenv never overrides a variable that is already
# set, so the compose values win inside the containers.

x-postgres-env: &postgres-env
  POSTGRES_USER: ${POSTGRES_USER:-indicnlu}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-indicnlu}
  POSTGRES_DB: ${POSTGRES_DB:-indicnlu}

x-backend-env: &backend-env
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
  INFERENCE_HOST: ${INFERENCE_HOST:-http://localhost}

x-backend: &backend
  env_file: .env
  volumes:
    # The `local` storage provider resolves STORAGE_BUCKET against the
    # working directory (/app), so every service shares one bucket.
    - data:/app/data
  restart: unless-stopped
  depends_on:
    redis:
      condition: service_healthy
    postgres:
      condition: service_healthy
    migrate:
      condition: service_completed_successfully

# Flask/Celery without the ML stack: control plane, data planes, migrate,
# flower. `api` builds it.
x-api: &api
  <<: *backend
  image: ${REGISTRY:-}indic-nlu-api:${TAG:-latest}

# Celery workers with TensorFlow. `sage` builds it; WORKER_DEVICE selects
# the cpu (default) or cuda variant — docker-compose.gpu.yml sets cuda.
x-worker: &worker
  <<: *backend
  image: ${REGISTRY:-}indic-nlu-worker:${TAG:-latest}-${WORKER_DEVICE:-cpu}

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

  # One-shot: applies migrations, then exits. Every backend service waits for
  # it to finish, so a fresh volume is fully migrated before anything starts.
  migrate:
    <<: *api
    command: flask db upgrade
    environment:
      <<: *backend-env
      FLASK_ENV: testing
    restart: "no"
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

  # Control plane: /api + Socket.IO under gunicorn (one gevent worker —
  # Socket.IO long-polling needs a client's requests to hit one process).
  # One is enough for both environments — publishing picks the registry
  # from the instance's own environment and the telemetry consumer drains
  # every environment's queue. FLASK_ENV here only selects the port.
  api:
    <<: *api
    build:
      context: .
      dockerfile: docker/Dockerfile.api
    command: gunicorn -k gevent -w 1 -b 0.0.0.0:5001 --timeout 300 "app:create_app()"
    environment:
      <<: *backend-env
      FLASK_ENV: testing
    ports:
      - "5001:5001"

  # Data planes: one per environment, each serving its own registry. They
  # are stateless (the request/serve handshake lives in Redis), so several
  # gunicorn workers are fine.
  triton-testing:
    <<: *api
    command: gunicorn -k gevent -w ${TRITON_WORKERS:-2} -b 0.0.0.0:5002 --timeout 120 "server:create_triton_server()"
    environment:
      <<: *backend-env
      FLASK_ENV: testing
    ports:
      - "5002:5002"

  triton-production:
    <<: *api
    command: gunicorn -k gevent -w ${TRITON_WORKERS:-2} -b 0.0.0.0:5004 --timeout 120 "server:create_triton_server()"
    environment:
      <<: *backend-env
      FLASK_ENV: production
    ports:
      - "5004:5004"

  # Celery monitoring. Both Celery apps share the broker and the workers
  # run with -E, so one flower sees the training, testing and production
  # queues and can inspect, revoke and terminate tasks. Set
  # FLOWER_BASIC_AUTH=user:password in .env anywhere this port is reachable.
  flower:
    <<: *api
    command: celery -A server.tasks:sage flower --port=5555
    environment:
      <<: *backend-env
      FLASK_ENV: testing
      FLOWER_BASIC_AUTH: ${FLOWER_BASIC_AUTH:-}
    ports:
      - "${FLOWER_PORT:-5555}:5555"
    depends_on:
      redis:
        condition: service_healthy

  # Training worker. Prefork with max_tasks_per_child=1 (WorkerConfig) gives
  # every training run a fresh process; one at a time keeps a single host
  # from oversubscribing its CPUs/GPU.
  sage:
    <<: *worker
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
      args:
        DEVICE: ${WORKER_DEVICE:-cpu}
    command: celery -A server.tasks:sage worker -E -Q training -P prefork -c 1 -l INFO -Ofair -n sage@%h
    environment:
      <<: *backend-env
      FLASK_ENV: testing

  # Serving workers: one per environment queue. Each serving task holds one
  # model for the life of its process, so the pool size is the number of
  # models that can be live at once in that environment.
  worker-testing:
    <<: *worker
    command: celery -A server.tasks:triton worker -E -Q testing -P prefork -l INFO -Ofair -n triton-testing@%h
    environment:
      <<: *backend-env
      FLASK_ENV: testing

  worker-production:
    <<: *worker
    command: celery -A server.tasks:triton worker -E -Q production -P prefork -l INFO -Ofair -n triton-production@%h
    environment:
      <<: *backend-env
      FLASK_ENV: production

  # Static frontend + reverse proxy to the control plane.
  web:
    build:
      context: .
      dockerfile: docker/Dockerfile.client
    image: ${REGISTRY:-}indic-nlu-client:${TAG:-latest}
    ports:
      - "${WEB_PORT:-80}:80"
    depends_on:
      - api
    restart: unless-stopped

volumes:
  data:
  redis:
  postgres:
```

- [ ] **Step 2: Create `docker-compose.gpu.yml`**

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
  image: ${REGISTRY:-}indic-nlu-worker:${TAG:-latest}-cuda
  gpus: all

services:
  sage:
    <<: *worker-gpu
    build:
      args:
        DEVICE: cuda

  worker-testing:
    <<: *worker-gpu

  worker-production:
    <<: *worker-gpu
```

- [ ] **Step 3: Append to `.env.example`**

Append after the `WEB_PORT=80` line:

```
# ── Containers ───────────────────────────────────────────────
# Image name prefix and tag (compose + docker-bake.hcl). Empty REGISTRY
# means plain local tags, e.g. indic-nlu-api:latest.
REGISTRY=
TAG=latest
# cpu | cuda — which worker image variant compose builds and runs. The CUDA
# host uses docker-compose.gpu.yml, which forces cuda.
WORKER_DEVICE=cpu
# gunicorn worker processes per inference data plane.
TRITON_WORKERS=2
# Celery monitoring UI. Leave FLOWER_BASIC_AUTH empty on a private host;
# set user:password anywhere the port is reachable.
FLOWER_PORT=5555
FLOWER_BASIC_AUTH=
```

- [ ] **Step 4: Validate both compositions**

Run:
```bash
docker compose config --quiet && echo "base ok"
docker compose -f docker-compose.yml -f docker-compose.gpu.yml config --quiet && echo "gpu ok"
docker compose -f docker-compose.yml -f docker-compose.gpu.yml config | grep -A2 -E '^\s+(sage|worker-testing|worker-production):' | grep -c 'indic-nlu-worker:latest-cuda'
docker compose config | grep -E 'image: ' | sort -u
```
Expected: `base ok`, `gpu ok`, `3`, and the image list shows exactly `indic-nlu-api:latest`, `indic-nlu-client:latest`, `indic-nlu-worker:latest-cpu`, `postgres:16-alpine`, `redis:7-alpine`. If `gpus: all` is rejected by `config`, replace it in the gpu file with:

```yaml
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

- [ ] **Step 5: Check the gunicorn commands resolve as compose sees them**

Run: `docker compose config | grep -E 'command:' | sort -u`
Expected: three gunicorn lines (5001 with `-w 1`, 5002 and 5004 with `-w 2`), three celery worker lines, `flask db upgrade`, and the flower line. No `python app.py` remains.

---

### Task 6: `docker-bake.hcl`

**Files:**
- Create: `docker-bake.hcl`

**Interfaces:**
- Consumes: compose services `web`, `api`, `sage` (Task 5) as inherited targets.
- Produces: bake targets `web`, `api`, `sage`, `worker-cuda`; groups `default`, `cuda`, `all`.

- [ ] **Step 1: Write the bake file**

```hcl
// Multi-platform builds, layered over docker-compose.yml so build contexts
// and Dockerfiles are defined once:
//
//   docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all
//   docker buildx bake -f docker-compose.yml -f docker-bake.hcl            # CPU images, both arches
//   docker buildx bake -f docker-compose.yml -f docker-bake.hcl worker-cuda
//
// Day-to-day local builds stay `docker compose up -d --build` (native arch
// only, loaded straight into the daemon). Producing a two-arch manifest
// needs the docker-container builder and a registry to push to:
//
//   docker buildx create --use --name multi
//   REGISTRY=ghcr.io/you/ docker buildx bake -f docker-compose.yml -f docker-bake.hcl --push all

variable "REGISTRY" {
  default = ""
}

variable "TAG" {
  default = "latest"
}

group "default" {
  targets = ["web", "api", "sage"]
}

group "cuda" {
  targets = ["worker-cuda"]
}

group "all" {
  targets = ["web", "api", "sage", "worker-cuda"]
}

target "web" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}indic-nlu-client:${TAG}"]
}

target "api" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}indic-nlu-api:${TAG}"]
}

// CPU worker: compose's `sage` service with both arches.
target "sage" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}indic-nlu-worker:${TAG}-cpu"]
  args = {
    DEVICE = "cpu"
  }
}

// CUDA worker: same Dockerfile, TensorFlow's [and-cuda] wheels. x86_64 only.
target "worker-cuda" {
  inherits  = ["sage"]
  platforms = ["linux/amd64"]
  tags      = ["${REGISTRY}indic-nlu-worker:${TAG}-cuda"]
  args = {
    DEVICE = "cuda"
  }
}
```

- [ ] **Step 2: Print the resolved plan**

Run: `docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all`
Expected: JSON with four targets; `web`/`api`/`sage` list both platforms and their compose `context`/`dockerfile`; `worker-cuda` has `dockerfile: docker/Dockerfile.worker`, `platforms: ["linux/amd64"]`, `args.DEVICE: "cuda"`, tag `indic-nlu-worker:latest-cuda`. If `--print` complains that `sage` carries `DEVICE: ${WORKER_DEVICE:-cpu}` unresolved, that is compose interpolation — set `WORKER_DEVICE=cpu` in the environment for the command.

- [ ] **Step 3: Native-arch bake build of the CPU group (proves the overlay builds, not only prints)**

Run: `docker buildx bake -f docker-compose.yml -f docker-bake.hcl --set '*.platform=linux/arm64' --load`
Expected: exits 0; `docker image ls | grep indic-nlu` shows the three tags refreshed. (`--set '*.platform'` narrows to the host arch so `--load` works with the default builder.)

---

### Task 7: Remove the old image, update docs

**Files:**
- Delete: `docker/Dockerfile`, `supervisord.conf`
- Modify: `README.md` (sections "Running with Docker", "Running with Docker Compose", the "Requirements" bullet), `CLAUDE.md` ("Commands" → Containers paragraph)

- [ ] **Step 1: Delete the superseded files**

Run: `git rm -q docker/Dockerfile supervisord.conf && ls docker/`
Expected: `Dockerfile.api  Dockerfile.client  Dockerfile.worker  nginx.conf`.

- [ ] **Step 2: Confirm nothing references them**

Run: `grep -rn "supervisord\|docker/Dockerfile\b\|Dockerfile:main\|target: main\|target: web" --include='*.md' --include='*.yml' --include='*.yaml' --include='*.conf' --include='*.json' . | grep -v node_modules | grep -v venv | grep -v docs/superpowers`
Expected: no output (README/CLAUDE.md are fixed in the next steps; if they show up here, that is the list to edit).

- [ ] **Step 3: Replace README "Running with Docker" + "Running with Docker Compose"**

Replace everything from the line `## Running with Docker` up to (not including) `## Notes for developers` with:

````markdown
## Running with Docker Compose

Three images, each with only its own dependencies:

| Image | Dockerfile | Runs |
|---|---|---|
| `indic-nlu-client` | [docker/Dockerfile.client](docker/Dockerfile.client) | nginx: built UI, proxies `/api` and `/socket.io` to `api` |
| `indic-nlu-api` | [docker/Dockerfile.api](docker/Dockerfile.api) | control plane, the two data planes, `flask db upgrade`, flower |
| `indic-nlu-worker:<tag>-cpu` / `-cuda` | [docker/Dockerfile.worker](docker/Dockerfile.worker) | training and serving Celery workers (the only image with TensorFlow) |

[docker-compose.yml](docker-compose.yml) runs the whole stack on one host, one process per container:

| Service | Role | Port |
|---|---|---|
| `web` | nginx: built UI, proxies `/api` and `/socket.io` to `api` | `80` (`WEB_PORT`) |
| `api` | control plane (gunicorn, one gevent worker) | `5001` |
| `triton-testing` / `triton-production` | data planes (gunicorn, `TRITON_WORKERS` gevent workers) | `5002` / `5004` |
| `flower` | Celery monitoring for every queue | `5555` (`FLOWER_PORT`) |
| `sage` | training worker | — |
| `worker-testing` / `worker-production` | serving workers | — |
| `migrate` | one-shot `flask db upgrade`, everything waits for it | — |
| `redis`, `postgres` | with healthchecks and named volumes | — |

```bash
cp .env.example .env            # set SECRET_KEY and POSTGRES_PASSWORD
docker compose up -d --build
open http://localhost/
```

On the CUDA host (linux/amd64 with the NVIDIA Container Toolkit), the override switches the workers to the `cuda` image variant and grants the GPUs:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Compose reads `.env` and overrides the host-specific values (localhost Redis, SQLite) per service, so the same `.env` serves both ways of running the stack. Model artifacts live in the `data` volume, shared by the API and all workers.

Python dependencies are split by role under [requirements/](requirements/) (`base`, `api`, `worker`, `worker-cuda`); the top-level `requirements.txt` includes `worker.txt` for a native install. [docker-bake.hcl](docker-bake.hcl) layers `linux/amd64` + `linux/arm64` platforms over the compose build definitions for when the images are published to a registry (`docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all` shows the plan).

Useful commands:

```bash
docker compose ps
docker compose logs -f api sage         # any service name
docker compose restart worker-testing
docker compose down                     # keep data
docker compose down -v                  # wipe database, redis and artifacts
```
````

- [ ] **Step 4: Update the README "Requirements" bullet**

Find the bullet `- For containers: Docker Engine 24+ with the Compose plugin (`docker compose`)` and replace with:

```markdown
- For containers: Docker Engine 24+ with the Compose plugin (`docker compose`, v2.35+ for bake-backed builds); the NVIDIA Container Toolkit on the CUDA host
```

- [ ] **Step 5: Rewrite the CLAUDE.md Containers paragraph**

Replace the paragraph beginning `Containers — \`docker compose up -d --build\`` with:

```markdown
Containers — three images, each with only its own dependencies: [docker/Dockerfile.client](docker/Dockerfile.client) (Vite build → nginx), [docker/Dockerfile.api](docker/Dockerfile.api) (Flask/Celery without the ML stack: control plane, both data planes, `migrate`, `flower`) and [docker/Dockerfile.worker](docker/Dockerfile.worker) (the Celery workers; the only image with TensorFlow; `ARG DEVICE=cpu|cuda`). Python requirements are split to match under [requirements/](requirements/) (`base` → `api` / `worker` → `worker-cuda`, `-r` includes; the top-level `requirements.txt` includes `worker.txt` for the native venv; `tensorflow`/`torch` use platform markers so one pin resolves on macOS, linux/arm64 and linux/amd64). `docker compose up -d --build` runs the whole stack on one host, one process per container ([docker-compose.yml](docker-compose.yml); only one service per image carries `build:`). Inside containers the servers run under gunicorn's gevent worker — the control plane with `-w 1` (Socket.IO long-polling needs one process), the data planes with `TRITON_WORKERS` — while `python app.py` remains the host way. `docker-compose.gpu.yml` is the override for the CUDA host (`-cuda` worker image, `gpus: all`); [docker-bake.hcl](docker-bake.hcl) layers multi-platform targets over compose for publishing. Compose overrides the localhost/sqlite values from `.env` per service; `.env.example` lists the keys it reads. `gevent-websocket` must stay out of the requirements: engineio prefers it when importable and it breaks WebSocket upgrades under plain `-k gevent`. Inference endpoints are absolute URLs the browser calls directly, so `INFERENCE_HOST` must be the host's public name and 5002/5004 stay published.
```

- [ ] **Step 6: Re-run the reference grep**

Run the grep from Step 2 again.
Expected: no output.

---

### Task 8: End-to-end smoke test of the stack

**Files:** none (verification only). Needs a `.env` (copy `.env.example` if absent; set `SECRET_KEY`).

- [ ] **Step 1: Bring the stack up from scratch**

Run: `docker compose down -v --remove-orphans; docker compose up -d --build && sleep 20 && docker compose ps`
Expected: `migrate` `Exited (0)`; `web`, `api`, `triton-testing`, `triton-production`, `flower`, `sage`, `worker-testing`, `worker-production`, `redis`, `postgres` all `Up`.

- [ ] **Step 2: Control plane through nginx**

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost/ && curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/models`
Expected: `200` for the SPA and `401` (auth required) for `/api/models` — a `502` means nginx cannot reach `api`.

- [ ] **Step 3: Socket.IO upgrade through nginx**

Run: `curl -s 'http://localhost/socket.io/?EIO=4&transport=polling' | head -c 120; echo`
Expected: a payload starting with `0{"sid":` (engineio open packet) — proves gunicorn's gevent worker serves Socket.IO. Then confirm the WebSocket driver: `docker compose exec api python -c "from engineio.async_drivers import gevent as g; print(g.SimpleWebSocketWSGI is not None)"` → `True`.

- [ ] **Step 4: Data plane**

Run: `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5002/api/infer/does-not-exist`
Expected: `401` or `404`, not connection refused — the triton gunicorn process is up.

- [ ] **Step 5: Flower sees every worker**

Run: `sleep 5; curl -s http://localhost:5555/api/workers | python3 -c "import sys,json; print(sorted(json.load(sys.stdin)))"`
Expected: `['sage@…', 'triton-production@…', 'triton-testing@…']` (hostnames are container ids).

- [ ] **Step 6: Train and serve (hands-on)**

In the UI at http://localhost/: sign up, create a `text_classification` model with two labels and a few utterances each, train, then publish the version to `testing` and query it on the Test tab. Expected: the `training` task shows as `SUCCESS` in flower, `docker compose logs sage` shows epoch output with no `ModuleNotFoundError`, and the Test tab returns a prediction (served by `worker-testing` through `triton-testing`). This exercises prefork inside the worker image and the full Redis handshake. On the CUDA host repeat this via `docker-compose.gpu.yml` and check `docker compose logs sage | grep -i "gpu"` for TensorFlow's device placement lines — that is the only place GPU visibility can be confirmed.

- [ ] **Step 7: Sizes for the record**

Run: `docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep indic-nlu`
Expected: client tens of MB, api well under 1 GB, worker a few GB. Report these numbers to the user.
