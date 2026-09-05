# Trusty Track — Agent Guide

Trusty Track is a race management system for Cub Scout Pinewood Derby events. It covers the full event lifecycle: racer registration, racing-group management, check-in, heat scheduling, race execution, hardware timer integration, audience displays, and standings.

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

## The rest of this guide

The sections below live in `.claude/rules/`, one file per area, and are **not**
loaded automatically — read the file that covers what you are about to change.
Section titles are unchanged, so a code comment citing `CLAUDE.md`'s "The public
demo" still names the section it always did; this table says which file holds it.

| Read | Before you touch | Sections |
| --- | --- | --- |
| [`heat-lanes.md`](.claude/rules/heat-lanes.md) | `heat_lanes`, `crud.set_heat_lanes`, `domain/lanes.py`, a delete path, or a heat's `kind` | `heat_lanes` is where a heat's lanes live · ⚠️ Free race heats share the `heats` table |
| [`scheduling.md`](.claude/rules/scheduling.md) | `domain/scheduling.py`, `crud.generate_heats_for_round`, lane outages, latecomers, elimination or balanced rounds, or `heat_number` | Heat scheduling (PPC) · How long a race will take · A racer who arrives after the racing has started · Balanced racing · Ladderless elimination · Master running order |
| [`scoring.md`](.claude/rules/scoring.md) | `domain/scoring.py`, `services/scoring.py`, ties, run-off heats, `services/records.py`, `domain/scale_speed.py` or `domain/lane_colors.py` | Scoring · Racing without being ranked · Run-off heats · Track records · Scale speed · Lane colours |
| [`advancement-and-awards.md`](.claude/rules/advancement-and-awards.md) | `domain/advancement.py`, `domain/awards.py`, `domain/roll_down.py`, `services/awards.py`, or the ceremony | Championship advancement · Awards · At most one trophy per racer · Voting for judged awards |
| [`roster.md`](.claude/rules/roster.md) | car numbering, `domain/roster_import.py`, `crud.create_practice_race`, `raceSetup.ts` or `weight_limit_oz` | Car numbering · Importing a roster from another derby program · The practice race · The race setup wizard · The weight limit |
| [`terminology-and-names.md`](.claude/rules/terminology-and-names.md) | `domain/terminology.py`, `domain/name_display.py`, `useTerminology()`, or any user-facing wording | Terminology · Name display |
| [`timers.md`](.claude/rules/timers.md) | `services/timer/`, a `TimerProfile`, the proxy WebSocket, or `TimerManager` | Timer integration |
| [`race-day-ui.md`](.claude/rules/race-day-ui.md) | `raceFlow.ts`, `heatSession`, `RaceExecution.tsx`, `RaceControl.tsx`, shortcuts or the chime | Race-day keys and the finish sound · What is on the track right now · What the operator screen does between heats |
| [`displays.md`](.claude/rules/displays.md) | `domain/displays.py`, `services/displays.py`, `Observation.tsx`, or the Displays panel | Telling an audience display what to show |
| [`frontend-screens.md`](.claude/rules/frontend-screens.md) | `Navigation.tsx`, `RaceDetails.tsx`, `RaceForm.tsx`, `SystemSettings.tsx`, `theming/`, `features/printables/`, or photo cropping | One row of race navigation · The roster toolbar · The race form is sectioned, except when creating · The settings page is sectioned, except the first time · Themes · Printables · Photo cropping |
| [`auth-and-demo.md`](.claude/rules/auth-and-demo.md) | `api/auth.py`, `api/demo_policy.py`, `domain/audit.py`, `api/race_lock.py`, or a schema extension | Roles and the operator PIN · The public demo · The activity log · Locking a race |
| [`ops.md`](.claude/rules/ops.md) | `services/backup.py`, the backup endpoints, HTTPS/`TRUSTYTRACK_HTTP_ONLY`, `services/discovery.py`/mDNS, or the first-run gate | Backup and restore · Networking: HTTPS by default, plain HTTP as an opt-out · Finding the instance: mDNS · First-run gate |
| [`ci.md`](.claude/rules/ci.md) | `.github/workflows/`, the release workflow, or `frontend/e2e/functional/` | What CI checks · What the functional e2e specs are for |
| [`documentation.md`](.claude/rules/documentation.md) | anything under `docs/` or `www/`, or a screenshot spec in `frontend/e2e/docs/` | Documentation · The site is one deployment, and the landing page is part of it · What to update, by what you touched · Finding the prose that just went stale · The screenshots · What the gates do and do not catch |

