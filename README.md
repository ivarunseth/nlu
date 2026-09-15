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

The system is split into two planes that only meet through Redis and blob storage:

- **Control plane** (`python app.py`) — the `/api` blueprint: auth, models, datasets, annotation, training, publishing, analytics. Talks to the database, enqueues Celery jobs, writes inference routes to Redis, and streams training progress over Socket.IO.
- **Data plane** (`python app.py triton`) — one process per environment exposing `POST /api/infer/<model_id>`. It never touches the database: it reads the route from Redis, queues the inputs, and waits for the serving worker to answer.
- **Workers** — the `sage` Celery app runs training (`training` queue); the `triton` Celery app runs serving tasks, one worker per environment queue (`testing`, `production`). A serving task loads a model once and answers batches until it is unpublished, superseded, or idle.

A version is validated in `testing` before it is promoted to `production`. See [CLAUDE.md](CLAUDE.md) for the architecture in depth.

## Requirements

- Python 3.11
- Node.js 22 and npm
- Redis 7
- For containers: Docker Engine 24+ with the Compose plugin (`docker compose`)
- For GPU training in deployment: an NVIDIA driver + CUDA runtime matching TensorFlow 2.15

## Running locally

Local development runs each process on the host against SQLite and a local Redis. Everything reads the same `.env`.

1. **Configure**

   ```bash
   cp .env.example .env
   # set SECRET_KEY; the rest of the defaults work for a local setup
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
   python app.py                                                    # control plane, :5001
   python app.py triton                                             # data plane for FLASK_ENV, :5002 (testing)
   celery -A server.tasks:sage   worker -Q training -P prefork -c 1 # training worker
   celery -A server.tasks:triton worker -Q testing  -P prefork      # serving worker, testing
   ```

   To also serve `production` locally, run a second data plane and serving worker with `FLASK_ENV=production` (`:5004`, queue `production`).

5. **Frontend**

   ```bash
   npm ci
   npm run dev                 # http://localhost:5173
   ```

   The Vite dev server proxies `/api`, `/api/infer` and `/socket.io` to the `testing` stack (`FLASK_ENV=production npm run dev` targets the other one). `npm run build` writes a production bundle to `dist/`.

## Running with Docker

The single image in [docker/Dockerfile](docker/Dockerfile) contains the backend and the built frontend. Run on its own, it starts every process under supervisord ([supervisord.conf](supervisord.conf)) — a single-container deployment. It still needs Redis and a database reachable over the network:

```bash
docker build -f docker/Dockerfile -t indic-nlu .
docker run -d --name indic-nlu --env-file .env \
  -e REDIS_HOST=<redis-host> \
  -e CELERY_BROKER_URL=redis://<redis-host>:6379/0 \
  -e SOCKETIO_MESSAGE_QUEUE=redis://<redis-host>:6379/0 \
  -e REDIS_URL_TESTING=redis://<redis-host>:6379/0 \
  -e REDIS_URL_PRODUCTION=redis://<redis-host>:6379/0 \
  -e SQLALCHEMY_DATABASE_URI=postgresql://user:pass@<db-host>:5432/indicnlu \
  -e CELERY_RESULT_BACKEND=db+postgresql://user:pass@<db-host>:5432/indicnlu \
  -e FLASK_DEBUG=false \
  -v indic-nlu-data:/app/data \
  -p 5001:5001 -p 5002:5002 -p 5004:5004 \
  indic-nlu
```

Migrations run automatically before the control plane starts. The UI is not served by this container — either put the built `dist/` behind your own web server (proxy `/api` and `/socket.io` to `:5001`, see [docker/nginx.conf](docker/nginx.conf)) or use Compose below. Inspect the processes with:

```bash
docker exec indic-nlu supervisorctl -c /etc/supervisor/conf.d/supervisord.conf status
```

## Running with Docker Compose

[docker-compose.yml](docker-compose.yml) runs the whole stack on one host, one process per container:

| Service | Role | Port |
|---|---|---|
| `web` | nginx: built UI, proxies `/api` and `/socket.io` to `api` | `80` (`WEB_PORT`) |
| `api` | control plane | `5001` |
| `triton-testing` / `triton-production` | data planes | `5002` / `5004` |
| `sage` | training worker | — |
| `worker-testing` / `worker-production` | serving workers | — |
| `migrate` | one-shot `flask db upgrade`, everything waits for it | — |
| `redis`, `postgres` | with healthchecks and named volumes | — |

```bash
cp .env.example .env            # set SECRET_KEY and POSTGRES_PASSWORD
docker compose up -d --build
open http://localhost/
```

Compose reads `.env` and overrides the host-specific values (localhost Redis, SQLite) per service, so the same `.env` serves both ways of running the stack. Model artifacts live in the `data` volume, shared by the API and all workers.

Useful commands:

```bash
docker compose ps
docker compose logs -f api sage         # any service name
docker compose restart worker-testing
docker compose down                     # keep data
docker compose down -v                  # wipe database, redis and artifacts
```

## Notes for developers

- **Inference endpoints are absolute URLs.** A deployment's endpoint is `INFERENCE_HOST:<5002|5004>/api/infer/<model_id>` and the browser calls it directly, bypassing nginx. On a real host set `INFERENCE_HOST` to its public name and keep `5002`/`5004` reachable.
- **Environments are first-class.** `FLASK_ENV` (`testing` | `production`) names both the Flask config and the inference environment a process serves — it selects the port for the servers and the registry/queue for the data plane and serving workers. Adding an environment means editing `ALLOWED_ENVIRONMENTS` in [server/config.py](server/config.py), mirroring the ports in [vite.config.js](vite.config.js), and running a serving worker on the new queue.
- **Keep the Celery prefork pool.** `worker_max_tasks_per_child=1` gives each training/serving task a fresh process; only prefork provides that.
- **Migrations:** prefer hand-written ones. `flask db migrate` autogenerate proposes dropping Celery's result-backend tables (`taskmeta`, `tasksetmeta`) — those belong to Celery, and dropping them fails on a fresh database.
- **Local is CPU-only; deployment is CUDA.** Do not install `tensorflow-metal` — it made CRF training an order of magnitude slower and breaks the prefork pool on macOS. CUDA throughput has not yet been profiled; see [CLAUDE.md](CLAUDE.md) for the GPU invariants in the CRF code.
- **Storage:** with `STORAGE_PROVIDER=local`, artifacts are written under `./<STORAGE_BUCKET>` relative to the working directory. Other providers take their credentials from the environment (`AWS_*`, `MINIO_*`, …); see [server/storage/](server/storage/).
- **Verification:** there is no meaningful test suite. Check Python changes with `python -m py_compile <file>` and the frontend with `npm run build`; validate the Compose file with `docker compose config`.
- **Config lives in `.env`.** Add new tunables to the `Config` class in [server/config.py](server/config.py) rather than as literals; Celery tasks and the registry read the config class directly, without an app context.
