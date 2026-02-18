# Install Channel 1: From Source (Developer) [DONE]

## Audience

Developers and technically advanced users who are comfortable with Git,
Python virtual environments, and Node.js. This is already largely supported
today; this task closes the remaining gaps.

---

## Current State

The README and `docs/development.md` describe a two-terminal dev workflow
(separate backend and frontend processes). This is appropriate for development
but not ideal as an end-user install story.

---

## Engineering Tasks

### 1.1 — Unified Server Mode

Allow the FastAPI backend to serve the compiled frontend, so a single process
is all that runs in production.

**Backend changes (`backend/main.py`):**

```python
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

# Mount static assets if the built frontend exists
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Serve index.html for all unknown paths (React Router)."""
        index = FRONTEND_DIST / "index.html"
        return FileResponse(index)
```

The `/graphql` and other API routes must be registered **before** the
catch-all SPA route.

**Frontend changes (`frontend/vite.config.ts`):**

The Vite dev proxy already points the frontend at the backend. No changes
needed — `npm run build` produces `frontend/dist/` which the backend will
serve.

**Acceptance criteria:**

- `npm run build` in `frontend/` produces `frontend/dist/`.
- Running `uvicorn main:app` from `backend/` serves the full app on
  a single port.
- React Router paths (e.g. `/race/1`) still load correctly (served via
  `index.html` fallback).
- The Vite dev server (`npm run dev`) continues to work unchanged.

---

### 1.2 — Configurable Data Directory

Move the SQLite database file and uploaded images out of the source tree into
a configurable location.

**Environment variables:**

| Variable               | Default                                | Description                 |
| ---------------------- | -------------------------------------- | --------------------------- |
| `TRUSTYTRACK_DATA_DIR` | `~/.trustytrack`                       | Root for DB and uploads     |
| `TRUSTYTRACK_DB_URL`   | `sqlite:///<data_dir>/trusty-track.db` | Full DB URL (overrides dir) |

**Backend changes:**

- `backend/database.py`: Read `TRUSTYTRACK_DATA_DIR` / `TRUSTYTRACK_DB_URL`
  from environment, create the directory if missing.
- `backend/main.py`: Point the static file upload directory at
  `<data_dir>/uploads/` instead of the hardcoded `backend/backend/` path.

**Acceptance criteria:**

- Fresh `git clone` + `uvicorn main:app` stores data in `~/.trustytrack/`.
- `TRUSTYTRACK_DATA_DIR=/tmp/test uvicorn main:app` stores data in `/tmp/test/`.
- Existing tests still pass (conftest.py should use a temp directory).

---

### 1.3 — Health Check Endpoint

Add `GET /health` to the FastAPI app.

```python
@app.get("/health")
async def health():
    return {"status": "ok"}
```

Used by Docker, systemd, and the desktop launcher to poll readiness.

---

### 1.4 — Convenience Install Script (`scripts/install.sh`)

A shell script that automates the from-source install on macOS/Linux.

```
scripts/install.sh
```

Steps performed by the script:

1. Check for Python ≥ 3.10 and Node.js ≥ 18; print friendly errors if missing.
2. Create `backend/venv/` and install Python dependencies.
3. Run `npm ci` in `frontend/`.
4. Run `npm run build` in `frontend/`.
5. Print a success message and the command to start the server.

The script does **not** daemonize or install a system service — that is
left to the user.

---

### 1.5 — Convenience Run Script (`scripts/serve.sh`)

A script to start the production (unified) server in the foreground.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source backend/venv/bin/activate
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

---

## User Documentation Required

- `docs/user/install-from-source.md` — Step-by-step guide for developers.
  Covers prerequisites, cloning, building, running, and accessing the app.
- Update `README.md` to link to all install methods.

See `06_user_documentation.md` for details.

---

## Definition of Done

- [x] Unified server mode implemented and tested.
- [x] Data directory is configurable via environment variable.
- [x] `GET /health` endpoint exists.
- [x] `scripts/install.sh` works on macOS (Homebrew Python + Node) and
      Ubuntu/Debian.
- [x] `scripts/serve.sh` starts the full app with a single command.
- [x] `docs/development.md` updated to reflect new scripts.
