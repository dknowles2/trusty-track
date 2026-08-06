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
uv run pytest
```

```bash
cd frontend && npm test -- --run
```

**End-to-end** (a real backend, a real browser — the only tests that exercise the served page, the GraphQL round trip and the normalized cache together):

```bash
cd frontend && npm run test:e2e
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
    heat_session.py   # What is on the track right now: heat + timer, merged
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
      raceFlow.ts             #   the race-day machine — pure, no React
      useRaceFlow.ts          #   its only wiring to React
      roundCompletion.ts      #   noticing a round's field was decided
      lanes.ts                #   predicates over a heat's lanes
    observation/              # Audience display
    printables/               # Pit passes, driver's licences, check-in codes
      documents.ts            #   card geometry and print order — pure, no React
      scanning.ts             #   reading a scanned code back — pure, no React
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

Track           id, name, lane_count, length_feet, timer_type, serial_port,
                remote_start_installed
  └─ Race[]

Race            id, name, date_time, location, group_id, track_id,
                car_numbering_strategy, global_start_number, scoring_strategy,
                championship_trophies, rules_configuration, auto_advance_heat
  ├─ Den[]            (cascade delete)
  ├─ Racer[]
  ├─ Round[]          (cascade delete)
  └─ Heat[]           (both kinds; see `Heat.kind`)

Den             id, race_id, name, color, rank,
                car_number_range_start, car_number_range_end

Racer           id, race_id, den_id?,
                first_name, last_name, car_number, car_name, car_weight,
                car_passed_inspection, racer_image_url, car_image_url

Round           id, race_id, round_number, name, scheduling_strategy,
                advancement_source, advancement_num_racers, den_id?

Heat            id, race_id, round_id?, kind, heat_number, lane_results (JSON string),
                created_at?, recorded_at?


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

**Use `backend/domain/lanes.py`, not `json.loads` or `json.dumps`.** `lanes.parse()` and `lanes.serialize()` are the only sanctioned way in or out of the blob, and they round-trip losslessly — the frontend writes a `skipped` key the backend never reads, and any parse/modify/write cycle that drops it makes a skipped heat look unrun. `lanes.py` is also the single file issue #5 replaces when this becomes a `heat_lanes` table, so new `json.loads(heat.lane_results)` calls make that migration larger.

**This is known technical debt** — see issue #5. Don't build new abstractions on top of the blob.

#### The `heat_lanes` shadow table

The normalized `heat_lanes` table exists and is kept current. Its rows are built from the lane *values* a writer supplied: `crud.set_heat_lanes` — the one door — stages them on the instance, and `backend/db/lane_sync.py` writes them on `after_flush`, which is when a newly created heat first has an id. `lane_results` is written alongside as a **derived** column, so a rollback has data and the readers can move one at a time. A malformed blob can no longer reach the table; parsing one survives only as a logged fallback for a write that skipped the door, which the AST guard in `test_heat_lanes_write.py` says cannot happen. **Making the table authoritative is the remaining half of #5, tracked as #72** — until that lands, the wins it promised (a `COUNT` instead of a parse for round completion, a `GROUP BY` for scoring, the racer foreign key enforcing anything on write) are not available, and `crud._remove_racer_from_*` still hand-walk the blob doing what `ON DELETE SET NULL` would do. Two consequences:

- **Write heats through `crud.set_heat_lanes`, and through the ORM.** A raw `UPDATE heats SET lane_results = ...`, or a bulk delete of a table other than `heats`, bypasses the listener entirely and silently rots the table. Setting the column without staging lanes is caught and logged, but it means the rows come from a re-parse of the string, which is the direction #72 moved away from.
- **`conftest.py` asserts `lane_sync.lanes_out_of_sync()` is empty after every test**, which is what makes the whole suite a test of the projection. If a change makes that fail, the projection is wrong — not the check.

`heat_lanes.heat_id` is a real foreign key since #6. `lane_sync` still cascades deletions itself, because a bulk `query(Heat).delete()` never loads the rows.

**`loaders.scheduled_racer_ids` is one `DISTINCT`** over `heat_lanes` rather than a load of every heat and a parse of each blob — the first of the wins #5 predicted to actually arrive, guarded by an exact count in `test_query_counts.py`. Note it needs no placeholder special case: the table holds a slot as `placeholder_slot` with a null `racer_id`, so the blob's negative-id convention simply is not there.

**Scoring and stats read through `crud.lanes_for_heats`** — one query for a whole set of heats, so a caller that already has them does not pay per heat. The GraphQL read path uses `loaders.lane_values_for_heat`, which is the same values off the loaders' existing per-race batch; the mutation resolvers use `schema._stored_lanes`, which is one heat and so cannot N+1.

