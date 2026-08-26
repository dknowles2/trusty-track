# Development Guide

Welcome to the **Trusty Track** development guide! This document provides instructions on how to set up your environment, run the application locally, and execute tests.

## 🏗️ Project Overview

Trusty Track is a race management application built with:

- **Backend:** Python (FastAPI, Strawberry GraphQL, SQLAlchemy, SQLite, Alembic)
- **Frontend:** TypeScript (React 19, Vite, urql + graphcache). Plain CSS with
  custom properties — no component or utility framework.

It is designed to run as a **single process on a machine at the venue**, often a
Raspberry Pi, serving one operator and a few read-only display screens over the
local network.

## 📋 Prerequisites

Ensure you have the following installed:

- **Python 3.10+** — 3.10 is the floor (Debian's system interpreter on a Pi);
  3.12 is what the installers and release builds pin. CI tests both.
- **Node.js 22+** & **npm** — 22 is the floor; `.nvmrc` holds the version
  CI, the Docker image and the Pi installer all use.
- **[uv](https://docs.astral.sh/uv/)** — the Python toolchain used throughout.
- **Git**

## 🔙 Backend Development

The backend lives in `backend/`, but the Python project is rooted at the **repo
root** — `pyproject.toml`, the virtualenv, and every `uv run` command are run
from there, not from inside `backend/`.

### 1. Setup

```bash
uv sync
```

### 2. Running the Server

Start the development server with live reload:

```bash
uv run uvicorn backend.api.main:app --reload --port 8005
```

The API will be available at `http://localhost:8005`.
GraphQL is at `/graphql`; interactive REST docs are at `/docs`.

### 3. Running Tests

```bash
uv run pytest
```

```bash
# One file, verbose
uv run pytest backend/tests/test_scoring_scope.py -v
```

```bash
# One test
uv run pytest backend/tests/test_scoring_scope.py -k leaderboard
```

The suite runs one worker per core, which takes it from about a minute and a
half to under half a minute. Turn that off when you are debugging a failure —
output arrives in order again, and `pdb` works:

```bash
uv run pytest -n0 backend/tests/test_scoring_scope.py
```

### 4. Linting and Types

Both gate CI over the whole tree, so run them before pushing:

```bash
uv run ruff check .
```

```bash
uv run ruff format --check .
```

```bash
uv run mypy backend
```

`mypy` is configured with an **exemption list** in `pyproject.toml` rather than
a list of modules to check — a new module is covered from the day it is
written, and the list can only shrink. Three modules are exempt; everything
else, including all of `backend/domain/` (held to `disallow_untyped_defs`), is
checked.

### 5. Database

The application uses **SQLite**. The database file `trusty-track.db` is created in the data directory (`~/.trustytrack` by default, override with `TRUSTYTRACK_DATA_DIR`) on first run.

#### Migrations

Schema changes are managed with **Alembic**. `init_db()` runs `alembic upgrade head` on startup, so a running app always has an up-to-date schema. If migrations fail, startup fails — a half-migrated database that appears to start normally is worse than a clear error.

**After changing anything in `models.py`, generate a migration:**

```bash
uv run alembic revision --autogenerate -m "describe the change"
```

Review the generated file before committing — autogenerate is a good first draft, not a finished migration. Then apply it and verify there is no remaining drift:

```bash
uv run alembic upgrade head
```

```bash
uv run alembic check
```

`alembic check` compares the models against the **target database**, so it reports `Target database is not up to date` if you have not upgraded first.

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
npm test -- --run
```

### 4. Linting and Types

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

### 5. End-to-End Tests

A real backend and a real browser, on their own ports and their own database:

```bash
cd frontend && npm run test:e2e
```

The first run needs Playwright's browser:

```bash
cd frontend && npx playwright install chromium
```

These are deliberately few and broad — they exist to catch the failures the
unit suites cannot, where the served page, the GraphQL round trip and the
normalized cache have to work together. Anything worth asserting in detail
belongs in a component test.

### 6. Generated GraphQL Types

`frontend/schema.graphql` and `frontend/src/gql/` are **generated** from the
live Strawberry schema — never edit them by hand. After any backend schema
change:

```bash
npm run codegen
```

CI fails if the committed output is stale (`npm run codegen:check`), so a
backend schema change cannot silently drift from the frontend's types.

## 🚀 Running the Full Stack

### Option 1: Convenience Scripts (Recommended for Production/Stand-alone)

To install and run the application as a single process:

```bash
# Install everything (prerequisites: Python 3.10+, Node.js 22+)
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
uv run uvicorn backend.api.main:app --reload --port 8005
```

**Terminal 2 (Frontend):**

```bash
cd frontend && npm run dev
```

The Vite dev server proxies `/api/*` to the backend **with the `/api` prefix
stripped**, so an endpoint that only exists at `/api/…` works in production and
404s in development. Register both forms, as `/graphql` and the printables
barcode do.

## ✅ Pre-commit Hooks

`pre-commit` runs Ruff, pytest, ESLint, Vitest and a frontend build on every
commit:

```bash
uv run pre-commit install
```

## 📚 Building the Docs

The user guide is MkDocs Material, and `mkdocs build --strict` gates CI — a
broken image path or a link to a missing page fails the build:

```bash
uv run --group docs mkdocs serve
```

```bash
uv run --group docs mkdocs build --strict
```

## 🐛 Troubleshooting

| Issue                     | Solution                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Port 8005/5173 in use** | Stop other running processes or allow the tools to pick the next available port (check console output).                                        |
| **CORS Errors**           | The backend is configured to allow `*` origins in development. Ensure you are accessing the frontend via `localhost` matching the CORS config. |
| **Database Locks**        | SQLite can occasionally lock if a process crashes. Restart the backend server.                                                                 |
| **Missing Dependencies**  | Re-run `uv sync` (backend) or `npm install` (frontend).                                                                |
| **`alembic` hits your real database** | `uv run alembic …` uses `~/.trustytrack` unless you set `TRUSTYTRACK_DATA_DIR`. Point it at a scratch directory when generating or testing migrations. |

## 📸 Regenerating Documentation Screenshots

The screenshots in `docs/assets/screenshots/` are generated by Playwright specs
in `frontend/e2e/docs/`, each walking the real UI against a real backend:

| Spec | Covers |
| --- | --- |
| `screenshots.spec.ts` | Getting started, race setup, race day |
| `screenshot-bulk-upload.spec.ts` | Bulk photo upload |
| `screenshot-printables.spec.ts` | Print sheets and the check-in scanner |
| `screenshot-free-race.spec.ts` | Free race setup and results |

**If a screen you changed appears in one of these, re-run it and commit the new
PNGs** — a stale screenshot is a documentation bug that no build catches.

### Prerequisites

Playwright's Chromium browser must be installed:

```bash
cd frontend
npx playwright install chromium
```

### Running

```bash
cd frontend && npx playwright test --config playwright.screenshots.config.ts
```

Or one spec at a time:

```bash
cd frontend && npx playwright test --config=playwright.screenshots.config.ts e2e/docs/screenshot-printables.spec.ts
```

This will:
1. Start a fresh backend on port 8001 with an isolated, empty database (`/tmp/trusty-track-screenshots`)
2. Start a fresh frontend dev server on port 5175 pointing at that backend
3. Walk through the UI (create a race, add dens, import test data, etc.) and capture screenshots
4. Write the updated PNGs to `docs/assets/screenshots/`

Every run is clean — the test data directory is wiped before the backend starts, so screenshots always reflect a fresh install.

## 📁 Directory Structure

- `backend/api/` — FastAPI app, Strawberry GraphQL schema, per-operation loaders.
- `backend/db/` — SQLAlchemy models, CRUD helpers, Alembic-backed init.
- `backend/domain/` — pure rules: scheduling, scoring, advancement, lanes,
  printables. No SQLAlchemy, no Strawberry, and typed strictly.
- `backend/services/` — scoring and stats wired to the database, timer devices.
- `backend/migrations/` — Alembic environment and versions.
- `frontend/src/features/<area>/` — one slice per area, each with its own
  `pages/`, `components/`, and `graphql/queries.ts`.
- `docs/` — the MkDocs site. `docs/tasks/` holds implementation plans, most of
  them already built and kept as design notes.
- `scripts/` — install, serve, dev, and schema-export scripts.

## 📝 Keeping the Docs Current

Docs are part of the change, not a follow-up. When you land something:

| If you changed… | Update |
| --- | --- |
| A screen the guides describe | The relevant `docs/*.md`, and re-run its screenshot spec |
| The GraphQL schema or a REST endpoint | `docs/design.md` |
| Behaviour a plan file describes | That `docs/tasks/**` file's header — mark it, or record the departure |
| Anything an agent needs to know | `CLAUDE.md` |

`mkdocs build --strict` catches broken links and missing images. It cannot
catch prose that is merely **wrong**, which is the failure that actually
happens — so check the page you invalidated.