Everything else — orientation, layout, the data model, migrations, the GraphQL
operation lists, the conventions, the open debt — is below and stays here.

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
    awards.py         # Who wins what
    roll_down.py      # At most one trophy per racer: the resolution order, and why
    lanes.py          # Lane value object + predicates over a heat's lanes
    scheduling.py     # PPC algorithm
    scoring.py        # TIMED / POINTS aggregation and ranking
    advancement.py    # Who advances; when a round is rebuilt
    heat_session.py   # What is on the track right now: heat + timer, merged
  migrations/         # Alembic environment and versions
  services/
    awards.py         # Award recipients, resolved against the standings
    backup.py         # The install as one zip, and putting it back
    scoring.py        # Leaderboard and advancement, wired to the DB
    stats.py          # Race statistics
    records.py        # Track records: fastest cars per track, across races
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
    management/               # Home, RaceDetails, racer/racing-group forms, imports
      #   RaceDetails' roster toolbar: three controls, then an overflow
      raceSettingsSections.ts #   the race form's sections and what stops a save — pure
    racing/                   # RaceControl, RaceExecution, scheduling, free race, timer UI
      raceFlow.ts             #   the race-day machine — pure, no React
      useRaceFlow.ts          #   its only wiring to React
      roundCompletion.ts      #   noticing a round's field was decided
      lanes.ts                #   predicates over a heat's lanes
    observation/              # Audience display
    printables/               # Pit passes, driver's licences, check-in codes
      documents.ts            #   card geometry and print order — pure, no React
      scanning.ts             #   reading a scanned code back — pure, no React
    awards/                   # Trophies: speed and judged
      awardText.ts            #   saying what an award is for — pure, no React
      ceremony.ts             #   stepping through them on a projector — pure
    stats/                    # Standings, RaceStats, Leaderboard
    settings/                 # SystemSettings first-run wizard
      backupClient.ts         #   the two REST calls — no React
  gql/                        # GENERATED — do not edit (see below)
  components/ui/              # Modal, CameraCapture
  context/                    # AlertContext, SerialProxyContext
  utils/
  schema.graphql              # GENERATED from the backend schema

scripts/
  export_schema.py            # Dumps Strawberry SDL for codegen
  build_site.sh               # www/ + mkdocs, assembled into dist/
  install.sh, serve.sh, run_dev.sh, install-pi.sh

www/                          # trusty-track.com's landing page — one HTML, one CSS
docs/                         # mkdocs site, served at /docs/
deploy/
  cloudflare/                 # How trusty-track.com is published
  ghpages-redirect/           # What the old docs address now serves
```

Each `features/<area>/` slice holds its own `pages/`, `components/`, and `graphql/queries.ts`.

---

## Data model

```
Organization    id, name, debug_mode
  └─ Race[]

Track           id, name, lane_count, length_feet, timer_type, serial_port,
                timer_profile?, remote_start_installed
  └─ Race[]

Race            id, name, date_time, location, organization_id, track_id,
                car_numbering_strategy, global_start_number, scoring_strategy,
                championship_trophies, rules_configuration, auto_advance_heat,
                weight_limit_oz?
  ├─ RacingGroup[]     (cascade delete)
  ├─ Racer[]
  ├─ Round[]          (cascade delete)
  └─ Heat[]           (both kinds; see `Heat.kind`)

RacingGroup     id, race_id, name, color, division?,
                car_number_range_start, car_number_range_end

Racer           id, race_id, racing_group_id?,
                first_name, last_name, car_number, car_name, car_weight,
                car_passed_inspection, racer_image_url, car_image_url

Round           id, race_id, round_number, name, scheduling_strategy,
                advancement_source, advancement_num_racers, racing_group_id?,
                advancement_from_bottom, elimination_losses?,
                balanced_phases?

Heat            id, race_id, round_id?, kind, heat_number,
                created_at?, recorded_at?
  └─ HeatLane[]       (cascade delete; see below)