**The backend reads lanes through `crud._round_heat_lanes`**, which comes off the table, not off `lanes.parse` — it is the choke point for `is_round_complete`, `field_is_short` and `may_rebuild`, so all three moved together. Two queries rather than one join, deliberately: a join from `heat_lanes` drops a heat that has no lane rows, where parsing gave it `[]` and kept it, and the last two rules reason about the *number* of heats. `lanes.from_parts` is the crossing back — it re-encodes `placeholder_slot` as a negative racer id and puts `skipped` back in `extra`, because that is still what `Lane` holds. `test_lane_reads.py` pins each of those, and each fails to a one-line mutation.

**Nothing reads the blob any more except five places, and each is deliberate:** `lanes.carry_extras` on the write path (it preserves keys the table does not model), `lane_sync`'s logged fallback and its verification, and the two `_remove_racer_from_*` helpers that [#72](https://github.com/dknowles2/trusty-track/issues/72) step 4 deletes outright. Everything else goes through `crud.lanes_for_heats`, `crud.heat_lanes_of`, or `loaders.lane_values_for_heat`.

**Reading: use `Heat.lanes` / `FreeRaceHeat.lanes`.** The GraphQL read path is structured and comes from the table:

```graphql
lanes { lane racerId placeholderSlot time place skipped }
```

It separates the things the blob conflated: a placeholder slot is `placeholderSlot`, not a negative `racerId`; `skipped` is a field; `time` is always a number, never the string the frontend sometimes wrote.

**`laneResults` is gone from the schema.** The raw blob was handed out as a string alongside `lanes` while the client moved across, and has been removed — an API offering both invites new code to take the untyped one. The blob is still the storage format; nothing outside the backend sees it.

**Writing goes through one door.** `crud.set_heat_lanes(heat, lanes)` is the only place a heat's lanes are stored — nine call sites used to assign `lane_results` themselves. Making `heat_lanes` authoritative ([#72](https://github.com/dknowles2/trusty-track/issues/72)) is then a change to that one function rather than to nine places that each have to remember, and `test_heat_lanes_write.py` walks `crud.py`'s AST to keep it that way. `record_heat_result` takes lanes rather than a serialized blob for the same reason — it was the last signature in the codebase that spoke the storage format instead of the value.

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

#### Two predicates, and which one you want

`lanes.has_results` and `lanes.is_finished` are deliberately different, and #55 was picking the wrong one:

| Question | Predicate | Skipped heat |
| --- | --- | --- |
| Would rebuilding this lose a result? | `has_results` — any lane has a time | not finished; a skipped round may be regenerated |
| Should the running order move on? | `is_finished` — any lane has a time **or** is skipped | finished; the operator is not coming back to it |

Anything deciding **what is on the track or what is next** wants `is_finished` (`schema._unfinished` wraps it for the `onDeck` / `currentlyRacing` subscriptions). Anything guarding **the stored record** wants `has_results`. `timingStats` is the third case and wants `has_results` for its own reason: it displays results, and a skipped heat has none. `hasRun` in `features/racing/lanes.ts` is `is_finished`'s counterpart on the frontend.

