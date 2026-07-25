# Trusty Track — Agent Guide

Trusty Track is a race management system for Cub Scout Pinewood Derby events. It covers the full event lifecycle: racer registration, den/group management, check-in, heat scheduling, race execution, hardware timer integration, audience displays, and standings.

It is designed to run as a **single process on a machine at the venue** (often a Raspberry Pi), serving one operator plus a few read-only display screens over the local network.

## Quick orientation

| Layer    | Tech                                            | Entry point            |
| -------- | ----------------------------------------------- | ---------------------- |
| Backend  | Python, FastAPI, SQLAlchemy, Strawberry GraphQL | `backend/api/main.py`  |
| Frontend | TypeScript, React 19, Vite, urql                | `frontend/src/App.tsx` |
| Database | SQLite in `~/.trustytrack`, Alembic migrations  | `trusty-track.db`      |

`/graphql` is the primary interface between frontend and backend. There is also a small REST endpoint (`POST /upload/`) for file uploads and a WebSocket at `/ws/timer/{track_id}` for browser-proxied serial timers.

**Full stack (production / single process):**

```bash
./scripts/install.sh
```

```bash
./scripts/serve.sh
```

**Development (two processes):**

```bash
./scripts/run_dev.sh
```

**Tests:**

```bash
cd backend && pytest
```

```bash
cd frontend && npm test
```

**Pre-commit hooks** run Ruff, pytest, ESLint, Vitest, and a frontend build on `git commit`:

```bash
pre-commit install
```

---

## Project layout

```
backend/
  api/
    main.py           # FastAPI app, CORS, uploads, timer WebSocket, SPA serving
    schema.py         # Strawberry GraphQL schema — queries, mutations, subscriptions
    loaders.py        # Per-operation query cache (see "Loaders" below)
    pubsub.py         # In-process async pub/sub backing subscriptions
  db/
    models.py         # SQLAlchemy ORM models
    crud.py           # DB helpers + heat generation + advancement cascade
    database.py       # Engine, session, Alembic-backed init_db()
    schemas.py        # Pydantic input/response models
    populate.py       # Test data generator (populateRace mutation)
  migrations/         # Alembic environment and versions
  services/
    scoring.py        # Leaderboard and advancement calculations
    stats.py          # Race statistics
    image_processing.py
    timer/
      manager.py      # TimerManager: one per track; state machine + result recording
      state_machine.py
      devices/        # base.py, fake.py, microwizard.py
  tests/              # pytest suite
  uploads/            # legacy; runtime uploads go to the data dir

frontend/src/
  App.tsx                     # Routes + first-run config gate
  features/
    core/                     # Navigation, shared queries
    management/               # Home, RaceDetails, racer/den forms, imports
    racing/                   # RaceControl, RaceExecution, scheduling, free race, timer UI
    observation/              # Audience display
    stats/                    # Standings, RaceStats, Leaderboard
    settings/                 # SystemSettings first-run wizard
  gql/                        # GENERATED — do not edit (see below)
  components/ui/              # Modal, CameraCapture
  context/                    # AlertContext, SerialProxyContext
  utils/
  schema.graphql              # GENERATED from the backend schema

scripts/
  export_schema.py            # Dumps Strawberry SDL for codegen
  install.sh, serve.sh, run_dev.sh, install-pi.sh

docs/                         # mkdocs site
tasks/                        # Plans for unimplemented work
```

Each `features/<area>/` slice holds its own `pages/`, `components/`, and `graphql/queries.ts`.

---

## Data model

```
Group           id, name, debug_mode
  └─ Race[]

Track           id, name, lane_count, length_feet, timer_type, serial_port
  └─ Race[]

Race            id, name, date_time, location, group_id, track_id,
                car_numbering_strategy, global_start_number, scoring_strategy,
                championship_trophies, rules_configuration, auto_advance_heat
  ├─ Den[]            (cascade delete)
  ├─ Racer[]
  ├─ Round[]          (cascade delete)
  ├─ Heat[]
  ├─ RacingGroup[]
  └─ FreeRaceHeat[]   (cascade delete)

Den             id, race_id, name, color, rank,
                car_number_range_start, car_number_range_end

Racer           id, race_id, den_id?, racing_group_id?,
                first_name, last_name, car_number, car_name, car_weight,
                car_passed_inspection, racer_image_url, car_image_url

RacingGroup     id, race_id, den_id?, name, car_number_range_*

Round           id, race_id, round_number, name, scheduling_strategy,
                advancement_source, advancement_num_racers, den_id?

Heat            id, race_id, round_id, heat_number, lane_results (JSON string)

FreeRaceHeat    id, race_id, lane_assignments (JSON), lane_results (JSON), created_at
```

### Enums (`backend/db/models.py`)

