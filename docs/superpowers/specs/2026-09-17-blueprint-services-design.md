# Blueprint services: one blueprint, one service

**Date:** 2026-09-17
**Status:** approved design, awaiting implementation plan

## Problem

The backend is one Flask blueprint (`api`, 13 route modules) plus a
second one (`triton`, one route), run as a "control plane" and a
"data plane" with per-environment ports, and driven by two Celery apps
named `sage` and `triton`. The names describe nothing, the two
blueprints share copy-pasted error handlers, the route modules are not
independently runnable, and nothing can be scaled or restarted on its
own. The goal is both naming clarity and independent deployability, at
the same time, without a rewrite.

## Decisions already made

- Modular monolith deployed as separate processes: one Python package,
  one database, one Flask image. Not database-per-service (see
  "Database ownership").
- Seven blueprints, seven HTTP services, one each.
- URLs are prefixed by blueprint name: `/api/<blueprint>/…`.
- Inference moves behind nginx as
  `/api/inference/<environment>/<model_id>`; ports 5002/5004 are no
  longer published.
- The package is `server/blueprints/`.
- The compose service `migrate` builds the Flask image and runs
  `flask db upgrade`; blueprint services are named `<blueprint>-api`;
  image tags carry no project prefix.
- CORS on the inference blueprint uses `flask-cors`.

## Layout

```
server/
  __init__.py            db, migrate, redis, store, socketio singletons; create_app(*names)
  config.py              one Config class; ALLOWED_ENVIRONMENTS (name -> redis_url) stays
  auth.py                unchanged
  blueprints/
    __init__.py          NAMES, load(name); register_error_handlers(bp)
    auth/                users.py, tokens.py
    dataset/             models.py, intents.py, entities.py, slots.py, values.py, utterances.py, tags.py, dataset.py
    training/            trainings.py
    publishing/          instances.py
    analytics/           analytics.py
    inference/           inference.py
    events/              namespace.py (today's server/events.py); init_app attaches the Socket.IO server
  database/              unchanged package; each model gets an ownership comment
  tasks/                 __init__.py (apps `training`, `serving`), train.py, inference.py
  utils/                 + socket.py (write-only Socket.IO emitter); otherwise unchanged
  models/  storage/      unchanged
```

`server/views/` is deleted. Every blueprint package has the same shape:

- `__init__.py` — creates the `Blueprint`, sets `url_prefix`, calls
  `register_error_handlers`, imports its view modules, and defines
  `init_app(app)` when it needs process-level extras. `init_app` is
  optional; the factory calls it only if present.
- The route modules, moved from `server/views/` with `git mv` so their
  history survives, keeping their file names. Nothing else.

`register_error_handlers` installs the 400/404/409/500/504 →
`{'error': description}` handlers once, replacing the two copies that
exist today.

## Factory and entrypoints

`create_app(*names)` in `server/__init__.py`:

1. `Flask(__name__)`, `config.from_object(Config)`.
2. `db.init_app`, `Session(app)`, `store.init_app`, and
   `migrate.init_app` (the `'db' in sys.argv` guard that skips
   background tasks during CLI use stays).
3. For each requested name (default: all of `BLUEPRINTS`): register
   the blueprint at its `url_prefix`; call `init_app(app)` if the
   package defines one.
4. Return the Flask app only.

`app.py` keeps the gevent monkey-patch on line 1 and exposes
`create_app(*names)` for gunicorn and the `flask` CLI.
`python app.py [name ...]` runs the named blueprints (default: all) on
`PORT` (default 5000), using `socketio.run` when `events` is mounted and
`app.run` otherwise.

Inside containers each service is
`gunicorn -k gevent -w N -b 0.0.0.0:5000 "app:create_app('<name>')"`.

## Blueprints

