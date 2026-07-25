# Development Guide

Welcome to the **Trusty Track** development guide! This document provides instructions on how to set up your environment, run the application locally, and execute tests.

## 🏗️ Project Overview

Trusty Track is a race management application built with:

- **Backend:** Python (FastAPI, SQLAlchemy, SQLite)
- **Frontend:** TypeScript (React, Vite, MUI/Tailwind)

## 📋 Prerequisites

Ensure you have the following installed:

- **Python 3.10+**
- **Node.js 18+** & **npm**
- **Git**

## 🔙 Backend Development

The backend is located in the `backend/` directory.

### 1. Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install .
```

### 2. Running the Server

Start the development server with live reload:

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8005`.
Interactive API docs are at `http://localhost:8005/docs`.

### 3. Running Tests

Run the backend test suite using `pytest`:

```bash
# Run all tests
pytest

# Run tests with output
pytest -s

# Run a specific test file
pytest test_main.py
```

### 4. Database

The application uses **SQLite**. The database file `trusty-track.db` is created in the data directory (`~/.trustytrack` by default, override with `TRUSTYTRACK_DATA_DIR`) on first run.

#### Migrations

Schema changes are managed with **Alembic**. `init_db()` runs `alembic upgrade head` on startup, so a running app always has an up-to-date schema. If migrations fail, startup fails — a half-migrated database that appears to start normally is worse than a clear error.

**After changing anything in `models.py`, generate a migration:**

```bash
uv run alembic revision --autogenerate -m "describe the change"
```

Review the generated file before committing — autogenerate is a good first draft, not a finished migration. Then verify there is no remaining drift:

```bash
uv run alembic check
```

`backend/tests/test_migrations.py::test_migrations_reproduce_the_models` runs that same check in CI, so a model change without a matching migration fails the build.

Other useful commands:

```bash
uv run alembic current
```

```bash
uv run alembic history
```

```bash
uv run alembic downgrade -1
```

**Databases created before Alembic was adopted** are detected on startup (application tables present, no `alembic_version` table), stamped at `0001_baseline`, and then upgraded forward. Migration `0002` checks whether `groups.debug_mode` already exists before adding it, because the old hand-rolled `ALTER TABLE` may or may not have succeeded on any given install.

## 🎨 Frontend Development

The frontend is located in the `frontend/` directory.

### 1. Setup

```bash
cd frontend
npm install
```

### 2. Running the UI

Start the Vite development server:

```bash
npm run dev
```

The application will be accessible at `http://localhost:5173`.

### 3. Running Tests

Run the frontend unit tests using `vitest`:

```bash
npm test
```

### 4. Linting

Check for code style issues:

```bash
npm run lint
```

## 🚀 Running the Full Stack

### Option 1: Convenience Scripts (Recommended for Production/Stand-alone)

To install and run the application as a single process:

```bash
# Install everything (prerequisites: Python 3.10+, Node.js 18+)
./scripts/install.sh

# Start the server (serves both backend and frontend on port 8005)
./scripts/serve.sh
```

### Option 2: Convenience Script (Recommended for Development)

You can start both the backend and frontend simultaneously with live reload using:

```bash
./scripts/run_dev.sh
```

### Option 3: Manual Start (Development)

To run the full application manually, you need two terminal windows:

**Terminal 1 (Backend):**

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

**Terminal 2 (Frontend):**

```bash
cd frontend
npm run dev
```

## 🐛 Troubleshooting

| Issue                     | Solution                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Port 8005/5173 in use** | Stop other running processes or allow the tools to pick the next available port (check console output).                                        |
| **CORS Errors**           | The backend is configured to allow `*` origins in development. Ensure you are accessing the frontend via `localhost` matching the CORS config. |
| **Database Locks**        | SQLite can occasionally lock if a process crashes. Restart the backend server.                                                                 |
| **Missing Dependencies**  | Re-run `pip install .` (backend) or `npm install` (frontend).                                                                |

## 📸 Regenerating Documentation Screenshots

The screenshots in `docs/assets/screenshots/` are generated automatically via a Playwright test that walks through the full UI flow.

### Prerequisites

Playwright's Chromium browser must be installed:

```bash
cd frontend
npx playwright install chromium
```

### Running

```bash
cd frontend
npx playwright test --config playwright.screenshots.config.ts
```

This will:
1. Start a fresh backend on port 8001 with an isolated, empty database (`/tmp/trusty-track-screenshots`)
2. Start a fresh frontend dev server on port 5175 pointing at that backend
3. Walk through the UI (create a race, add dens, import test data, etc.) and capture screenshots
4. Write the updated PNGs to `docs/assets/screenshots/`

Every run is clean — the test data directory is wiped before the backend starts, so screenshots always reflect a fresh install.

## 📁 Directory Structure

- `backend/` - API, database models, business logic.
- `frontend/` - React application, components, pages.
- `docs/` - Documentation files.
- `scripts/` - Utility scripts.
