# Trusty Track — Agent Guide

Trusty Track is a race management system for Cub Scout Pinewood Derby events. It covers the full event lifecycle: racer registration, den/group management, check-in, heat scheduling, race execution, and standings display.

## Quick orientation

| Layer    | Tech                                            | Entry point            |
| -------- | ----------------------------------------------- | ---------------------- |
| Backend  | Python, FastAPI, SQLAlchemy, Strawberry GraphQL | `backend/main.py`      |
| Frontend | TypeScript, React 18, Vite, urql                | `frontend/src/App.tsx` |
| Database | SQLite, auto-created in `~/.trustytrack`        | `trusty-track.db`      |

The GraphQL endpoint at `/graphql` is the primary interface between frontend and backend. There is also a small REST endpoint (`POST /upload/`) for file uploads.

**Full Stack (Production/Single Process)**:

```bash
./scripts/install.sh   # Installs dependencies & builds frontend
./scripts/serve.sh     # Starts unified server on http://localhost:8005
```

**Development (Two processes)**:

- **Backend**: `cd backend && uvicorn main:app --reload`
- **Frontend**: `cd frontend && npm run dev`
- **One-command Dev**: `./scripts/run_dev.sh`

**Tests:**

```bash
cd backend && pytest          # backend unit/integration tests
cd frontend && npm test       # frontend unit tests (vitest)
```

---

## Project layout

```
backend/
  main.py           # FastAPI app, CORS, file upload REST endpoint, DB init
  models.py         # SQLAlchemy ORM models (all DB tables)
  schema.py         # Strawberry GraphQL schema — all queries and mutations
  crud.py           # DB helper functions called from schema.py resolvers
  scoring.py        # Leaderboard / scoring calculations
  schemas.py        # Pydantic input/response models
  database.py       # SQLAlchemy engine and session setup
  image_processing.py
  populate.py       # Generates test data (used via populateRace mutation)
  test_*.py         # pytest test files
  uploads/          # Uploaded racer/car photos stored here

frontend/src/
  App.tsx                     # React Router config, auth-gate for system init
  pages/
    Home.tsx                  # Race list, create race
    SystemSettings.tsx        # First-run wizard (group + track setup)
    RaceDetails.tsx           # Racer roster, den management, check-in (~60 KB, largest file)
    RaceControl.tsx           # Schedule management + race execution
    Observation.tsx           # Audience display screens
    Standings.tsx             # Final leaderboard
  components/
    race-control/
      ScheduleManagement.tsx
      RaceExecution.tsx
      RoundWizard.tsx
      FakeTimerMole.tsx
    DenManager.tsx
    RacerForm.tsx
    CheckInModal.tsx
    ImportRacersModal.tsx
    Leaderboard.tsx
    CameraCapture.tsx
    Navigation.tsx
  graphql/
    raceDetails.ts            # gql query/mutation strings (some queries also inline in pages)
  api/
    graphqlClient.ts          # urql client, proxies to http://127.0.0.1:8005/graphql
  context/
    AlertContext.tsx          # App-wide alert/toast system

docs/
  development.md              # Dev environment setup
  scheduling-algorithms.md    # PPC algorithm description
  fake-timer.md               # Fake timer documentation

tasks/                        # Planned future work (not yet implemented)
```

---

## Data model

```
Group           id, name
  └─ Race[]

Track           id, name, lane_count, length_feet, timer_type, serial_port
  └─ Race[]

Race            id, name, date_time, location, group_id, track_id,
                car_numbering_strategy, scoring_strategy, championship_trophies
  ├─ Den[]
  ├─ Racer[]
  ├─ Round[]
  ├─ Heat[]
  └─ RacingGroup[]

Den             id, race_id, name, color, rank,
                car_number_range_start, car_number_range_end
  └─ Racer[]

Racer           id, race_id, den_id (nullable), racing_group_id (nullable),
                first_name, last_name, car_number, car_name, car_weight,
                car_passed_inspection, racer_image_url, car_image_url

RacingGroup     id, race_id, den_id (nullable), name,
                car_number_range_start, car_number_range_end
  └─ Racer[]

Round           id, race_id, round_number, name, scheduling_strategy,
                advancement_source ("PACK"|"DEN"|null), advancement_num_racers
  └─ Heat[]

Heat            id, race_id, round_id, heat_number,
                lane_results (JSON string)
```