**`recorded_at` is when, and it is the only thing the two kinds can be ranked on together** (#59). `created_at` cannot: for a free heat it is roughly when it ran, for an official heat it is when the *round was generated*. Schedule order cannot either — it says nothing about a heat being re-recorded. `crud.stamp_recorded` keeps `recorded_at` non-null exactly when the heat holds a result, including clearing it on a re-run, and only the two result-recording functions call it: editing a schedule is not running a heat.

Both take parsed lanes. Outside `migrations/`, nothing reads the blob with `json.loads` or writes it with `json.dumps` any more — the free-race pair in `crud` were the last two, and they took dicts and dumped them, which is a second copy of the codec in two of the places [#72](https://github.com/dknowles2/trusty-track/issues/72) has to change. They take `lanes.Lane` now, like everything else. The three audience subscriptions and `loaders.scheduled_racer_ids` were wrong in the same way: they tested lane *index 0* for a time, so a skipped heat, or a heat whose first lane had been vacated by a deleted racer, pinned both wall displays one heat behind for the rest of the event. `services/stats.py` was the last holdout and outlived that claim being written here — it parsed the blob itself, which meant a heat whose `lane_results` was not a list of lanes took the whole stats page down rather than being skipped.

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

**Queries:** `races`, `race`, `racers`, `racer`, `tracks`, `groups`, `rounds`, `initialConfig`, `advancementStatus`, `raceStats`, `timerStatus`, `heatSession`, `freeRaceHeats`, `activeFreeRaceHeat`, `randomFreeRaceLanes`, `version`

**Mutations:**

- Race: `createRace`, `updateRace`, `deleteRace`
- Racer: `createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`
- Bulk: `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToDen`, `bulkDeleteRacers`, `bulkCheckIn`, `bulkAssignPhotos`
- Den: `createDen`, `updateDen`, `deleteDen`
- Track: `createTrack`, `updateTrack`, `deleteTrack`
- Round/Heat: `createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `updateHeatResult`, `reorderHeats`
- Timer: `prepareHeat`, `abortHeat`, `forceResults`, `releaseStartGate`, `resetTimer`, `reconnectTimer`, `fakeTimerStart`, `fakeTimerFinish`
- Free race: `startFreeRaceHeat`, `recordFreeRaceResult`, `deleteFreeRaceHeat`
- System/data: `createInitialConfig`, `updateInitialConfig`, `importRacers`, `uploadImage`, `populateRace`

**Subscriptions:** `raceStateChanged`, `timerStatus`, `heatSession`, `leaderboard`, `heats`, `onDeck`, `currentlyRacing`, `timingStats`, `freeRaceHeat`, `activeFreeRaceHeat`

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
  - **`mypy` gates it, and only it, strictly** (`disallow_untyped_defs`). `uv run mypy backend` runs over the whole tree in CI; the modules not yet clean are listed as *exemptions* in `pyproject.toml`, so a new module is checked from the day it is written and that list can only shrink — it is down to three (`api.schema`, `db.crud`, `services.timer.manager`), all of them Strawberry duck-typing or its neighbours. Keeping `domain/` clean is cheap because it has no ORM rows or framework shells in it — which is also why a wrong type there is worth catching. `Lane.placeholder_slot` and `Lane.real_racer_id` exist so the sign convention has one home and a checker can see through it; prefer them to `is_placeholder` / `is_real_racer` when you need the value.
- **Cascade deletes:** deleting a `Race` cascades to `Den` and `Round`, and removes its heats of both kinds; deleting a `Round` cascades to its `Heat`s.
- **Scoring is always computed on demand** in `services/scoring.py`. There is no stored leaderboard.
- **Data directory** defaults to `~/.trustytrack`; override with `TRUSTYTRACK_DATA_DIR`. Images land in `uploads/` there and are served from `/static/<filename>`.
- **The unified server** serves `frontend/dist` with an SPA catch-all. Health check at `/health`.

### Frontend

- **Generated types.** `src/gql/` and `frontend/schema.graphql` are generated — never edit them. Run `npm run codegen` after any backend schema change; CI fails if they're stale. See `src/gql/README.md`.
- **Prefer deriving view types** from generated operation types rather than hand-writing interfaces. See `features/racing/types.ts`.
- **Write documents with urql's `gql` tag**, give every operation a **unique name**, and codegen will type it. Plain template literals still work at runtime but get no types.
- **urql request policy:** mutations re-fetch with `'network-only'`. Not on the first-run gate in `App.tsx`, where it never did anything — `Routes` renders one matched element and every route's element is a `ProtectedRoute`, so changing route updates that component's children rather than remounting it, and a mount-only policy refetches once per page load. Freshness there comes from `forgetInitialConfig` in `api/graphqlClient.ts` invalidating the field when a config mutation changes it.
- **Two concurrent mutations with identical variables are one operation.** urql keys an operation on its document plus its variables, and with the normalized cache in the chain only one of a colliding pair gets a result back — the other never settles. Reproduced in `graphqlClient.test.ts`'s neighbourhood and fixed at the call site in `BulkPhotoUploadModal` (#116) by issuing one request per distinct image. Anything doing `Promise.all` over the same mutation wants distinct variables, or one request with the duplicates folded in.
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

**Putting racers in goes through `crud.populate_round_field`**, never `resolve_round_placeholders` directly — both `trigger_auto_advancements` and the `advanceRound` mutation call it, and having two copies of the call is how #48 ended up on only one path at first.

**`advancement_num_racers` is per *den* when the source is `DEN`**, and absolute otherwise. The rule is `domain/advancement.field_size`, wrapped by `crud.round_field_size` which counts the dens — use those, never the raw column. It had grown five copies, two of them wrong, and the wrong ones shrank a DEN final to a fraction of its field on every preliminary result (#52).

`advancement_num_racers` is also a **request**, not a guarantee: "top four" from a den of three can only ever supply three. Heats are generated from the request, before anyone qualifies, so a round can hold more slots than the race can fill. Left alone the surplus is fatal rather than untidy — `phase` reports `NOT_READY` while any placeholder remains, and the operator screen has no controls in that state, so the round cannot be run, edited or skipped. `domain/advancement.field_is_short` detects it and the round is rebuilt for the field that actually qualified. A round that has already been raced is filled in place regardless, following the same rule as invalidation.

### Car numbering

`PER_GROUP` fills within each den's range; `GLOBAL` numbers sequentially from `global_start_number`; `MANUAL` disables auto-numbering.

### Timer integration

One `TimerManager` per track, created at startup in `main.py`'s lifespan. Three connectivity modes: fake, backend-direct serial, and browser-proxied serial over WebSocket. The manager owns byte framing, the state machine, and result recording, and publishes state through `pubsub`.

**A timer model is data, not a subclass** (#89). `TimerProfile` in `services/timer/devices/base.py` is a frozen record: port framing, identification banner, setup commands, `HeatPrep`, `acks`, and a tuple of `Matcher`s pairing a pattern with the event it means and the captured groups holding lane, time and place. Its methods hold only the rules for reading those fields, which is why `TimerManager` never had to change. **Add a device by adding a record to `devices/`, not a class** — a subclass identifies its device with arbitrary Python, and a prober that walks `ALL_PROFILES` trying each candidate cannot read arbitrary Python. That is what the old ABC made impossible.

Two things worth knowing before editing a profile:

- **Matcher order is priority**, and `repeat=True` applies a matcher across the whole line — that is how one line reporting every lane becomes one event per lane.
- **`identification` is an ordered sequence, but `is_identified_by` uses only the first.** The rest of a banner is informational; treating a version line as an identification in its own right makes the manager re-initialise a device that was still finishing its greeting.

**`parse_line` returning `[]` and returning `None` are different answers.** Empty means "recognised, no event", which is what lets a connection leave `CONNECTED`; `None` means nothing claimed the line.

**The browser-proxy path gets no copy of the profiles, even though it probes.** The backend owns all protocol state and the browser is a wire — it needs the port parameters, which the WebSocket `configure` message carries, and nothing else. DerbyNet ships its profile set to the browser because *their* browser-side timer is the driver; ours is not.

**Both auto-detect modes detect**, and differ only in who holds the port. `services/timer/probe.py` walks every USB serial port against every profile with a `probe` command and an `identification` banner, and `TimerManager.autodetect()` adopts what answers. `services/timer/proxy.py` runs the same walk over the WebSocket, since there the browser holds the port: `ProxySession` sends a `configure` per candidate, waits for `ready`, writes the probe and watches the relayed bytes. Neither leaves a track without a timer — nothing answering keeps `DEFAULT_PROFILE`.

Three things about the proxy walk:

- **The port is reopened only when the framing changes.** With the profiles we ship that is once, since everything probeable is 9600 8-N-1; the check is on the framing rather than the profile so that a 1200-baud probeable profile would still work. Reopening is the failure-prone half, and it lives in `SerialProxyContext.tsx`: `close()` will not resolve while a reader holds the lock, so the read loop has to be cancelled first — and that ending has to be told apart from the device being unplugged, since one reopens and the other hangs the WebSocket up.
- **Bytes arriving while probing never reach the manager.** They are answers to *other* profiles' probes, and would go through the wrong matchers and past acknowledgement matching that never asked for them.
- **An identified device goes straight to IDLE**, through `TimerManager.adopt_profile` — `adopt`'s reasoning with no port to hand over. The fallback path uses the ordinary `handle_connect`, because there nothing has identified itself.

- **`probe` and `on_connect` are different fields on purpose.** `probe` fires only when nothing is connected or nothing is armed; `on_connect` fires on every reconnect, including mid-event. The MicroWizard sends `RV` for the former and nothing for the latter — `RV` on every connect is what caused the re-initialization loop removed in `9f09cee`.
- **A connection that opens and goes quiet is the normal case, and `CONNECTED` is a trap without help.** `handle_connect` sends the setup commands, the device acknowledges them, and `_process_line` consumes acknowledgements through `_pending_acks` with an *early return* — so nothing reaches the branch that leaves `CONNECTED`. `nudge_if_unidentified`, called from the watchdog, asks with `probe` (never while a heat is armed). Don't "fix" this by treating an ack as identification: an ack says something is there, not which model, and in proxy mode the profile is only an assumption.
- **A probe hands over its open port**, and `adopt()` goes straight to `IDLE`. Reopening would lose the banner the device just sent and strand the manager in `CONNECTED`.
- **A hand-configured `Track.serial_port` is never probed** — used exactly as given. Go through `_start_backend_direct` in `schema.py` rather than calling `connect_direct`/`autodetect` directly; there are four call sites and #48 is the standing reminder about rules that land on only some of them.
- **The suite must never touch real hardware.** `conftest.py`'s autouse `no_real_serial_ports` stubs both `probe.usb_ports` and `probe.open_serial`. Tests that exercise probing pass their own `open_port` to `probe.detect`.
- **`_timer_status(s)` in `schema.py` is the only converter.** The `timerStatus` query and its subscription both go through it. They used to build the type separately, which is how a field lands on one and not the other — and with a normalized cache, a subscription payload missing a field the query supplied is how a value vanishes from a screen mid-event.
- **A gate watcher is a poll, and its answers are scoped to the poll.** A profile may carry `gate_watcher` (a command plus matchers) for a device that only reports the gate when asked. Real answers are as short as `0`, `U`, `O` and `.` — PDT's gate-closed pattern is a bare `.`, which matches any character — so `read_gate` is consulted **only** inside the window following a query, never as part of `parse_line`. Putting them in the general matcher list would have them claim every line the timer sends.
- **The debounce is for polled gate state only** (`GateBelief` in `state_machine.py`). A device that *pushes* an edge has already debounced it and says so once; requiring a second confirming observation would mean never believing it, which is the trap that kept the gate debounce out of [#90](https://github.com/dknowles2/trusty-track/pull/90). A poll is a sample and the next one re-observes, which is what makes waiting for persistence work there and only there. `min_change_seconds=0` means no debounce — the first sample is believed.
- **Polling runs only while ARMED or READY.** Not RUNNING: the answer cannot change a run under way, and DerbyNet found some timers resend the previous heat's results when queried too soon after gate-open. Not IDLE: nothing is waiting on the answer.
- **The MicroWizard is deliberately not polled.** `N2` makes it push both edges, so a query would be traffic for an answer already volunteered — and untested risk on the one device anybody runs.
- **`backend/tests/timer_recordings/` holds real device output** — DerbyNet's `.playback` files (MIT, attributed), replayed by `test_timer_recordings.py`. It is the only evidence here that did not come from us, and it immediately found that our MicroWizard could not identify a **K3**: that firmware writes `Serial Number 15985` with a space, and the prober needs the whole banner. **Check a new or edited profile against a recording if one exists** — a test written from the same notes as the profile agrees with the profile's mistakes.
- **Seven profiles are adapted from DerbyNet** (`devices/derbynet.py`, MIT, attributed) and **none has run against its hardware** — nor, strictly, has the MicroWizard. Every profile carries a `provenance` string that the timer check page displays; don't let a device name imply support. `test_timer_derbynet_profiles.py` feeds each one a line from its DerbyNet definition, which catches a mistyped pattern but *not* a wrong one.
- **The vocabulary the import needed**: `command_eol` (the Champ, The Judge and SuperTimer ignore commands without a `\r`), `on_event` (mostly "results overdue → force a report"), `LaneCount` (a timer reporting 6 lanes on a 4-lane track is a real misconfiguration), and `pre_probe` (a settle command before probing). SuperTimer II is deliberately absent — two-part results, a binary-encoded lane mask, and a 10000 scale factor, all for one device.
- **`/timer-check` is the diagnostics page** (`features/settings/pages/TimerDiagnostics.tsx`), linked from System Settings. It exists because the serial log was only reachable from inside a running heat, so "is my timer working" required setting up a race first. Serial-log rendering is `features/racing/serialLog.ts` — pure, tested, shared with `HardwareTimerMole`. Its command annotations describe the MicroWizard specifically; a second device means sourcing them from the active profile rather than from that table.

**Remote start is two claims, not one** (#111). `TimerProfile.remote_start` says the device has a command for releasing the gate; `Track.remote_start_installed` says this track has the solenoid that command drives. Both are needed, and only the first is knowable from a protocol — the MicroWizard's gate release is a separately-sold accessory and `LG` is silently ignored without it, which is why DerbyNet gates theirs behind a command-line flag and we gate ours behind an operator setting. `TimerManager.can_remote_start()` is the conjunction; it rides on `TimerStatus` because the client has no copy of the profiles. `release_start_gate` refuses outside ARMED and READY and returns *why* as a string: releasing a gate with no heat armed sends cars down a track nothing is timing.

**`TimerManager` writes to the DB via its own `SessionLocal()`**, outside the request lifecycle — which is why the test suite maintains a second, file-backed database. See issue #9.

**A heat id used to stop being a stable handle** (#50). `invalidate_future_rounds` rewrites the heats of every later championship round on *every* earlier result; when it did that by deleting and re-inserting, an armed heat could vanish — or, since SQLite reuses rowids, come back as a different heat holding a different field. Three things now hold:

- **`_reset_heats_in_place` rewrites the existing rows** when the shape has not changed, so ids survive. It falls back to full regeneration only when the heat count differs (a den added to a `DEN` round, say).
- **`_record_results` verifies before writing.** It compares the heat's current lane assignment against the `racer_by_lane` it was armed with and calls `_abandon_run` on a mismatch. `racer_by_lane` absent means *unknown*, not *no racers*, so the check sits out when the caller did not supply one.
- **`_revalidate_timers(info)` disarms proactively.** Call it from any mutation that regenerates, deletes or re-fields heats — it is already on `updateHeatResult`, `regenerateRound`, `deleteRound`, `deleteHeat` and `advanceRound`. Without it the operator only finds out after a run, holding times they must key in by hand.

### What is on the track right now

`heatSession(trackId, heatId)` merges the heat row (schedule, and results once saved) with the `TimerManager`'s pending lane times, and reports a `phase` — `NO_HEAT`, `NOT_READY`, `WAITING`, `RUNNING`, `RECORDED`. The rule is `domain/heat_session.py`; the resolver loads the two sides and calls it.

Two things it settles, because they were getting it wrong in a render function:

- **A recorded heat ignores the timer.** Anything still pending belongs to a run that has already been superseded, and showing it would contradict the standings.
- **`pending` is a field.** A time from the timer is not in the database and an abort still loses it, so the screen must not present it as final.

`phase` is *not* the timer's state (`ARMED`, `FAULT`…), which is about the device and is still reported separately as `timerState`.

Also a subscription. It watches **two** channels — `timer_state:{track_id}` for lane times and arming, and `race_state:{race_id}` for a result being saved, which is what turns `RUNNING` into `RECORDED` and never comes from the timer. `pubsub.subscribe` takes several channels for this.

`RaceExecution.tsx` renders from it and merges nothing (issue #7). **`phase` is the answer to "what is this heat doing", not `timerState`** — a recorded heat whose timer has not caught up must not show as racing. Screens read `HeatSession` / `LiveLane` from `features/racing/types.ts`; the stored `heat.lanes` are what *edits and skips write against*, since those change the record rather than the live view.

Don't reintroduce a merge on the client; extend `domain/heat_session.py` instead.

### What the operator screen does between heats

Issue #13. `RaceExecution.tsx` used to encode the race-day flow as six `useEffect`s guarding each other with mirror state, two refs, a derived boolean and an `eslint-disable react-hooks/exhaustive-deps`. It is now one machine in `features/racing/raceFlow.ts`, with `useRaceFlow.ts` as the only wiring.

**`phase` is an input to this machine, not a state of it.** The issue originally proposed a client machine reading `IDLE → PREPARING → ARMED → RUNNING → RECORDED`, but that is the *heat's* state and the server has owned it since #7. What is left is genuinely local — a countdown to the next heat, and whether a round summary is up:

```
WATCHING ──recorded, times, a next heat, auto-advance on──> COUNTING_DOWN(n)
COUNTING_DOWN ──n reaches 0──> ADVANCE_TO_NEXT_HEAT, back to WATCHING
any ──a round's field is decided──> ROUND_SUMMARY ──dismissed──> WATCHING
```

The test for whether something belongs in `raceFlow.ts` rather than on the server: **it does not survive a refresh.**

`reduce` returns commands (`PREPARE_HEAT`, `ADVANCE_TO_NEXT_HEAT`) rather than performing them, which is what makes race-day behaviour assertable without rendering — `raceFlow.test.ts` dispatches event sequences and touches no DOM. Put a *rule* there and its *I/O* in `useRaceFlow.ts`; if you find yourself writing an `if` about the race in the hook or the component, it is in the wrong file.

Two things it settles that were previously accidents:

- **Cancelling a countdown is sticky, scoped to the heat.** Nothing the server can see changed when the operator clicked, so a machine that re-decided purely from the observation would start counting again on the next payload. Moving to another heat gets a countdown back.
- **A summary's presence and its id are separate fields.** `AdvancementStatus.roundId` is optional, so `hasRoundSummary` and `roundSummaryId` cannot be collapsed into one nullable number.

`roundCompletion.ts` is the matching piece for `RaceControl.tsx`: there is no event for "a round's field was just decided", so it is recovered by comparing one query result against the last. `seen === null` means "first look", where every decided round is history rather than news.

### Printables

Pit passes, driver's licences and check-in codes. `/race/:raceId/print`, from the roster's **Print** button.

**HTML the browser prints, not server-rendered PDFs** — the plan assumed PDFs. There is no PDF toolchain on a Pi, the branding already lives in the frontend, and a sheet of sixty is a CSS grid rather than a page-composition problem. The one thing a page cannot draw for itself is the QR code, so that is the only part the server renders: `GET /api/printables/barcode/{racer_id}.png`, registered **at both `/printables/...` and `/api/printables/...`** because the Vite dev proxy strips the prefix — the `/api`-only form works in production and 404s on the machine it is written on.

**Sheet-first.** Nobody prints one pit pass; they print sixty before check-in opens. The page is the sheet, the roster's selection arrives on `?racers=`, and an *empty* selection means the whole roster rather than nothing.

**The layout numbers live in `documents.ts`, not the stylesheet.** The page has to say "2 sheets of Letter" before the operator commits paper, so the card geometry is read by both TypeScript and CSS (as custom properties set inline) rather than kept in two places. `inPrintOrder` is the other rule worth knowing: car number ascending, unnumbered racers last — they are the ones still needing a number, which is easier to spot at the bottom of a stack than the middle.

The payload is `TT1:<race_id>:<racer_id>` — versioned because these live on paper and get scanned by a later version of the app, race-scoped because a bare racer id from last year's derby resolves to whoever holds that id now. `domain/printables.py` owns encode and decode; `features/printables/scanning.ts` is its mirror on the frontend, and **both pin the literal payload in a test** so neither can drift alone.

**Scanning is Chromium-only, by decision.** `CheckInScanner.tsx` decodes with the browser's own `BarcodeDetector` rather than adding a decode library — the same trade the browser-proxied serial timer already makes. Safari and Firefox get the car-number entry and a line saying why. That entry is **not** a fallback branch: it is on screen next to the viewfinder everywhere, because a creased code with a queue behind the table is the common case. It resolves only when exactly one racer holds the number — manual numbering allows duplicates, and picking the first would check in the wrong child.

A scan has **four** outcomes, not racer-or-nothing (`scanning.resolveScan`): the racer, not one of ours, a code from another race, or a racer deleted since printing. They are separate because the operator's next move differs for each.

### First-run gate

`App.tsx` queries `initialConfig()`; if the system is unconfigured, all routes redirect to `/system-settings`, which creates the `Group` and `Track`.

---

## Known architectural debt

An architecture review is tracked in **issue #18**. Before making a substantial change, check whether it overlaps.

**Still open:**

| Issue | Area |
| --- | --- |
| #14 | Whether GraphQL is still the right choice — a question to revisit, not scheduled work. The case is materially weaker since #10, #11 and #12 |
| #15 | No authentication on mutations; CORS misconfigured. **Deferred by decision** — it adds a prompt to the operator flow |

**Closed, and load-bearing — don't undo them:**

| Issue | What it established |
| --- | --- |
| #5 | `lane_results` is normalized into `heat_lanes`; reads and writes are structured, and `laneResults` is gone from the schema. No new `json.loads` on the blob. The blob is still what gets written; #72 is the flip |
| #6 | Free race heats live in the `heats` table with `kind = FREE`. Use `models.official_heats(query)` |
| #7 | The server owns the live heat view. Don't reintroduce a merge on the client |
| #8 | `backend/domain/` is pure — no SQLAlchemy, no Strawberry |
| #11 | Query counts are guarded by `test_query_counts.py` |
| #12 | Subscriptions carry typed payloads into a normalized cache |
| #13 | The race-day flow is one machine in `features/racing/raceFlow.ts`, not effects |
| #17 | Standings cover preliminary rounds only |
| #26 | The PPC scheduler fills every lane; `test_domain_scheduling.py` holds the properties |
| #45 | `ruff check` and `ruff format --check` gate CI over `backend scripts packaging`. Keep the tree at zero findings — the point was that a lint nobody enforces accumulates debt in files nobody touches |

---

## Implementation plans (`docs/tasks/`)

Staged plans live in `docs/tasks/<area>/`, numbered in intended order. Areas: `free-race`, `graphql`, `improvements`, `install`, `observation`, `printables`, `stats`, `timers`.

**All of them are built** — free racing, observation subscriptions, hardware timers, the GraphQL migration, race stats, printables, and all five install channels — and those files are design notes, not a backlog. Every plan says so in its header, so **the absence of a `[COMPLETED]` marker is meaningful**: it means something is left, and right now nothing is.

Keep the markers honest — this is the index, and the point is that nobody has to re-derive it from the code. If you finish one, mark it, and record the departures rather than leaving the plan describing a design that was not taken.

`TODO.md` at the repo root is a mostly-completed feature checklist.

---

## What CI checks

Eight jobs on every pull request (`.github/workflows/ci.yml`):

| Job | What it would catch |
| --- | --- |
| **Lint & Types** | `ruff check`, `ruff format --check`, `mypy backend` over the whole tree |
| **Backend Tests** ×2 | The suite on 3.10 *and* 3.12 — 3.10 is the floor a Pi's system interpreter gives you, and it has caught syntax that 3.12 accepts |
| **Frontend Tests** | `eslint`, `tsc --noEmit`, `vitest` |
| **GraphQL Codegen** | A backend schema change that was not regenerated into `src/gql` |
| **Docs Build** | `mkdocs build --strict` — a broken link or a missing image, before it deploys |
| **End-to-End** | The served page, the GraphQL round trip and the normalized cache, together |
| **Doc Screenshots** | The Playwright specs that generate the documentation's images still drive the app (#114) |
| **Docker Build** | That the image builds *and starts*: it runs the container and waits on `/health` |

Two things worth knowing:

- **The release workflow has its own test gate.** CI runs on pull requests and on `main`; a tag is neither, so without it, tagging any commit publishes it to GHCR and the release page whatever state it was in.
- **The e2e suite runs against a real backend, on its own ports and its own database.** It replaced a mocked one that had been failing silently — the mocks predated the normalized cache (#12) and answered without `__typename`, which graphcache cannot store, so the page rendered nothing. Nothing ran it, so nobody found out. If you add a browser test, add it there rather than mocking the API.

### What the functional e2e specs are for

`frontend/e2e/functional/` holds two files and one shared `support.ts`: `roster.spec.ts` for the management side, `raceDay.spec.ts` for what happens once racing starts. Between them they cover generating a schedule, running a heat on the fake timer, standings arriving over the subscription, and a championship field filling from the cascade.

They exist because every *rule* in those paths is already unit-tested and none of that says the answer survives the GraphQL round trip and the normalized cache. That gap is not hypothetical: writing `raceDay.spec.ts` found the subscription snapshot race below.

Three conventions, each learned from a failure:

- **Seed through GraphQL, drive the one step under test with the browser.** `support.ts` builds the race, roster and schedule. A spec that clicks its way through setup reports a break anywhere in the app as a failure of the thing it was testing.
- **One test per question.** The docs screenshot specs are a single long `test()` where each step depends on the last, and a break a third of the way through looked for months like a spec that ran (#114).
- **The specs share one backend**, so the same rules as `e2e/docs/` apply: unique race names, no assuming a race id, and the first-run gate is only there for whichever spec goes first (`ensureConfigured` handles it either way).

**A subscription must register its queue before it sends its opening snapshot.** `pubsub.subscribe` registers on entry, so anything published earlier reaches no queue, and every payload these emit is a full snapshot rather than a delta — nothing catches up. `heatSession`, `timerStatus` and `freeRaceHeat` built the snapshot first and subscribed afterwards, and the operator screen arms the heat itself, so its own `prepareHeat` landed squarely in the window: the screen sat at "Waiting for Timer…" with the start button disabled while the timer was ARMED. `test_subscription_snapshot_race.py` pins all three by taking the opening payload and *then* publishing. The existing subscription tests could not catch it — they trigger concurrently after a 50 ms sleep, by which time the subscription has long since subscribed.

---

## Documentation

**`docs/` is part of the change, not a follow-up.** The docs are published from `main` on every merge, so a stale page ships the moment the code does. Everything below has already gone wrong at least once.

### What to update, by what you touched

| Changed | Update |
| --- | --- |
| A screen the guides describe | The `docs/*.md` page for it — and **re-run its screenshot spec** |
| GraphQL schema, a REST endpoint, a model field | `docs/design.md` §3.2 / §3.3 |
| Something `spec.md` calls unimplemented | That line in `docs/spec.md` |
| Behaviour a plan file describes | The `docs/tasks/**` header — mark it, or record the departure |
| A feature worth a user's attention | `README.md`, `docs/index.md`, and `mkdocs.yml`'s nav |
| A rule an agent needs | This file |

### The screenshots

They come from Playwright specs in `frontend/e2e/docs/` — `screenshots.spec.ts` (getting started, setup, race day), `screenshot-bulk-upload.spec.ts`, `screenshot-printables.spec.ts`, `screenshot-free-race.spec.ts`. Each builds its own data against a real backend:

```bash
cd frontend && npx playwright test --config=playwright.screenshots.config.ts e2e/docs/screenshot-printables.spec.ts
```

They write to `docs/assets/screenshots/`. That path was wrong in all three original specs — resolved one level short, into an untracked `frontend/docs/` — so regenerating a screenshot updated nothing and nobody noticed. If a run produces no diff, check where the files landed before concluding nothing changed.

**They run in CI now** (`Doc Screenshots`), because the same failure happened a second way: `screenshots.spec.ts` died a third of the way through for months, so most of the images it owns had not been regenerated by anyone (#114). Nothing compares pixels — the version stamp changes every commit — the job only checks the specs still drive the app.

Two things that job protects, both learned the hard way:

- **A spec that dies part-way looks like a spec that ran.** This one is a single 500-line `test()` where each step depends on the last, so a break anywhere silently stops every screenshot after it.
- **The CI job retries once, and gives a test five minutes rather than ten.** They drive a real backend, a real browser and a fake timer over a WebSocket on a shared runner; a heat that does not arm inside the deadline is usually that. A break that reproduces still fails twice, and a stuck spec now says so in five minutes instead of ten.
- **They share one backend when run together**, which is what CI does. That means: no two specs may use the same race name (`races.name` is unique), no spec may assume its race is id 1, and the first-run setup screen is only there for whichever spec runs first. **Regenerate images one spec at a time** — the documented command above — and the config wipes the data directory per invocation, so that run always gets a virgin system.

Fixing the harness is how three app bugs surfaced: the first-run gate bouncing back to setup, a "Round Complete!" summary over an unraced race, and identical concurrent `uploadImage` mutations not all returning.

### What the gate does and does not catch

`mkdocs build --strict` runs on every PR and catches a broken link or a missing image. **It cannot catch prose that is simply wrong**, which is the failure that actually happens. Three found in one audit: a "sort the roster by clicking a column header" tip for a table that has never been sortable, a check-in instruction pointing at the row rather than the button, and a paragraph describing a free-race history list that does not exist. Each was written accurately and then outlived its screen.

So: when a change invalidates a page, **read the page**. Grepping for the feature name is not enough — the stale sentence usually does not mention it.
