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
written, and the list can only shrink. It is down to one module,
`backend.api.schema`; everything else, including all of `backend/domain/`
(held to `disallow_untyped_defs`), is checked.

### 5. Database

The application uses **SQLite**. The database file `trusty-track.db` is created in the data directory (`~/.trustytrack` by default, override with `TRUSTYTRACK_DATA_DIR`) on first run.

#### Migrations

Schema changes are managed with **Alembic**. `init_db()` runs `alembic upgrade head` on startup, so a running app always has an up-to-date schema. If migrations fail, startup fails — a half-migrated database that appears to start normally is worse than a clear error.

**Run Alembic through `./scripts/migrate.sh`, not `uv run alembic` directly.** The bare CLI opens whatever `TRUSTYTRACK_DATA_DIR` resolves to, which is `~/.trustytrack` for anyone who has not set it — your own real install, if this machine has ever run the app, complete with its database and every uploaded photograph. `scripts/migrate.sh` runs Alembic against a disposable scratch directory instead, migrated to head first so `--autogenerate` diffs against a realistic (if empty) schema.

**After changing anything in `models.py`, generate a migration:**

```bash
./scripts/migrate.sh revision --autogenerate -m "describe the change"
```

Review the generated file before committing — autogenerate is a good first draft, not a finished migration. Then apply it and verify there is no remaining drift:

```bash
./scripts/migrate.sh upgrade head
```

```bash
./scripts/migrate.sh check
```

`alembic check` compares the models against the **target database**, so it reports `Target database is not up to date` if you have not upgraded first.

`backend/tests/test_migrations.py::test_migrations_reproduce_the_models` runs that same check in CI, so a model change without a matching migration fails the build.

Other useful commands:

```bash
./scripts/migrate.sh current
```

```bash
./scripts/migrate.sh history
```

```bash
./scripts/migrate.sh downgrade -1
```

**If you run `uv run alembic` by hand anyway**, a backstop in `backend/migrations/env.py` refuses to touch the default `~/.trustytrack` once it already holds a configured race, unless `TRUSTYTRACK_DATA_DIR` is set explicitly or `TRUSTYTRACK_ALLOW_UNSAFE_MIGRATION=1` is — it never applies to the app's own startup migration, which keeps running against the real data directory regardless. See `CLAUDE.md`'s "Database migrations" section for the reasoning.

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

## 📚 Building the Docs and the Website

The user guide is MkDocs Material, and `mkdocs build --strict` gates CI — a
broken image path or a link to a missing page fails the build:

```bash
uv run --group docs mkdocs serve
```

```bash
uv run --group docs mkdocs build --strict
```

The guides are half of <https://trusty-track.com/>. The other half is the
landing page in `www/` — one HTML file and one stylesheet, no framework and no
build step of its own. `scripts/build_site.sh` puts them together the way
Cloudflare Pages does, with the landing page at the root and the documentation
under `/docs/`:

```bash
./scripts/build_site.sh
```

```bash
python3 -m http.server -d dist 8080
```

Serve the result rather than opening `dist/index.html` from the filesystem —
every link on the landing page is root-relative, so `file://` resolves them
against the disk root and none of them work.

The landing page links into the guides about fifteen times, and shows the logo
and four screenshots straight out of `docs/assets/`. `mkdocs --strict` does not
look at `www/`, so `backend/tests/test_landing_page_links.py` is what fails when
a renamed page leaves the front door on a 404. Deployment is written up in
[`deploy/cloudflare/README.md`](https://github.com/dknowles2/trusty-track/blob/main/deploy/cloudflare/README.md).

## 🐛 Troubleshooting

| Issue                     | Solution                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Port 8005/5173 in use** | Stop other running processes or allow the tools to pick the next available port (check console output).                                        |
| **CORS Errors**           | The backend is configured to allow `*` origins in development. Ensure you are accessing the frontend via `localhost` matching the CORS config. |
| **Database Locks**        | SQLite can occasionally lock if a process crashes. Restart the backend server.                                                                 |
| **Missing Dependencies**  | Re-run `uv sync` (backend) or `npm install` (frontend).                                                                |
| **`alembic` hits your real database** | Use `./scripts/migrate.sh` instead of `uv run alembic …` — it points Alembic at a scratch directory automatically. If you use the bare CLI anyway, it refuses on its own once your default database holds a configured race (#689); set `TRUSTYTRACK_DATA_DIR` or `TRUSTYTRACK_ALLOW_UNSAFE_MIGRATION=1` if you mean it. |

## 📸 Regenerating Documentation Screenshots

The screenshots in `docs/assets/screenshots/` are generated by Playwright specs
in `frontend/e2e/docs/`, each walking the real UI against a real backend:

| Spec | Covers |
| --- | --- |
| `screenshot-first-run.spec.ts` | The setup wizard and an empty Home page |
| `race-day.spec.ts` | Race setup and race day |
| `screenshot-observation.spec.ts` | The audience displays |
| `screenshot-race-stats.spec.ts` | The Stats page |
| `screenshot-awards.spec.ts` | Awards and the ceremony |
| `screenshot-balanced.spec.ts` | Balanced racing |
| `screenshot-bulk-upload.spec.ts` | Bulk photo upload |
| `screenshot-elimination.spec.ts` | Ladderless elimination |
| `screenshot-free-race.spec.ts` | Free race setup and results |
| `screenshot-printables.spec.ts` | Print sheets and the check-in scanner |
| `screenshot-settings.spec.ts` | System Settings and the activity log |
| `screenshot-slowest-race.spec.ts` | The slowest race bracket |
| `screenshot-timers.spec.ts` | Timer settings and the timer check page |

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

The specs run in parallel against one backend — as many at a time as your
machine has cores to spare — and the whole set takes about twenty seconds. One
of them runs on its own first, covering the things that belong to the whole
install rather than to a race: the setup wizard, which only exists before the
install is configured; the empty Home page; and the operator PIN, which while
it is set would stop every other spec's mutations.

Or one spec at a time:

```bash
cd frontend && npx playwright test --config=playwright.screenshots.config.ts e2e/docs/screenshot-printables.spec.ts
```

That first spec still runs, because the one you asked for needs a configured
install to photograph. It adds a few seconds.

This will:
1. Start a fresh backend with an isolated, empty database, on a port and a data
   directory derived from this checkout (see `frontend/e2e/environment.ts`), so
   two worktrees can run this at once
2. Start a fresh frontend dev server pointing at that backend
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
- `docs/` — the MkDocs site, served at `/docs/` on trusty-track.com.
- `www/` — the landing page at the root of trusty-track.com.
- `deploy/` — how the site and the old documentation address are published.
- `scripts/` — install, serve, dev, schema-export and site-build scripts.

## 📝 Keeping the Docs Current

Docs are part of the change, not a follow-up. When you land something:

| If you changed… | Update |
| --- | --- |
| A screen the guides describe | The relevant `docs/*.md`, and re-run its screenshot spec |
| The GraphQL schema or a REST endpoint | `docs/design.md` |
| Anything an agent needs to know | `CLAUDE.md`, or the file it indexes under `.claude/rules/` |

`mkdocs build --strict` catches broken links and missing images. It cannot
catch prose that is merely **wrong**, which is the failure that actually
happens — so check the page you invalidated.
