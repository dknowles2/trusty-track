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
  domain/             # Pure rules — no SQLAlchemy, no Strawberry (see below)
    lanes.py          # Lane value object + the lane_results JSON codec
    scheduling.py     # PPC algorithm
    scoring.py        # TIMED / POINTS aggregation and ranking
    advancement.py    # Who advances; when a round is rebuilt
  migrations/         # Alembic environment and versions
  services/
    scoring.py        # Leaderboard and advancement, wired to the DB
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
  └─ Heat[]           (both kinds; see `Heat.kind`)

Den             id, race_id, name, color, rank,
                car_number_range_start, car_number_range_end

Racer           id, race_id, den_id?, racing_group_id?,
                first_name, last_name, car_number, car_name, car_weight,
                car_passed_inspection, racer_image_url, car_image_url

RacingGroup     id, race_id, den_id?, name, car_number_range_*

Round           id, race_id, round_number, name, scheduling_strategy,
                advancement_source, advancement_num_racers, den_id?

Heat            id, race_id, round_id?, kind, heat_number, lane_results (JSON string),
                created_at?


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

There is no foreign key from a lane to a racer. `updateHeatResult` takes the whole array as an opaque string and overwrites.

**Use `backend/domain/lanes.py`, not `json.loads`.** `lanes.parse()` and `lanes.serialize()` are the only sanctioned way in or out of the blob, and they round-trip losslessly — the frontend writes a `skipped` key the backend never reads, and any parse/modify/write cycle that drops it makes a skipped heat look unrun. `lanes.py` is also the single file issue #5 replaces when this becomes a `heat_lanes` table, so new `json.loads(heat.lane_results)` calls make that migration larger.

**This is known technical debt** — see issue #5. Don't build new abstractions on top of the blob.

#### The `heat_lanes` shadow table

The normalized `heat_lanes` table exists and is kept current. The blob is still the source of truth — everything **writes** the blob, and `backend/db/lane_sync.py` listens on the SQLAlchemy `Session` and projects those writes into the table, so no write site needs to know it exists. Two consequences:

- **Write heats through the ORM.** A raw `UPDATE heats SET lane_results = ...`, or a bulk delete of a table other than `heats`, bypasses the listener and silently rots the table.
- **`conftest.py` asserts `lane_sync.lanes_out_of_sync()` is empty after every test**, which is what makes the whole suite a test of the projection. If a change makes that fail, the projection is wrong — not the check.

`heat_lanes.heat_id` is a real foreign key since #6. `lane_sync` still cascades deletions itself, because a bulk `query(Heat).delete()` never loads the rows.

**Reading: use `Heat.lanes` / `FreeRaceHeat.lanes`.** The GraphQL read path is structured and comes from the table:

```graphql
lanes { lane racerId placeholderSlot time place skipped }
```

It separates the things the blob conflated: a placeholder slot is `placeholderSlot`, not a negative `racerId`; `skipped` is a field; `time` is always a number, never the string the frontend sometimes wrote.

**Writing is structured too.** `updateHeatResult` and `recordFreeRaceResult` take `[HeatLaneInput!]!` — the same fields, so what a screen reads is what it sends back:

```graphql
mutation($heatId: Int!, $lanes: [HeatLaneInput!]!) {
  updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
}
```

The blob is still the storage format; `_lanes_from_input` in `schema.py` converts, and `lanes.carry_extras` preserves any key the blob holds that nothing models — a client cannot send back what it cannot see. `skipped` is deliberately *not* carried: it is modelled, so an update that omits it is un-skipping the heat.

On the frontend, no code parses lane JSON any more. Screens read `lanes`, ask about a heat through the named predicates in `features/racing/lanes.ts` (`hasRun`, `hasTimes`, `wasSkipped`, `byPlace`), and send changes back with `toInput` / `cleared`. Build heat fixtures with `features/racing/testFixtures.ts`.

### ⚠️ Free race heats share the `heats` table

