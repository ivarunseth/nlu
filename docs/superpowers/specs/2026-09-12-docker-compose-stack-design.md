# Docker Compose stack

Run every service of the platform as its own container on a single host,
built from the one existing image in `docker/Dockerfile`. Compose is the
process manager; `supervisord.conf` stays as the image's default `CMD` so
the same image can also run as a single-container "combo" deployment.

## Services

All backend services build the same image, read `.env` through `env_file`,
and share the `data` volume at `/app/data` (the `local` storage provider
resolves `STORAGE_BUCKET` against the working directory).

| service | command | published port | environment |
|---|---|---|---|
| `redis` | `redis:7-alpine` | — | healthcheck `redis-cli ping` |
| `postgres` | `postgres:16-alpine` | — | healthcheck `pg_isready` |
| `migrate` | `flask db upgrade` | — | one-shot, runs after postgres is healthy |
| `api` | `python app.py` | 5001 | `FLASK_ENV=testing` (selects the port only) |
| `triton-testing` | `python app.py triton` | 5002 | `FLASK_ENV=testing` |
| `triton-production` | `python app.py triton` | 5004 | `FLASK_ENV=production` |
| `sage` | `celery -A server.tasks:sage worker -Q training -P prefork -c 1` | — | training queue |
| `worker-testing` | `celery -A server.tasks:triton worker -Q testing -P prefork` | — | serving, testing queue |
| `worker-production` | `celery -A server.tasks:triton worker -Q production -P prefork` | — | serving, production queue |
| `web` | nginx (`web` stage of the Dockerfile) | 80 | serves `dist/`, proxies `/api` and `/socket.io` to `api:5001` |

One control plane is enough: publishing selects the registry from the
instance's own environment and the telemetry consumer drains every
environment's queue. The data planes are per-environment because each one
serves the routes of exactly one registry.

## Configuration

Compose sets the host-specific values per service in `environment:`, which
overrides both `env_file` and `.env` (python-dotenv never overrides an
existing variable):

- `REDIS_HOST=redis`, `CELERY_BROKER_URL`, `SOCKETIO_MESSAGE_QUEUE`,
  `REDIS_URL_TESTING`, `REDIS_URL_PRODUCTION` → `redis://redis:6379/0`.
  The per-environment URLs must be set explicitly: `config.py` defaults them
  to `localhost`, so the shared-client fallback in `registry_for` never fires.
- `SQLALCHEMY_DATABASE_URI=postgresql://…@postgres:5432/…` and
  `CELERY_RESULT_BACKEND=db+postgresql://…`. Credentials come from
  `POSTGRES_USER/PASSWORD/DB` in `.env`, with defaults for a first boot.
- `FLASK_DEBUG=false` on every service: the reloader would double-start the
  servers inside a container.
- `INFERENCE_HOST` defaults to `http://localhost`; the browser calls the
  published 5002/5004 ports directly because deployment endpoints are
  absolute URLs. Set it to the host's public name on a real deployment.

`.env.example` documents the keys the compose stack reads.

## Image

- Adds a third stage `web`: `nginx:alpine` with `docker/nginx.conf` and the
  built `dist/`. The `main` stage keeps supervisor installed and
  `supervisord.conf` as the default `CMD`; that file runs the same six
  processes (with the same commands as the compose services) inside one
  container for a single-container deployment. Compose never uses it.
- Creates `/app/data` owned by `appuser` so the named volume is initialised
  writable, and copies sources with `--chown` so the session directory and
  logs are writable by the non-root user.
- `.dockerignore` keeps `node_modules`, `venv`, `.env`, `data/`, `instance/`
  and build output out of the context.

## Verification

`docker compose config` validates the file; `docker compose build` builds
both targets. The stack is exercised by hand with `docker compose up`.