| Blueprint | Prefix | Writes | Reads | `init_app` |
|---|---|---|---|---|
| `auth` | `/api/auth` | `user` | — | — |
| `dataset` | `/api/dataset` | `model`, `intent`, `entity`, `slot`, `value`, `utterance`, `tag` | — | — |
| `training` | `/api/training` | `training` | `model`, dataset tables (builds `data.csv`) | — |
| `publishing` | `/api/publishing` | `instance`, `environment` | `model`, `training` | `Environment.update()` |
| `analytics` | `/api/analytics` | `prediction` (through the telemetry consumer) | all of the above | starts the telemetry consumer |
| `inference` | `/api/inference` | — (no SQLAlchemy) | registry (Redis) | `CORS(blueprint, …)` |
| `events` | `/socket.io` | — | — | `socketio.init_app(app, message_queue=…)`; registers `events.Event('/')` |

Resource paths are unchanged under the prefix, e.g.
`/api/dataset/models/<id>/intents`,
`/api/training/models/<id>/trainings/<tid>/start`,
`/api/publishing/models/<id>/instances`,
`/api/analytics/models/<id>/live`, `/api/auth/tokens`.
`GET /api/dataset/models/<id>` stays in `dataset` because `model` is
its table; other blueprints read `Model` only for authorisation.

### Socket.IO

`events` is the only process that runs the Socket.IO **server**. Every
other emitter (`training`'s `socketio.emit('training', …)`, the
`WorkerTask.status` emits from the Celery side) goes through the Redis
message queue, which Flask-SocketIO supports from a process that is not
the server: a write-only `SocketIO(message_queue=…)` built without an
app. `server/utils/socket.py` provides that instance lazily, once per
process (`emitter()`, `emit(event, payload, room)`); `WorkerTask` and
`training` both use it. It must never be created at import time, since
prefork workers fork after import and would share its Redis connection. Consequences: only `events` needs
`-w 1`; `training` and `publishing` may run more gunicorn workers.

The frontend keeps one connection to `/socket.io` and joins rooms for
training ids and serving task ids exactly as now.

### Telemetry consumer

