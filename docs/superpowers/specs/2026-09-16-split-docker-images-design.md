# Split the Docker image into client / api / worker

**Date:** 2026-09-16
**Status:** approved design, awaiting implementation plan

## Goal

Replace the single `docker/Dockerfile` (one Python image carrying every
dependency, plus a supervisord single-container mode) with three images that
each install only what their processes import, driven by one
`docker-compose.yml`, a `docker-bake.hcl` overlay for multi-platform builds,
and a compose override for the CUDA deployment host. Requirements are split
by role so each image, and the native macOS venv, resolves from the same pins.

Images are built locally for now (`docker compose … --build`); no registry.
The bake file is ready for `--push` when one exists.

## Non-goals

- `tensorflow-metal` on macOS. CLAUDE.md records why it was removed (CRF
  10–30× slower on Metal, prefork children abort on fork). Not reinstated.
- Kubernetes, Helm, or any orchestrator beyond compose.
- Locking transitive dependency trees per platform (pip-tools). Pins are
  carried over from the current `requirements.txt`; pip resolves the
  platform wheel.
- Changing anything about the serving/publishing runtime (registry,
  Celery apps, ports). Only packaging and process launch change.

## Findings that drive the split

- TensorFlow, transformers, scikit-learn, onnx*, tf2onnx and
  tensorflow-model-optimization are imported only under `server/models/`.
  Only `server/tasks/training.py` and `server/tasks/inference.py` import that
  package, lazily inside the task body. Neither the control plane nor the
  triton data plane ever loads TF.
- `pandas` is imported by `server/database/model.py`, `server/database/intent.py`
  and `server/views/api/analytics.py`, so the api image needs pandas + numpy.
- `TFAutoModel.from_pretrained(name)` converts PyTorch checkpoints when the hub
  has no TF weights; that path imports `torch`. Torch stays in the worker.
- `tensorflow==2.15.0` has wheels for macOS arm64 (which depends on
  `tensorflow-macos`), linux aarch64 and linux x86_64 (verified with
  `pip download`). One pin serves the Mac venv and both container arches.
- On linux/x86_64 the PyPI `torch==2.8.0` wheel pulls the `nvidia-*` CUDA 12 /
  cuDNN 9 wheel set, which conflicts with TF 2.15's `[and-cuda]` set
  (CUDA 12.2 / cuDNN 8.9) and adds ~2.5 GB. Conversion is a one-off CPU job.
- Packages in the current `requirements.txt` that neither `server/` nor any
  kept package's dependency closure needs: Flask-Mail, Flask-APScheduler,
  APScheduler, tzlocal, uuid6, openpyxl, et_xmlfile, xlrd, gevent-websocket.
  (argon2-cffi and pycryptodome are required by minio; bcrypt and
  cryptography by paramiko/azure-storage-blob; msgspec by Flask-Session;
  narwhals by scikit-learn — they stay as transitive pins.) `gunicorn` and
  `flower` were also unreferenced but are now used (below).
- `tensorflow==2.15.0` on linux/x86_64 cannot find CUDA libraries installed
  through the `[and-cuda]` extra; `2.15.0.post1` is the linux/x86_64-only
  re-release that fixes it (verified the wheel exists). No other platform has
  a post1 wheel.

## 1. Requirements layout

```
requirements/
  base.txt          runtime shared by every Python process
  api.txt           -r base.txt   + flower
  worker.txt        -r base.txt   + ML stack (CPU, all platforms)
  worker-cuda.txt   -r worker.txt + tensorflow[and-cuda]==2.15.0.post1
requirements.txt    -r requirements/worker.txt     (native venv: everything, CPU)
```

**base.txt** (direct deps; transitive pins follow):
Flask, Flask-SocketIO, Flask-SQLAlchemy, Flask-Migrate, Flask-Session,
Flask-HTTPAuth, Werkzeug, SQLAlchemy, alembic, psycopg2-binary, celery, kombu,
redis, gevent, gunicorn, PyJWT, python-dotenv, requests, pandas, numpy,
boto3, azure-storage-blob, google-cloud-storage, minio, pysftp, paramiko.

