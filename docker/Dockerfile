# -----------------------------------------------------------------------------
# Stage 1: Build the React frontend
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV PATH="/app/node_modules/.bin:${PATH}"

# Copy package files first for better caching
COPY package*.json ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source
COPY vite.config.js .
COPY index.html .
COPY src/ ./src/
COPY public/ ./public/

# Build the React app
RUN npm run build


# -----------------------------------------------------------------------------
# Stage 2: Build the Python backend
#
# The default CMD runs every process under supervisord, so the image works as
# a single-container deployment on its own. docker-compose.yml builds this
# same stage and overrides `command` per service to run one process each.
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS main

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install OS packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor \
    build-essential \
    gcc \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create application user
RUN useradd -m -s /bin/bash appuser

# Install Python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY --chown=appuser:appuser server/ ./server/
COPY --chown=appuser:appuser migrations/ ./migrations/
COPY --chown=appuser:appuser app.py .
# server/utils/dataset.py reads the label palette from public/colors.txt
COPY --chown=appuser:appuser public/colors.txt ./public/colors.txt
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy frontend build
COPY --chown=appuser:appuser --from=build /app/dist ./dist

# Writable directories for the non-root user: logs (supervisord), the local
# storage provider's bucket (bind to a volume in compose; an empty named
# volume inherits this ownership) and the filesystem session store.
RUN mkdir -p /app/logs /app/data /app/instance /app/flask_session \
    && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

EXPOSE 5001 5002 5003 5004

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]


# -----------------------------------------------------------------------------
# Stage 3: Serve the frontend
#
# Static SPA behind nginx, proxying the control plane the way the Vite dev
# server does (vite.config.js). Only used by docker-compose.yml.
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS web

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
