# Stage 1 — Build the React frontend
#
# Pinned to the *build* platform, not the target. The output is JavaScript and
# is identical either way, so building it under QEMU for the arm64 image would
# emulate `npm ci` and a Vite build for nothing.
#
# The version here is the one copy of the Node version that `.nvmrc` cannot
# supply — a `FROM` line is resolved before any file is available to read.
# Keep the two in step.
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# Stage 2 — Runtime image
FROM python:3.12-slim AS runtime

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Create a non-root user
RUN useradd --system --create-home --home-dir /home/trustytrack --shell /usr/sbin/nologin trustytrack

WORKDIR /app

# Install Python dependencies using uv
COPY pyproject.toml ./
COPY backend/ ./backend/
RUN uv pip install --system --no-cache .

# Copy the built frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Data directory — override with TRUSTYTRACK_DATA_DIR.
#
# Created here, owned by the user the container runs as. Without it the app
# cannot start: `database.py` does `os.makedirs(DATA_DIR)` at import time, and a
# non-root process cannot create a directory at the filesystem root. Mounting a
# named volume does not save it either — Docker creates a mount point absent
# from the image as root, and only copies ownership from a directory that is
# already there.
ENV TRUSTYTRACK_DATA_DIR=/data
ENV PYTHONPATH=/app

RUN mkdir -p /data && chown trustytrack:trustytrack /data
VOLUME ["/data"]

# Expose the application port. Documentary only — `EXPOSE` publishes nothing on
# its own, and the port actually listened on is `$PORT` below.
EXPOSE 8000

# Switch to non-root user
USER trustytrack

# Shell form, so `$PORT` is expanded at run time.
#
# Cloud Run and Railway tell a container which port to listen on by setting
# `PORT`, and a container that ignores it is marked unhealthy and killed. The
# default keeps every documented `docker run -p 8000:8000` working unchanged.
#
# `exec` matters: without it `sh` stays PID 1, uvicorn is its child, and the
# SIGTERM a platform sends to stop the container never reaches the server — so
# every shutdown is a ten-second wait and then a kill.
CMD ["sh", "-c", "exec uvicorn backend.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