```

### Enums (`backend/db/models.py`)

| Enum                   | Values                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| `CarNumberingStrategy` | `PER_GROUP`, `GLOBAL`, `MANUAL`                                              |
| `HeatKind`             | `OFFICIAL`, `FREE`, `RUN_OFF` (#550 — settles a tie, never joins the aggregate score) |
| `SchedulingStrategy`   | `PPC`, `ELIMINATION`, `BALANCED`                                             |
| `ScoringStrategy`      | `TIMED` (avg time), `POINTS` (sum of placements) — lower is better for both  |
| `TiebreakMethod`       | `SHARED` (not resolved — the default), `BEST_TIME`, `TOTAL_TIME`, `COUNTBACK`, `HEAD_TO_HEAD` — see `domain/tiebreak.py` (#540) |
| `TimerType`            | `FAKE`, `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY`, `NONE`                   |

---

### The rest of the data model

**`heat_lanes` is where a heat's lanes live**, and **free race heats share the
`heats` table** — two rules with enough traps between them to have their own file.
Read [`.claude/rules/heat-lanes.md`](.claude/rules/heat-lanes.md) before writing a
heat, adding a delete path, or filtering on `Heat.kind`.

---

## Database migrations

Schema changes use **Alembic**. `init_db()` runs `alembic upgrade head` at startup; if migrations fail, startup fails.

**Run Alembic through `scripts/migrate.sh`, never `uv run alembic` directly** (#689). `alembic` opens whatever `TRUSTYTRACK_DATA_DIR` resolves to, which for anyone who has not set it is `~/.trustytrack` — a real install's own database, and every uploaded photograph of a child, if this machine has ever run the app. `scripts/migrate.sh` points Alembic at a fresh scratch directory instead, upgraded to head before your own command runs so `--autogenerate` diffs against a fully-migrated (if empty) schema, the same shape a real database is in.

**After changing `models.py` you must generate a migration:**

```bash
./scripts/migrate.sh revision --autogenerate -m "describe the change"
```

Review the generated file, then apply it and confirm there's no drift:

```bash
./scripts/migrate.sh upgrade head
```

```bash
./scripts/migrate.sh check
```

`alembic check` compares `models.py` against the **target database**, so it reports `Target database is not up to date` if you haven't upgraded first.

`backend/tests/test_migrations.py::test_migrations_reproduce_the_models` runs that check in CI, so a model change without a migration **fails the build**.

**The unwrapped CLI refuses on its own, too, as a backstop.** `backend/migrations/env.py`'s `_refuse_unsafe_cli_target` runs only on the path the CLI's own `engine_from_config` takes — never on `init_db()`'s, which hands the migration an already-open connection through `config.attributes` and so is unaffected whatever database it points at, exactly as it must be for the app to migrate itself at every startup. Given no explicit `TRUSTYTRACK_DATA_DIR`/`TRUSTYTRACK_DB_URL`, it refuses outright once the default database already holds a configured `Organization` — an empty or not-yet-created one, the ordinary first migration of a fresh checkout, is left alone. The message names the fix: use `scripts/migrate.sh`, set `TRUSTYTRACK_DATA_DIR` yourself, or set `TRUSTYTRACK_ALLOW_UNSAFE_MIGRATION=1` if you genuinely mean to migrate that database by hand.

**Write a `downgrade()` that works, and it is checked.** `test_every_downgrade_runs_and_lands_back_at_the_same_schema` walks the chain to `base` and back on every run; `test_a_downgrade_past_the_folded_heats_keeps_the_data` does the same with rows through `0003` and `0006`, the two migrations that carry data rather than reshape a table. An unexercised downgrade is worse than an absent one — it is only reached when somebody is already rolling back under pressure.

**`alembic check` does not compare server defaults**, and treating it as a full schema comparison is how the same drift got through twice. `test_an_adopted_database_ends_up_with_the_same_schema` now compares an upgraded legacy database against a real fresh one attribute by attribute (`_schema_snapshot`) rather than asking Alembic — reflected attributes, not DDL text, since SQLite's stored `CREATE TABLE` differs in quoting and constraint order without the schema differing.

Databases created before Alembic are detected at startup (app tables present, no `alembic_version`), stamped at `0001_baseline`, and upgraded forward. **There are three legacy shapes, not two**, and `groups.debug_mode` has now needed a migration for each: the column absent (`0002` adds it), left nullable by the old hand-rolled `ALTER` (`0004` tightens it), and — the one that hid longest — created by `create_all()` as `NOT NULL` with no server default, which is every `v1.0.0` install (`0012` restores the default). The third was invisible because the model carries a Python-side `default=False`, so the ORM supplies the value on every insert and nothing ever reads the default.

---

## GraphQL API

Defined entirely in `backend/api/schema.py`.

**Queries:** `auditLog`, `races`, `race`, `racers`, `racer`, `tracks`, `organizations`, `rounds`, `initialConfig`, `advancementStatus`, `raceStats`, `timerStatus`, `timerModels`, `heatSession`, `freeRaceHeats`, `activeFreeRaceHeat`, `randomFreeRaceLanes`, `displays`, `suggestDisplayName`, `scenes`, `scenePresets`, `version`, `networkAddresses`, `practiceRace`

**Mutations:**

- Race: `createRace`, `updateRace`, `deleteRace`
- Racer: `createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`
- Bulk: `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToRacingGroup`, `bulkDeleteRacers`, `bulkCheckIn`, `bulkAssignPhotos`, `bulkSetExcludedFromStandings`
- RacingGroup: `createRacingGroup`, `updateRacingGroup`, `deleteRacingGroup`
- Track: `createTrack`, `updateTrack`, `deleteTrack`, `setLaneOutages`
- Track records: `createTrackRecord`, `updateTrackRecord`, `deleteTrackRecord`
- Round/Heat: `createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `pinRoundField`, `unpinRoundField`, `updateHeatResult`, `reorderHeats`, `applyMasterRunningOrder`
- Timer: `prepareHeat`, `abortHeat`, `forceResults`, `releaseStartGate`, `resetTimer`, `reconnectTimer`, `startTimerTest`, `fakeTimerStart`, `fakeTimerFinish`
- Award: `createAward`, `updateAward`, `deleteAward`, `reorderAwards`
- Voting: `castVote` — the one mutation `VIEWER` may run
- Audience displays: `assignDisplay`, `advanceDisplay`, `identifyDisplay`, `renameDisplay`, `forgetDisplay`
- Display scenes (#613): `createScene`, `renameScene`, `deleteScene`, `updateSceneDisplay`, `removeSceneDisplay`, `applyScene`, `applyScenePreset`
- Free race: `startFreeRaceHeat`, `recordFreeRaceResult`, `deleteFreeRaceHeat`
- Run-off: `createRunOffHeat`, `deleteRunOffHeat`
- Intermission: `startIntermission`, `extendIntermission`, `pauseIntermission`, `resumeIntermission`, `endIntermission`
- System/data: `createInitialConfig`, `updateInitialConfig`, `importRacers`, `previewGprmImport`, `confirmGprmImport` (GrandPrix Race Manager import, #618), `previewDerbynetImport`, `confirmDerbynetImport` (DerbyNet import, #661), `uploadImage`, `populateRace`, `createPracticeRace`

**Subscriptions:** `raceStateChanged`, `racesChanged`, `timerStatus`, `heatSession`, `leaderboard`, `heats`, `onDeck`, `currentlyRacing`, `timingStats`, `freeRaceHeat`, `activeFreeRaceHeat`, `displayAssignment`, `displays`

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
  - **`mypy` gates it, and only it, strictly** (`disallow_untyped_defs`). `uv run mypy backend` runs over the whole tree in CI; the modules not yet clean are listed as *exemptions* in `pyproject.toml`, so a new module is checked from the day it is written and that list can only shrink — it is down to **one**, `api.schema`, where resolvers return ORM rows and `self` is not the type it is declared on, so most of what is left wants a `type: ignore` with a reason rather than a fix. `db.crud` and `services.timer.manager` came off once somebody counted: the list was described as all duck-typing, and between them they had seven errors, none of which were — two were real bugs. Keeping `domain/` clean is cheap because it has no ORM rows or framework shells in it — which is also why a wrong type there is worth catching. `Lane.placeholder_slot` and `Lane.real_racer_id` exist so the sign convention has one home and a checker can see through it; prefer them to `is_placeholder` / `is_real_racer` when you need the value.
- **Cascade deletes:** deleting a `Race` cascades to `RacingGroup` and `Round`, and removes its heats of both kinds; deleting a `Round` cascades to its `Heat`s.
- **Scoring is always computed on demand** in `services/scoring.py`. There is no stored leaderboard.
- **Data directory** defaults to `~/.trustytrack`; override with `TRUSTYTRACK_DATA_DIR`. Images land in `uploads/` there and are served from `/static/<filename>`.
- **The unified server** serves `frontend/dist` with an SPA catch-all. Health check at `/health`.

### Frontend

- **Generated types.** `src/gql/` and `frontend/schema.graphql` are generated — never edit them. Run `npm run codegen` after any backend schema change; CI fails if they're stale. See `src/gql/README.md`.
- **Prefer deriving view types** from generated operation types rather than hand-writing interfaces. See `features/racing/types.ts`.
- **Write documents with urql's `gql` tag**, give every operation a **unique name**, and codegen will type it. Plain template literals still work at runtime but get no types.
- **The subscription socket's retry and keep-alive settings are deliberate, not defaults** (`api/liveConnection.ts`). `graphql-ws` gives up permanently after five reconnections, which is about thirty seconds of backoff — less than an access point reboot — and never pings an idle socket, so a half-open connection produced by wifi dropping a client fires no close event and triggers no retry at all. That second one is the dangerous case: the screen shows its last payload indefinitely while believing it is connected. Setting `keepAlive` is not sufficient on its own; the library sends the pings and does nothing when no pong returns, so `pingWatchdog` closes the socket and turns the hang into a close event. Don't "simplify" these back to defaults.
- **urql request policy:** mutations re-fetch with `'network-only'`. Not on the first-run gate in `App.tsx`, where it never did anything — `Routes` renders one matched element and every route's element is a `ProtectedRoute`, so changing route updates that component's children rather than remounting it, and a mount-only policy refetches once per page load. Freshness there comes from `forgetInitialConfig` in `api/graphqlClient.ts` invalidating the field when a config mutation changes it.
- **Two concurrent mutations with identical variables are one operation.** urql keys an operation on its document plus its variables, and with the normalized cache in the chain only one of a colliding pair gets a result back — the other never settles. Reproduced in `graphqlClient.test.ts`'s neighbourhood and fixed at the call site in `BulkPhotoUploadModal` (#116) by issuing one request per distinct image. Anything doing `Promise.all` over the same mutation wants distinct variables, or one request with the duplicates folded in.
- **Alerts:** use `useAlert()` from `AlertContext`. Never `window.alert`.
- **Styling:** CSS custom properties defined in `src/index.css` — `var(--scouting-blue)` (#003F87), `var(--cub-scouting-gold)` (#FCD116). Existing class naming (`.race-details`, `.racer-table`). Standard border-radius 12px.
- **Drag and drop:** `@dnd-kit`, see `ScheduleManagement.tsx`.

---

---

## Known architectural debt

The architecture review of 2026-07-24 is **closed** ([#18](https://github.com/dknowles2/trusty-track/issues/18)) — all three of its theses are resolved and its backlog is empty. It is worth reading before a substantial change anyway, not as a tracker but as a retrospective: it records which of its own premises expired between filing and implementation, what verification caught that reading the code did not, and when a surviving mutation is evidence versus a broken harness. None of that is re-derivable from the tree.

**Still open:**

| Issue | Area |
| --- | --- |
| [#112](https://github.com/dknowles2/trusty-track/issues/112) | SuperTimer II timer profile. **Needs hardware** — two-part results, a binary lane mask and a 10000 scale factor, none reusable, and a test written from the same notes as the profile would agree with its mistakes. Not engineering work |
| [#301](https://github.com/dknowles2/trusty-track/issues/301) | A second proxy WebSocket silently takes over the timer — the manager's write function is repointed and neither screen says so |
| [#299](https://github.com/dknowles2/trusty-track/issues/299) | A screen that never got a subscription: the roster across devices |
| [#296](https://github.com/dknowles2/trusty-track/issues/296), [#297](https://github.com/dknowles2/trusty-track/issues/297) | The demo: a private instance per visitor, and a reset timer an always-on host would need |
| [#501](https://github.com/dknowles2/trusty-track/issues/501) | Themes: the ~140-file inline-colour-literal migration #498 called out as its own milestone. Most of the app still does not respond to a theme change |

**Closed, and load-bearing — don't undo them:**

| Issue | What it established |
| --- | --- |
| #5 | `lane_results` is normalized into `heat_lanes`; reads and writes are structured, and `laneResults` is gone from the schema. #72 finished it — the column is dropped and `heat_lanes` is the only copy |
| #6 | Free race heats live in the `heats` table with `kind = FREE`. Use `models.official_heats(query)` |
| #7 | The server owns the live heat view. Don't reintroduce a merge on the client |
| #8 | `backend/domain/` is pure — no SQLAlchemy, no Strawberry |
| #11 | Query counts are guarded by `test_query_counts.py` |
| #12 | Subscriptions carry typed payloads into a normalized cache |
| #13 | The race-day flow is one machine in `features/racing/raceFlow.ts`, not effects |
| #17 | Standings cover preliminary rounds only |
| #26 | The PPC scheduler fills every lane; `test_domain_scheduling.py` holds the properties |
| #45 | `ruff check` and `ruff format --check` gate CI over the whole tree (`uv run ruff check .` / `uv run ruff format --check .`, which also covers Python code blocks inside Markdown files, not just `backend scripts packaging`). Keep the tree at zero findings — the point was that a lint nobody enforces accumulates debt in files nobody touches |
| #125 | Foreign keys are enforced on every connection, and `heat_lanes` carries `ON DELETE` actions. Deletion ordering is the schema's rule, not Python's |
| #14 | **Keep GraphQL.** 48 mutations against 17 queries — the cost sits where GraphQL adds nothing, and does not shrink in REST |
| #72 | `heats.lane_results` is dropped. `heat_lanes` is the only copy; migration `0013` proved that per database rather than waiting on a release |
| #164 | `Lane` mirrors the table — `placeholder_slot` and `skipped` are fields. The negative-id convention survives only in `domain/scheduling.py`, crossed at `lanes.from_participant` |
| #172 | A late racer is admitted on check-in. Same three cases as #171, and `disrupted` is the same flag |
| #173 | The heat sheet is a table document, and CSV lives in `utils/csv.ts` |
| #192 | A PIN is removed by an explicit control, never by an empty field — blank still means "leave alone" |

---

## Where the design record lives

**`docs/tasks/` is gone.** It held staged implementation plans for nine areas — `demo`, `free-race`, `graphql`, `improvements`, `install`, `observation`, `printables`, `stats`, `timers` — and every one of them shipped, so what was left was a backlog nobody read beside a set of design notes this file had already absorbed. Keeping both meant keeping them in step, and the markers on those files drifted the moment somebody finished something without going back.

So the record is split in two, by what it is:

- **Why the code is the way it is** — including the departures, the measurements, and the designs that were considered and not taken — is in this file and in the `.claude/rules/` files it indexes, next to the rule it explains.
- **What is not built** is a GitHub issue. See the "Still open" table above. A backlog belongs where a backlog is looked at.

Two consequences worth knowing. `docs/derbynet-timer-protocol.md` came out of `tasks/timers/` because it is not a plan — it is the DerbyNet protocol every profile in `services/timer/devices/` was written against, and `docs/spec.md` links it. And the plans themselves are recoverable from git history if a decision's original reasoning is ever wanted; `git log --diff-filter=D -- docs/tasks` finds the commit that removed them.

**Don't reintroduce a plan directory.** Write the rule here when it lands, and open an issue for what has not.

**A rule goes in the `.claude/rules/` file for its area, not here.** This file is the router: it holds what is true across the whole tree — the layout, the data model, the operation lists, the conventions — and an index of everything else. It was one 359 KB file, which is about 88k tokens loaded into every session before an agent had read a line of code; the split is what makes the record affordable to keep. Adding a section here rather than to the file that covers its area is how it grows back. When a new area needs a file of its own, add it to the index table above — an unindexed file is one nobody opens.

---

---