A free race heat is a `Heat` with `kind = FREE` and no `round_id` (issue #6). It is an exhibition run: the timer records it and the audience display shows it, but **scoring, scheduling, advancement and statistics must exclude it**.

**Use `models.official_heats(query)`** rather than writing the filter out, so its absence is visible at the call site. The paths that depend on it are `crud.get_heats`, `loaders.heats_for_race`, `compute_race_stats`, and the `onDeck` / `currentlyRacing` / `timingStats` subscriptions; `test_heat_kind.py` inserts a free heat and checks each one. `delete_race` deliberately does *not* filter — it takes both.

Heat IDs used to be ambiguous: `heats` and `free_race_heats` had independent autoincrement sequences, so anything holding a bare ID had to carry a `HeatKind` alongside it, and inferring the kind by looking an ID up in one table and falling back to the other wrote free-race times into official heats (issue #4). One table means one sequence, so an ID is unambiguous and code reads the kind off the heat rather than being told it.

**"Has this heat been run" is one question for both kinds**: whether any lane holds a time (`lanes.has_results`). A free heat's schedule goes into `lane_results` when it is created, exactly as a generated official heat's does. `FreeRaceHeat.recorded` in GraphQL exposes this; it replaces testing `laneResults` for null.

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
- **The domain layer (`backend/domain/`) imports no SQLAlchemy and no Strawberry.** Scheduling, scoring, and advancement are plain functions over plain values; `crud.py` and `services/` load rows, call them, and persist the answer. Put a *rule* there and its *I/O* in the caller. Keep it importable without a database — that is what lets `test_domain_scheduling.py` run every racer count from 2 to 20 against every lane count from 2 to 8 in under a second, which is how issue #26 was found.
  - Enum-ish values cross the boundary as plain strings. `ScoringStrategy` and friends are `str` enums whose values equal their names, so they pass through unchanged and there is no second copy of the vocabulary.
- **Cascade deletes:** deleting a `Race` cascades to `Den` and `Round`, and removes its heats of both kinds; deleting a `Round` cascades to its `Heat`s.
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

`docs/scheduling-algorithms.md`. The algorithm is `domain/scheduling.py`; `crud.generate_heats_for_round` decides who is in the field and writes the rows.

Lane 1 is seeded with every racer, which fixes the heat count at one per racer; remaining lanes are filled greedily, preferring a racer who has not yet run that lane and has met the current occupants least often.

Greedy alone finds a *maximal* matching, not a *maximum* one, so it used to strand a lane in roughly 1 in 4 four-lane schedules — giving one racer a heat fewer, which under `POINTS` scoring made their score *better*. Fixed in #26 by repairing the greedy result with augmenting paths. `test_domain_scheduling.py` holds the properties; **every heat is full** is the one that regressed silently for a long time, so keep it.

### Scoring

Rules in `domain/scoring.py`, database wiring in `services/scoring.py`. `TIMED` averages heat times (a recorded `0.0` is treated as a 9.999s DNF penalty); `POINTS` sums placements. Both are lower-is-better. `get_leaderboard(db, race_id)` returns sorted standings.

**Standings cover preliminary rounds only** — rounds with no `advancement_source`. Settled in #17. A championship field is chosen *from* the standings, so folding championship results back in is circular: `record_heat_result` re-runs advancement on every result, so a final-round time could change who was supposed to be in the final. It also mixes populations, since a championship average is taken against the fastest cars rather than the whole field.

`get_leaderboard(db, race_id)` is prelim-scoped by default. Pass `round_id` for one round (this is how the UI shows championship results) or `scope=ALL` for the pre-#17 whole-race average. The `Race.leaderboard` GraphQL field takes `roundId` and `includeAllRounds` to match.

### Championship advancement

Rules in `domain/advancement.py`; entry points are `advanceRound` and `scoring.get_advancing_racers()`.

- `advancement_source = "PACK"` — top N overall
- `advancement_source = "DEN"` — top N from each den
- `advancement_source = "ROUND:<id>"` — top N from that round

`crud.record_heat_result` cascades: it calls `invalidate_future_rounds` and `trigger_auto_advancements` on **every** heat result.

**The invalidation rule**, since it is easy to get wrong: recording *or clearing* a result in round N resets the field of every later championship round back to placeholders, because the standings they were drawn from just moved. A later round that has **already been raced** is left alone — a stale field the operator can see and fix beats silently wiping heats people ran. General rounds are never invalidated; their field is the roster.

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
| #7 | Server-owned `HeatSession` as the single source of truth for live race state |
| #12 | Subscriptions should carry payloads instead of triggering full refetches |
| #13 | Model the race-day flow as an explicit state machine |
| #14 | Whether GraphQL is still the right choice |
| #15 | No authentication on mutations; CORS misconfigured |
| #26 | PPC scheduler strands lanes, giving some racers fewer heats |

Don't entrench conventions these issues are removing — particularly the `lane_results` blob (#5) and the negative-ID placeholder trick.

---

## Implementation plans (`docs/tasks/`)

Staged plans live in `docs/tasks/<area>/`, numbered in intended order. Areas: `free-race`, `graphql`, `improvements`, `install`, `observation`, `printables`, `stats`, `timers`.

**Most of these are already built.** Free racing, observation subscriptions, hardware timers, the GraphQL migration, and race stats have all landed — the plan files remain as design notes, not a backlog. `printables` (QR codes, pit passes, driver's licenses) is the main area still unimplemented.

Check the code before assuming anything in `docs/tasks/` is outstanding.

`TODO.md` at the repo root is a mostly-completed feature checklist.