| Enum                   | Values                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| `CarNumberingStrategy` | `PER_GROUP`, `GLOBAL`, `MANUAL`                                              |
| `HeatKind`             | `OFFICIAL`, `FREE`                                                           |
| `Rank`                 | `LION`, `TIGER`, `WOLF`, `BEAR`, `WEBELOS`, `ARROW_OF_LIGHT`, `OTHER`        |
| `SchedulingStrategy`   | `PPC`                                                                        |
| `ScoringStrategy`      | `TIMED` (avg time), `POINTS` (sum of placements) — lower is better for both  |
| `TimerType`            | `FAKE`, `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY`                           |

### ⚠️ `lane_results` is a JSON string doing four jobs

```json
[{"lane": 1, "racer_id": 10, "time": 3.452, "place": 2}, ...]
```

It encodes **the schedule** (who is in which lane), **the results** (time, place), **placeholders** for unadvanced championship slots (as *negative* racer IDs: `-1`, `-2`, …), and **heat status** (inferred by scanning for a non-null `time` or a `skipped` flag).

There is no foreign key from a lane to a racer. Parse with `json.loads()`, serialize with `json.dumps()`. `updateHeatResult` takes the whole array as an opaque string and overwrites.

**This is known technical debt** — see issue #5, which normalizes it into a `heat_lanes` table. Don't build new abstractions on top of the blob; prefer adding to `crud.py` helpers that already parse it.

### ⚠️ Heat IDs are not unique across tables

