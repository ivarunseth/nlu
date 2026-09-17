# Indic NLU

A platform for training and serving natural-language-understanding models for Indian languages. Create a model, build a labelled dataset in the browser, train versioned artifacts, and publish a version into a `testing` or `production` environment where it is served behind a per-model inference endpoint with its own API key.

Three model types are supported:

| Type | Task | Training data |
|---|---|---|
| `text_classification` | intent / label per utterance | utterance → label |
| `named_entity_recognition` | token classification (entity spans) | utterance + `[start, end)` spans |
| `natural_language_understanding` | joint intent + slots | label + spans |

Each type ships several architectures (transformer, deep neural network, recurrent neural network with CRF), selected per training run. Artifacts can be exported as SavedModel, H5, TFLite or ONNX and are served by the matching runtime.

## Technology stack

**Backend**
- Python 3.11, Flask 3.1, Flask-SocketIO (gevent) for live training progress
- Celery 5.5 on Redis for training and serving tasks; SQLAlchemy 2 / Flask-Migrate (Alembic) for the schema and the Celery result backend
- TensorFlow 2.15 / Keras, tf2onnx + onnxruntime, Hugging Face `transformers`
- Pluggable blob storage for artifacts: `local`, `s3`, `gcs`, `azure`, `minio`, `ftp`, `sftp`, `akamai`

**Frontend**
- React 19, Vite, React-Bootstrap, React Router 7, Recharts, socket.io-client, axios

**Infrastructure**
- Redis — Celery broker, Socket.IO message queue, and the inference registry (published routes, request/response queues)
- A SQL database — SQLite for local development, PostgreSQL in containers
- Docker / Docker Compose for deployment; CUDA GPU on the deployment host (local development is CPU-only)

### How it fits together

The backend is seven Flask blueprints under [server/blueprints/](server/blueprints/), one per deployable service, all served from one image. The name of a blueprint is its URL prefix (`/api/<name>/`), its nginx location and its compose service:

- **auth** — sign-up, sign-in, session tokens.
- **dataset** — models and everything a labelled dataset is made of (intents, entities, slots, values, utterances, tags, import/export).
- **training** — training runs; enqueues onto the `training` Celery queue.
- **publishing** — deployments: writes a route into the environment's registry (Redis) and launches the serving task.
- **analytics** — dashboards; runs the telemetry consumer that persists predictions.
- **inference** — `POST /api/inference/<environment>/<model_id>`: reads the route from Redis, hands inputs to the serving worker over Redis, never queries the database (the models are imported by every process, but the inference blueprint issues no queries).
- **events** — the Socket.IO server (`/socket.io`); every other process emits through the Redis message queue.
- **Workers** — the `training` Celery app runs training (`training` queue); the `serving` app runs serving tasks, one worker per environment queue (`testing`, `production`). A serving task loads a model once and answers batches until it is unpublished, superseded, or idle.

## Requirements

- Python 3.11
- Node.js 22 and npm
- Redis 7
- For containers: Docker Engine 24+ with the Compose plugin (`docker compose`, v2.35+ for bake-backed builds); the NVIDIA Container Toolkit on the CUDA host
- For GPU training in deployment: an NVIDIA driver + CUDA runtime matching TensorFlow 2.15

## Running locally

Local development runs each process on the host against SQLite and a local Redis. Everything reads the same `.env`.

1. **Configure**

   ```bash
   cp .env.example .env
   # set SECRET_KEY; PUBLIC_URL=http://localhost:5173 is right for host development
   ```

2. **Backend**

   ```bash
   python -m venv venv && source venv/bin/activate
   pip install -r requirements.txt
   flask db upgrade            # creates instance/indicnlu.db
   ```

3. **Redis** — `redis-server` (or `brew services start redis`).

4. **Start the processes**, each in its own terminal (there is no process manager):

   ```bash
   python app.py                                                       # every blueprint in one process, :5000
   celery -A server.tasks:training worker -Q training -P prefork -c 1  # training worker
   celery -A server.tasks:serving  worker -Q testing  -P prefork       # serving worker, testing
   celery -A server.tasks:api      worker -Q default  -P prefork       # request worker (long-running API calls)
   ```

   `python app.py training` (any blueprint names) runs a subset. To also serve `production` locally, run a second serving worker with `-Q production`.