Owned by `analytics` (the only reader of `prediction`). It is started
with `gevent.spawn` (the process is monkey-patched under both
`python app.py` and gunicorn's gevent worker) instead of
`socketio.start_background_task`, which required the Socket.IO server.
Skipped when `'db' in sys.argv`.

### Inference

`POST /api/inference/<environment>/<model_id>`. The view resolves
`registry_for(environment)`; an unknown environment is a 404. Nothing
downstream changes: `claim()`, the `inputs:*` push, the `outputs:*`
wait, and the lazy launch of the serving task onto the `<environment>`
queue are as they are today.

The blueprint is environment-agnostic; isolation is a deployment
choice. Compose runs one `inference` container per environment
(`inference-api-testing`, `inference-api-production`, both
`create_app('inference')`), mirroring the serving workers, and nginx
routes `/api/inference/<environment>/` to the container of that
environment. The registries share the single `redis` service on a
one-host stack; `REDIS_URL_<ENV>` can point them at separate instances
when the environments need isolating. A
container could in principle answer another environment's request if
nginx were bypassed; a `SERVE_ENVIRONMENTS` guard is the follow-up if
that ever matters.

`Instance.to_dict()['endpoint']` becomes
`f"{PUBLIC_URL}/api/inference/{environment}/{model_id}"`. `PUBLIC_URL`
(default `http://localhost`) replaces `INFERENCE_HOST` and
`INFERENCE_HOST_<ENV>` and is the only absolute URL the backend emits.
API-key auth on the route is unchanged. `flask-cors` is added to
`requirements/base.txt`; `CORS` is applied to the inference blueprint
object only, with `origins='*'`, `methods=['POST', 'OPTIONS']`,
`allow_headers=['Authorization', 'Content-Type']`.

## Configuration

- One `Config` class. The `configs` map and `config_for()` are removed;
  `FLASK_ENV` is no longer read by the application.
- `ALLOWED_ENVIRONMENTS` remains the set of inference environments,
  each with its `redis_url`. The `server`/`triton` port entries and
  `host` are removed.
- `PORT` (default 5000) is the listen port for `python app.py`.
- `PUBLIC_URL` replaces `INFERENCE_HOST*`.
- `INFERENCE_WORKERS` replaces `TRITON_WORKERS`.
- Serving workers select their environment by queue (`-Q testing`)
  and read the registry for that environment; the `FLASK_ENV` they
  receive today is redundant and is dropped from compose.

## Database ownership

One database, one Alembic tree. Each blueprint owns the tables it
writes (table above); other blueprints import those models read-only.
Ownership is stated in a one-line comment at the top of each model
module (`# Owned by dataset. analytics reads only.`). `analytics` is
the only cross-cutting reader, and it is read-only; that is why a
database split is not worth its cost now, and the ownership map is the
seam to cut along if it ever is.

## Names

| Thing | Now | After |
|---|---|---|
| Celery app, training | `server.tasks:sage` | `server.tasks:training` |
| Celery app, serving | `server.tasks:triton` | `server.tasks:serving` |
| task modules | `tasks/training.py`, `tasks/inference.py` | `tasks/train.py`, `tasks/inference.py` — task names `server.tasks.train.train`, `server.tasks.inference.serve` (a module named `training` would collide with the app of that name, which Celery's `include` binds as a package attribute; `inference` has no such clash) |
| Celery node names | `sage@%h`, `triton-<env>@%h` | `training@%h`, `serving-<env>@%h` |
| serving task | `model` | `serve` |
| compose HTTP services | `api`, `triton-testing`, `triton-production` | `auth-api`, `dataset-api`, `training-api`, `publishing-api`, `analytics-api`, `inference-api-testing`, `inference-api-production`, `events-api` |
| compose Redis | `redis` | `redis` (broker, Socket.IO queue, registries) |
| compose one-shot | `migrate` | `migrate` (builds the Flask image, runs `flask db upgrade`) |
| compose workers | `worker`, `worker-testing`, `worker-production` | `training-worker` (builds the worker image), `serving-worker-testing`, `serving-worker-production` |
| compose others | `client`, `flower`, `redis`, `postgres` | unchanged |
| image tags | `indic-nlu-api`, `indic-nlu-worker`, `indic-nlu-client` | `api`, `worker`, `client` (each behind `${REGISTRY}`) |
| bake targets | `client`, `api`, `worker`, `worker-cuda` | unchanged names, new tags |

## Compose and nginx

- Published ports: `client` on `CLIENT_PORT` (default 80), `flower` on
  loopback. Nothing else.
- Every HTTP service and worker `depends_on: migrate:
  service_completed_successfully` (plus healthy `redis`/`postgres`).
- `events-api` runs `-w 1`; `inference-api-<env>` run `-w ${INFERENCE_WORKERS:-2}`;
  the others default to `-w 1` with no constraint against raising it.
- `docker-compose.gpu.yml` overrides `training-worker`,
  `serving-worker-testing`, `serving-worker-production`.
- `flower` starts against `server.tasks:training`.
- `docker/Dockerfile.api` exposes 5000 and defaults its `CMD` to
  `app:create_app()`.

`nginx.conf`:

- One `location /api/<name>/` per blueprint, each `proxy_pass` to
  `http://<name>-api:5000` through a `set $upstream` variable so nginx
  starts and stays up regardless of service state.
- `/socket.io/` → `events-api`, with the upgrade headers and the long read
  timeout.
- `/api/dataset/` keeps `proxy_read_timeout 300s` (import/export).
- `/api/inference/testing/` → `inference-api-testing`,
  `/api/inference/production/` → `inference-api-production`, each with a
  read timeout that covers `INFERENCE_BATCH_TIMEOUT` plus margin; bare
  `/api/inference/` → 404.
- `/socket.io/` restates every forwarded header including
  `X-Forwarded-Proto` (a location that sets any `proxy_set_header`
  inherits none).
- `/api/` with no matching prefix → 404 from nginx.
- `/assets/` caching and the SPA fallback are unchanged.

## Frontend

- `src/api/*.js`: change the literal `/api/…` base in each module —
  `users.js`, `tokens.js` → `/api/auth`; `models.js`, `intents.js`,
  `entities.js`, `slots.js`, `values.js`, `utterances.js`, `tags.js`,
  `dataset.js` → `/api/dataset`; `trainings.js` → `/api/training`;
  `instances.js` → `/api/publishing`; `analytics.js` →
  `/api/analytics`. `inference.js` already uses the absolute
  `endpoint` from the instance record and is untouched.
- `SocketContext` keeps connecting to `/socket.io`.
- `vite.config.js` proxies `/api` and `/socket.io` to
  `http://localhost:${PORT || 5000}`; the `FLASK_ENV=production npm run
  dev` variant goes away with the environment ports.

## Removed

- `server/views/` (moved), `server/database.py` (dead module shadowed
  by the `database/` package).
- (Reversed after implementation, see "Long-running requests".) The
  async-dispatch feature was first removed as unreachable, then restored
  and wired up at the owner's request.
- `/api/stats`, `request_stats`, `add_request`, `requests_per_second`
  and `REQUEST_STATS_WINDOW` (per-process counter, no callers).
- The `_link` / `_links` dicts in the models' `to_dict()`: they call
  `url_for` on endpoints that now live in other processes, and nothing
  in `src/` reads them.
- The hand-written CORS `after_request` on the inference blueprint.
- `create_application_server`, `create_triton_server`, `config_for`,
  the `configs` map, `INFERENCE_HOST*`, `TRITON_WORKERS`, `FLASK_ENV`
  handling, per-environment ports.

## Documentation

`CLAUDE.md`, `README.md`, `.env.example`, and the compose header are
rewritten in the new vocabulary. The "Architecture: two planes" section
becomes "Blueprints", listing the table above and the two invariants
that still matter: `events` is the single Socket.IO server, and
`inference` never imports SQLAlchemy.

## Out of scope

SQLAlchemy model internals, the registry/serving handshake and its
invariants, the ML code, the `storage` package, anything in `src/`
other than API base paths and the Vite proxy.

## Verification

1. `python -m py_compile` over `server/**/*.py` and `app.py`.
2. `npm run build`.
3. `docker compose config`, `docker compose -f docker-compose.yml -f
   docker-compose.gpu.yml config`, and
   `docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all`.
4. `docker compose up -d --build`, then a scripted smoke test through
   nginx on `http://localhost/`: `POST /api/auth/tokens` (sign in),
   `POST /api/dataset/models`, `GET /api/dataset/models/<id>/intents`,
   `GET /api/training/models/<id>/trainings`,
   `GET /api/publishing/models/<id>/instances`,
   `GET /api/analytics/models/<id>/dataset`,
   `POST /api/inference/testing/<unknown>` → 404 from the inference
   service (not nginx), `POST /api/inference/nowhere/<id>` → 404, and a
   Socket.IO connect through `/socket.io/`.
5. Manual UI check by the owner.

## Long-running requests (added after implementation)

`apply_async` in `server/blueprints/__init__.py` turns a view into a
202-then-fetch call: the WSGI environ (with the body as bytes and the
blueprint name) is sent to `server.tasks.request.dispatch` on the
`default` queue of the `api` Celery app; the worker rebuilds that one
blueprint with `create_app(name, init=False)`, replays the request with
`g.sync = False`, and stores `(body, status, headers)`. Each blueprint that
uses it registers `GET /status/<taskId>` (`register_status_route`). The
`api` app's result backend is `REQUEST_RESULT_BACKEND` (Redis db 1) with
`REQUEST_RESULT_TTL`; training/serving stay on `TASK_RESULT_BACKEND`
(renamed from `CELERY_RESULT_BACKEND`, which Celery would otherwise apply
to every app from the environment). `RequestTask` pushes `status` to the
task-id Socket.IO room without the payload; the frontend client waits on
that event (slow poll as fallback) and fetches `Location` with the caller's
`responseType`. Compose service: `request-worker` from the api image.
Decorated: dataset import/export, tag import/export, analytics dashboards,
training data download, and cascading deletes (model, intent, entity).
Every decorated call is dispatched; there is no size predicate. The `api` worker reuses child processes
(`REQUEST_MAX_TASKS_PER_CHILD`), unlike the TensorFlow workers.