`lane_results` format (stored as JSON string in Heat.lane_results):

```json
[{"lane": 1, "racer_id": 10, "time": 3.452, "place": 2}, ...]
```

### Enums (defined in `backend/models.py`)

| Enum                   | Values                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| `CarNumberingStrategy` | `PER_GROUP`, `GLOBAL`, `MANUAL`                                              |
| `Rank`                 | `LION`, `TIGER`, `WOLF`, `BEAR`, `WEBELOS`, `ARROW_OF_LIGHT`, `OTHER`        |
| `SchedulingStrategy`   | `PPC` (Perfect-N rotation)                                                   |
| `ScoringStrategy`      | `TIMED` (avg time, lower=better), `POINTS` (sum of placements, lower=better) |
| `TimerType`            | `FAKE`, `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY`                           |

---

## GraphQL API

All queries and mutations are defined in `backend/schema.py`. The frontend calls them via urql (see `frontend/src/graphql/` and inline `gql` strings in page components).

### Queries

| Query                                | Description                                               |
| ------------------------------------ | --------------------------------------------------------- |
| `races(skip, limit)`                 | List all races                                            |
| `race(raceId)`                       | Full race with nested dens, racers, rounds, heats         |
| `racers(raceId?, skip, limit)`       | Racer list, optionally filtered by race                   |
| `racer(racerId)`                     | Single racer                                              |
| `tracks()`                           | All track configurations                                  |
| `groups()`                           | All organizations                                         |
| `initialConfig()`                    | Whether system has been configured (used by router guard) |
| `rounds(raceId)`                     | Rounds for a race                                         |
| `advancementStatus(raceId, roundId)` | Whether round has enough results to advance               |

### Mutations

**Race:**
`createRace`, `updateRace`, `deleteRace`

**Racer:**
`createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`

**Bulk racer ops:**
`bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToDen`, `bulkDeleteRacers`

**Den:**
`createDen`, `updateDen`, `deleteDen`

**Track:**
`createTrack`, `updateTrack`, `deleteTrack`

