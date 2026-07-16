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

# Create logs directory
RUN mkdir -p /app/logs && chown -R appuser:appuser /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY server/ ./server/
COPY migrations/ ./migrations/
COPY app.py .
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy frontend build
COPY --from=build /app/dist ./dist

# Switch to non-root user
USER appuser

EXPOSE 5001 5002 5003 5004 5005 5006

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]