# Install Channel 2: Docker / Docker Compose

## Audience

Self-hosters and technically inclined users who are comfortable running a
terminal and have Docker installed. Typical scenarios:

- A pack admin who runs a home server or NAS.
- A developer who wants to run a stable instance without touching the source.
- Someone deploying to a cloud VM (VPS, Raspberry Pi 5, etc.).

**Goal:** `docker compose up` brings up the full application, persists data
between restarts, and survives a reboot.

---

## Prerequisite

Unified server mode (task `01_from_source.md §1.1`) must be implemented first
so the entire app runs in one container on one port.

---

## Engineering Tasks

### 2.1 — Multi-Stage `Dockerfile`

A single `Dockerfile` at the repo root using two build stages:

**Stage 1 — Frontend build (Node.js)**
- Base image: `node:20-slim`
- Copy `frontend/package*.json`, run `npm ci`.
- Copy `frontend/` source, run `npm run build`.
- Output: `frontend/dist/`

**Stage 2 — Runtime image (Python)**
- Base image: `python:3.11-slim`
- Copy `pyproject.toml`, run `pip install --no-cache-dir .`.
- Copy `backend/` source.
- Copy `frontend/dist/` from Stage 1 into the image.
- Set `WORKDIR /app/backend`.
- Expose port `8000`.
- `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`

**Key considerations:**
- Do not run as root. Create a non-root user (`trustytrack`) in the runtime
  stage and switch to it.
- The data directory (`~/.trustytrack` by default) should be overrideable via
  `TRUSTYTRACK_DATA_DIR`. In Docker this will typically be `/data`.
- Built image should be under 300 MB.

---

### 2.2 — `docker-compose.yml`

A Compose file for easy one-command startup.

```yaml
services:
  app:
    image: trustytrack/trustytrack:latest   # or build: .
    ports:
      - "8000:8000"
    volumes:
      - trustytrack_data:/data
    environment:
      - TRUSTYTRACK_DATA_DIR=/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  trustytrack_data:
```

The `build: .` alternative (instead of a pre-built image) lets users who
cloned the repo build locally without a registry.

---

### 2.3 — `.dockerignore`

Exclude from the build context:
- `backend/venv/`
- `frontend/node_modules/`
- `frontend/dist/` (will be built inside Docker)
- `*.db`, `certs/`, `.git/`, `docs/`, `tasks/`
- All test files and configs

---

### 2.4 — Container Registry Publishing

Publish images to GitHub Container Registry (`ghcr.io`) via the release
pipeline (task `05_release_pipeline.md`). Tag strategy:

| Git event | Docker tag |
|-----------|------------|
| Push to `main` | `ghcr.io/org/trustytrack:dev` |
| Tag `v1.2.3` | `ghcr.io/org/trustytrack:1.2.3`, `:1.2`, `:latest` |

---

### 2.5 — Reverse Proxy / HTTPS Notes

The container itself serves plain HTTP on port 8000. For HTTPS (required for
camera access in browsers), users have two options:

1. **Caddy or Traefik** as a reverse proxy with automatic Let's Encrypt certs
   (suitable for internet-facing installs).
2. **Self-signed certificate** — handled by the desktop/Pi setups; Docker
   users running on a LAN can use a self-signed cert with a custom entrypoint
   script that generates it on first boot.

Document both options. Do not bake TLS into the runtime image by default.

---

## User Documentation Required

- `docs/user/install-docker.md` — Step-by-step Docker Compose setup guide.
  - Prerequisites: Docker Desktop (Mac/Windows) or Docker Engine (Linux).
  - Copy-pasteable `docker-compose.yml`.
  - How to start, stop, update, and back up data.
  - How to access the app in the browser.
  - Troubleshooting: port conflicts, health check failures.

See `06_user_documentation.md` for details.

---

## Definition of Done

- [ ] `Dockerfile` builds successfully on macOS (arm64) and Linux (amd64).
- [ ] `docker compose up` starts the app; `docker compose down` stops it.
- [ ] Data persists in the named volume across `docker compose down/up` cycles.
- [ ] Container passes its own health check within 30 seconds of starting.
- [ ] Image size is under 300 MB.
- [ ] `.dockerignore` excludes dev artifacts.
- [ ] `docker-compose.yml` committed at the repo root.