5. **Frontend**

   ```bash
   npm ci
   npm run dev                 # http://localhost:5173
   ```

   The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:${PORT}`. `npm run build` writes a production bundle to `dist/`.

## Running with Docker Compose

Three images, each with only its own dependencies:

| Image | Dockerfile | Runs |
|---|---|---|
| `client` | [docker/Dockerfile.client](docker/Dockerfile.client) | nginx: built UI, proxies `/api/<blueprint>/` and `/socket.io/` to the blueprint services |
| `api` | [docker/Dockerfile.api](docker/Dockerfile.api) | every `*-api` blueprint service, `migrate` (`flask db upgrade`), flower |
| `worker:<tag>-cpu` / `-cuda` | [docker/Dockerfile.worker](docker/Dockerfile.worker) | training and serving Celery workers (the only image with TensorFlow) |

[docker-compose.yml](docker-compose.yml) runs the whole stack on one host, one process per container:

| Service | Role | Published port |
|---|---|---|
| `client` | nginx: built UI, proxies `/api/<blueprint>/` and `/socket.io/` | `80` (`CLIENT_PORT`) |
| `migrate` | builds the Flask image, runs `flask db upgrade`, exits | — |
| `auth-api`, `dataset-api`, `training-api`, `publishing-api`, `analytics-api`, `events-api` | one blueprint each (gunicorn, gevent) | — |
| `inference-api-testing` / `inference-api-production` | the `inference` blueprint, one container per environment | — |
| `flower` | Celery monitoring for every queue | `127.0.0.1:5555` (`FLOWER_BIND`, `FLOWER_PORT`) |
| `request-worker` | replays long-running API calls (see below) | — |
| `training-worker` | training worker (builds the worker image) | — |
| `serving-worker-testing` / `serving-worker-production` | serving workers | — |
| `redis` | Celery broker, Socket.IO message queue, inference registries | — |
| `postgres` | with healthchecks and a named volume | — |

```bash
cp .env.example .env            # set SECRET_KEY, POSTGRES_PASSWORD and PUBLIC_URL (http://localhost for a local stack)
docker compose up -d --build
open http://localhost/
```

On the CUDA host (linux/amd64 with the NVIDIA Container Toolkit), the override switches the workers to the `cuda` image variant and grants the GPUs:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Compose reads `.env` and overrides the host-specific values (localhost Redis, SQLite) per service, so the same `.env` serves both ways of running the stack. `PUBLIC_URL` is the exception: it must name the address users reach nginx on. Model artifacts live in the `data` volume, shared by the API and all workers.

Python dependencies are split by role under [requirements/](requirements/) (`base`, `api`, `worker`, `worker-cuda`); the top-level `requirements.txt` includes `worker.txt` for a native install. [docker-bake.hcl](docker-bake.hcl) layers `linux/amd64` + `linux/arm64` platforms over the compose build definitions for when the images are published to a registry (`docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all` shows the plan). The flower service unsets an empty `FLOWER_BASIC_AUTH` before starting, because flower would otherwise treat the empty value as an (unmatchable) credential.

Useful commands:

```bash
docker compose ps
docker compose logs -f dataset-api training-worker   # any service name
docker compose restart serving-worker-testing
docker compose down                     # keep data
docker compose down -v                  # wipe database, redis and artifacts
```

## Notes for developers

- **Inference endpoints go through nginx.** A deployment's endpoint is `PUBLIC_URL/api/inference/<environment>/<model_id>`; set `PUBLIC_URL` to the host's public name.
- **Environments are inference environments.** `testing` / `production` each have a route registry (`REDIS_URL_<ENV>`), a serving queue of the same name and an API-key TTL (`ALLOWED_ENVIRONMENTS` in [server/config.py](server/config.py)). No HTTP process "serves" an environment: `inference` reads it from the URL, serving workers from their queue. Adding one means editing that dict and running a serving worker on the new queue.
- **One Socket.IO server.** Only the `events` blueprint (`events-api` in compose) hosts `/socket.io`; everything else emits through `server/utils/socket.py` (the Redis message queue). Keep it at one gunicorn worker.
- **Long-running API calls are asynchronous.** Views wrapped in `apply_async` ([server/blueprints/__init__.py](server/blueprints/__init__.py)) — dataset import/export, the analytics dashboards, training data download, and the cascading deletes of a model/intent/entity — answer `202 {"task_id"}` with a `Location` header at once; the request worker (`celery -A server.tasks:api worker -Q default`) replays the request and stores the response in `REQUEST_RESULT_BACKEND` (Redis, expiring). `GET /api/<blueprint>/status/<task_id>` returns 202 until then and the stored response after. The browser does not poll: the worker pushes `status` into the task-id Socket.IO room and the API client ([src/api/client.js](src/api/client.js)) fetches the result on the terminal event (with a slow poll as fallback), so call sites see the same result a synchronous endpoint would return. `curl` users poll `Location`.
- **Keep the Celery prefork pool.** `worker_max_tasks_per_child=1` gives each training/serving task a fresh process; only prefork provides that.
- **Migrations:** prefer hand-written ones. `flask db migrate` autogenerate proposes dropping Celery's result-backend tables (`taskmeta`, `tasksetmeta`) — those belong to Celery, and dropping them fails on a fresh database.
- **Local is CPU-only; deployment is CUDA.** Do not install `tensorflow-metal` — it made CRF training an order of magnitude slower and breaks the prefork pool on macOS. CUDA throughput has not yet been profiled; see [CLAUDE.md](CLAUDE.md) for the GPU invariants in the CRF code.
- **Storage:** with `STORAGE_PROVIDER=local`, artifacts are written under `./<STORAGE_BUCKET>` relative to the working directory. Other providers take their credentials from the environment (`AWS_*`, `MINIO_*`, …); see [server/storage/](server/storage/).
- **Verification:** there is no meaningful test suite. Check Python changes with `python -m py_compile <file>` and the frontend with `npm run build`; validate the Compose file with `docker compose config`.
- **Config lives in `.env`.** Add new tunables to the `Config` class in [server/config.py](server/config.py) rather than as literals; Celery tasks and the registry read the config class directly, without an app context.