`heats` and `free_race_heats` have independent autoincrement sequences, so their IDs overlap. **Anything holding a bare heat ID must also carry a `HeatKind`** — never infer the kind by looking an ID up in one table and falling back to the other. Doing exactly that used to write free-race times into official heats (issue #4). Issue #6 folds the two tables together.

---

## Database migrations

Schema changes use **Alembic**. `init_db()` runs `alembic upgrade head` at startup; if migrations fail, startup fails.

**After changing `models.py` you must generate a migration:**

```bash
uv run alembic revision --autogenerate -m "describe the change"
```

Review the generated file, then apply it and confirm there's no drift:

```bash
uv run alembic upgrade head
```

```bash
uv run alembic check
```

`alembic check` compares `models.py` against the **target database**, so it reports `Target database is not up to date` if you haven't upgraded first.

`backend/tests/test_migrations.py::test_migrations_reproduce_the_models` runs that check in CI, so a model change without a migration **fails the build**.

Databases created before Alembic are detected at startup (app tables present, no `alembic_version`), stamped at `0001_baseline`, and upgraded forward.

---

## GraphQL API

Defined entirely in `backend/api/schema.py`.

**Queries:** `races`, `race`, `racers`, `racer`, `tracks`, `groups`, `rounds`, `initialConfig`, `advancementStatus`, `raceStats`, `timerStatus`, `freeRaceHeats`, `activeFreeRaceHeat`, `randomFreeRaceLanes`, `version`

**Mutations:**

- Race: `createRace`, `updateRace`, `deleteRace`
- Racer: `createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`
- Bulk: `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToDen`, `bulkDeleteRacers`, `bulkCheckIn`, `bulkAssignPhotos`
- Den: `createDen`, `updateDen`, `deleteDen`
- Track: `createTrack`, `updateTrack`, `deleteTrack`
- Round/Heat: `createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `updateHeatResult`, `reorderHeats`
- Timer: `prepareHeat`, `abortHeat`, `forceResults`, `resetTimer`, `reconnectTimer`, `fakeTimerStart`, `fakeTimerFinish`
- Free race: `startFreeRaceHeat`, `recordFreeRaceResult`, `deleteFreeRaceHeat`
- System/data: `createInitialConfig`, `updateInitialConfig`, `importRacers`, `uploadImage`, `populateRace`

**Subscriptions:** `raceStateChanged`, `timerStatus`, `leaderboard`, `heats`, `onDeck`, `currentlyRacing`, `timingStats`, `freeRaceHeat`, `activeFreeRaceHeat`

### Adding a mutation

1. Add a resolver to `Mutation` in `backend/api/schema.py` (`@strawberry.mutation`)
2. Get the session with `db = info.context["db"]`
3. Call `crud.py` helpers; add new helpers there for non-trivial DB work
4. `await _publish_race_state(race_id)` if the change affects race state
5. Add the `gql` document to the relevant `features/*/graphql/queries.ts`
6. **Regenerate types:** `cd frontend && npm run codegen`
7. Call it with `useMutation` from urql

---

## Key patterns and conventions

### Backend

- **GraphQL context** carries `db`, `timer_managers`, and `loaders`.
- **Strawberry types are duck-typed shells.** Resolvers return raw SQLAlchemy ORM objects and Strawberry reads attributes off them. `self` inside a field resolver is the ORM object, not the Strawberry type.
- **Loaders (`api/loaders.py`).** Because of the above, every relationship used to be a fresh query per row. Use `_loaders(info)` in field resolvers rather than querying directly — it caches per operation. `backend/tests/test_query_counts.py` fails the build if query counts regress or start scaling with heat count.
  - **Subscriptions hold a context open for the whole connection.** If you add a subscription that re-reads the DB, call `_loaders(info).clear()` after `db.expire_all()`, or it will replay stale data to the audience displays.
- **Cascade deletes:** deleting a `Race` cascades to `Den`, `Round`, and `FreeRaceHeat`; deleting a `Round` cascades to its `Heat`s.
- **Scoring is always computed on demand** in `services/scoring.py`. There is no stored leaderboard.
- **Data directory** defaults to `~/.trustytrack`; override with `TRUSTYTRACK_DATA_DIR`. Images land in `uploads/` there and are served from `/static/<filename>`.
- **The unified server** serves `frontend/dist` with an SPA catch-all. Health check at `/health`.

### Frontend

- **Generated types.** `src/gql/` and `frontend/schema.graphql` are generated — never edit them. Run `npm run codegen` after any backend schema change; CI fails if they're stale. See `src/gql/README.md`.
- **Prefer deriving view types** from generated operation types rather than hand-writing interfaces. See `features/racing/types.ts`.
- **Write documents with urql's `gql` tag**, give every operation a **unique name**, and codegen will type it. Plain template literals still work at runtime but get no types.
- **urql request policy:** mutations re-fetch with `'network-only'`.
- **Alerts:** use `useAlert()` from `AlertContext`. Never `window.alert`.
- **Styling:** CSS custom properties defined in `src/index.css` — `var(--scouting-blue)` (#003F87), `var(--cub-scouting-gold)` (#FCD116). Existing class naming (`.race-details`, `.racer-table`). Standard border-radius 12px.
- **Drag and drop:** `@dnd-kit`, see `ScheduleManagement.tsx`.

---

## Business logic highlights

### Heat scheduling (PPC)

`docs/scheduling-algorithms.md`. Each racer races in every lane exactly once per round; the algorithm generates the minimum heats to satisfy that. Lives in `crud._generate_ppc` / `crud.generate_heats_for_round`.

### Scoring

`services/scoring.py`. `TIMED` averages heat times (a recorded `0.0` is treated as a 9.999s DNF penalty); `POINTS` sums placements. Both are lower-is-better. `get_leaderboard(db, race_id)` returns sorted standings.

Note that `get_leaderboard` with no `round_id` spans **all** heats in the race, so championship heats blend into prelim averages. Whether that is intended is an open question — see issue #17.

### Championship advancement

`advanceRound` and `scoring.get_advancing_racers()`:

- `advancement_source = "PACK"` — top N overall
- `advancement_source = "DEN"` — top N from each den
- `advancement_source = "ROUND:<id>"` — top N from that round

`crud.record_heat_result` cascades: it calls `invalidate_future_rounds` and `trigger_auto_advancements` on **every** heat result.

### Car numbering

`PER_GROUP` fills within each den's range; `GLOBAL` numbers sequentially from `global_start_number`; `MANUAL` disables auto-numbering.

### Timer integration

One `TimerManager` per track, created at startup in `main.py`'s lifespan. Devices implement `services/timer/devices/base.py`. Three connectivity modes: fake, backend-direct serial, and browser-proxied serial over WebSocket. The manager owns byte framing, the state machine, and result recording, and publishes state through `pubsub`.

**`TimerManager` writes to the DB via its own `SessionLocal()`**, outside the request lifecycle — which is why the test suite maintains a second, file-backed database. See issue #9.

### First-run gate

`App.tsx` queries `initialConfig()`; if the system is unconfigured, all routes redirect to `/system-settings`, which creates the `Group` and `Track`.

---

## Known architectural debt

An architecture review is tracked in **issue #18**. Before making a substantial change, check whether it overlaps:

| Issue | Area |
| --- | --- |
| #5 | Normalize `lane_results` into a `heat_lanes` table |
| #6 | Fold `FreeRaceHeat` into `Heat` |
| #7 | Server-owned `HeatSession` as the single source of truth for live race state |
| #8 | Extract a pure domain layer for scheduling/scoring/advancement |
| #9 | `TimerManager` bypasses the request session |
| #12 | Subscriptions should carry payloads instead of triggering full refetches |
| #13 | Model the race-day flow as an explicit state machine |
| #14 | Whether GraphQL is still the right choice |
| #15 | No authentication on mutations; CORS misconfigured |
| #17 | Decide scoring scope (prelim vs championship) |

Don't entrench conventions these issues are removing — particularly the `lane_results` blob (#5) and the negative-ID placeholder trick.

---

## Implementation plans (`docs/tasks/`)

Staged plans live in `docs/tasks/<area>/`, numbered in intended order. Areas: `free-race`, `graphql`, `improvements`, `install`, `observation`, `printables`, `stats`, `timers`.

**Most of these are already built.** Free racing, observation subscriptions, hardware timers, the GraphQL migration, and race stats have all landed — the plan files remain as design notes, not a backlog. `printables` (QR codes, pit passes, driver's licenses) is the main area still unimplemented.

Check the code before assuming anything in `docs/tasks/` is outstanding.

`TODO.md` at the repo root is a mostly-completed feature checklist.