**Round/Heat:**
`createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `advanceRound`,
`updateHeatResult`, `reorderHeats`

**System:**
`createInitialConfig`, `updateInitialConfig`

**Data:**
`importRacers` (CSV), `uploadImage` (base64 → stores file → returns URL), `populateRace` (test data)

### Adding a new mutation

1. Add resolver method to `Query` or `Mutation` class in `backend/schema.py`
2. Decorator: `@strawberry.mutation` (or `@strawberry.field` for queries)
3. DB session from: `db: Session = info.context["db"]`
4. Call `crud.py` helpers; add new helpers there for non-trivial DB work
5. Add corresponding `gql` string in `frontend/src/graphql/` or inline in the relevant page
6. Call with `useMutation` from urql

---

## Key patterns and conventions

### Backend

- **GraphQL context**: every resolver receives `info: Info`; get the DB session with `db = info.context["db"]`.
- **Pydantic schemas** (`schemas.py`) are for input validation and REST responses. GraphQL types are Strawberry types defined directly in `schema.py`.
- **Cascade deletes**: deleting a `Race` cascades to its `Den`, `Round`, `Heat` records. Deleting a `Round` cascades to its `Heat` records.
- **Scoring** is always computed on-demand in `scoring.py`; there is no cached/stored leaderboard column.
- **Unified Server**: The backend serves `frontend/dist` static files and uses a catch-all route for SPA fallback. Health check is at `/health`.
- **Data Directory**: Default storage is `~/.trustytrack`. Override with `TRUSTYTRACK_DATA_DIR` env var.
- **Images**: The frontend sends base64-encoded image data to `uploadImage` mutation or `POST /upload/`. Files land in the `uploads/` subdirectory of the data dir. URLs of the form `/static/<filename>` are stored in `racer_image_url` / `car_image_url`.

### Frontend

- **urql request policy**: mutations trigger a re-fetch using `'network-only'` to ensure fresh data.
- **Alert system**: use the `useAlert()` hook (from `AlertContext`) to show success/error toasts — do not use `window.alert`.
- **GraphQL strings**: prefer adding queries/mutations to `frontend/src/graphql/raceDetails.ts` rather than inlining large `gql` blocks inside components.
- **Styling**: CSS custom properties for theme colors — `var(--scouting-blue)` (#003F87), `var(--gold)` (#FCD116). Use the existing CSS class naming style (e.g., `.race-details`, `.racer-table`). Standard border-radius is 12px.
- **Drag-and-drop**: heat reordering uses `@dnd-kit`. See `ScheduleManagement.tsx` for the pattern.

---

## Business logic highlights

### Heat scheduling (PPC / Perfect-N)

Described in `docs/scheduling-algorithms.md`. Each racer races in every lane exactly once per round. The algorithm generates the minimum number of heats to satisfy this. Logic lives in `backend/crud.py` (heat generation functions).

### Scoring strategies

Defined in `backend/scoring.py`:

- **TIMED**: average of all heat times. Racers with no recorded time are ranked last.
- **POINTS**: sum of placement values across heats (1st = 1 point). Lower total = better rank.

`get_leaderboard(db, race_id)` returns a sorted list of `(racer, score)` tuples.

### Championship advancement

`advanceRound` mutation and `get_advancing_racers()` in `scoring.py`:

- `advancement_source = "PACK"`: top N racers overall advance.
- `advancement_source = "DEN"`: top N racers from _each_ den advance.

### Car numbering strategies

- `PER_GROUP`: each den has a number range (e.g., 100–199); `bulkAutoNumber` fills within the range.
- `GLOBAL`: sequential across all racers from a configurable start.
- `MANUAL`: user assigns numbers individually; auto-number is disabled.

### System initialization gate

`App.tsx` calls `initialConfig()` on load. If no config exists, all routes redirect to `/system-settings`. This is the first-run wizard that creates the `Group` and `Track` records.

---

## Common task guidance

**Add a new field to an existing model:**

1. Add column to the SQLAlchemy model in `backend/models.py`
2. Add field to the Strawberry type and/or Pydantic schema in `backend/schema.py` / `backend/schemas.py`
3. Update relevant `create`/`update` mutations in `backend/schema.py` and CRUD helpers in `backend/crud.py`
4. Update the GraphQL fragment/query in `frontend/src/graphql/raceDetails.ts` or the relevant page
5. Update the UI component to display/edit the new field

**Add a new page:**

1. Create component in `frontend/src/pages/`
2. Add route in `frontend/src/App.tsx`
3. Add navigation link in `frontend/src/components/Navigation.tsx` if appropriate

**Add a new backend test:**

- Follow the pattern in `backend/test_*.py`
- Tests use a fresh in-memory SQLite database per test (see conftest / setup in existing test files)
- Use the FastAPI `TestClient` for HTTP/GraphQL requests

**Working with heat results:**

- `Heat.lane_results` is stored as a JSON string — parse with `json.loads()` / serialize with `json.dumps()`
- The `updateHeatResult` mutation accepts the full lane results array and overwrites the field

---

## Not yet implemented (see `tasks/`)

The `tasks/` directory contains implementation plans for features that do not exist yet:

- **Observation subscriptions** (`tasks/observation/`) — real-time WebSocket updates; currently the observation page polls or uses static data
- **Printables** (`tasks/printables/`) — QR codes, pit passes, driver's licenses
- **Free racing** (`tasks/free-race/`) — casual practice heats outside the main competition
- **Timer integration** (`tasks/timers/`) — DerbyNet serial protocol for hardware timers
- **Installation packaging** (`tasks/install/`) — Raspberry Pi, Docker, desktop app distribution (from source is complete)

Do not assume these features exist when modifying related code.