**worker.txt** adds: tensorflow (`2.15.0.post1` on linux/x86_64, `2.15.0`
elsewhere, via markers), keras, tensorflow-estimator,
tensorflow-io-gcs-filesystem, tensorflow-model-optimization, transformers,
tokenizers, huggingface_hub, safetensors, scikit-learn, scipy, joblib, h5py,
onnx, onnxruntime, tf2onnx, and torch:

```
--extra-index-url https://download.pytorch.org/whl/cpu
torch==2.8.0+cpu; sys_platform == "linux"
torch==2.8.0;     sys_platform != "linux"
```

Linux takes the CPU wheel from PyTorch's index on both x86_64 and aarch64
(PyPI's aarch64 wheels carry CUDA too); the macOS wheel is CPU-only. The
same torch goes into the CUDA image — TF is the only framework that touches
the GPU.

**worker-cuda.txt**: `-r worker.txt` plus `tensorflow[and-cuda]==2.15.0.post1`.
The extra adds the `nvidia-*` wheels TF 2.15 was built against; the pin
matches worker.txt's linux/x86_64 marker so the resolver sees one TF version.

**api.txt** adds flower and its deps (tornado, humanize, prometheus_client).

**Removed** from every file: Flask-Mail, Flask-APScheduler, APScheduler,
tzlocal, uuid6, openpyxl, et_xmlfile, xlrd, gevent-websocket. Flask-SocketIO
under gunicorn's gevent worker uses `simple-websocket` (already a dependency)
for WebSocket upgrades.

Rules:
- Every version pin is the one in today's `requirements.txt`. Nothing is
  upgraded, with the single exception of the tensorflow post1 marker above.
- Transitive pins are kept and placed in the lowest file whose direct deps
  need them (e.g. `greenlet` in base, `ml-dtypes` in worker), so each image's
  resolved tree matches the current one minus the removals.
- No separate macOS file: pip selects the darwin wheel of `tensorflow`.

## 2. Images

All three live in `docker/`. `docker/Dockerfile` and `supervisord.conf` are
deleted; `supervisor` is not installed anywhere.

### `docker/Dockerfile.client`

`node:22-bookworm-slim` build stage (`npm ci`, `npm run build`) →
`nginx:1.27-alpine` with `docker/nginx.conf` and `/app/dist` at
`/usr/share/nginx/html`. `EXPOSE 80`. Identical to today's `build` + `web`
stages, standalone.

### `docker/Dockerfile.api`

- `FROM python:3.11-slim`; `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`.
- No compiler: every package in `api.txt` ships wheels for linux/amd64 and
  linux/arm64 on CPython 3.11. If a build ever fails on a missing wheel, add
  `build-essential` to that Dockerfile only.
- `COPY requirements/base.txt requirements/api.txt` → `pip install`.
- Copies `server/`, `migrations/`, `app.py`, `public/colors.txt`
  (`server/utils/dataset.py` reads the palette).
- Non-root `appuser`; writable `/app/data`, `/app/instance`, `/app/flask_session`.
- `EXPOSE 5001 5002 5003 5004`.
- Default `CMD`: the control plane under gunicorn:

  ```
  gunicorn -k gevent -w 1 -b 0.0.0.0:5001 --timeout 300 "app:create_app()"
  ```

  `-w 1`: Socket.IO long-polling requires a client's requests to land in the
  same process; gevent provides the concurrency inside it. `create_app()`
  already returns the Flask app with `socketio.init_app` applied, i.e. the
  Socket.IO-wrapped WSGI app, so no new entrypoint is needed. The gevent worker
  monkey-patches before importing the app; the `monkey.patch_all()` at the top
  of `app.py` becomes a harmless no-op under gunicorn and still matters for
  `python app.py` on the host.

The same image runs, via compose `command` overrides:
- data planes: `gunicorn -k gevent -w ${TRITON_WORKERS:-2} -b 0.0.0.0:<port> --timeout 120 "server:create_triton_server()"` — stateless, so several
  processes are fine; the Redis handshake in `server/registry.py` is already
  multi-process safe.
- `migrate`: `flask db upgrade`.
- `flower`: `celery -A server.tasks:sage flower --port=5555`.

### `docker/Dockerfile.worker`

- `FROM python:3.11-slim`, same env and user conventions as api.
- `ARG DEVICE=cpu`. Copies `requirements/base.txt`, `worker.txt` and
  `worker-cuda.txt`, then installs `worker.txt` (`cpu`) or `worker-cuda.txt`
  (`cuda`); any other value fails the build.
- Copies `server/` and `public/colors.txt` only — no `app.py` (the worker
  builds its app context through `server.create_application_server` in
  `server/tasks/request.py`), no `migrations/`.
- Default `CMD`: the training worker
  (`celery -A server.tasks:sage worker -E -Q training -P prefork -c 1 -l INFO -Ofair -n sage@%h`).
  Serving workers override `command` in compose. Prefork stays the pool
  everywhere (`worker_max_tasks_per_child=1` needs it).
- CPU variant builds for linux/amd64 and linux/arm64; CUDA variant is
  linux/amd64 only.

## 3. Compose, bake, GPU override, flower

### `docker-compose.yml`

Single source of build contexts. Only one service per image carries `build:`
(parallel builds of the same tag race on export).

| service | image | build | command |
|---|---|---|---|
| `web` | `${REGISTRY:-}indic-nlu-client:${TAG:-latest}` | `docker/Dockerfile.client` | nginx default |
| `api` | `${REGISTRY:-}indic-nlu-api:${TAG:-latest}` | `docker/Dockerfile.api` | gunicorn control plane (image default) |
| `triton-testing` / `triton-production` | api image | — | gunicorn data plane, `FLASK_ENV` per service, ports 5002 / 5004 |
| `migrate` | api image | — | `flask db upgrade` (one-shot) |
| `flower` | api image | — | `celery -A server.tasks:sage flower --port=5555` |
| `sage` | `${REGISTRY:-}indic-nlu-worker:${TAG:-latest}-${WORKER_DEVICE:-cpu}` | `docker/Dockerfile.worker`, `args: DEVICE: ${WORKER_DEVICE:-cpu}` | training worker |
| `worker-testing` / `worker-production` | worker image | — | serving workers, one per queue |
| `redis`, `postgres` | upstream | — | unchanged |

Unchanged: the `x-backend-env` block, the `data` volume shared by every
backend service, healthchecks, `depends_on` ordering through `migrate`,
published ports 5001/5002/5004 and `${WEB_PORT:-80}`.

`flower`: publishes `${FLOWER_BIND:-127.0.0.1}:${FLOWER_PORT:-5555}:5555` —
loopback by default; `FLOWER_BASIC_AUTH` passed through from `.env`
(`user:password`). flower 2.x returns 401 for every `/api/*` call (which
the UI's revoke/shutdown buttons use) unless auth is configured or
`FLOWER_UNAUTHENTICATED_API` is set, and it splits `FLOWER_BASIC_AUTH` on
`,` even when empty (`""` → `['']`, truthy → auth on with an unmatchable
credential). The service command therefore branches: credentials set → use
them; empty → drop the variable and set `FLOWER_UNAUTHENTICATED_API=true`.
Because the empty case leaves the API open (task submission, worker
shutdown), the port stays on loopback unless the operator sets
`FLOWER_BIND=0.0.0.0` — which `.env.example` says to do only together with
credentials. Both Celery apps share the broker
and workers run with `-E`, so one flower shows the `training`, `testing` and
`production` queues and can inspect, revoke and terminate tasks. Depends on
`redis` only.

### `docker-compose.gpu.yml`

Override for the CUDA host:

```
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Sets `build.args.DEVICE: cuda` and the `…-cuda` image tag on `sage`, the same
image on `worker-testing` / `worker-production`, and `gpus: all` on all
three. Nothing else differs from the CPU stack.

### `docker-bake.hcl`

Overlay over compose, used as
`docker buildx bake -f docker-compose.yml -f docker-bake.hcl <group>`:

- variables `REGISTRY` (default `""`) and `TAG` (default `latest`), matching
  compose.
- targets `web`, `api`, `sage` inherit compose's contexts and gain
  `platforms = ["linux/amd64", "linux/arm64"]`.
- target `worker-cuda` inherits `sage` with `DEVICE = "cuda"`,
  tag `…-worker:${TAG}-cuda`, `platforms = ["linux/amd64"]`.
- groups: `default` = the three CPU images, `cuda` = `worker-cuda`,
  `all` = both.

Local builds stay `docker compose … --build` (native arch, loaded straight
into the daemon; compose already drives bake). Multi-arch manifests need the
`docker-container` builder and `--push`; that path is documented as
"when a registry exists" and not exercised now.

### `.env.example`

New keys with comments: `REGISTRY`, `TAG`, `WORKER_DEVICE`, `TRITON_WORKERS`,
`FLOWER_BIND`, `FLOWER_PORT`, `FLOWER_BASIC_AUTH`. `WEB_PORT` stays.

## 4. Cleanup and documentation

- Delete `docker/Dockerfile`, `supervisord.conf`.
- `.dockerignore`: unchanged except that `requirements/` must not be
  excluded (it is not today).
- CLAUDE.md "Containers" paragraph rewritten: three images, which services
  run from which, gunicorn, flower, the GPU override, bake. The
  single-container / supervisord sentences are removed. README's Docker
  section updated the same way.
- CLAUDE.md "Commands" gets the gunicorn lines as the container way to run
  the two servers; `python app.py` remains the host way.

## 5. Verification

On the Mac (linux/arm64 containers):
1. `docker compose build` — three images build; `docker image ls` shows
   `indic-nlu-client`, `indic-nlu-api`, `indic-nlu-worker:latest-cpu`, and
   the api image is markedly smaller than the worker image.
2. `docker compose up -d`; UI on `:80`, sign in, `/api` request through nginx,
   Socket.IO connects (browser devtools → `socket.io` upgrade 101).
3. Flower on `:5555` lists `sage@…`, `triton-testing@…`,
   `triton-production@…`.
4. Train a small model → `training` task completes in flower, artifact
   appears in the `data` volume; publish to `testing` → `POST /api/infer/…`
   through `:5002` returns a prediction. This exercises both worker roles and
   prefork inside the worker image.
5. `docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all`
   resolves without error and shows the platforms per target.
6. Fresh venv: `pip install --dry-run -r requirements.txt` resolves on macOS
   (pulling `tensorflow-macos` transitively) — no Metal.
7. `python -m py_compile` on any touched Python; `npm run build` unaffected.

CUDA image: `docker buildx bake -f docker-compose.yml -f docker-bake.hcl worker-cuda` is cross-buildable from the Mac (pip only, no compilation) but
slow under emulation; whether TF sees the GPU can only be verified on the
deployment host with `docker compose … -f docker-compose.gpu.yml up` and a
training run. The spec records this as unverified until then, consistent with
CLAUDE.md's note that nothing has been measured on CUDA.

## Open risks

- A pin that today only installs because of a removed package's transitive
  dependency. Mitigation: `pip check` inside each built image is part of the
  implementation plan.
- `tensorflow[and-cuda]==2.15.0.post1` with `torch==2.8.0+cpu`: both are CPU-side
  for torch, but `pip check` on the CUDA image confirms no `nvidia-*`
  version clash.
- Gunicorn `-w 1` for the control plane is a single process; if throughput
  ever needs more, scale `api` replicas with sticky sessions in nginx
  (`ip_hash`) rather than raising `-w`.
