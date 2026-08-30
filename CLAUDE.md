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
| `HeatKind`             | `OFFICIAL`, `FREE`                                                           |
| `SchedulingStrategy`   | `PPC`, `ELIMINATION`, `BALANCED`                                             |
| `ScoringStrategy`      | `TIMED` (avg time), `POINTS` (sum of placements) — lower is better for both  |
| `TiebreakMethod`       | `SHARED` (not resolved — the default), `BEST_TIME`, `TOTAL_TIME`, `COUNTBACK`, `HEAD_TO_HEAD` — see `domain/tiebreak.py` (#540) |
| `TimerType`            | `FAKE`, `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY`, `NONE`                   |

### `heat_lanes` is where a heat's lanes live

```
HeatLane        id, heat_id, lane, racer_id?, placeholder_slot?,
                time_seconds?, place?, skipped
```

One row per lane. It separates the four jobs the old `Heat.lane_results` JSON
blob did at once — the schedule, the results, unadvanced championship slots (as
*negative* racer ids), and heat status inferred by scanning for a time.

**`domain.lanes.Lane` mirrors those columns exactly** ([#164](https://github.com/dknowles2/trusty-track/issues/164)). `placeholder_slot` and `skipped` are fields, not a sign trick and an `extra` dict — so an undecided slot has `racer_id is None`, and `Lane.is_empty` asks about **both** fields. That last point is the trap: a placeholder used to hold a negative id and so was never "empty", and `is_complete` skips empty lanes, so an `is_empty` that asked only about `racer_id` would call a round of undecided slots finished. `resolve_placeholders` clears the slot when it fills one, for the same reason — writing the racer over a negative id *was* the clear.

**The negative-id convention survives in exactly one place, and it is not storage.** `domain/scheduling.py` matches *opaque* participant ids and hands out negative ones for slots; teaching a matching algorithm about advancement would be worse. `lanes.from_participant` is the only crossing on the write path — use it rather than `Lane(racer_id=...)` when the id came from the scheduler.

**The blob is gone** ([#5](https://github.com/dknowles2/trusty-track/issues/5),
[#72](https://github.com/dknowles2/trusty-track/issues/72)). `heats.lane_results`
was dropped in migration `0013`, and with it `lanes.parse`, `serialize`,
`from_dict`, `to_dict` and `carry_extras`. There is one copy of a heat's lanes.

#### One copy, one door

Rows are built from the lane *values* a writer supplied. `crud.set_heat_lanes` —
the one door — hands them to `backend/db/lane_sync.py`, which writes them
immediately for a heat that already has an id, and stages them for the
`after_flush` listener when it does not (a newly constructed heat has no id, and
the rows need one).

That split is worth knowing, because getting it wrong was silent. While
`lane_results` was still written alongside, *that* assignment is what made the
instance dirty and pulled it into the flush the listener watches. `STAGED` is
not a mapped attribute, so once the column went, an update to an existing heat
marked nothing dirty — and `Session.commit` does not flush a clean session.

- **Write heats through `crud.set_heat_lanes`.** `test_heat_lanes_write.py`
  asserts nothing else in the backend package constructs a `HeatLane` or inserts
  into the table. That guard replaces `lanes_out_of_sync` and the autouse
  `conftest.py` assertion behind it, which compared the two copies after every
  test in the suite; with one copy there is nothing to compare, so the property
  is held earlier instead — the write cannot happen rather than being detected.
- **Deletion is the schema's job**, not Python's. See below.

**Migration `0013` proved the drop rather than assuming it.** The column was the
only copy of anything the table does not model, so it rebuilt every blob from
`heat_lanes`, compared, and copied the ones that did not match into
`heat_lane_blob_archive` before dropping. That table is expected to be empty; a
non-empty one is a real operator's data, kept. Three things land in it: a time
that is not a number (`heat_lanes.time_seconds` is a float), a key no version
ever wrote, and a lane naming a racer who no longer exists — the blob being the
only record of who it was. `0013`'s downgrade restores the column from the table
plus the archive, so down-and-back-up is lossless. `test_lane_results_drop.py`
pins all of it against a `v1.0.0`-shaped database.

#### Foreign keys are enforced, and deletion is the database's job

SQLite defaults enforcement **off**, and the default is per *connection* rather than per database. For most of this project's life nothing turned it on, so every `ForeignKey` in `models.py` was documentation ([#125](https://github.com/dknowles2/trusty-track/issues/125)). `database._enforce_foreign_keys` is a `connect` listener on the `Engine` **class** — not on one engine, because `TimerManager` writes through its own `SessionLocal` (#9), the Alembic CLI builds its own, and the suite keeps another.

Two things this cost, both worth knowing before touching them:

- **Migrations suspend enforcement, and the restore does not stick.** `PRAGMA foreign_keys` is a no-op inside a transaction, and the migration run has opened one by the time `migrations/env.py`'s suspension ends. The connection went back to the pool with enforcement off and every session afterwards inherited it — the app ran unenforced while the whole suite reported otherwise. `init_db()` therefore calls `engine.dispose()` at the end, so the next connect re-runs the listener. `test_foreign_keys.py::test_enforcement_survives_init_db` is the only test in the tree that goes down the operator's path.
- **Five delete paths were removing a parent while lane rows still pointed at it** — `delete_heat`, `delete_round`, `generate_heats_for_round`'s `clear_existing` branch, `bulk_delete_racers` and `delete_race`. Each was correct only because nothing was checking.

**`heat_lanes` carries `ON DELETE CASCADE` on `heat_id` and `ON DELETE SET NULL` on `racer_id`.** Fixing those five by reordering call sites would leave the constraint depending on every future caller remembering; the clause puts the rule where the relationship is, and it is the one [#72](https://github.com/dknowles2/trusty-track/issues/72) step 4 wanted anyway. `lane_sync` no longer cascades deletions in Python — it did so twice, and the `after_flush` half ran *after* the `DELETE FROM heats` a real constraint refuses. Don't add that back: put an `ON DELETE` action on the relationship instead.

**Deleting a racer vacates the lanes *before* the delete, not after** (`crud._vacate_lanes`). The clause covers `racer_id`; the lane's `time` and `place` go too. None of that can be done afterwards — `ON DELETE SET NULL` fires the moment the delete lands, so a later pass has no racer id left to match on. The two `_remove_racer_from_*` helpers this replaces got away with looking afterwards only by parsing the blob, which still named the racer.

One thing that ordering forces, and it is not obvious: **which rounds may be rebuilt is decided first of all**, before anything is vacated. Vacating clears times, and a round with no times left looks like a round that was never raced — so asking afterwards regenerates a started round and destroys the results the check exists to protect. Four tests catch that inversion.

**`loaders.scheduled_racer_ids` is one `DISTINCT`** over `heat_lanes` rather than a load of every heat and a parse of each blob — the first of the wins #5 predicted to actually arrive, guarded by an exact count in `test_query_counts.py`. Note it needs no placeholder special case: the table holds a slot as `placeholder_slot` with a null `racer_id`, so the blob's negative-id convention simply is not there.

**Scoring and stats read through `crud.lanes_for_heats`** — one query for a whole set of heats, so a caller that already has them does not pay per heat. The GraphQL read path uses `loaders.lane_values_for_heat`, which is the same values off the loaders' existing per-race batch; the mutation resolvers use `schema._stored_lanes`, which is one heat and so cannot N+1.

**The backend reads lanes through `crud._round_heat_lanes`**, which comes off the table, not off `lanes.parse` — it is the choke point for `is_round_complete`, `field_is_short` and `may_rebuild`, so all three moved together. Two queries rather than one join, deliberately: a join from `heat_lanes` drops a heat that has no lane rows, where parsing gave it `[]` and kept it, and the last two rules reason about the *number* of heats. `lanes.from_parts` is the crossing back — it re-encodes `placeholder_slot` as a negative racer id and puts `skipped` back in `extra`, because that is still what `Lane` holds. `test_lane_reads.py` pins each of those, and each fails to a one-line mutation.

**Nothing reads a blob any more, because there is not one.** Lanes come from `crud.lanes_for_heats`, `crud.heat_lanes_of`, or `loaders.lane_values_for_heat`. Outside `migrations/`, which speak the storage format by definition, no JSON is involved.

**Reading: use `Heat.lanes` / `FreeRaceHeat.lanes`.** The GraphQL read path is structured and comes from the table:

```graphql
lanes { lane racerId placeholderSlot time place skipped }
```

It separates the things the blob conflated: a placeholder slot is `placeholderSlot`, not a negative `racerId`; `skipped` is a field; `time` is always a number, never the string the frontend sometimes wrote.

**`laneResults` is gone from the schema.** The raw blob was handed out as a string alongside `lanes` while the client moved across, and has been removed — an API offering both invites new code to take the untyped one. The blob is still the storage format; nothing outside the backend sees it.

**Writing goes through one door.** `crud.set_heat_lanes(heat, lanes)` is the only place a heat's lanes are stored — nine call sites used to assign `lane_results` themselves. Making `heat_lanes` authoritative ([#72](https://github.com/dknowles2/trusty-track/issues/72)) is then a change to that one function rather than to nine places that each have to remember, and `test_heat_lanes_write.py` walks the backend package's AST to keep it that way. `record_heat_result` takes lanes rather than a serialized blob for the same reason — it was the last signature in the codebase that spoke the storage format instead of the value.

**Writing is structured too.** `updateHeatResult` and `recordFreeRaceResult` take `[HeatLaneInput!]!` — the same fields, so what a screen reads is what it sends back:

```graphql
mutation($heatId: Int!, $lanes: [HeatLaneInput!]!) {
  updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
}
```

`_lanes_from_input` in `schema.py` converts. It used to take the stored blob too, so `lanes.carry_extras` could preserve keys a client cannot see and so cannot send back; `heat_lanes` models every field there is, so there is nothing left to carry.

On the frontend, no code parses lane JSON any more. Screens read `lanes`, ask about a heat through the named predicates in `features/racing/lanes.ts` (`hasRun`, `hasTimes`, `wasSkipped`, `byPlace`), and send changes back with `toInput` / `cleared`. Build heat fixtures with `features/racing/testFixtures.ts`.

### ⚠️ Free race heats share the `heats` table

A free race heat is a `Heat` with `kind = FREE` and no `round_id` (issue #6). It is an exhibition run: the timer records it and the audience display shows it, but **scoring, scheduling, advancement and statistics must exclude it**.

**Use `models.official_heats(query)`** rather than writing the filter out, so its absence is visible at the call site. The paths that depend on it are `crud.get_heats`, `loaders.heats_for_race`, `compute_race_stats`, and the `onDeck` / `currentlyRacing` subscriptions; `test_heat_kind.py` inserts a free heat and checks each one. **`timingStats` and `delete_race` deliberately do *not* filter** — both take either kind. `timingStats` shows the heat that just happened, and an exhibition run is the thing that just happened when it is (#59); `delete_race` is removing all of them.

Heat IDs used to be ambiguous: `heats` and `free_race_heats` had independent autoincrement sequences, so anything holding a bare ID had to carry a `HeatKind` alongside it, and inferring the kind by looking an ID up in one table and falling back to the other wrote free-race times into official heats (issue #4). One table means one sequence, so an ID is unambiguous and code reads the kind off the heat rather than being told it.

**"Has this heat been run" is one question for both kinds**: whether any lane holds a time (`lanes.has_results`). A free heat's lanes are written when it is created, exactly as a generated official heat's are. `FreeRaceHeat.recorded` in GraphQL exposes this; it replaces testing `laneResults` for null.

#### Three predicates, and which one you want

`lanes.has_results`, `lanes.is_finished` and `lanes.is_complete` are deliberately different, and #55 and [#224](https://github.com/dknowles2/trusty-track/issues/224) were each picking (or restating) the wrong one:

| Question | Predicate | Skipped heat |
| --- | --- | --- |
| Would rebuilding this lose a result? | `has_results` — any lane has a time | not finished; a skipped round may be regenerated |
| Should the running order move on? | `is_finished` — any lane has a time **or** is skipped | finished; the operator is not coming back to it |
| Is this heat *settled* — may advancement fire? | `is_complete` — every assigned lane has a time, a place, **or** is skipped; a placeholder never settles | settled; the round is as decided as it will ever be |

**`is_complete` accepts a place without a time and a skipped lane**, and both loosenings were bug fixes ([#224](https://github.com/dknowles2/trusty-track/issues/224)). It used to demand a time, so one skipped heat left its round incomplete forever and every later championship round silently never filled — and `advancementStatus` had a private copy of the rule that *did* accept place-without-time (how a POINTS race is hand-entered), so the operator screen said ready while `trigger_auto_advancements`, reading the domain rule, never fired. The copy is gone; `advancementStatus` reads `advancement.is_round_complete`. Don't reintroduce a second copy.

Anything deciding **what is on the track or what is next** wants `is_finished` (`schema._unfinished` wraps it for the `onDeck` / `currentlyRacing` subscriptions). Anything guarding **the stored record** wants `has_results`. `timingStats` is the third case and wants `has_results` for its own reason: it displays results, and a skipped heat has none. `hasRun` in `features/racing/lanes.ts` is `is_finished`'s counterpart on the frontend.

**`recorded_at` is when, and it is the only thing the two kinds can be ranked on together** (#59). `created_at` cannot: for a free heat it is roughly when it ran, for an official heat it is when the *round was generated*. Schedule order cannot either — it says nothing about a heat being re-recorded. `crud.stamp_recorded` keeps `recorded_at` non-null exactly when the heat holds a result, including clearing it on a re-run, and only the two result-recording functions call it: editing a schedule is not running a heat.

Both take parsed lanes. The three audience subscriptions and `loaders.scheduled_racer_ids` were wrong in the same way: they tested lane *index 0* for a time, so a skipped heat, or a heat whose first lane had been vacated by a deleted racer, pinned both wall displays one heat behind for the rest of the event. `services/stats.py` was the last holdout — it parsed the blob itself, so a heat whose blob was not a list of lanes took the whole stats page down rather than being skipped. That failure is now unrepresentable: a lane is a row.

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

**Write a `downgrade()` that works, and it is checked.** `test_every_downgrade_runs_and_lands_back_at_the_same_schema` walks the chain to `base` and back on every run; `test_a_downgrade_past_the_folded_heats_keeps_the_data` does the same with rows through `0003` and `0006`, the two migrations that carry data rather than reshape a table. An unexercised downgrade is worse than an absent one — it is only reached when somebody is already rolling back under pressure.

**`alembic check` does not compare server defaults**, and treating it as a full schema comparison is how the same drift got through twice. `test_an_adopted_database_ends_up_with_the_same_schema` now compares an upgraded legacy database against a real fresh one attribute by attribute (`_schema_snapshot`) rather than asking Alembic — reflected attributes, not DDL text, since SQLite's stored `CREATE TABLE` differs in quoting and constraint order without the schema differing.

Databases created before Alembic are detected at startup (app tables present, no `alembic_version`), stamped at `0001_baseline`, and upgraded forward. **There are three legacy shapes, not two**, and `groups.debug_mode` has now needed a migration for each: the column absent (`0002` adds it), left nullable by the old hand-rolled `ALTER` (`0004` tightens it), and — the one that hid longest — created by `create_all()` as `NOT NULL` with no server default, which is every `v1.0.0` install (`0012` restores the default). The third was invisible because the model carries a Python-side `default=False`, so the ORM supplies the value on every insert and nothing ever reads the default.

---

## GraphQL API

Defined entirely in `backend/api/schema.py`.

**Queries:** `auditLog`, `races`, `race`, `racers`, `racer`, `tracks`, `organizations`, `rounds`, `initialConfig`, `advancementStatus`, `raceStats`, `timerStatus`, `timerModels`, `heatSession`, `freeRaceHeats`, `activeFreeRaceHeat`, `randomFreeRaceLanes`, `displays`, `suggestDisplayName`, `version`, `networkAddresses`

**Mutations:**

- Race: `createRace`, `updateRace`, `deleteRace`
- Racer: `createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`
- Bulk: `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToRacingGroup`, `bulkDeleteRacers`, `bulkCheckIn`, `bulkAssignPhotos`
- RacingGroup: `createRacingGroup`, `updateRacingGroup`, `deleteRacingGroup`
- Track: `createTrack`, `updateTrack`, `deleteTrack`, `setLaneOutages`
- Track records: `createTrackRecord`, `updateTrackRecord`, `deleteTrackRecord`
- Round/Heat: `createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `updateHeatResult`, `reorderHeats`, `applyMasterRunningOrder`
- Timer: `prepareHeat`, `abortHeat`, `forceResults`, `releaseStartGate`, `resetTimer`, `reconnectTimer`, `startTimerTest`, `fakeTimerStart`, `fakeTimerFinish`
- Award: `createAward`, `updateAward`, `deleteAward`, `reorderAwards`
- Voting: `castVote` — the one mutation `VIEWER` may run
- Audience displays: `assignDisplay`, `advanceDisplay`, `identifyDisplay`, `renameDisplay`, `forgetDisplay`
- Free race: `startFreeRaceHeat`, `recordFreeRaceResult`, `deleteFreeRaceHeat`
- System/data: `createInitialConfig`, `updateInitialConfig`, `importRacers`, `uploadImage`, `populateRace`, `createPracticeRace`

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

## Business logic highlights

### Heat scheduling (PPC)

`docs/scheduling-algorithms.md`. The algorithm is `domain/scheduling.py`; `crud.generate_heats_for_round` decides who is in the field and writes the rows.

Lane 1 is seeded with every racer, which fixes the heat count at one per racer; remaining lanes are filled greedily, preferring a racer who has not yet run that lane and has met the current occupants least often.

Greedy alone finds a *maximal* matching, not a *maximum* one, so it used to strand a lane in roughly 1 in 4 four-lane schedules — giving one racer a heat fewer, which under `POINTS` scoring made their score *better*. Fixed in #26 by repairing the greedy result with augmenting paths. `test_domain_scheduling.py` holds the properties; **every heat is full** is the one that regressed silently for a long time, so keep it.

**`generate_ppc` takes *which* lanes, not how many** (#171, step 1). `usable_lanes` is a sequence of lane numbers — `[1, 2, 4]` when lane 3's sensor has failed — and every property is stated over that set. It sorts and de-duplicates, and an empty set schedules nothing rather than heats of empty lanes.

That makes a heat's **position** in the schedule and its **lane number** different things, which they never were before. `HeatPlan.lane_numbers` carries the mapping and **`HeatPlan.assignments` is what callers consume**; `enumerate(plan.lanes)` was the old idiom and with a gap it writes lane 4's racer into lane 3. Both write paths do this — `crud._generate_ppc` and `crud._reset_heats_in_place`, which builds its own schedule (#50) — and each has a test that fails to the one-line reversion. On an undamaged track the two agree, so nothing else in the suite can tell the difference.

**`crud.usable_lanes_for_race` is the one place that decides** — every lane the track has, less its outages. Several call sites read it, and #48 is why it is a function rather than the expression written out at each. Free racing went near none of them until [#303](https://github.com/dknowles2/trusty-track/issues/303): the random draw, `prepare_heat`'s anonymous-arm fallback and `fake_timer_finish`'s matching fallback all used to fall back to raw `track.lane_count` instead, so a lane out of service was armed and timed like any other. The two mutation fallbacks now read the mask off the heat's own stored lanes rather than the track — which is also what lets the Free Race screen's session-only per-lane toggle reach them without a second server-side list: a lane the operator switches off for the session simply never gets a row when the heat is created.

**A `LaneOutage` row means "this lane does not work"; its absence means it does** (#171, step 2). A row per outage rather than a list on `Track`: a schedule asks for a *set* of lanes, and a set of small integers in a string column is the shape #5 spent a release removing. There is deliberately no `is_out_of_service` flag — a row saying a lane works can disagree with its own absence. Scoped to the **track**, since the sensor is hardware in the room and a venue running two races has the same dead lane in both.

`crud.set_lane_outages` takes the whole set, because the screen is a row of checkboxes and a repaired lane is simply absent. **The control lives inside the track's own card in System Settings**, under the lane count — it was briefly a separate section at the foot of the page, which meant repeating the track's name to say which track it meant, a reliable sign of something being in the wrong place. It saves on click rather than on **Save Settings**, and says so: a lane goes out of service mid-event, and a track with no id yet (added but not saved) gets no control at all. It drops lanes outside `1..lane_count`: a stale outage on lane 6 of a track since reconfigured to four would never appear on screen to be un-set.

**Setting an outage brings existing heats into line too** (`crud.apply_outages_to_scheduled_heats`), and what happens depends on how far the round has got:

| Round | What happens |
| --- | --- |
| nothing raced | regenerated for the remaining lanes — nothing is at risk, so everybody gets an equal schedule |
| part-way through | recorded heats untouched; the dead lane is vacated from the pending ones; `Round.disrupted` set |
| finished | untouched |

**The middle case is the whole design problem, and `disrupted` is a flag rather than a correction because the cost depends on the scoring strategy.** Racers in the vacated lanes raced fewer times than everyone else. `TIMED` averages, which is scale-free, so the round is still good evidence; `POINTS` **sums** placements, so a racer with one heat fewer scores *better* — #26 arriving by a third route. `domain/scoring.counts_a_disrupted_round` states that difference once, and `services/scoring._scoring_heats` drops disrupted rounds under `POINTS` only. An explicit `round_id` overrides it: a screen asking for one round's standings is showing that round, and a blank page is a worse answer than the results it holds.

**Ids survive.** The pending heats are rewritten through `set_heat_lanes` rather than deleted and regenerated, so an armed heat is not swapped underneath the operator (#50) — and `setLaneOutages` awaits `_revalidate_timers` for the round it *does* regenerate. That await is not decorative: it was missing on the first attempt, the tests passed, and the only evidence was a `coroutine was never awaited` warning.

**Turning a track's `lane_count` down is the same problem by a second route** (#325) — `updateTrack` used to write the new count and stop, leaving heats holding racers on lanes that no longer exist. `apply_outages_to_scheduled_heats` reads `usable_lanes_for_race` rather than the `LaneOutage` rows directly, which is what lets the one function cover both: a shrunk `lane_count` changes what counts as usable without adding an outage row for the old logic to have noticed. `updateTrack` calls it, awaits `_revalidate_timers` and publishes race state, exactly as `setLaneOutages` does — only when the count went down; growing it or leaving it unchanged touches nothing.

### A racer who arrives after the racing has started

Rule in `domain/latecomers.py`, database wiring in `crud.admit_late_racers` (#172). **The same three cases as a lane going out of service, and deliberately so** — both are "a round already under way has to change, and the heats people ran must survive it":

| Round | What happens |
| --- | --- |
| nothing raced | regenerated with the newcomer in it — the outcome to prefer whenever it is available |
| part-way through | recorded heats untouched; heats appended at the end; `Round.disrupted` set |
| finished | untouched; they join from the next round |

**`disrupted` is the same flag with the same justification**, so `counts_a_disrupted_round` needed no change: whoever fills the other lanes of the appended heats runs more often than their peers, and under `POINTS` an extra heat can only add to a total where lower is better. This is #26 arriving by a fourth route.

**What admission has to get right is lane balance, not opponents.** A newcomer takes each usable lane exactly once — PPC exists because lanes are not equal, and who you race matters far less. Newcomers fill each other's remaining lanes before any established racer is pulled in, so two children arriving together share heats rather than each dragging a separate set of veterans into extra runs.

**Check-in is the trigger, not creation.** `car_passed_inspection` is what the generator fields from, so a racer on the roster and not yet inspected is not eligible for a heat. Four resolvers call `_admit_late_racers` — `createRacer`, `updateRacer`, `checkInRacer` and `bulkCheckIn` — which is #48's shape again; the function is idempotent and asks who is *missing* rather than being told who arrived, so `bulkCheckIn` calls it **once for the batch**. Per-racer it would regenerate an unraced round sixty times over a desk queue.

**Only general rounds.** A championship field is drawn from the standings; a latecomer becomes eligible for it by racing the preliminaries. Note the test for this has to *advance* the final first — while it still holds placeholders, dropping the championship filter regenerates it into an identical round of placeholders and the check passes either way.

`_admit_late_racers` awaits `_revalidate_timers` for the same reason `setLaneOutages` does: the unraced case rebuilds heats, and an armed heat must not be swapped underneath the operator (#50).

On the roster, `features/management/rosterStatus.ts` is what puts a **No heats** badge against a racer who is checked in and in none — the one case admission cannot fix, where they arrived after the round finished. It is quiet until a round exists: before the first one nobody is scheduled, and flagging the whole roster is how an operator learns to ignore a badge.

### Balanced racing

Rules in `domain/balanced.py`, wiring in `crud` (`generate_heats_for_round`'s `BALANCED` branch and `extend_balanced_round`, on the same cascade seam as elimination). GPRM calls the method "Dynamic": the first phase is random; each later phase ranks the field — most heat wins, then fewest **points per heat** — and races neighbours against neighbours, so winners race winners and the other heats are winnable. The stated goal is maximizing how many racers win at least one heat. The round ends after `Round.balanced_phases` phases (default: the track's lane count, GPRM's own advice). Lane assignment within a heat goes to whoever has used that lane least — best effort, since the matchups come first.

Three ways it differs from elimination, each deliberate:

- **Balanced heats feed the ordinary standings.** Everyone races once per phase, so a `POINTS` sum and a `TIMED` average are both fair over it — no exclusion. The one exception is #172's: a latecomer joins the next phase with fewer heats than everyone else, so `extend_balanced_round` sets `Round.disrupted`, and `POINTS` standings drop the round exactly as they do for a lane outage.
- **Ranking is points per heat, not GPRM's raw total** — a raw total ranks a latecomer's empty record above cars that raced well all day. A racer with no heats sorts *last* (`Record.average_points` and `performance_order`): an unknown record is not a leading one.
- **Completeness is a phase count, not a winner** — `crud.is_round_complete` requires `max(appearances) >= balanced_phases`. The same deleted-pending-phase trap as elimination applies and is tested.

The championship refusal, the append-only growth, the latecomer-never-restarts logic and the `admit_late_racers` skip are all shared with elimination, and the modal's "How it's raced" choice carries all three styles.

### Ladderless elimination

Rules in `domain/elimination.py`, wiring in `crud` (`generate_heats_for_round`'s `ELIMINATION` branch and `extend_elimination_round`). A general round with `scheduling_strategy = ELIMINATION`: a **loss** is any heat a car does not win (second of four counts the same as fourth; a DNF is a loss; a *skipped* lane is neither), a car is out at `Round.elimination_losses`, and the last car standing wins. Sources: McGrew's Derby Race Methods and Stan Pope's No-Chart N-Elimination.

**The schedule grows a wave at a time, from the recorded-result cascade.** `generate_heats_for_round` writes only the first wave; `extend_elimination_round` runs on every result (before `trigger_auto_advancements` in `record_heat_result`) and appends the next wave once every scheduled heat is finished — append-only, so an armed heat is never swapped underneath the operator (#50). Everything is recomputed from the finished heats — the same state-not-event shape as [#248](https://github.com/dknowles2/trusty-track/issues/248) — so a corrected earlier result just changes who the next wave holds. Waves group cars by loss count (undefeated race the undefeated), and nobody races alone: a leftover single car spills into the adjacent group's heat.

Five rules that are each a way of getting it wrong:

- **`crud.is_round_complete` asks whether a winner exists**, not just whether every scheduled heat is finished — between waves everything is finished and nothing is decided, and the reachable trap is an operator deleting the pending wave: without the branch a downstream championship round fills itself from a race still going.
- **A never-raced car never loses, so completeness and the leaderboard both filter to who is still checked in** ([#313](https://github.com/dknowles2/trusty-track/issues/313)). A car whose lanes are always skipped sits at zero losses forever — a skip is neither a win nor a loss — so `extend_elimination_round` keeps re-fielding it every wave while it stays checked in. Withdrawing it is the only way out, and `crud.is_round_complete` filters losses to `crud.eligible_racer_ids` before asking whether the round is decided — the same population `extend_elimination_round` fields the next wave from — so the withdrawn car stops counting as a second car still alive. `_elimination_leaderboard` filters the same way, for the same reason: unfiltered, that car ties the actual winner for first with zero heats raced.
- **Elimination heats never feed the aggregate standings** (`services/scoring._scoring_heats`), including through the "no prelim rounds" fallback. Heat counts are uneven *by design* — an eliminated car races fewer heats — which is #26's failure shape under `POINTS` and skews a `TIMED` average toward early knockouts. The round's result is survival, read via its own round-scoped leaderboard (`_elimination_leaderboard`: score = losses, survivors first, then the eliminated by how long they lasted, ties shared per #226).
- **A latecomer joins the next wave at zero losses** ([#172](https://github.com/dknowles2/trusty-track/issues/172)'s rule in this format's terms) — `extend_elimination_round` fields every eligible racer it has not seen — **but never a race already decided**: checking in after the final heat must not restart it. `admit_late_racers` deliberately skips part-raced elimination rounds; the PPC lane-balance appendix is wrong for a format where the schedule grows itself.
- **An elimination round cannot be a championship round** — a wave of placeholders is nonsense; `createRound` refuses the combination.

The UI is the add-round dialog's "How it's raced" choice (`RoundConfigModal`), and the Standings page's round selector includes elimination rounds beside championship ones, labelled in losses.

### Master running order

`domain/running_order.py` (stage 1), `Race.master_running_order` and `applyMasterRunningOrder` (stage 2, [#549](https://github.com/dknowles2/trusty-track/issues/549)). A pack with several racing groups otherwise runs one block per group — the Lions' round, then the Tigers' — and the track idles between blocks while the next den's cars are staged. A master running order interleaves the heats of the race's current rounds into one sequence instead, so the next den is already queued while the current one races.

**Not a new scheduling algorithm, not a merged round.** Every heat in the interleave is a heat some generator (PPC, balanced, elimination) already produced, in the order that generator wants it run; rounds stay separate rows, so advancement, `is_round_complete`, `field_is_short` and the round-summary edge detector are untouched. This only decides which heat lands at which *position* — `Heat.heat_number` — across rounds rather than within one.

**Off by default**, per race. Running one den at a time is how many events are deliberately structured, and interleaving is a visible change to the schedule an operator has to choose.

**`crud.apply_master_running_order` writes through `_write_heat_numbers`, the one door `reorderHeats` already used** — extracted from it so neither function writes a heat row a second way. `reorderHeats` keeps its own restriction to a single round (the drag-and-drop schedule screen's contract); the master order deliberately does not, since spanning rounds is the whole point. Each of the race's current **general** rounds contributes one `running_order.GroupSchedule`, built from that round's own heats in their existing order; `interleave` decides how the groups are woven together, never reorders within one. Championship rounds are left out of the weave entirely — see "the execution flow follows the order" below for why.

**Only pending heats move.** "Pending" is exactly `Heat.recorded_at is None` — the record of when a heat ran (#59) — so a heat that already holds a result keeps its `heatNumber` unchanged: an announcer who already called heat 6 must find heat 6 unchanged. New numbers for the pending heats start one past the highest `heat_number` anywhere in the race, recorded or not, in any round — so a freshly assigned number can never collide with a heat that already has a place in some round's own history, including a *different* round's.

**`applyMasterRunningOrder` itself applies once; it does not repair.** Calling it again recomputes the interleave from scratch over every pending heat, which is right for the operator's own deliberate click but wrong as an automatic reaction to a mid-event change — the issue calls this out directly: a group gaining one heat can shift every group's smooth-WRR credit from the very first pick, silently renumbering a heat the announcer already read out. That automatic reaction is stage 3, below.

**Repair, not regenerate (stage 3).** A lane outage ([#171](https://github.com/dknowles2/trusty-track/issues/171)) rewriting pending heats and a latecomer ([#172](https://github.com/dknowles2/trusty-track/issues/172)) being admitted both change how many heats a round has left, mid-event — the input the interleave is built from. `crud.repair_master_running_order(db, race_id, new_heats_by_round)` is the fix, called from `admit_late_racers` and `apply_outages_to_scheduled_heats` once each has finished its own work, passing exactly the `models.Heat` rows it just created for each round. It is a no-op — at most the one query that checks the flag, never a write — whenever `Race.master_running_order` is off or the map is empty, which is what makes repeated repair idempotent: a cascade that admits nobody or only vacates lanes creates nothing new, so there is nothing to fold in.

**Every heat that already existed keeps the `heat_number` it already had — recorded or still pending, whether or not it was ever through an interleave.** This function assigns a number only to a heat that is an entry in `new_heats_by_round`, i.e. one that did not exist before the call that is repairing right now. That is what protects an armed heat's number, the same rule elimination's wave growth already follows (#50): the only heats eligible for a new number here did not exist for the operator to have armed, so `_revalidate_timers` has nothing to do — a heat that already existed is never reassigned, and one that is brand new was never armed. Not attempted: splicing a new heat's number in *between* two existing ones. `heat_number` is a plain integer with no gap to put it in without shifting a neighbour, which is exactly the renumbering this function exists to avoid — so new heats are placed after the highest `heat_number` the race holds anywhere.

**The two rounds a single admission cascade grows are still woven together.** A `bulkCheckIn` that admits a latecomer to two dens at once produces new heats for two rounds in one call to `admit_late_racers`; `running_order.interleave` — the same function `applyMasterRunningOrder` uses for a whole race — weaves those new heats by the same proportional-pacing, no-consecutive-car rules, scoped to what actually changed rather than the whole schedule.

**Hooked at `admit_late_racers` and `apply_outages_to_scheduled_heats` themselves, not inside `generate_heats_for_round`.** Both callers call that function for their own "nothing raced" case, which would make it the one seam reaching every mid-event rebuild — but it also serves `regenerateRound`, `createRoundWizard`, and every scheduling strategy's first wave or phase, none of which is the automatic, no-operator-in-the-loop cascade this issue is about. Hooking it there would repair far more than #171 and #172 ask for. Each of the two callers instead passes exactly the heats *it* just created — the appended tail for a part-way admission, every heat of a round `apply_outages_to_scheduled_heats` or `admit_late_racers` fully regenerated. `withdraw_absent_racers` ([#228](https://github.com/dknowles2/trusty-track/issues/228)) also calls `generate_heats_for_round` for an unraced round losing a withdrawn racer, and is deliberately not hooked here — the issue's own "genuinely hard" section names only the outage and the latecomer, and a round *shrinking* has no new heat needing a position in the first place.

**The schedule screen shows it (stage 4).** `ScheduleManagement` renders a "Master running order" panel — one flat table, sorted by `heatNumber`, listing every heat once — above the ordinary per-round blocks, and only while `Race.masterRunningOrder` is on; an ordinary race's schedule screen is byte-for-byte what it always was. Each row is labelled by its round's own racing group, read via `Round.racingGroupId` (exposed as a plain field on the GraphQL type — the column has always been on the model, nothing exposed it) and resolved client-side against `race.racingGroups`, which the screen already fetches; a round scoped to no single group (a combined general round, a championship round drawing from several) shows an em dash rather than a guessed name. The word for "racing group" comes from `useTerminology()`, same as everywhere else (`terminologyGuard.test.ts` holds this file to it too). **Applying the order is a button in that panel**, wired to `applyMasterRunningOrder` and refetching on success — the same deliberate, re-runnable operator action the mutation's own docstring describes, not the automatic mid-event repair stage 3 triggers on its own seam.

**The setting is a checkbox on `RaceForm`, gated on `isEditing`** — the same reason the terminology override above it is: `updateRace` is the only mutation that accepts `masterRunningOrder`, so a race being created has nothing yet to submit it into (`buildCreateRaceInput` does not send it, matching the terminology fields). `false` needs no separate clear flag, the same shape `voting_open` and the theme fields use: it is already what every race had before the column existed.

**The execution flow follows the order, through one rule stated twice.** Writing the interleave into `heat_number` was not enough on its own: every surface that answers "which heat is next" sorted by `(round_number, heat_number)` — `RaceControl.tsx`'s `sortedHeatsEx`, the `currentlyRacing`/`onDeck` subscriptions — so with the flag on and the order applied, the operator screen still ran one den's round to completion before the next den's heats were reachable at all, and `ScheduleManagement`'s "Complete previous rounds first" gating meant they could not even be jumped to by hand. The rule is now `domain/running_order.execution_sort_key`: `(round_number, heat_number)` with the flag off — every existing race unchanged — and `heat_number` alone across general rounds with it on, `round_number` kept as a tiebreak so a round not yet re-applied (its numbers count 1..N again) zips deterministically rather than jumping around. `crud.heats_in_running_order` is the one door both subscriptions read through; `features/racing/runningOrder.ts` is the frontend mirror `sortedHeatsEx` sorts with, each side pinned by its own tests so the operator screen and the wall displays cannot drift apart.

**Championship rounds are exempt from the interleave and run after every general round, whatever numbers they hold.** Two reasons, either sufficient: their field is drawn from the general rounds' standings, so they cannot meaningfully run before those finish; and the advancement cascade's `_reset_heats_in_place` renumbers a championship round's heats 1..N on **every** rebuild — a master number written onto one would not survive the first preliminary result recorded after it. So `apply_master_running_order` and `repair_master_running_order` both skip rounds with an `advancement_source`, and `execution_sort_key` places them last in their own `(round_number, heat_number)` block. Don't "fix" the exemption by teaching `_reset_heats_in_place` to preserve master numbers — the round's field changes size across rebuilds, and the sort already makes the numbers irrelevant.

**What the flag relaxes on the frontend, each gated so a race with it off is untouched.** `ScheduleManagement`'s per-round `isUpcoming` gating is off — rounds progress concurrently, so no round is "upcoming" — and within-round **dragging is off too**, with the handle saying why: `reorderHeats` renumbers a round 1..N, which would silently pull that round to the head of the interleave. `handleRunHeat` skips its jump-ahead renumbering for the same reason (selecting the heat is what the renumber existed to fake). `RaceExecution`'s On Deck panel shows the next heat's line-up across rounds rather than announcing "End of Round" between every heat, and `upcomingRounds` means "any other round with a heat still to run" rather than "higher round number". `raceFlow.ts`, `roundCompletion.ts` and advancement needed no change — the machine takes the active heat's phase as an input wherever the sort put it, and round completion is detected per round, not from the order. `masterRunningOrder.spec.ts` crosses the whole path end to end: two dens, the interleave applied, the Race tab offering the other den's heat next and the schedule running it mid-round.

### Scoring

Rules in `domain/scoring.py`, database wiring in `services/scoring.py`. `TIMED` averages heat times (a recorded `0.0` is treated as a 9.999s DNF penalty); `POINTS` sums placements. Both are lower-is-better. `get_leaderboard(db, race_id)` returns sorted standings.

**Standings cover preliminary rounds only** — rounds with no `advancement_source`. Settled in #17. A championship field is chosen *from* the standings, so folding championship results back in is circular: `record_heat_result` re-runs advancement on every result, so a final-round time could change who was supposed to be in the final. It also mixes populations, since a championship average is taken against the fastest cars rather than the whole field.

`get_leaderboard(db, race_id)` is prelim-scoped by default. Pass `round_id` for one round (this is how the UI shows championship results) or `scope=ALL` for the pre-#17 whole-race average. The `Race.leaderboard` GraphQL field takes `roundId` and `includeAllRounds` to match.

**A missing placement must never be a reward under `POINTS`** ([#225](https://github.com/dknowles2/trusty-track/issues/225)). `POINTS` sums, so a racer with fewer placements scores *better* — the failure #26 keeps arriving by new routes. Four routes are now closed, two ways: a lane outage mid-round (#171) and a latecomer (#172) set `Round.disrupted` and the round is dropped from `POINTS` standings; a **skipped lane** and a **DNF** (a recorded time ≤ 0, which the timer assigns no place) are scored as **last place in their heat** — the racers assigned, not the track's lane count. The penalty routes and the drop routes are different because they are different facts: a penalised lane *exists* and can classify last; a disrupted round has racers who were *scheduled fewer heats*, and there is no lane to penalise. `TIMED` needs neither for a skip — an average is scale-free — and keeps its 9.999 s penalty for a DNF. A lane with a real time but no place stays uncounted: that is a half-finished hand entry, not a scratch.

**A tie shares a rank** ([#226](https://github.com/dknowles2/trusty-track/issues/226)). `rank_key` still breaks ties by racer id so the *order* is deterministic, but `standings_ranks` stamps competition ranks (1, 1, 3) over it — otherwise a tie for a trophy or the last championship slot was resolved by registration order and no screen ever said so. Racers who have not raced keep strictly increasing positions; tying them would make a pre-race leaderboard a wall of rank 1. Advancement and awards still cut by position (`standings[:n]`, `standings[place-1]`), which is unchanged and now *visible*: the operator sees the shared rank and settles it with a race-off or a corrected time.

**`LeaderboardEntry.racingGroupDivision` is the racing group's category, riding along for branding** ([#298](https://github.com/dknowles2/trusty-track/issues/298)) — `RacingGroup.division` was assignable and stored since the app's first spec but shown nowhere. Named `racingGroupDivision` rather than `division`, because `rank` on a standings row already means the finishing position and the same collision would recur under any name sharing that row; the two would otherwise be mistaken for the same field on the same type. `Leaderboard.tsx`'s Racing Group column and `Observation.tsx`'s heat cards and live standings all read `racingGroupDivision`/`division` straight off the payload — no formatter, since the stored text already is the label.

**`RacingGroup.division` is free text, where it was a seven-value `Rank` enum** (`LION` through `ARROW_OF_LIGHT`) — [#496](https://github.com/dknowles2/trusty-track/issues/496) stage 2. Nothing server-side ever read the enum to decide anything, so nothing structural was lost making it text; the frontend's `RacingGroupManager` offers the traditional Cub Scout ranks as picker *suggestions* (`categoryPresets.ts`'s `CATEGORY_PRESETS`, the same "fill an ordinary field" pattern `awardTemplates.ts` uses for ready-made awards) rather than a constraint, so a school typing "3rd Grade" is exactly as valid as a pack picking "Wolf" from the list. The field's UI label is the fixed word **Category**, not a configurable term — narrower than the issue's open question about a third configurable vocabulary slot, resolved that way because the field is branding-only and a third term was judged not worth eight more columns. Migration `0030_racing_group_division` carries every stored enum code to the display string `rankLabel()` used to compute (`LION` to `"Lion"`); `rankLabel()` itself is gone, since a stored value is now already its own label. The downgrade reverses by exact label match and sends anything else to `OTHER` — lossy, and said so in the migration's docstring, the same tradeoff the enum-era `rankLabel()` made for a code it did not recognise.

### Track records

`services/records.py`, carried on `raceStats` as `trackRecords` and shown on the Stats page. The fastest cars a track has ever seen: races carry `track_id`, so a track accumulates results across events. One entry per racer at their single best time, capped at five, best first — official heats only, `time_seconds > 0` only (a recorded 0.0 is a DNF marker), and a lane whose racer was deleted has no holder (`_vacate_lanes` cleared its time anyway).

**Computed on every read, never stored** — the same rule as the standings (#17): a corrected time must move the record, and a stored copy would be the first thing able to disagree with the heats it came from. The consequence is documented rather than fought: deleting a race deletes the records it set. The frontend marks entries whose `raceId` equals the current race ("set at this event"); the comparison is client-side, so the payload carries the race id, name and date of each entry. `test_track_records.py` pins all of it.

**Historical records are the one stored kind** (`models.HistoricalTrackRecord`, table `track_records`, migration `0023`) — hand-entered for events from before Trusty Track, which is the case the computed-never-stored rule does not cover: there are no heats to compute from, so the row is primary data, the audit log's distinction. Merged into the same list by time; `race_id` is null in the payload, so the "set at this event" badge never fires for one. Managed on the track's card in System Settings (`TrackRecords.tsx`), operator-only (`createTrackRecord` / `updateTrackRecord` / `deleteTrackRecord`), validation on the Pydantic schema surfaced as a sentence. `ON DELETE CASCADE` from tracks.

**Breaking the record is announced on the audience displays.** `timingStats` carries `recordBreak` (a `TrackRecordBreak`), and the projector's results overlay and the timing view both render it (`features/observation/recordBreak.ts` composes the one sentence both use). The rule that keeps it meaningful: the baseline is `track_records(..., exclude_race_id=<current race>)` — **the record as it stood before today** — so a first event with no history celebrates nothing rather than "breaking the record" on every fast heat. `records.broken_record` also refuses a tie (strict `<`) and DNF markers, and a free heat never fires it. Derived from state per payload, not remembered as an event (#248's shape). `test_record_break.py` pins each refusal. Note the docs screenshot suite trips it deterministically, and how it does so is the point: `screenshot-observation.spec.ts` races on a **track of its own** and seeds one historical record slower than any car it invents, so the banner in `observation/07` and `10` says the same thing on every run. It used to lean on the specs sharing `tracks[0]`, which made another spec's times the baseline — survivable while one spec ran at a time, and not once they run at once.

**The projector's results overlay needs the same edge detector as `roundCompletion.ts`, and got it late** (#335). `timingStats` delivers an opening payload on connect — the subscription's usual shape — so a projector opened or reconnecting mid-event was popping the "Heat Results" overlay for whichever heat happened to be last, possibly minutes ago: `seen === null` meant history, not news, and this subscription had no `seen` at all. `features/observation/resultsOverlay.ts` supplies it. Its key is `heatId` plus `recordedAt` rather than `roundName`-`heatNumber`: the latter is unchanged by a correction, so a re-recorded heat never re-triggered the overlay. `recorded_at` is exposed on the `TimingStats` GraphQL type for exactly this — it is otherwise the same field #59 already uses to rank official and free heats together.

### Championship advancement

Rules in `domain/advancement.py`; entry points are `advanceRound` and `scoring.get_advancing_racers()`.

- `advancement_source = "ALL"` — top N overall
- `advancement_source = "EACH_GROUP"` — top N from each racing group
- `advancement_source = "ROUND:<id>"` — top N from that round

**`Round.advancement_from_bottom` flips which end of those standings the field comes from — the Slowest Race bracket.** The source vocabulary is deliberately unchanged; `AdvancementRule.from_bottom` reverses the pick in `domain/advancement._picking_order`, slowest first (slot 1 is the slowest car, mirroring slot 1 being the fastest). Two rules ride on it: a racer with no recorded result is never picked (`Standing.has_raced` — the leaderboard sorts the unraced *below* everyone, so the naive bottom of the list is cars that never ran), and the round's standings view is reversed **on display only** (`features/stats/slowestFirst.ts` — the stored leaderboard stays lower-is-better, so anything chaining off the round reads it unchanged). Everything else — invalidation, `should_populate`, `field_is_short`, withdrawal — is direction-agnostic and needed no change. The operator reaches it from the add-round dialog's "Which cars race" control; placeholder slots and the round-summary sentence read "Slowest N" via `AdvancementStatus.fromBottom` and `Round.advancementFromBottom`.

`crud.record_heat_result` cascades: it calls `invalidate_future_rounds` and `trigger_auto_advancements` on **every** heat result.

**The invalidation rule**, since it is easy to get wrong: recording *or clearing* a result in round N resets the field of every later championship round back to placeholders, because the standings they were drawn from just moved. A later round that has **already been raced** is left alone — a stale field the operator can see and fix beats silently wiping heats people ran. General rounds are never invalidated; their field is the roster.

**"Can see" is `AdvancementStatus.fieldIsStale`** ([#229](https://github.com/dknowles2/trusty-track/issues/229)) — for years the premise above had no seeing half. True when a raced, advanced round's actual field (as a *set*; lane order is the scheduler's business) no longer matches who would advance today; the schedule shows a **Line-up out of date** badge (display text renamed from "Field out of date" — "field" is jargon to a volunteer; `fieldIsStale` stays, it is API). Only a *raced* round can be stale — an unraced one is re-fielded outright, so a mismatch there is a bug, not a state.

**The rebuild paths preserve runs-per-lane** ([#230](https://github.com/dknowles2/trusty-track/issues/230)). `generate_heats_for_round` takes `runs`, and `runs=None` — what every rebuild passes — means *preserve what the round had*, derived from the heats about to be cleared (heat count over the field those heats actually hold, floor). The derivation lives there and nowhere else because it used to live in exactly one caller (`regenerateRound`, from #143) while `invalidate_future_rounds` and `populate_round_field` had nothing — so a two-run final quietly became a one-run final on the first recorded prelim result. `_reset_heats_in_place` checks divisibility, not equality, for the same reason. `test_multi_run_rounds.py` holds it, and contains the first tests in the tree with `runs > 1`.

**The divisor is the heats' actual field, not the round's requested one** ([#311](https://github.com/dknowles2/trusty-track/issues/311)). The first cut divided by `Round.total_participants`, which for a championship round is `advancement.field_size(rule, racing_group_count)` — the *requested* slot count, constant regardless of what the heats hold. That agrees with the heats the first time a field comes up short (#48): the round was still built from the request, so the two coincide. It stops agreeing on any *later* rebuild — once a short field has already shrunk a round to its real size, `invalidate_future_rounds` divides the existing heat count by the request again, not by the smaller field the heats actually hold, and silently drops a run. `domain.advancement.scheduled_participant_count` fixes the divisor by counting distinct participants — real racers and placeholder slots, kept in separate identity spaces — straight off the existing heats, the same move `placeholder_slots` already made for `field_is_short` and for the same reason.

**A withdrawal is the mirror of an admission** ([#228](https://github.com/dknowles2/trusty-track/issues/228)): un-checking a racer runs `crud.withdraw_absent_racers` from the same `_admit_late_racers` hook, withdrawal before admission, both idempotent — which is what lets a mistaken un-check heal on re-check. Same three cases as #172: unraced rounds regenerate without them, part-raced rounds keep every finished heat and vacate their pending lanes (no `disrupted` flag — an absent car empties a lane, it does not give anyone extra runs), finished rounds stand. An unraced championship round naming a withdrawn racer is re-fielded so the next qualifier steps up, and `get_advancing_racers` skips racers who are not checked in — their results stay on the leaderboard, but a slot in a race yet to run never goes to a car that has left the building.

**Putting racers in goes through `crud.populate_round_field`**, never `resolve_round_placeholders` directly — both `trigger_auto_advancements` and the `advanceRound` mutation call it, and having two copies of the call is how #48 ended up on only one path at first.

**Population asks about the state of the race *now*, never about which round just finished** ([#248](https://github.com/dknowles2/trusty-track/issues/248)). `advancement.should_populate` used to fire a `ROUND:`-scoped rule only on its source round's completion *event* — so a chained final whose field was reset after that event had passed (a prelim correction, say) waited for a completion that never came again, and one created after its source finished had no event at all. Stated over the present — "is the source round complete?" — the answer is the same wherever it is asked from, and a stranded round heals on the next cascade. `crud.populate_round_if_decided` is the one asker; the recorded-result cascade calls it per future round and `createRound` calls it for the round just made. Multiple championship rounds chain this way — the wizard wires every round after the first to `ROUND:<previous>`, and the add-round dialog offers the same once a championship round exists.

**The wizard's rollback deletes in reverse creation order, and a round joins the rollback list the moment its row exists** ([#249](https://github.com/dknowles2/trusty-track/issues/249)). `create_round` commits, so a failure in heat generation leaves a committed round; and a general round cannot be deleted while championship rounds exist, so forward-order deletion raised out of the rollback and left half a schedule that made every later wizard run refuse.

**A new round's number comes from `max(round_number) + 1`, not the count** ([#250](https://github.com/dknowles2/trusty-track/issues/250)). Deleting a middle round makes the two disagree, and two rounds sharing a number are invisible to each other in advancement's strict `<`/`>` ordering.

**`advancement_num_racers` is per *racing group* when the source is `EACH_GROUP`**, and absolute otherwise. The rule is `domain/advancement.field_size`, wrapped by `crud.round_field_size` which counts the racing groups — use those, never the raw column. It had grown five copies, two of them wrong, and the wrong ones shrank an `EACH_GROUP` final to a fraction of its field on every preliminary result (#52).

`advancement_num_racers` is also a **request**, not a guarantee: "top four" from a racing group of three can only ever supply three. Heats are generated from the request, before anyone qualifies, so a round can hold more slots than the race can fill. Left alone the surplus is fatal rather than untidy — `phase` reports `NOT_READY` while any placeholder remains, and the operator screen has no controls in that state, so the round cannot be run, edited or skipped. `domain/advancement.field_is_short` detects it and the round is rebuilt for the field that actually qualified. A round that has already been raced is filled in place regardless, following the same rule as invalidation.

### Awards

Rules in `domain/awards.py`, database wiring in `services/awards.py`, storage in the `awards` table (#170). Two kinds, and the difference is only where the recipient comes from:

| Kind | Recipient | Fields |
| --- | --- | --- |
| `SPEED` | computed from the standings | `source` + `place`, optionally `racing_group_id` |
| `SPECIAL` | chosen by a person | `racer_id` |

**A speed award names a source, never a winner**, and the recipient is resolved on every read. An award defined before the racing has to stay correct when a time is corrected after it; storing the racer id would make this the first thing in the app able to disagree with the leaderboard, which is the loop #17 closed. Same principle as the standings themselves: computed on demand, never stored.

**`EACH_GROUP` is not a source, and that is the one departure from advancement's vocabulary.** For advancement `EACH_GROUP` means "the top N of *each* racing group", which yields a set — right for filling a field, wrong for an award, which has exactly one recipient. A racing-group-scoped award is an ordinary source with `racing_group_id` set, so "fastest Wolf" is the pack standings narrowed. Six of them is six awards, which is also how they are announced.

**`place` is 1-based and refused below 1** in both `SpeedRule.__post_init__` and the Pydantic schema. `standings[place - 1]` with a place of 0 indexes from the end and hands the trophy to the slowest car.

**`Award.from_bottom` flips which end `place` counts from — the slowest-car trophy.** Deliberately the same word and the same idea as `Round.advancement_from_bottom`: a pack that gives one is reading the standings it already has from the other end, not asking a different question, so there is no new source vocabulary. It carries the same rider, for the same reason — **a car that has not raced never wins it** (`Standing.has_raced`), because the leaderboard sorts racers with no result *below* everyone who ran, so the raw bottom of the standings is cars that stayed home. That field was defaulted-true and unread by awards until now; `services/awards._standings_cache` had to start supplying it from `heats_completed`, and a mutation there survives every test that does not race a *partial* round — four racers on a four-lane track all run in heat one, so the test needs a field wider than the track. `recipient_of` narrows to the racing group **before** reversing: "slowest Wolf" is the Wolves read backwards, not the pack read backwards and then filtered.

On the frontend the kind is called **Speed-based** rather than "Whoever is fastest" — the old label stopped being true the moment an award could name the slowest car. `awardText.positionLabel` is the shared rule for saying a position in either direction, and it names first place in both ("Fastest", "Slowest") rather than numbering it: nobody announces "1st slowest".

**A null recipient is the ordinary state**, not an error — third place has nobody until three cars have run, and Best Paint has nobody until somebody decides. A `SPEED` row missing its source or place resolves to nobody too, rather than raising: an award nobody can win is visible on the operator screen, and an exception takes down the presentation display mid-ceremony.

**`crud._clear_fields_of_other_kind` runs *after* an update applies**, not before. Changing the kind is what makes the other kind's fields stale, and the new kind and the stale fields arrive in the same payload.

**Resolution is whole-race and memoised** (`loaders.award_recipients`). One speed award is a full scoring pass over the heats it draws from, and a pack hands out a dozen; `services/awards` loads each *distinct source* once within that. `test_query_counts.py` compares eight awards against one.

**`Race.championship_trophies` is not this.** It means how many cars advance to the final — a scheduling input. An award is an outcome.

On the frontend, `/race/:raceId/awards` is a fourth tab on `RaceModeToggle` beside Roster, Standings and Stats. `features/awards/awardText.ts` turns a stored rule into the sentence both the operator screen and (later) the presentation display show — `{source: "ROUND:4", place: 1, racingGroupId: 3}` is exactly the wrong thing to put in front of somebody choosing trophies. It is pure, and it holds the ordinal edge cases (11th, not 11st) and the two "that no longer exists" messages for a round or racing group deleted out from under an award. **Editing a speed award must not seed the racer picker from its computed recipient** — switching it to judged would then freeze the trophy on whoever happened to be fastest at that moment.

**The ceremony is its own route** (`/race/:raceId/awards/present`), not another tab on the audience display. The observation views rotate on a timer because nobody is driving them; a ceremony is paced by whoever is holding the microphone, and a screen that advanced on its own would announce the next trophy over the applause for the last one. `ceremony.ts` holds the stepping rules: it **clamps rather than wraps**, because putting the first award back up reads as "we are starting again" and the last slide is the one people photograph, and it shows an award with no recipient rather than skipping it, because most are undecided right up until they are announced. It sits at `zIndex: 3000` — the navigation is 1000 and painted its Details/Control/Standings menu across the top of a projector until somebody loaded the page.

**Ready-made superlatives are a picker, not a new concept** ([#306](https://github.com/dknowles2/trusty-track/issues/306)). `features/awards/awardTemplates.ts` is a plain list — Best Paint, Most Original, Best Use of Colour, Most Aerodynamic, Most Patriotic, Best Scout Spirit, Judges' Choice — each pairing a name with an artwork key. Choosing one from `AwardForm`'s picker just fills in the name and `artworkKey` fields of an ordinary `SPECIAL` award; nothing downstream learns a new kind, and the operator can rename it or clear the artwork afterwards, both still ordinary text and select controls. A `SPEED` award gets no picker at all — `crud._set_speed_artwork_key` overwrites whatever `artworkKey` a client sends for one, deriving it from the rule instead (`domain.awards.default_artwork_key`: `from_bottom` → the slowest-car key, place 1 → the trophy key, anything else → the medal key). Both kinds cross the same plain-string vocabulary the frontend's `artwork.tsx` draws from — the backend only decides *which* key, never what it looks like.

**Artwork is committed SVG, not fetched or generated.** Same reasoning as the chime being two oscillators rather than an audio file: the venue has no internet, so every picture `artwork.tsx` can draw ships in the bundle. They are original line-art in the app's own palette (`--scouting-blue`, `--cub-scouting-gold`), not clipart pulled from anywhere, so there is no licence to track. A key `artwork.tsx` does not recognise (an old award saved by a build that had fewer keys, say) renders nothing rather than throwing — the same "print blank rather than crash" rule the heat sheet's deleted-racer case follows.

**The certificate is its own module, sibling to `heatSheet.ts`**, not a `DocumentSpec` card. One certificate per sheet is the same shape problem the heat sheet had: `documents.ts` sizes a card repeated to a grid, and a certificate is one full-page document, so `printables/certificate.ts` holds its own pure rules and `pages/Certificate.tsx` shares only the print stylesheet. Reached from the Awards screen's **Print certificates** link, next to **Present** — the two ends of the same ceremony, one for the room and one for the wall afterwards. One certificate is built per award, using its *current* recipient exactly as the results sheet's award lines do — an award nobody has decided yet still gets a certificate, printed with the name left blank, rather than being skipped; skipping would mean reprinting the whole batch the moment judging finishes. An award with no `artworkKey` gets a plain certificate — a border and the event's name, no clipart — which is also what an award saved before this feature existed still prints.

### Voting for judged awards

Rules in `domain/awards.can_be_voted_on` and `domain/awards.rank_tally`, database wiring in `crud.cast_vote` and `services/awards.vote_tallies_for`, storage in the `award_votes` table (#305). A `SPECIAL` award — Best Paint, Most Original — is chosen by a person; this is how a pack collects opinions from a phone in the room instead of a paper ballot and a clipboard.

**The role model is the one real obstacle, and the fix is one deliberate exception rather than a new credential.** A phone in the room holds no PIN and is a `VIEWER`, and `Role.VIEWER: frozenset()` in `api/auth.py` means no mutation at all (#15). Rather than a third PIN or a per-race voting token — both rejected in the issue — `Race.voting_open` is an explicit state the operator toggles, and `castVote` is the one mutation `auth.VOTE_MUTATIONS` grants `VIEWER`. The role policy only says the attempt is allowed; `crud.cast_vote` is what actually checks `Race.voting_open` and `Award.votable` and refuses otherwise. CORS stays at its `TRUSTYTRACK_ALLOWED_ORIGINS` default (a LAN, justified under "The public demo" below) — the reasoning already covers an unauthenticated write, since the PIN was never what protected a `VIEWER`'s empty mutation set in the first place; `castVote` is the first mutation a `VIEWER` can reach, and it is reachable only while the operator has said so.

**Ballot stuffing is accepted, not defended against.** The primary use case is a shared iPad at the event, so a per-device lock would be wrong — many voters, one device. `ballot_key` is a client-generated token, unique per award (`uq_award_ballot` in `award_votes`), and it exists only to make one *submission* idempotent against a doubled click or a retried request: `crud.cast_vote` catches the resulting `IntegrityError` and treats a retried key as success rather than a second vote. A fresh key is a new ballot, and the frontend generates one per vote, never one per device.

**The ballot screen shows cars, never children.** `carNumber`, `carName` and `carImageUrl` are what `features/awards/pages/VotingBallot.tsx` requests and renders; it does not ask for a racer's name or `racerImageUrl`. Nothing server-side enforces this — queries carry no role check in this app, same as every other screen — so it is a scoping choice in the one query this page sends, the same way `AwardVoteTally` above carries `racerId` and a `racer` resolver rather than a name.

**Which awards can be voted on is a flag, not a third kind.** `Award.votable` is `SPECIAL`-only; a `SPEED` award has a computed recipient, and a ballot for one could not mean anything. `crud._clear_fields_of_other_kind` forces `votable` false the moment an award becomes `SPEED`, the same way it forces `racer_id` null. New judged awards default to votable in `AwardInput` (the form), but the column itself defaults false (`server_default=false()`) — the same "form offers a sensible default, storage stays conservative" shape `weight_limit_oz` uses (#205): an award that existed before this shipped does not suddenly start collecting ballots.

**Closing voting never writes `Award.racer_id` by itself.** `Award.voteTally` (backed by `loaders.award_vote_tallies`, one query for the whole race like `award_recipients`) is a ranked list the operator reads; applying the winner is one click that calls the ordinary `updateAward` mutation with `racerId` set — ties, spoiled ballots and an obvious stuffing incident all stay fixable by a person rather than being written into the trophy automatically. `voting_open` is a plain field on `RaceUpdateInput`, not a separate mutation, since `updateRace` already drops absent fields.

**Timing is operator judgment, not enforced.** Nothing here couples `voting_open` to racing progress or to the ceremony route; the operator is expected to close voting before presenting, the same trust the ceremony's own pacing already runs on.

**Sharing the ballot address is a backend question, not a browser one** ([#414](https://github.com/dknowles2/trusty-track/issues/414)). `window.location.origin` names the machine from its own point of view, and on the documented setup — one machine at the venue, the operator's own laptop — that is `http://localhost:8000`, which no phone on the wifi can open. The browser has no way to do better than that; the backend can, because it is the thing bound to the network. `services/network.lan_addresses()` is best-effort over two OS-level techniques (resolving the machine's own hostname, and reading which interface a UDP "connect" would route through — neither sends a packet, and neither alone is reliable on every OS), exposed as the `networkAddresses` query. `features/awards/shareAddress.ts` (pure) is where the substitution happens: `window.location`'s own address is kept whenever its hostname is already not `localhost`/`127.0.0.1`/`::1`, and swapped for the first LAN address otherwise, keeping the browser's own port and path — the frontend does not need the backend to tell it what port it is being served on, since it is already being served on the right one. **The result always carries a `reachable` flag, checked whether or not a substitution happened** — an empty `networkAddresses` list leaves the shown address as `localhost` and says so, because implying an address works when nothing here could confirm it is worse than a plain warning.

**The QR code is rendered server-side, from the same URL the text shows** — `services/printables.url_png`, sharing `_qr_png` with the check-in code but encoding an ordinary URL rather than an app-internal payload, since this code is scanned by a phone that is not running Trusty Track and never will be. `GET /printables/vote-qr/{race_id}.png` (`/api/` too, the barcode endpoint's reason) takes the URL as a query parameter rather than working it out again on the backend — computing the shareable address twice would be two copies of the same rule free to disagree — and refuses one that does not contain `/race/{race_id}/vote`, since this is not a general-purpose QR generator sitting behind no credential. Not cached `immutable` like the check-in code: the encoded address depends on the machine's current network and can change between requests in a way a racer's id never does. Unguarded, like the barcode endpoint and the ballot page itself — voting is the one screen a `VIEWER` with no PIN is meant to reach.

### Car numbering

`PER_GROUP` fills within each racing group's range; `GLOBAL` numbers sequentially from `global_start_number`; `MANUAL` disables auto-numbering.

### The practice race

`crud.create_practice_race`, behind the `createPracticeRace` mutation and the **Try a practice race** button on Home ([#201](https://github.com/dknowles2/trusty-track/issues/201)). The operator is a parent volunteer who uses this app once a year, and the night before is when they want to know what race day feels like. Everything needed already existed — `populate` builds a believable roster, the fake timer runs heats without hardware — but reaching it meant creating a race, adding racing groups, populating, checking everybody in and running the round wizard, which is most of the thing being rehearsed.

**One mutation, not five round trips.** A rehearsal that fails half way leaves the operator with a broken race to tidy up, which is the opposite of the confidence it exists to give.

**It reuses a fake-timer track and only creates one if there is none.** An operator who rehearses three times must not end up with three tracks in System Settings — a track is global state, which is the same fact the e2e conventions are built around. It never picks a real one: arming a heat on a real timer sends a signal to a device in a room somebody may be standing in.

**It includes a championship round.** Advancement is the part of race day that surprises people; a rehearsal that stops before the final leaves out the bit worth practising.

**The name counts up.** `races.name` is unique, so a second rehearsal would otherwise fail at the point the operator is least equipped to understand why — and a counter reads better than a timestamp on the Home page.

There is deliberately no "is a practice race" column. The name is what tells an operator, and a flag would be a schema change for something cosmetic that nothing else branches on.

### The weight limit

`Race.weight_limit_oz`, and the rule is on the frontend in `features/management/weightCheck.ts` ([#205](https://github.com/dknowles2/trusty-track/issues/205)). Check-in had recorded a weight "for documentation purposes", which misses the reason anybody weighs a car: the dispute happens at the scale with a queue behind it, and the app should back up the volunteer holding the car.

**It is a warning, never a refusal.** Nothing on the server rejects an overweight car, and the save is not blocked. The inspector decides; the app makes the rule visible at the moment it matters. That is also why the rule lives on the client — it is shown while somebody types, not enforced at a boundary.

**A column of its own, not a key in `rules_configuration`.** That column is a free-text string nothing reads and nothing writes, and a number in a string column is the shape [#5](https://github.com/dknowles2/trusty-track/issues/5) spent a release removing. The issue proposed reusing it; don't.

**Null means no check, and there is deliberately no server default.** Every race that existed before this has null, and giving them a limit at migration time would suddenly flag cars a person had already passed at the inspection table. New races are offered 5.0 by `RaceForm` instead — the near-universal pack rule — which keeps the data model honest about what "no limit" means.

**`clearWeightLimit` is why the check can be turned off.** `update_race` drops every null from its payload, so absent means "leave alone" — which is what lets a screen re-submit a whole race without wiping the fields it does not offer, and also means no field can be set *back* to null. Without the explicit flag the weight check could be switched on and never off again. Same shape and same reasoning as the PIN's removal control ([#192](https://github.com/dknowles2/trusty-track/issues/192)).

**`TOLERANCE_OZ` is half a scale division, not a fudge.** Scales disagree in the last place, and refusing a car that reads 5.001 is a rule about the equipment rather than about the car. `0.005` is chosen so a car *displaying* 5.00 always passes a 5.0 limit and one displaying 5.01 never does.

**Zero is "not weighed", not "very light".** An empty number input hands back `0`, and a green tick against a car nobody has put on the scale is worse than no answer at all.

### Terminology

`domain/terminology.py`, storage on `Organization` and `Race` ([#496](https://github.com/dknowles2/trusty-track/issues/496), stage 3; [#551](https://github.com/dknowles2/trusty-track/issues/551) adds the third term below). An AWANA club, a school science fair, a Space Derby or a Raingutter Regatta runs the same event format Trusty Track was built for, and had to read "Den", "Pack" and "Car" on every screen with no way to change any of them — the word was the column name. Three configurable terms fix that: what a racing group is called, what the organization itself is called, and what a racer's own vehicle is called, each stored as a singular and a plural because English plurals are irregular and deriving "Classes" from "Class" is a rule nobody should own. A racing group's `division` (the field stage 2 turned into free text — Cub Scout rank, school grade) stays a fixed "Category" label rather than becoming a configurable term of its own: it is branding on one row, not vocabulary a whole screen is built from.

**Two scopes, layered, the same shape as a lane outage's schedule and a latecomer's admission are not — this is closer to `display_theme`.** An **organization** default, set once for the install; a **race** override, for one venue running a pack derby in March and a school science fair in May under the same install. `domain.terminology.resolve_terminology` is the one place the layering happens — race beats organization beats the built-in Scouting words — and it is pure, so it is pinned with no database in `test_domain_terminology.py`. **The frontend must not merge these itself**, the same reasoning that kept the live heat view server-side ([#7](https://github.com/dknowles2/trusty-track/issues/7)): two screens resolving the layers independently is two chances to disagree about what a race is called.

**Fourteen nullable columns, not a blob and not a key-value table.** A blob is the shape [#5](https://github.com/dknowles2/trusty-track/issues/5) spent a release removing; a key-value table is stringly typed, and a misspelled key would sit there reading as an override and doing nothing, invisible to both mypy and the schema. Three terms across two scopes is twelve columns — six on `Organization`, six on `Race` — plus a `vehicle_artwork_key` pair ([#551](https://github.com/dknowles2/trusty-track/issues/551) stage 4, below) bringing it to fourteen, and each one checkable forever.

**A third term, what a racer's vehicle is called, followed the same shape** ([#551](https://github.com/dknowles2/trusty-track/issues/551) stage 1) — "Car" is wrong for a Space Derby (rockets) or a Raingutter Regatta (boats), and both are run by the same volunteer with the same roster and standings as a pinewood derby. `vehicle_singular`/`vehicle_plural` land on `Organization` and `Race` exactly like the two pairs above — twelve nullable columns across the two scopes now, not eight — and `resolve_terminology`, `TerminologyOverrides`, `clearTerminology` and every other seam described in this section cover all three terms uniformly rather than growing a parallel path for the new one. Deliberately **not** a rename of `car_number`, `car_name`, `car_passed_inspection`, `car_image_url` or `CarNumberingStrategy`: those are storage and API, checked by nothing that reads display copy, and renaming eight columns and every GraphQL field for zero user-visible gain was declined in the issue itself. Only the word a screen shows is configurable — the sweep that makes every screen actually say it is a later stage of the same issue, not this one. System Settings' terminology section and the per-race override form (`RaceForm.tsx`) already gain the two new inputs in this stage, rendered exactly as the existing four are — but nothing reads the resolved `vehicleSingular`/`vehiclePlural` back out yet: `useTerminology()` still returns only `{ group, groups, org, orgs }` until the next stage extends it.

**Stage 2 carries the vehicle word into the frontend** ([#551](https://github.com/dknowles2/trusty-track/issues/551) stage 2). `useTerminology()` now returns `vehicle`/`vehicles`/`vehicleLower`/`vehiclesLower` alongside `group`/`groups`/`org`/`orgs`, and `DEFAULT_TERMINOLOGY` carries the built-in `"Car"`/`"Cars"` so an unconfigured install renders exactly what it always has. The rule for which pure helper takes the word as a parameter is narrower than "touches terminology": only a helper whose *output* actually says "car" needed it — `awardText.ts`'s `carLabel`, `csvMapping.ts`'s `fieldLabels`/`validate`, `setupChecklist.ts`'s `checklistFor`, `standingsExport.ts`'s `standingsRows`, and `readiness.ts`'s `readinessItems`/`checkinItem` (not in the issue's own suggested list, found only because it renders the identical sentence `setupChecklist.ts` does). `ceremony.ts`, `resultsSheet.ts`, `roundSummaryText.ts` and `groupRacersByRacingGroup.ts` were checked and left alone: they never render the word "car", only field names like `carNumber` that stay storage vocabulary.

**The sweep and the guard extension landed together** ([#551](https://github.com/dknowles2/trusty-track/issues/551) stage 3). `terminologyGuard.test.ts` gained "Car"/"Cars" (word-boundary) beside "Den"/"Pack" and the six Cub Scout ranks, over the same `.tsx` scan described below, and it lit up screens across the roster, check-in, printables, free race, race execution, stats, track records, awards and timer diagnostics — every one wired through `useTerminology()` or threaded as a resolved-word parameter, with no new allowlist entry needed. Two hand-checks, per the issue's own callout mirroring #496's: the voting ballot's loop variable was literally named `car` — a JS identifier the guard correctly flagged even though it was never displayed text, renamed to `entry` rather than allowlisted, with the one genuine piece of user-facing text there (`votedCarLabel`'s `'this car'` fallback) taking the resolved word like its siblings; and the observation views were wired the same as everything else, since they never named a concept to begin with, only a stored name or division.

**`vehicle_artwork_key` rides alongside the word rather than being derived from it** ([#551](https://github.com/dknowles2/trusty-track/issues/551) stage 4) — a fourth column pair, plain string exactly like `Award.artwork_key`, not folded into `vehicle_singular`: an operator who renames "Car" to "Speedster" still wants the rocket picture, and deriving one from the other would need its own fallback for a word outside a recognised set, or would silently disagree with an operator's own choice. `VEHICLE_ARTWORK_KEYS = ("car", "rocket", "boat")` in `domain/terminology.py` is the whole recognised vocabulary — a plain tuple, not an enum, the same relationship `services/timer` has with `TimerProfile.key`. `frontend/src/features/printables/components/PrintDecor.tsx`'s `VehicleGlyph` is the only place a key becomes a picture — original line-art (`Rocket`, `Boat`) beside the existing car, judged at the sizes they are actually used (a 26px pit-pass footer glyph, a 54px masthead mark) — and a key outside the set renders nothing there, the same print-blank-rather-than-crash rule `AwardArtwork` already follows. The certificate deliberately gets no vehicle glyph of its own: its guilloche background already replaced one giant outlined car once (see Printables below), and blowing up a rocket or boat the same way repeats a mistake that file already made and un-made; it still shows the *award's* own artwork, a separate vocabulary untouched by this change.

**Null means inherit, and `clearTerminology` is the explicit way back to it** — on both `InitialConfigInput` (the organization default) and `RaceUpdateInput` (the race override), following the same trap `clearWeightLimit` ([#205](https://github.com/dknowles2/trusty-track/issues/205)) and the PIN's removal control ([#192](https://github.com/dknowles2/trusty-track/issues/192)) already solved: `updateRace` and `updateInitialConfig` both drop absent fields, so absent already means "leave alone," and nothing else can ask for null. Unlike `display_theme`'s `"MATCH_APP"`, there is no non-null sentinel available here — an organization's own chosen word could legitimately be any string a sentinel might otherwise claim — so the flag is unavoidable, not merely consistent.

**`Terminology` is served resolved on `Race` and on `InitialConfigStatus`** (the screens with no race — Home, System Settings), and the raw six override columns are served alongside it on `Race`, `Organization` and `InitialConfigStatus` so an edit form can tell "inherited" apart from "set explicitly" — a form seeded from the resolved words could never offer to clear them, the same trap noted under Awards for a `SPEED` award's recipient.

**The frontend reads through one hook, seeded two ways** (stage 4). `TerminologyContext` and `useTerminology()` return `{ group, groups, org, orgs }`; `AppTerminologyProvider` wraps the whole app from `initialConfig.terminology` (the organization default, for Home, System Settings and anything else with no race in view), and `RaceTerminologyGate` wraps every `/race/:raceId` route and overrides it with that race's own `Race.terminology` once it answers — the server already layers organization under race, so there is nothing to merge on the client. A handful of pure `.ts` helpers that used to say "Den"/"Pack" outright (`awardText.ts`'s `describeSpeedAward`, `ceremony.ts`'s `slideFor`, `resultsSheet.ts`'s `resultsSections`, `standingsExport.ts`'s `standingsRows`, `setupChecklist.ts`'s `checklistFor`, `groupRacersByRacingGroup.ts`, `csvMapping.ts`'s `fieldLabels`) take the resolved words as a parameter instead, the same split `raceFlow.ts` uses between the rule and the React wiring that supplies it. `roundSummaryText.ts`'s `advancingFromLabel` (#532) is the same shape for the "Round Complete!" modal's advancement-source sentence — it used to hardcode "the whole pack" / "each racing group" / "an earlier round" straight into `RaceExecution.tsx`, and the middle one leaked the *internal* `EACH_GROUP` source name even under the default vocabulary, where the operator-facing word is "each den".

**The terminology guard (`frontend/src/terminologyGuard.test.ts`) only sees `.tsx` shapes it recognizes — and until #532, that stopped at the first `{`.** A hardcoded word inside a JSX interpolation (a ternary's string branch, or plain text broken up by `{n}`) or a `prop={...}` form of `label`/`placeholder`/`title`/`aria-label` was invisible to both matchers, which is exactly how the `RaceExecution.tsx` hardcode above went unnoticed. Both now scan the whole run between two tags (or inside the braces) rather than bailing at the brace, and the issue's five planted violation shapes are pinned as self-test cases inside the guard file so the coverage cannot silently regress again. The scan also covers `src/components`, `src/context` and `src/theming` alongside `src/features` now — nothing in those three exploited the hole, but nothing stopped a future one from living there either.

**`terminologyGuard.test.ts` is the AST-walk guard the issue asked for**, in the same spirit as `test_heat_lanes_write.py`: it checks every `.tsx` file under `src/features` for "Den"/"Pack"/the six Cub Scout rank words in JSX text and in `label`/`placeholder`/`title`/`aria-label` props, against a three-file, reasoned allowlist — the terminology setting's own labels, which name the built-in words being overridden, and two free-text "Category" placeholder examples (`division` stays a fixed field, not a configurable term). Without it the fiftieth file is the one that gets missed.

**The ballot and the audience displays were checked by hand, not swept**, per the issue's own callout: the voting ballot never names a racing group or an organization at all (`award.name` is operator-typed, and the ballot's query deliberately carries no racing-group field), and the observation views only ever render a racing group's *name* or its division, never the word for the concept.

**A general round's *default* name is derived too, and written once** ([#533](https://github.com/dknowles2/trusty-track/issues/533)). `Round.name` was three copies of the literal string `"All Pack"` — `crud.create_practice_race`, `createRoundWizard` and `createRound` — none of them reading the terminology at all, so a renamed install still saw "All Pack" on the schedule, the heat sheet and the printed results with no control anywhere that could reach it. `crud.default_general_round_name` is the one seam now: it resolves the race's own terminology (organization override beating the install default, same as everywhere else) and returns `"All " + organization_singular`, so a fresh install's first round still reads exactly "All Pack" — the built-in singular is "Pack" — while a pack that has renamed itself "Troop" gets "All Troop" instead of the un-pluralized nonsense the literal produced everywhere. `Round.name` stays a plain stored column, not a computed field like the standings or an award's recipient: an operator's own rename has to survive, so this only supplies what goes in the column when nobody typed a name, and renaming the vocabulary afterwards does not retitle a round already created. `ScheduleManagement.tsx`'s `roundName === 'All Pack'` check lost the string comparison for the same reason — it was already OR'd with `roundNumber === 1`, which is what was actually load-bearing.

User-facing detail — what's configurable, the two scopes, how to get back to inheriting — is [Race and track settings](docs/reference/race-settings.md#the-words-on-screen); this section and stage 3's above are the mechanism.

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
- **`Track.timer_type` is the transport; `Track.timer_profile` is the model** (#143). They are separate questions — the same MicroWizard can be on either transport, and knowing the model does not tell you which. Null means detect it, which is what every track did before the picker existed. `_device_for` is the one place that decides, because three mutations build a manager and #48 is about rules reaching only some of them.
  - A named model **narrows** the port search rather than replacing it: `autodetect([profile])`. The operator is asking *which port*, not *which timer*, and a probe writes to every port it tries.
  - On the proxy, a named model empties the candidate walk so the existing fallback path — reopen with this framing, hand over — does the work. There is deliberately no second code path for "we know what this is".
  - The fake timer is reachable by `timer_type` and is **not** offered as a model, or a track could ask for a fake timer over a real serial port. `_device_for` rejects it, and `timerModels` omits it.
- **`TimerType.NONE` is a fourth transport, not a variant of `FAKE`** ([#490](https://github.com/dknowles2/trusty-track/issues/490)). A pack with no electronic timer needs the opposite of what `FAKE` gives them — it invents a result a few seconds after every heat starts, which looks exactly like a real one — so `NONE` is its own device, `services/timer/devices/no_timer.py`, excluded from `ALL_PROFILES` and `by_key` the same way `FAKE` is. `_device_for` picks it, and `prepareHeat` / `startTimerTest` both refuse outright for a `NONE` track: there is nothing to arm, so the operator's only route to a result is hand entry through the Override/Edit modal, which becomes the primary control (`RaceExecution.tsx`'s `hasTimer`) rather than sitting secondary to arming that was never going to happen. `raceFlow.ts`'s auto-prepare is gated on the same flag, so a no-timer track does not fire a refused mutation on every render.
  - **The modal's columns follow the race's scoring strategy, not the track's timer** (`RaceExecution.tsx`'s `isPointsStrategy`): `TIMED` shows a time column and always derives places from it on save (`lanes.shouldDerivePlaces`); `POINTS` shows a place column and sends it exactly as typed — this applies to *every* `POINTS` race, timer or none, because points scoring has always meant somebody calling the order by eye. Calling `assignPlaces` unconditionally here was the bug: with no time anywhere, it reads that as "clear every place" and would silently discard a hand-typed finishing order.
  - **A lane can now hold a place with no time at all**, which nothing before #490 ever wrote — every prior writer set both together. `domain.lanes.Lane.has_result` (and so `has_results`, `is_finished`, and `heat_session.is_recorded`, which now delegates to `is_finished` instead of carrying its own copy) had to learn that a place alone is a result too, or a hand-placed `POINTS` heat would never register as recorded: the regeneration guard would let it be silently rebuilt, and the Race screen would never move off `WAITING` to offer Edit. The frontend's `hasTime`/`hasTimes` in `lanes.ts` matches. Safe to broaden because the invariant it depends on — place implies time, until now — always held for existing data.
- **Mutation-testing a backend rule: change the file's size, or force a new mtime.** CPython validates a cached `.pyc` on (mtime, size), and the usual mutation-test dance — save a copy, edit, run, `shutil.move` the copy back — restores *both*. Flipping `ON_DECK_DEPTH = 2` to `1` is the same length, and the copy's mtime came from a second earlier, so the interpreter went on serving the mutated bytecode: the unit tests were fine and the *end-to-end* run kept failing against a server that no source file described. Restore with `git checkout --` (which writes a fresh mtime) rather than `shutil.move`.

**The suite must never touch real hardware.** `conftest.py`'s autouse `no_real_serial_ports` stubs both `probe.usb_ports` and `probe.open_serial`. Tests that exercise probing pass their own `open_port` to `probe.detect`.
- **`_timer_status(s)` in `schema.py` is the only converter.** The `timerStatus` query and its subscription both go through it. They used to build the type separately, which is how a field lands on one and not the other — and with a normalized cache, a subscription payload missing a field the query supplied is how a value vanishes from a screen mid-event.
- **A gate watcher is a poll, and its answers are scoped to the poll.** A profile may carry `gate_watcher` (a command plus matchers) for a device that only reports the gate when asked. Real answers are as short as `0`, `U`, `O` and `.` — PDT's gate-closed pattern is a bare `.`, which matches any character — so `read_gate` is consulted **only** inside the window following a query, never as part of `parse_line`. Putting them in the general matcher list would have them claim every line the timer sends.
- **The debounce is for polled gate state only** (`GateBelief` in `state_machine.py`). A device that *pushes* an edge has already debounced it and says so once; requiring a second confirming observation would mean never believing it, which is the trap that kept the gate debounce out of [#90](https://github.com/dknowles2/trusty-track/pull/90). A poll is a sample and the next one re-observes, which is what makes waiting for persistence work there and only there. `min_change_seconds=0` means no debounce — the first sample is believed.
- **Polling runs only while ARMED or READY.** Not RUNNING: the answer cannot change a run under way, and DerbyNet found some timers resend the previous heat's results when queried too soon after gate-open. Not IDLE: nothing is waiting on the answer.
- **A poll-only device with no independent start signal needs `gate_open_starts_race`, not just a knowable gate** ([#340](https://github.com/dknowles2/trusty-track/issues/340)). The Champ's matchers hold only the lane-result pattern — the polled gate opening is the *only* thing that ever says a race started. Reading that as an ordinary re-armed gate (the ARMED/READY toggle every other polled profile uses) would leave `RACE_STARTED`'s commands unreachable and, worse, leave polling running — `_gate_poll_loop` only stops on a state transition it never gets, so the very fix that makes gate polling safe elsewhere (stop while RUNNING) would instead poll straight through a live run, the documented Pack936 failure. The flag makes a polled gate-open observed from READY go through `TimerManager._start_race()` — the same stop-polling/RUNNING/on-start-commands path a matched `RaceStarted` takes — instead of falling back to ARMED. Ignored unless `gate_state_is_knowable` is also true, since that is what makes READY reachable at all.
- **The MicroWizard is deliberately not polled.** `N2` makes it push both edges, so a query would be traffic for an answer already volunteered — and untested risk on the one device anybody runs.
- **`backend/tests/timer_recordings/` holds real device output** — DerbyNet's `.playback` files (MIT, attributed), replayed by `test_timer_recordings.py`. It is the only evidence here that did not come from us, and it immediately found that our MicroWizard could not identify a **K3**: that firmware writes `Serial Number 15985` with a space, and the prober needs the whole banner. **Check a new or edited profile against a recording if one exists** — a test written from the same notes as the profile agrees with the profile's mistakes.
- **Seven profiles are adapted from DerbyNet** (`devices/derbynet.py`, MIT, attributed) and **none has run against its hardware** — nor, strictly, has the MicroWizard. Every profile carries a `provenance` string that the timer check page displays; don't let a device name imply support. `test_timer_derbynet_profiles.py` feeds each one a line from its DerbyNet definition, which catches a mistyped pattern but *not* a wrong one.
- **The vocabulary the import needed**: `command_eol` (the Champ, The Judge and SuperTimer ignore commands without a `\r`), `on_event` (mostly "results overdue → force a report"), `LaneCount` (a timer reporting 6 lanes on a 4-lane track is a real misconfiguration), and `pre_probe` (a settle command before probing). SuperTimer II is deliberately absent — two-part results, a binary-encoded lane mask, and a 10000 scale factor, all for one device.
- **`/timer-check` is the diagnostics page** (`features/settings/pages/TimerDiagnostics.tsx`), linked from System Settings. It exists because the serial log was only reachable from inside a running heat, so "is my timer working" required setting up a race first. Serial-log rendering is `features/racing/serialLog.ts` — pure, tested, shared with `HardwareTimerMole`. Its command annotations describe the MicroWizard specifically; a second device means sourcing them from the active profile rather than from that table.
- **The bench test is how an untested profile becomes a tested one** ([#235](https://github.com/dknowles2/trusty-track/issues/235)). `startTimerTest` arms every lane with **no heat behind it** — `TimerManager.prepare_test_heat` sends exactly the commands a real heat would, and `_finish_test_run` writes nothing anywhere: no heats row, no lanes, no audit entry (`test_timer_test_run.py` pins all three). `_test_run` stays set through the finish so the diagnostics page can label the results a test; arming a real heat, aborting or resetting clears it. Refused while a real heat is armed — a bench test must not disarm race day. `GET /api/timer-test/{track_id}/report` packages the profile, framing and full serial conversation as a download; the frontend's `features/settings/timerTest.ts` (pure) builds the prefilled issue link that asks for the *file*, because asking a volunteer to describe serial traffic in prose is the failure the feature replaces. A good report is a `timer_recordings/` fixture waiting to be written.

**Remote start is two claims, not one** (#111). `TimerProfile.remote_start` says the device has a command for releasing the gate; `Track.remote_start_installed` says this track has the solenoid that command drives. Both are needed, and only the first is knowable from a protocol — the MicroWizard's gate release is a separately-sold accessory and `LG` is silently ignored without it, which is why DerbyNet gates theirs behind a command-line flag and we gate ours behind an operator setting. `TimerManager.can_remote_start()` is the conjunction; it rides on `TimerStatus` because the client has no copy of the profiles. `release_start_gate` refuses outside ARMED and READY and returns *why* as a string: releasing a gate with no heat armed sends cars down a track nothing is timing.

**Reverse lane numbering lives on `Track`, not on `TimerProfile`, for the same reason** (#553, stage 1 of #553's four-capability list). A finish-line unit is wired to its lanes in whatever order the installer plugged it in, which is a fact about this venue's cable — exactly as `remote_start_installed` is a fact about this venue's solenoid rather than about the device model — so `Track.reverse_lanes` sits beside it. **It applies at exactly one seam, in `TimerManager`, and nowhere else** — `_translated_lane(lane) = lane_count + 1 - lane`, applied only within `1..lane_count` so a device with more channels than the track has wired passes the extra ones through unchanged. Two crossings, both named in a comment block above `_translated_lane` in `manager.py`, and each flips exactly once:

- **Read side**, `_translate_incoming`, called once from `_process_line` on the value straight out of `TimerProfile.parse_line` — before `_handle_event` sees it. Deliberately not in `_handle_event` itself: `inject_event` (the fake timer, and unit tests) also lands there, already holding track lane numbers, since it never spoke to a device and has nothing on the wire to un-mirror. Flipping in `_handle_event` would double-cross a real result and wrongly cross a fake one.
- **Write side**, `_device_lane_mask`, wherever `HeatPrep.mask` commands are built — the device's own addressing for the lanes told to arm. Without this half, results would be correctly labelled while the timer armed and clocked the *wrong* two lanes.

A reversal applied in two places is a reversal in none; the mirror is its own inverse, so one method serves both directions. `test_timer_reverse_lanes.py` pins the seam directly, and `test_timer_recordings.py::test_a_recorded_session_is_mirrored_through_the_manager` replays a real Derby Timer recording through an actual `TimerManager` with the flag on, checked against the recording's own genuine results — the proof #553 asked for, since this is Trusty Track's own arithmetic and not the device's protocol, so it is the one of the issue's four capabilities verifiable with no hardware at all.

**At most one browser owns a track's proxy socket at a time** ([#301](https://github.com/dknowles2/trusty-track/issues/301)). On a proxied track `/ws/timer/{track_id}` *is* the timer, so a second connection — another device, or a reload whose old socket has not gone away yet — used to repoint `manager.set_write_fn()` and leave both sessions running, with the first tab believing it was still armed while its bytes went nowhere. `main.TIMER_WS_CONNECTIONS` tracks the websocket and `ProxySession` currently registered for each track; a takeover tears the outgoing session down itself — `ProxySession.close()`, which resets the write function and calls `manager.handle_disconnect()` — *before* installing the new one, and pops the registry entry first so the outgoing connection's own `finally` (once its receive loop eventually notices the close) finds no entry naming it and does not repeat that teardown. Two calls to `handle_disconnect()` would reset the *new* connection's write function back to the no-op, which is the bug this closes. The outgoing socket is then closed with code `4000` and an explicit reason, purely for the person watching that screen — `SerialProxyContext`'s `ws.onclose` now reads `event.reason` and reports `'error'` with it rather than a plain `'disconnected'`, which also surfaces the existing 4403/4000 refusals that were previously discarded the same way.

**`TimerManager` writes to the DB via its own `SessionLocal()`**, outside the request lifecycle — which is why the test suite maintains a second, file-backed database. See issue #9.

That database lives in `$TMPDIR/trustytrack_test_<checkout>_<worker>` (`backend/tests/data_dir.py`), which the suite **wipes at the start of a run** rather than at the end — a run that crashes or is killed still leaves a virgin directory for the next one, which teardown cannot promise, and the artefacts of a failed run stay put to be looked at. It is cleaned at all because nothing ever removed the images `POST /upload/` writes: the directory had reached 8,000 files and 3.5 GB before anybody looked, and the first test to zip it (the backup endpoint, #176) had to be killed. A run leaves about 40 files now.

**The name is per checkout and per xdist worker, and both parts were bugs.** The worker part is obvious once the suite runs `-n auto`: the workers are processes that import `conftest.py` the same way, and the first thing it does is delete this directory. The checkout part is the one nobody sees — several worktrees of this repository are a normal way to work, each with its own pytest and its own pre-commit hook, and they share one `TMPDIR`. A commit in one worktree was deleting the database and uploads of a run under way in another. It was quiet: nearly every test holds its database in memory and never looks here, so what surfaced was an occasional inexplicable failure in the few that do — `test_init_db` opens the file database, and the backup service zips the whole directory. What is deliberately **not** in the name is anything unique per run: a fixed name is what lets the wipe happen at the start rather than the end.

**The end-to-end runs have the same rule, in `frontend/e2e/environment.ts`** — data directory *and* ports derived from the checkout. Fixed ports meant the second worktree to start could not run the specs at all (`http://127.0.0.1:8002/health is already used`), and the backend URL was written out in eleven spec files, which is why the port could not be changed in one place to begin with. Ports are *derived*, never allocated: the same checkout gets the same port every run, so a server left by a killed run is on the port the next one wants — findable, where a moving port would hide it.

Three things about that header, each of which has a wrong-looking alternative:

- **The `os.environ` assignment must be the only statement before the imports.** Ruff's E402 tolerates exactly that one write ahead of them and nothing else, which is why the wipe happens *after* the imports and recreates `UPLOAD_DIR` — `database.py` makes it on import and `main.py` mounts it as static files, so removing it without putting it back breaks every upload test.
- **Read the path from `database.DATA_DIR`, never repeat it.** `test_init_db.py` hardcoded `/tmp/trustytrack_test`, so moving the directory would have pointed the test at one place and the app at another.
- **`test_the_suite_writes_to_a_temporary_data_directory` is the guard that matters.** Without conftest's assignment the suite writes into a real `~/.trustytrack` — deleting its database and dropping images beside the operator's photos — and nothing else in the tree would fail.

**A heat id used to stop being a stable handle** (#50). `invalidate_future_rounds` rewrites the heats of every later championship round on *every* earlier result; when it did that by deleting and re-inserting, an armed heat could vanish — or, since SQLite reuses rowids, come back as a different heat holding a different field. Three things now hold:

- **`_reset_heats_in_place` rewrites the existing rows** when the shape has not changed, so ids survive. It falls back to full regeneration only when the heat count differs (a racing group added to an `EACH_GROUP` round, say).
- **`_record_results` verifies before writing.** It compares the heat's current lane assignment against the `racer_by_lane` it was armed with and calls `_abandon_run` on a mismatch. `racer_by_lane` absent means *unknown*, not *no racers*, so the check sits out when the caller did not supply one.
- **`_revalidate_timers(info)` disarms proactively.** Call it from any mutation that regenerates, deletes or re-fields heats — it is already on `updateHeatResult`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `deleteRacer`, `bulkDeleteRacers` and `deleteRace`. Without it the operator only finds out after a run, holding times they must key in by hand. `deleteRacer` and `bulkDeleteRacers` were the last two rebuild paths without it, reachable from the lower-privileged check-in desk — `bulk_delete_racers` can regenerate an unraced round out from under an armed heat exactly like any other rebuild (#309); `deleteRace` closes the same gap for a heat armed on a shared track when a practice or second race sharing it is deleted.

**Arming a different heat mid-run must not inherit the run under way** (#337). `_record_results`'s staleness check only catches a heat whose *lanes* changed underneath it — it says nothing about the timer having been pointed at a different heat altogether. While heat A was RUNNING, nothing stopped the operator from selecting heat B and preparing it: `prepare_heat` unconditionally swapped `_active_heat_id`, and heat A's finish-line results then arrived into a manager that had moved on, landing on heat B — whose lanes genuinely matched what *it* was armed with, so the mismatch check had nothing to catch. The `prepareHeat` resolver now refuses to arm a *different* heat while the manager is RUNNING or RESULTS_OVERDUE, the same refusal `startTimerTest` already made for a bench test. Two things it deliberately leaves alone: preparing the *same* heat mid-run still works — that is "Reset Heat", the operator's way to abandon a stuck run and retry it — and switching heats while merely ARMED or READY is untouched, since nothing is pending yet and that is the ordinary "wrong heat selected" correction. The guard lives in the resolver, not in `TimerManager.prepare_heat` itself, which stays the low-level primitive several unit tests re-arm directly.

**A database error while writing a heat's results must not take the timer link down with it** (#342). `_record_results` runs inline on the byte-receive path, with no request or GraphQL resolver between it and the exception — so a locked SQLite file or an integrity error reaching `receive_bytes` killed `_read_loop` on backend-direct serial, and over the proxy reached `main.py`'s generic WebSocket handler, which closes the socket. Either way the whole timer link went down over a write failure that has nothing to do with the hardware, with the frontend holding no auto-reconnect for the proxy case. `_record_results` now catches `SQLAlchemyError` around the write, rolls the session back, and calls `_recording_failed` — the same shape as `_abandon_run` (heat disarmed, `_pending_results` kept), landing in `FAULT` rather than `IDLE` because a write failure is not the routine "the schedule changed" case those two calls cover. The times stay on the status and in the merged `heatSession` view for the operator to key in through Override.

**`forceResults` waits for the report it just asked for, rather than beating it there** ([#341](https://github.com/dknowles2/trusty-track/issues/341)). The mutation sends the device's force command (`RA` on a MicroWizard — "report every lane immediately") and used to call `force_record()` immediately after, which records the pending partials and transitions to IDLE. The device's answer — the very thing the command was sent to fetch, typically the stuck lane's 0.000 DNF — arrived milliseconds later into a state `_handle_event`'s `LaneResult` branch does not accept (the tested lane-result-outside-RUNNING case) and was dropped, leaving that lane's time missing rather than the DNF the device reported. `TimerManager.force_results()` is now the one door for the whole button: it sends the command holding `_event_lock` (the resolver used to call `_send_commands` without it, unlike every other manager entry point), then polls briefly — bounded by `FORCE_RESULTS_WAIT_SECONDS` — for the expected lanes to fill in through the ordinary event path before falling back to `force_record()`. When the report does arrive in that window, the ordinary `LaneResult` handling records it and `force_record()`'s own call is a no-op; there is no second write.

### Race-day keys and the finish sound

`features/racing/shortcuts.ts` and `features/racing/chime.ts`, wired in `RaceExecution` ([#207](https://github.com/dknowles2/trusty-track/issues/207), [#208](https://github.com/dknowles2/trusty-track/issues/208)). Both are pure rules with the doing in the component, the same split as `raceFlow.ts`.

**Three keys, and each is printed on the button it mirrors.** Space advances, E opens the editor, Escape cancels the countdown. A screen somebody uses once a year cannot amortise a cheat sheet, so a fourth key is a cost rather than a feature.

**Space does not start a heat.** On a real timer the gate is released by hand, and on the fake one the control is a debugging panel rather than part of the flow — so there is no "start" for a key to mean.

**Nothing fires while typing, with a dialog open, or with a modifier held**, and `preventDefault` is called *only* once an action has been decided. Space scrolls a page and Escape closes things; taking either away from a keystroke we are going to ignore is worse than having no shortcut.

**The hooks sit above `RaceExecution`'s two early returns** — no heat, and a round whose field is undecided. A hook after them does not run on every render, which is what `react-hooks/rules-of-hooks` catches.

**The chime is an edge, not a state.** `RECORDED` persists for as long as the operator leaves the heat on screen and a payload arrives for every lane time and every check-in, so `shouldChime` compares the previous phase. A null previous phase is a page load, which is not a heat finishing.

**Off by default, remembered per device**, like the PIN: the operator's laptop wants it and a wall display does not. Switching it on plays it once — the only way to find out whether the machine is muted without waiting for a heat. It is two WebAudio oscillators rather than an asset, because these machines have no internet.

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

**The screen stays on the heat it is showing; advancing is the toggle's job or the button's** (#130). `RaceControl` pins `selectedHeatId` to whatever the fallback landed on, adjusting it *during render* rather than in an effect — an effect would show the unpinned heat for a frame and then correct it, which is the flicker the `activeExecutionHeat` memo was written to avoid. It converges in one pass and is self-healing: a pinned heat that stops existing sends the memo back to the fallback, which then gets pinned.

Without that pin the fallback — "the first heat still to be run" — slid forward the moment a result landed, because recording a heat changes which heat that is. Three consequences, none of them obvious from reading the component:

- the recorded heat's **Edit** button went with it, leaving **Re-Run** — which *clears* the result — as the only route back to a mistyped time;
- **Next Heat** and **Cancel** were unreachable;
- and `raceFlow.ts` never observed the active heat as `RECORDED`, so `COUNTING_DOWN` was unreachable and **`autoAdvanceHeat` did nothing in either position** while the screen advanced regardless.

`raceFlow.test.ts` dispatches events directly and `RaceExecution.test.tsx` is handed a fixed heat, so neither could see it — this needs a real backend moving the data underneath, and it is pinned by two tests in `raceDay.spec.ts`.

`reduce` returns commands (`PREPARE_HEAT`, `ADVANCE_TO_NEXT_HEAT`) rather than performing them, which is what makes race-day behaviour assertable without rendering — `raceFlow.test.ts` dispatches event sequences and touches no DOM. Put a *rule* there and its *I/O* in `useRaceFlow.ts`; if you find yourself writing an `if` about the race in the hook or the component, it is in the wrong file.

Two things it settles that were previously accidents:

- **Cancelling a countdown is sticky, scoped to the heat.** Nothing the server can see changed when the operator clicked, so a machine that re-decided purely from the observation would start counting again on the next payload. Moving to another heat gets a countdown back.
- **A summary's presence and its id are separate fields.** `AdvancementStatus.roundId` is optional, so `hasRoundSummary` and `roundSummaryId` cannot be collapsed into one nullable number.

`roundCompletion.ts` is the matching piece for `RaceControl.tsx`: there is no event for "a round's field was just decided", so it is recovered by comparing one query result against the last. `seen === null` means "first look", where every decided round is history rather than news.

### Telling an audience display what to show

Vocabulary in `domain/displays.py`, presence in `services/displays.py`, the operator's list at **Race Control → Displays** (#174).

**A display registers by *subscribing*, and that is forced rather than chosen.** A screen holds no PIN and is a `VIEWER`, and a `VIEWER` may make no mutation at all (#15) — so presence cannot be announced by calling one. The constraint produces the right shape anyway: the display is the thing being told, not the thing asking. `displayAssignment` connects on entry and disconnects in a `finally`, because a browser tab closing arrives as cancellation.

**Presence is in memory, not the database.** A display is a browser tab that is open right now; a row saying a screen was on a gym wall last March describes nothing that still exists, and nothing would ever delete it. Assignments go with it, and losing them on a restart is not a gap — an unassigned display falls back to its own URL, which is what every display did before this existed. That fallback is why the whole feature needs no migration.

**`assigned` is a separate flag from the assignment**, and collapsing them breaks the fallback. Every connected display receives an opening payload carrying *an* assignment, so a client that treats "I have a payload" as "I have been told something" overrides the URL on every screen in the room the moment it connects. The end-to-end spec caught this; no unit test could, because each side was individually correct.

**A screen that goes quiet stays listed.** It is how the operator finds out the projector at the back has dropped off the wifi, and nothing but a person can tell a switched-off screen from a dead network — so `forgetDisplay` is the only way a row leaves.

**The photo slideshow is a sixth view** (#175), not a subsystem: `SLIDESHOW` in the same enum, rules in `features/observation/slideshow.ts`. It goes in **car number order rather than shuffling** — the audience is families watching for their own child, and under a shuffle nobody can tell whether they have missed them; in order everybody comes round once per cycle. Racers with no photograph are skipped rather than shown blank, and *loading* is distinguished from *nothing to show*, because the empty state otherwise fires during the first fetch and a projector announces "No photos yet" to the room on its way to the photographs.

**A screen's default name is derived from its own id, not drawn at random** (`domain/display_names.py`, #495). Presence is in memory, so a random name would be re-invented every restart — survivable for `Display 3`, which nobody used as a handle, and not for a name the operator has been saying out loud all morning ("put the standings on Plucky Puffin"). Seeding the draw from `display_id` — which the browser keeps in `localStorage` (`displayIdentity.ts`) — buys the same-screen-same-name property with no storage on the server at all. **Collisions are resolved on the animal, not the whole name**: `Brisk Badger` and `Bright Badger` are worse than `Display 1` and `Display 2`, because the noun is what gets read at a glance and shouted across a room, so `whimsical_name` walks its seeded candidates until it finds an animal nobody else in the race is using, and falls back to a numbered suffix only once the pool is exhausted — the walk must terminate, and the fallback is for the pathological case, not the expected one.

**Identify is an event, not a state, the same shape as the ceremony's steps and for the same reason.** `Display.identify_seq` is bumped by `identifyDisplay` and carried on every payload; the screen flashes its name when the seq it receives is higher than the one it already had, and **ignores the seq it arrives holding** — an opening payload is a reconnection, not an instruction, and a screen that obeyed it would flash its name on every wifi hiccup. That is `roundCompletion.ts`'s `seen === null` rule, applied in `identifyOverlay.ts` exactly as `AwardCeremony` already applies it to `slide_seq`.

**The rename form's reroll asks the server** ([#521](https://github.com/dknowles2/trusty-track/issues/521)). It used to draw from a twelve-item list hand-copied onto the frontend, filtered only against the name being edited — so it knew nothing about any *other* row on screen and could, and did, hand the operator a name a second display was already using, defeating the whole point of `whimsical_name`'s per-race uniqueness. `suggestDisplayName(displayId, avoid)` goes through `DisplayRegistry.suggest_name`, which runs the same walk `_auto_name` runs on first connect, against the same taken set — so there is one animal vocabulary and one collision rule, not two. `avoid` carries the draft currently in the input, because the walk is otherwise seeded from `displayId` alone and would hand back the identical word on every press; the frontend passes its current draft each time so "give me another" means that. Operator-only, enforced the same way as `auditLog` — `_require_operator_role`, since the role policy only guards mutations and this changes nothing, so it is a query.

**The ceremony can be driven from the operator's list, and the command is a *step*, never a slide number** (`advanceDisplay`). The display owns the index — it is the only thing that knows which trophy is up, and it holds no PIN to report one back (#15) — so an absolute index would need the server to be the sole driver, which kills the presenter remote at the projector. A step composes with both: `Display.slide_delta` is applied to wherever the ceremony has actually got to, and `Display.slide_seq` is what makes it an event rather than a state, since two Nexts carry the same delta. `AwardCeremony` ignores the seq it *arrives* holding — an opening payload is a reconnection, not an instruction, and obeying it would jump a trophy on every wifi hiccup; that is `roundCompletion.ts`'s `seen === null` rule again. Applied during render rather than in an effect, for the same reason `RaceControl` pins its heat that way.

**A view that leaves the observation page must take the subscription with it.** The ceremony is its own route, so an `AWARDS` assignment *navigates* the screen there — and the first version let that navigation close the `displayAssignment` subscription, which is both the screen's presence and its leash: the row dropped to "Not connected" and the screen could never be told anything again, the one state the feature promises cannot happen. `AwardCeremony` therefore holds the same subscription and navigates back to the observation page when an assignment names any other view — gated on `assigned`, the same flag lesson as the opening payload, or a hand-opened ceremony would march off to the standings the moment it connected. `displays.spec.ts` round-trips it end-to-end, which unit tests cannot: the failure is a socket closing across a route change.

**The ceremony is offered as a view only when the race has an award** (`displayView.viewOptionsFor`). Choosing it for a race with none sends the screen to a page whose only content is a line saying there is nothing to announce, and most races never define any — an option that can only disappoint is worse than one that is absent. Two things about it: the option is **kept when the screen is already showing it**, because a select whose current value is missing from its own list renders with nothing chosen and the row then says nothing about what the screen is doing (reachable by deleting the last award mid-ceremony); and it is an **offer, not a permission** — the server still accepts the assignment and the ceremony page still speaks for itself, rather than the rule getting a second copy to keep in step. The panel reads the count `cache-and-network` on every visit to the tab, which is what makes an award added a minute ago on another page show up.

**A full-screen view hides the app's chrome through `ChromeContext`, not the URL.** `Navigation` used to read `?projector=true`, which stopped being sufficient the moment a view could be *assigned*: an operator switching a screen to Projector from across the room got projector mode with the navigation bar across the top, because no URL had changed. Rewriting the display's URL on assignment is the tempting fix and is worse — the URL is the fallback the assignment overrides, so writing to it makes a reload flash the previous view.

`Display` is **keyed on `displayId`** in graphcache, not embedded: `assignDisplay` returns one and the panel's list has to recognise it as the row it is already holding. `CUSTOM_KEYED_TYPES` in `api/graphqlClient.ts` exists for it, and `graphqlClient.test.ts` requires every id-less type to be in exactly one of the two lists.

### One row of race navigation

`Navigation.tsx` holds every race view — Roster, Control, Standings, Awards, Stats, Live — and that is the only race navigation there is. There used to be a second: a `RaceModeToggle` rendered by four pages, offering Roster/Standings/Awards/Stats. Standings and Stats therefore appeared **twice**, two rows apart, and the same page was called Details in one and Roster in the other. Awards appeared only on the toggle, so it was unreachable from Control or Live.

The merged row keeps the toggle's word — **Roster**, which is what the page calls itself — and Standings and RaceStats lost header rows that existed only to centre the toggle between two spacer divs.

If you add a race view, it goes in `links` in `Navigation.tsx`. Don't reintroduce a per-page toggle.

**The browser tab's name is `features/core/pageTitle.ts`**, applied by `PageTitle` — a component rendering nothing, mounted once inside the router. Every page was called "Trusty Track" until then, which on race day is several identical tabs. A component rather than a hook each page calls, for #48's reason: fourteen routes, and a rule depending on every page remembering reaches only some. Two things about the wording, both about how a tab strip is read: **what distinguishes this tab comes first**, since a tab truncates from the right and the app's name is the part every tab shares; and the second half names **what the page is about** — the race for a race page, the application otherwise ("Standings — 2026 Pinewood Derby", "Settings — Trusty Track"). The words are the navigation's labels and Race Control's own tab labels, so a title traces back to something the operator clicked. A race whose name has not arrived yet is the view alone rather than "Standings — undefined". The name costs no request: it comes off `GET_RACES_NAV`, which the navigation has already fetched.

**The race list survives a second tab** ([#300](https://github.com/dknowles2/trusty-track/issues/300)). `Navigation.tsx` fetched `GET_RACES_NAV` once on mount, so a race created, renamed or deleted in another tab — or another device on the same LAN — left every other tab's selector, and the browser tab's title behind it, stale until a reload. `racesChanged` is an **argument-free** subscription — the one exception to every other subscription in the schema being scoped to a race, a track or a display, because the navigation's race list is not scoped to one race — and its payload is a bare `true` rather than the list itself: the client already holds `GET_RACES_NAV`, and shipping the list down the socket a second way would need to be kept in step with the query rather than just triggering it. `createRace`, `updateRace`, `deleteRace` and `createPracticeRace` all publish it — the fourth because it inserts into `races` the same as the first, and #48's lesson is that a rule reaching only the obvious call sites reaches only some of them. Deliberately **not** folded into `raceStateChanged`: that channel is per-race, and a sentinel race id on it would mean every existing subscriber — scoped to a race that may not be the one on screen — filtering out an event that was never theirs. `Navigation.tsx` re-executes `GET_RACES_NAV` with `requestPolicy: 'network-only'` on the signal; `PageTitle` needs no change, since it reads the same query through the normalized cache and updates when the cache does.

### The roster toolbar

`RaceDetails.tsx`. Six buttons competed for one row and four of them wrapped their labels at 1280px. The rule now: **the first row holds Add Racer, Scan and an overflow menu, and nothing else.** Manage racing groups, upload photos and print are things an operator does once before an event, so they live behind the `⋯`; add and scan are the two reached for repeatedly. Search and the group-by-racing-group toggle sit on their own row beneath.

**There is no Bulk Actions button.** It was disabled for most of the day — space spent saying "not yet" — and what it held is now a selection bar that exists only while rows are ticked, with a clear-selection ✕. `roster-selection-bar` and `roster-more-menu` are the test ids; the individual `bulk-*-btn` ids survived the move, so what changed for a test is only that the actions no longer need a menu opened first.

Move-to-racing-group is still a menu, because six racing groups will not fit on the bar — but it opens **downward** now rather than flying out sideways, which retired `denMenuSide`, `denMenuContainerRef`, `moveDenTimeoutRef` and the two hover handlers that measured which side had room.

**Only the actions that remove something clear the selection** ([#420](https://github.com/dknowles2/trusty-track/issues/420)). The desk works a queue: select everyone, Auto number, then Check In — and until now the first click cleared the selection along with everything else, so the second landed on nothing, silently, because the bar it would have used had just disappeared. Check In, Auto number and Move to racing group now leave `selectedRacerIds` standing after they succeed, so that sequence is one selection rather than two. Clear numbers and Delete still clear it — both remove data (numbers, or the rows themselves) rather than adding to it, so a selection surviving them is a chance to repeat a destructive action by mistake, not a convenience. The explicit **✕** is unaffected either way.

### The settings page is sectioned, except the first time

`SystemSettings.tsx`, with the vocabulary in `features/settings/sections.ts`
and the nav in `SettingsNav.tsx`. The page was one 600px column holding an
organization name, two PINs, every track's name, geometry, lanes-in-service,
timer, model, remote start and historical records, a backup panel and two links
out. The documentation had already started writing it as though it were
sectioned — "Settings → Access", "Settings → Tracks → Lanes in service",
"Settings → Backup" — which is the tell that the page owed the reader those
sections. They are named after what the docs already called them.

**The first run gets no nav at all.** `sectionsFor(false)` returns an empty
list and the caller reads that as "render the lot": the same screen is the
setup wizard until it has been saved once, and somebody who has never seen the
app should meet every field in order rather than go hunting for the two they
have not filled in. It is also why Backup is absent there rather than merely
empty — offering to replace an install that does not exist yet is offering
nothing.

**Down the left, not across the top.** There is already a navigation row across
the top of every page, and a second row is what "One row of race navigation"
above was written to end. Under 768px the column becomes a wrapping row, since
the phone at the registration desk is a real device.

**Validation moved into `firstProblem`, and this is not decoration.** The
browser only validates the fields it is *rendering*, so with one section on
screen an empty organization name is not in the document and nothing native
fires — the save would go up missing a name. `handleSubmit` checks the whole
form and **switches to the section holding the problem**, because reporting
"your organization needs a name" over the track form is a dead end. The inputs
keep `required`/`min` as well: those still catch the value that *is* on screen,
and the browser points straight at it. The check also names the track at fault
by number, which the form never did even when everything was on screen at once.

**Backup is outside the `<form>`.** A Restore button under a submit button
saying **Save Settings** is one misclick from replacing the event —
`BackupPanel`'s own header has said so since #176, and `isFormSection` is now
where that is stated once.

**The two links out (`/timer-check`, `/activity`) are nav items, not a
footnote**, and the docs send people to them by that route. On the wizard,
where there is no nav, they stay as the strip under the form.

**A saved track's card carries its own `Check this timer →`**, to
`/timer-check#timer-<id>`. "Is my timer working" is a question about *one*
timer, and the diagnostics page renders a live panel per track — a three-track
venue arriving at the top of that page has to work out which panel is theirs,
which looks like nothing being wrong. `TimerDiagnostics` gives each section
`id="timer-<id>"` and scrolls to the fragment itself, because a router
navigation does not scroll to one the way a page load does, and the sections do
not exist until the tracks query has answered. The nav's general link stays:
before the first save a track has no id to point at, and the docs name that
route in two places.

A track's card is `TrackCard.tsx`, split under **The track** and **The timer** —
it was 200 lines of JSX inside a `.map()` with nothing saying which controls
were about the track and which about the device at the end of it. Lanes in
service and track records still save on click rather than on **Save Settings**,
and still say so.

### Themes

Three independently configurable colour surfaces (#498) — **App** (the
operator's own screens), **Display** (the audience/projector views), and
**Printables** (pit passes, licences, heat sheets, certificates, results
sheets) — each pickable from seven purpose-built themes: Field Uniform
(default, unchanged), Under the Lights, Old Glory, Clear Sight, Sawdust &
Pine, Trail Colors, and Newsprint. Full user-facing detail —
what each is for, which is per-device versus per-install, the printing/ink
note — is `docs/reference/themes.md`; this section is the mechanism.

**A theme is one plain data record, not a stylesheet.** `frontend/src/
theming/themes.ts` is the one place a theme's colours live — `THEMES: readonly
Theme[]`, each with `app`/`display`/`printables` token maps and an `isDark`
flag per surface. `applyTheme` (`theming/applyTheme.ts`) redefines a surface's
CSS custom properties as inline styles on that surface's own root element and
sets its `data-theme` attribute; nothing generates a stylesheet, so there is
nothing else able to disagree with this file. `index.css` keeps Field
Uniform's own values as the pre-JS `:root` fallback (`themes.test.ts` pins
that the two agree), and `[data-theme="clear-sight"]` / `[data-theme=
"newsprint"]` selectors carry the two deviations that are not a token value
at all — Clear Sight's solid border and heavier type, Newsprint's header
rule in place of a filled bar.

**Three scoping roots, and `applyTheme` clears what it does not set.** The
App root is `document.body` (`theming/appTheme.ts`'s `applyStoredAppTheme`,
called first in `main.tsx` and again on a Settings save); the Display root is
`Observation.tsx`'s and `AwardCeremony.tsx`'s own top-level elements; the
Printables root is the shared `.printables-page` div each of `Printables.tsx`
/ `Certificate.tsx` / `HeatSheet.tsx` / `ResultsSheet.tsx` renders
(`features/printables/printablesTheme.ts` is the one helper all four call, so
there are not four copies of the resolve-and-cast). `applyTheme` takes every
token name a surface *could* hold and either sets it or calls
`removeProperty` — otherwise switching from Newsprint (which sets
`--print-decor-color`) to a theme that does not would leave a stale inline
override nothing clears.

**`MATCH_APP` always resolves against Field Uniform, everywhere, never
against a live App theme** (#528). The App theme lives only in each
device's own `localStorage` and never reaches the server, so nothing — not a
wall display, not a printed page, not even the settings page's own preview —
can know "the App picker's current value" for a device other than itself;
there is no App picker for either surface to defer to. `resolveSurfaceKey(setting)`
takes no App theme argument at all, and every caller (`Observation.tsx`,
`AwardCeremony.tsx`, the four Printables pages, and `AppearancePreview.tsx`)
resolves it the same way, so `MATCH_APP` always resolves to Field Uniform —
which is also why Field Uniform's Display definition is exactly today's
shipped `.projector-mode` palette: an install that has never opened Settings
renders identically to before this feature existed. The Display/Printables
pickers show this option as **"Field Uniform (default)"**, not "Match App
theme" — the old name promised a relationship the architecture cannot
deliver (the App theme is per-device, Display and Printables are
per-install), and it briefly meant something different in the settings
preview alone: before #528, `AppearancePreview.tsx` was the one caller
passing a real `appThemeKey`, so previewing the default showed whichever
theme the App picker's own (unsaved) selection happened to be, not what the
wall or the printer would actually render. The preview now resolves
Display/Printables exactly as they resolve everywhere else — showing the
operator a look they would not get was worse than showing them the truth.

**Per-device App theme, per-install Display and Printables.** `Organization.
display_theme` / `Organization.printables_theme` are `varchar` columns, server
default `'MATCH_APP'`, exposed on `initialConfig` and set through
`updateInitialConfig` alongside the org name and PINs — the same reasoning as
the Displays system already pushing view state from the operator's own list
(see "Telling an audience display what to show"): walking to every wall
display to set the same theme on each defeats the point. The App theme is
`localStorage` only (`trustytrack.appTheme`, same shape as the PIN and the
finish chime) and is never sent to the server.

**No clear flag, unlike the PIN or the weight limit — because there is no
bare-null state to disambiguate.** `InitialConfigInput.display_theme` /
`.printables_theme` are `str | None = None`: absent means leave alone, same
as every other optional field here. What makes this *unlike* the PIN
(`""` clears it) and the weight limit (`clearWeightLimit` exists because
`null` is both "no limit" and "not supplied") is that this column's own "off"
state is the non-null string `"MATCH_APP"` — an operator resetting to the
default sends that value explicitly, which the absent-means-leave-alone rule
already handles with nothing extra. `_apply_themes` in `api/schema.py`
mirrors `_apply_pins`'s shape for exactly this reason.

**Plain `String`, not `SAEnum`, on the backend.** Unlike `TimerType` or
`ScoringStrategy`, nothing server-side branches on a theme key — the frontend
holds the one canonical vocabulary, the same relationship it has with a
timer's `TimerProfile`. A value from a build that no longer ships a theme (an
old device, a stale column) falls back to Field Uniform in `themeByKey`,
never a crash.

**`AwardArtwork`'s `variant` is derived from the active theme, not
hardcoded, on both ends that changed.** The Awards list (App surface) passes
`variant={appIsDark ? 'dark' : 'light'}`, reading this device's own
`localStorage` theme — Under the Lights is the only one of the seven with a
dark App surface, and without this its Awards list drew every trophy in blue
against a background nearly the same colour. `AwardCeremony`'s background
converged from a hardcoded `--scouting-blue` to `--display-bg-color` — the
one deliberate colour change this feature makes to an existing screen under
the *default* theme (stage 1's groundwork PR left it as a hardcoded literal
because no theme data existed yet to decide with). `resolvePalette` in
`artwork.tsx` now prefers a caller's own `palette.line` for `variant="dark"`
rather than always forcing white — needed because `--display-text-color` is
not pure white under Sawdust & Pine or Trail Colors.

**The demo denylist leaves `updateInitialConfig` refused, whole.** Themes are
cosmetic and harmless to try, but the mutation that carries them also sets
PINs and reconfigures tracks — real ways to break the demo for everyone else
— and it is one mutation, not one per field. Splitting Display/Printables
into their own mutation just to carve a demo exception was considered and
rejected as disproportionate complexity for a demo-only nicety. A demo
visitor still gets the real experience: the App theme is client-only and
always available, and the settings page's three-panel live preview needs no
mutation at all, so every theme's full App/Display/Printables rendering is
visible without persisting anything.

**Not attempted here: the ~140-file inline-style migration.** #498's own
"Required groundwork" section calls this out as its own milestone, separate
from adding the themes themselves. This feature converts the files Display
and Printables theming actually depends on (stage 1) plus a representative
slice of decoration (`--print-decor-strength` on the chequered band, the
licence wash and the certificate guilloche; Clear Sight's `.racer-card`
border) — most inline-styled screens still read literal colours and do not
respond to a theme. `docs/reference/themes.md` and the landing page say so
plainly, per the project's own honesty rule for partial coverage.

### Printables

Pit passes, driver's licences and check-in codes. `/race/:raceId/print`, from the roster's **Print** button.

**HTML the browser prints, not server-rendered PDFs** — the plan assumed PDFs. There is no PDF toolchain on a Pi, the branding already lives in the frontend, and a sheet of sixty is a CSS grid rather than a page-composition problem. The one thing a page cannot draw for itself is the QR code, so that is the only part the server renders: `GET /api/printables/barcode/{racer_id}.png`, registered **at both `/printables/...` and `/api/printables/...`** because the Vite dev proxy strips the prefix — the `/api`-only form works in production and 404s on the machine it is written on.

**Sheet-first.** Nobody prints one pit pass; they print sixty before check-in opens. The page is the sheet, the roster's selection arrives on `?racers=`, and an *empty* selection means the whole roster rather than nothing.

**The layout numbers live in `documents.ts`, not the stylesheet.** The page has to say "2 sheets of Letter" before the operator commits paper, so the card geometry is read by both TypeScript and CSS (as custom properties set inline) rather than kept in two places. `inPrintOrder` is the other rule worth knowing: car number ascending, unnumbered racers last — they are the ones still needing a number, which is easier to spot at the bottom of a stack than the middle.

The payload is `TT1:<race_id>:<racer_id>` — versioned because these live on paper and get scanned by a later version of the app, race-scoped because a bare racer id from last year's derby resolves to whoever holds that id now. `domain/printables.py` owns encode and decode; `features/printables/scanning.ts` is its mirror on the frontend, and **both pin the literal payload in a test** so neither can drift alone.

**The decoration is drawn, never fetched** (`components/PrintDecor.tsx`, and the gradients in `PrintSheet.css`). Same rule as the award artwork and the finish chime, for the same reason: these pages get printed on a laptop at a venue with no internet, and an image that 404s prints as a blank rectangle rather than as an error. Two things about how it is split. The flat repeating things — the chequered flag band under every card header, the licence's security wash — are **CSS gradients rather than SVG `<pattern>`s**: a sheet of pit passes is sixty cards, and sixty patterns is sixty copies of the same element id; a gradient has no id to collide. And **nothing in `PrintDecor` carries `role="img"`**, which is load-bearing rather than tidy — `Certificate.test.tsx` uses `svg[role="img"]` to tell a certificate that has award artwork from one that does not, so border furniture answering to that selector would break the distinction.

**Nothing in `PrintDecor` is scaled past about an inch, and the certificate is why.** Its background was first a giant outlined `DerbyCar`, and a recognisable object blown up to fill a page is clip art whatever it is drawn of — it also fought the award's own artwork, the one picture on that page that means anything. The background is texture instead: `.certificate::before` is a repeating-radial-gradient guilloche, masked to a band so it is clear of the recipient's name in the middle and of the frame at the edge. **Rings rather than rays** — a `repeating-conic-gradient` converges, so it crowds to a dark knot behind exactly the line that matters and reads as a sunburst. A print engine that ignores the mask gets the rings everywhere at 5%, which is survivable rather than wrong.

**One frame, and the corner ornaments are part of it.** The certificate carried a navy `double` border *and* an inset gold `outline` *and* four corner brackets, which is three concentric lines — at which point the ornament reads as a fourth frame rather than as ornament. Gold now appears once in the border region (the corners) and once under the recipient's name.

**The car is a wedge, and that took throwing away two drafts.** A silhouette with a flat deck and a squared rear block reads as a pickup truck at every size, however carefully the nose is tapered; what says "pinewood derby" is the single unbroken slope from tail to nose, slightly concave (a straight one is a doorstop). Judge a shape like this at the size it is *used* — a footer glyph is 26px, and detail that only works at 240px is a smudge there.

**Two contrast traps, both of which only appear on some racers' cards.** A portrait's ring is gold, and an initials placeholder takes its colour from the racer's *name* — one of those colours is that same gold, so the ring vanishes on exactly those cards unless a white gap ring sits inside it. The pit pass's car-number roundel is gold on the portrait for the same reason and needs the same treatment. Neither is visible in a screenshot of one card; both are visible on a sheet of sixty.

**`print-color-adjust` is stated over the document and everything in it**, not as a list of classes. The list had already reached four, and a decoration added later that nobody adds to it fails silently *and only on paper* — the screen preview is right and the print is white on white.

**Scanning is Chromium-only, by decision.** `CheckInScanner.tsx` decodes with the browser's own `BarcodeDetector` rather than adding a decode library — the same trade the browser-proxied serial timer already makes. Safari and Firefox get the car-number entry and a line saying why. That entry is **not** a fallback branch: it is on screen next to the viewfinder everywhere, because a creased code with a queue behind the table is the common case. It resolves only when exactly one racer holds the number — manual numbering allows duplicates, and picking the first would check in the wrong child.

A scan has **four** outcomes, not racer-or-nothing (`scanning.resolveScan`): the racer, not one of ours, a code from another race, or a racer deleted since printing. They are separate because the operator's next move differs for each.

**The heat sheet is a table, not a card** ([#173](https://github.com/dknowles2/trusty-track/issues/173)). `/race/:raceId/print/heat-sheet`, linked from the schedule rather than the roster's print menu, because it prints the *schedule*. `heatSheet.ts` holds the rules and shares only the stylesheet with the cards above — `DocumentSpec` and `perSheet` are card geometry and do not apply.

Two rules there, both about what paper needs that a screen does not: a lane's three states are **distinct** — an unadvanced championship slot reads "To be decided" because somebody will write a name in, an empty lane reads "—" because nobody is coming, and rendering both as blank loses that. And every row gets a column for every lane the **track** has rather than every lane the heat holds, so a heat short a lane still lines up with the rows above it. The blank **Result** column is deliberate: this sheet is what the announcer's table has when a screen is not there — the laptop runs flat, the timer stops talking, an auxiliary display drops off the wifi. Naming only the last of those is how the landing page ended up promising paper for a wifi failure two sections after boasting that nothing needs wifi.

**CSV lives in `utils/csv.ts`**, not in whichever page needed it. `RaceStats` had the only copy and it quoted every field without escaping an embedded quote, so a car named `The "Beast"` produced a malformed row and silently shifted every later column. Use `downloadCsv` / `filenameFor`; don't inline a third.

### Roles and the operator PIN

`backend/api/auth.py`. Three roles — `VIEWER` (the wall displays, no credential, **no mutations at all**), `CHECKIN` (the registration desk: racers, photos, check-in), `OPERATOR` (everything). Derived from who is physically in the room, not from an abstract permission model.

**Off until a PIN is set.** An install with no `Organization.operator_pin_hash` treats every caller as `OPERATOR`, which is exactly what every install did before #15. That is what lets this land without locking an operator out of their own event mid-season, and it is why the deferral's concern — nobody wants a login prompt on race morning — is met: the prompt exists only if they choose to set a PIN.

**One enforcement seam, not the two the design sketch proposed.** `RolePolicyExtension.resolve` checks `info.field_name` against `POLICY[role]` for any field whose parent is `Mutation`. The sketch's second layer (`allowed_operation_types` for `VIEWER`) is *not* here, for three measured reasons: `AsyncBaseHTTPView.execute_single` recomputes that set from the HTTP method, so overriding `execute_operation` — the seam the sketch names — misses the ordinary path; `VIEWER` holds an empty set so every mutation is refused anyway; and `resolve` fires on the **WebSocket** too, which closes the gap the sketch flagged (`graphql-ws` permits a mutation on the socket a subscription arrived on, and observation is almost all subscriptions).

Two traps, both recorded on #15 and both still true:

- **`on_execute` swallows the exception** — the mutation runs to completion and returns data. Use `resolve`. Any test here must assert the mutation was *refused* (the row is absent), never that the check ran.
- **There are two `OperationType` enums** with identical reprs and no overlap under `is`. Not relevant now that layer 1 is gone, but it is why it was tried.

**Adding a mutation means classifying it.** `test_auth_policy.py::test_every_mutation_is_classified` compares `CHECKIN_MUTATIONS | OPERATOR_ONLY_MUTATIONS` against the schema **in both directions** — a new mutation nobody bucketed is denied to *every* role including the operator, silently, so this turns that into a red build; and the reverse direction catches an entry outliving the mutation it named.

**The client's half is `api/pin.ts`** — the PIN lives in `localStorage`, per device, which is the point: the operator's laptop holds the operator PIN, the desk's tablet the check-in one, and a wall display holds nothing and stays a viewer. `UnlockButton` is in **both** navigation surfaces, because the header and the mobile drawer are different components and a phone at the desk only ever sees the second.

**Entering a PIN reloads the page.** Heavy-handed for four digits and deliberate: the socket carries the PIN in its URL, so a new PIN needs a new socket, and rebuilding the urql client and its normalized cache mid-session to avoid a reload is a great deal more machinery for something that happens once per device per event.

**The PIN travels in the `x-trustytrack-pin` header**, or as a `?pin=` query parameter on the WebSocket, which has no headers of its own. Not a cookie: same-origin, so CORS stays simple and `allow_credentials` is off — the old `allow_origins=["*"]` with `allow_credentials=True` was rejected by browsers outright, so it was broken *and* permissive.

**`/ws/timer/{track_id}` is operator-only**, and its check runs *before* the track lookup so an unauthenticated caller learns nothing — not whether the track exists, nor whether proxy mode is on. It is not GraphQL, so the role policy does not reach it, and it is the one path that could change who won without touching a mutation: on a proxied track that socket *is* the timer. Refusals close with **4403**; 4000 is anything about the track.

**Role resolution is lazy** (`auth.resolve_role`). It costs a query for the configured PINs, and only a mutation ever asks — an audience display resolves no role at all. `test_query_counts.py` caught the eager version.

**Absent and empty PINs mean different things** in `InitialConfigInput`. Absent is *leave alone*; empty is *clear*. The settings page re-submits the whole config on every save and cannot send back a PIN it is never given, so treating absent as "clear" would switch enforcement off whenever the operator renamed a track.

### The public demo

`backend/demo_mode.py` for the flag, `backend/api/demo_policy.py` for what a demo refuses. `TRUSTYTRACK_DEMO_MODE` is **off by default and read at call time**, like `TRUSTYTRACK_DEMO_SEED` — absent means an ordinary install, which is every install that exists.

The whole feature exists because two things are one click from ending a public instance. **`createInitialConfig` sets the operator PIN, and an install with no PIN treats every caller as `OPERATOR`** — so the first visitor to open System Settings owns the demo until somebody resets it. And `POST /upload/` wrote a permanent file from an unauthenticated request, which on a public URL is an anonymous image host and the route by which a real photograph of a real child arrives on a machine that exists to avoid holding one.

**A denylist, not an allowlist, and the asymmetry with `auth.py` is deliberate.** The role policy classifies every mutation and denies anything absent from the table, because an unclassified mutation should fail closed — `test_auth_policy.py` compares against the schema in **both** directions for that reason. Here the opposite is right: a new mutation is ordinary demo behaviour, and failing closed would mean every feature added after this file silently stops working on the demo with nothing to say so. So `test_demo_mode.py::test_every_refused_mutation_exists` checks **one** direction — a stale entry — and says so, because beside its neighbour it reads as an oversight.

**Extension order is load-bearing in two directions at once**, and it reads backwards — a later extension wraps an earlier one, so execution runs from the end of the list towards the front:

```python
schema = strawberry.Schema(
    ...,
    extensions=[RolePolicyExtension, DemoPolicyExtension, AuditExtension],
)
```

Before `AuditExtension`, so a demo refusal is recorded like any other (#219's rule, from the other side). After `RolePolicyExtension`, so it runs *first*: on a demo nobody sets a PIN, so every caller is `OPERATOR` and the role policy would have allowed the mutation and reported the wrong reason. `test_demo_mode.py::test_the_refusal_is_recorded` fails to a one-line swap.

**Deleting things stays allowed.** Destroying a race is part of what a visitor is there to try, and the reset undoes it. What is refused is the set that ends the demo for everybody else, or that puts something on the disk which should not be there.

**The four REST routes check for themselves** — upload, backup, restore and `/ws/timer/{track_id}` — because the schema extensions cover GraphQL mutations and none of these is one. Same reason the backup routes already make their own `_require_operator` call (#15).

**`POST /upload/` is guarded and capped in every mode, not only the demo.** At `CHECKIN` rather than `OPERATOR`, matching its GraphQL twin `uploadImage`: requiring the operator would make the REST route stricter than the mutation that does the same thing, and photographing a car is the desk's job. The body is read in chunks against `MAX_UPLOAD_BYTES` rather than read whole and measured afterwards — measuring afterwards happens once the thing being guarded against is already in memory. Note the route has **no callers**: the frontend sends data URLs through `uploadImage`. Whether it should exist is a separate question from whether it should be open, and only the second is settled.

**Tracks are coerced to `TimerType.FAKE` when the managers are built.** Belt and braces — the mutations that could change a timer type are refused — but a seed archive carries whatever type it was built with, and an `AUTO_DETECT_BACKEND` track sends `autodetect()` walking the USB serial ports. A track that cannot be reconfigured should not be probed either.

**The demo builds its own event on first boot** (`backend/demo_content.py`, called from the lifespan). It opens on a raced preliminary round, standings drawn from it, a final whose field filled itself through the advancement cascade — and **a heat still left to run**, which is the one an all-raced demo loses: a visitor should be able to *do* something, not only read what already happened. Each of those three is pinned by a test that fails to a one-line change.

**Seeded from code, not from a baked-in archive.** The plan chose an archive so that reset could reuse `restore_archive`'s teardown; at boot there is nothing to tear down — that teardown exists because a restore replaces a *running* event. A committed binary would also be regenerated by hand and stale by default, where code is always at the current schema. The reset half is the other side of that: on Cloud Run scale-to-zero *is* the reset, and an always-on host would need a timer instead ([#297](https://github.com/dknowles2/trusty-track/issues/297)).

**`is_seeded` asks whether an `Organization` exists**, which is the question the first-run gate asks, so there is no marker column — #201 declined one for the practice race for the same reason. The consequence is deliberate: a demo container that somehow starts against a database holding somebody's real event seeds nothing on top of it.

**A migration failure stops a demo and not an install.** `init_db()` raising has always been logged and stepped over, which is right for an operator — they can read the log and the app is still there. The demo has nobody to read it and ephemeral storage, so carrying on means serving an empty or half-migrated database to every visitor with nothing to say so.

**The demo lets go of its socket when nobody is using it.** Rules in `frontend/src/api/demoSession.ts`, wiring in `features/core/components/DemoSessionGate.tsx` — `raceFlow.ts`'s split, for its reason. The host bills instance-time rather than request-time, so cost does not scale with viewers; the whole risk is **one visitor who leaves a tab open**, because a subscription socket in flight is an instance that never scales to zero.

**It latches, and does not disable any of `liveConnection.ts`.** That module is built to *never* stay disconnected — retry forever, ping an idle socket, close a half-open one so the retry path notices — and all three are right for a gym on race day and exactly wrong for scaling to zero. So the demo *disposes* the `graphql-ws` client, which is the one thing that policy cannot come back from, and the phases are one-way: reviving on a mouse move would leave a subscription-driven page silently receiving nothing, which is the failure `pingWatchdog` exists to prevent, reintroduced by the thing meant to save money. **Resuming is a page reload**, following the PIN's precedent (#15).

**The cap is checked before idleness**, or a visitor who keeps clicking holds a session open forever — which is the case the cap exists for. **The gate polls rather than arming a timer for the deadline**: a laptop that sleeps with the tab open does not fire a pending `setTimeout` on schedule, and waking to find the demo still connected is what this prevents.

**`initialConfig.demoMode` is how the page finds out**, reported on the unconfigured branch too — a first-run wizard is the one screen that must not be idled out from under somebody halfway through it.

**The image honours `$PORT`, and the `CMD` is shell form for it.** Cloud Run and Railway tell a container which port to listen on, and one that ignores it is marked unhealthy and killed; `${PORT:-8000}` keeps every documented `docker run -p 8000:8000` working. **Keep the `exec`** — without it `sh` stays PID 1, uvicorn is its child, and the SIGTERM a platform sends to stop the container never reaches the server, so every shutdown is a ten-second wait and then a kill.

**`deploy/cloudrun/deploy.sh` is the deployment, and its flags are the documentation.** `--max-instances=1` is both a hard cost ceiling and free correctness — the pub/sub singleton and the `TIMER_MANAGERS` dict need one instance, and WebSockets then need no session affinity. `--min-instances=0` lets the instance die, which is the reset. **Never set "CPU always allocated"**: it bills continuously and deletes the entire advantage. Don't grow this into a deployment framework — the portability comes from having no durable state and calling no platform APIs, not from a layer over four of them. `VOLUME ["/data"]` is deliberately left in the Dockerfile: ignored on the target, and the demo points `TRUSTYTRACK_DATA_DIR` at `/tmp` instead, so removing it would only change what a real Docker operator gets.

**Releasing a stable version pushes it to the demo** (`.github/workflows/deploy-demo.yml`, called by `release.yml`'s `deploy-demo` job). Four rules, each of which is a way of getting it wrong:

- **It deploys the image the release just published, and never builds one.** The demo is then byte-for-byte what the release page hands out, and the workflow needs no Cloud Build permissions — the `IMAGE=…` arm of `deploy.sh`, which is why that arm exists.
- **It calls `deploy.sh` rather than repeating its flags.** Those flags are the description of what the demo *is* (`--max-instances=1` for the in-process pub/sub, `--min-instances=0` so the instance dying is the reset), and a second copy in a workflow would be free to disagree with the script the maintainer runs by hand.
- **Configuration is repository *variables*, not secrets**, and the reason is mechanical as well as tidy: `secrets` is not readable from a job-level `if` and `vars` is, so `if: vars.DEMO_CLOUD_RUN_PROJECT != ''` lets a fork — or this repository before anybody wired up a project — skip the job rather than fail a release. Keyless auth (Workload Identity Federation) is what makes that possible, since there is then no key that had to be a secret. `docs/demo.md` lists the variables.
- **The release does not wait on it.** `create-release` needs `[docker, macos-dmg, windows-exe]` and deliberately not this: a Cloud Run outage must not hold up the installers or the release page. Pre-releases are skipped for the same reason they do not claim `latest` — `docker`'s `stable` output is the gate.

**It is served at `demo.trusty-track.com`**, a Cloud Run domain mapping rather than a load balancer — a global external ALB would do the same job and bill for its forwarding rule whether anybody visits or not, which deletes the scale-to-zero property the whole design rests on. The CNAME to `ghs.googlehosted.com` is **DNS-only in Cloudflare, deliberately**: proxying it intercepts the challenge Google's managed certificate provisions against, hands Cloud Run a `Host` header the proxy is free to rewrite, and puts Cloudflare's 100-second idle cap on WebSockets that the app expects to hold open for the `--timeout=900` the service is deployed with. `TRUSTYTRACK_ALLOWED_ORIGINS` takes a comma-separated list so the `run.app` address can keep working while a domain settles — and that comma is why `deploy.sh` passes `--set-env-vars` with gcloud's `^|^` delimiter syntax, since the default splits on commas to find the next *variable* and reads a list-valued one as a key with no value.

`/health` is polled after the deploy, and that is not decoration: Cloud Run calls a revision healthy as soon as the container answers on `$PORT`, which happens before seeding has finished — and with `--min-instances=0` there is nothing running to ask until somebody asks, so the check doubles as the cold start.

**Cold start was measured, not optimised.** The plan assumed several seconds; it is about 0.7 — 0.41 s of Python import, 0.15 s for all 24 migrations on a fresh database, 0.13 s to seed (an M-series Mac, warm caches). An at-head `alembic upgrade` costs nothing measurable and `pillow_heif` is 7 ms of the import, so all four proposed cuts — skipping the at-head migration, baking a seeded database into the image, lazy-importing `pillow_heif`, and a startup CPU boost — were worthless or invisible. Re-measure before reviving any of them.

**`TRUSTYTRACK_ALLOWED_ORIGINS` narrows CORS**, defaulting to today's `*`. The wildcard's justification is a LAN — a display or a phone on venue wifi loads the page from this origin, and the PIN is what the server checks. On a public origin it does not hold: `VIEWER` is the no-credential default and a viewer can read a roster.

### The activity log

`backend/domain/audit.py` for the vocabulary, `models.AuditEntry` for the row, and two seams that write it ([#219](https://github.com/dknowles2/trusty-track/issues/219)). The database held the current state and no record of how it got there, so "who deleted that round" had no answer but whoever happened to be watching.

**Two seams, because one is not enough.** `AuditExtension` records every mutation at the same hook `RolePolicyExtension` uses. That alone would miss the results, which is the thing a dispute is actually about: `TimerManager` calls `crud.record_heat_result` through its own session outside any request (#9), so a mutation-only log records every *correction* to a time and never the time it corrected. `record_heat_result` and `update_free_race_heat_result` therefore take a **required keyword-only `source`**, and record the entry themselves — #48's lesson, that a rule depending on each caller remembering reaches only some of them.

**Extension order is load-bearing and reads backwards.** A *later* extension wraps an earlier one, so `AuditExtension` is listed **after** `RolePolicyExtension` in order to catch the `PermissionDeniedError` and record a refusal — which is the most interesting line the log holds. Listed first it records no refusals at all. Measured, not assumed; the first draft had them the other way round. `test_audit_log.py::TestRefusals` fails if they are swapped.

**Redaction is three defences, not a list.** `createInitialConfig` carries both PINs in plaintext, so this is the one part of the feature where being wrong writes a credential into a readable table. Names are matched as *fragments* on a normalised form, because a denylist that spelled `data_url` let `dataUrl` straight through — found by smoke-testing `redact`, not by reading it. Then the value is checked regardless of its name, and anything past `DROP_STRING_OVER` is dropped rather than shortened. Nested inputs are flattened one level, and every leaf goes through the same checks: `createInitialConfig` hides its PINs *inside* `config`, so a flattener trusting the outer name would undo the whole module.

**An entry is self-contained.** `describe` renders the sentence from the entry alone and never looks an id back up. That is the opposite of the standings, awards and recipients — all computed on demand so they cannot disagree with the race — and right for the opposite reason: an audit entry is a claim about a moment that has passed, and one that changed its story as the data moved would be a second view of the present.

**`race_id` is a plain integer, not a foreign key.** The one place the schema declines a cascade (#125): deleting a race must not take the record of what was done to it.

**A query, not a subscription.** Half the entries are written from `crud`, and publishing from there would mean `db` importing the api layer's pub/sub. The page refetches instead.

**The query guards itself.** `RolePolicyExtension` covers mutations only, so `auditLog` calls `_require_operator_role` — the same gap `/api/backup` and `/ws/timer/{track_id}` each close for themselves. `sourceIp` is a separate field so a screen can decline to ask, and the page does not show it by default.

**One insert per mutation, and `test_query_counts.py` measures it.** `record_audit` returns a value object rather than the ORM row: `db.commit()` expires the instance, so handing the row back made reading any field a second SELECT.

### Backup and restore

`backend/services/backup.py`, `GET /api/backup` and `POST /api/backup/restore`, the panel at the foot of System Settings. An archive is a zip of three things: a database snapshot, the uploads directory, and a `manifest.json`.

**The service imports nothing from the app.** It takes an engine and two directories, which is what lets a test run a real restore against a temporary data directory rather than the operator's own. Keep it that way — a restore is the one operation in the tree that overwrites everything, so it must be testable without pointing it at the install.

Four rules, each of which is a way of getting it wrong:

- **The snapshot goes through SQLite's backup API, never `shutil.copy`.** The app is serving while it runs and the timer writes through its own session (#9), so a file copy can catch a half-written page. The backup API takes a read lock and produces a database that opens.
- **Everything refusable is refused before anything moves.** The manifest is read, the schema revision is checked and every member is unpacked into staging *first*; only then is anything swapped. A damaged or too-new archive leaves the running event untouched, which is what `test_a_refusal_leaves_the_running_event_untouched` pins.
- **`dispose` runs between staging and the swap.** SQLAlchemy pools connections, and replacing the file underneath an open one leaves it addressing a database that no longer exists. `test_the_connection_pool_is_dropped_before_the_swap` asserts the ordering rather than the call.
- **A stale `-wal`/`-shm` beside a replaced database is a corrupt read, not an error.** They belong to the file that was just moved aside, so they are removed with it.

**Recognition is by Alembic revision, not by version number** (`database.known_revisions`). A *newer* archive holds a schema this install has no migrations for and no downgrade path back from, so it is refused; an *older* one is restored and then upgraded forward by `init_db()`, which is the path a legacy database already takes at startup. The revision comes out of the archived database rather than being asserted by the manifest.

**Member names are checked, not sanitised.** An archive arrives from whoever holds the operator PIN. A backup we wrote contains exactly three kinds of entry, so anything else — `uploads/../../etc/passwd` being the classic — is a reason to stop rather than to guess.

**Both endpoints check the role themselves.** `RolePolicyExtension` guards GraphQL mutations and these are not GraphQL, the same reason `/ws/timer/{track_id}` does its own. Operator-only in both directions: the archive holds every racer's name and photograph, and a restore replaces a running event.

**One level of undo, deliberately.** What is replaced is kept as `trusty-track.db.pre-restore` and `uploads.pre-restore/`. An unbounded history of 60-photo directories would fill the SD card the backup exists to protect.

### First-run gate

`App.tsx` queries `initialConfig()`; if the system is unconfigured, all routes redirect to `/system-settings`, which creates the `Organization` and `Track`.

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
| #45 | `ruff check` and `ruff format --check` gate CI over `backend scripts packaging`. Keep the tree at zero findings — the point was that a lint nobody enforces accumulates debt in files nobody touches |
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

- **Why the code is the way it is** — including the departures, the measurements, and the designs that were considered and not taken — is in this file, next to the rule it explains. That is what every section above is.
- **What is not built** is a GitHub issue. See the "Still open" table above. A backlog belongs where a backlog is looked at.

Two consequences worth knowing. `docs/derbynet-timer-protocol.md` came out of `tasks/timers/` because it is not a plan — it is the DerbyNet protocol every profile in `services/timer/devices/` was written against, and `docs/spec.md` links it. And the plans themselves are recoverable from git history if a decision's original reasoning is ever wanted; `git log --diff-filter=D -- docs/tasks` finds the commit that removed them.

**Don't reintroduce a plan directory.** Write the rule here when it lands, and open an issue for what has not.

`TODO.md` at the repo root is a mostly-completed feature checklist.

---

## What CI checks

Eight kinds of job on every pull request (`.github/workflows/ci.yml`), nine runners — two of them are matrices:

| Job | What it would catch |
| --- | --- |
| **Lint & Types** | `ruff check`, `ruff format --check`, `mypy backend` over the whole tree |
| **Backend Tests** ×2 | The suite on 3.10 *and* 3.12 — 3.10 is the floor a Pi's system interpreter gives you, and it has caught syntax that 3.12 accepts |
| **Frontend Tests** | `eslint`, `npm run typecheck` (`src` *and* `e2e`), `vitest` |
| **GraphQL Codegen** | A backend schema change that was not regenerated into `src/gql` |
| **Docs Build** | `scripts/build_site.sh` — the landing page and the guides assembled exactly as Cloudflare Pages assembles them, with `mkdocs build --strict` catching a broken link or a missing image before it deploys |
| **End-to-End** ×2 | The served page, the GraphQL round trip and the normalized cache, together |
| **Doc Screenshots** | The Playwright specs that generate the documentation's images still drive the app (#114) |
| **Docker Build** | That the image builds *and starts*: it runs the container and waits on `/health` |

**A job named in the ruleset may not be renamed — give it a gate job instead.** `main`'s ruleset requires status checks by exact name, and it names `End-to-End` and `Doc Screenshots`. Sharding renamed them to `End-to-End (1/2)` and so on, so those two contexts stopped reporting entirely and every pull request became unmergeable with nothing failing and nothing pending — `mergeStateStatus: BLOCKED`, an empty list of failures. `e2e-gate` and `doc-screenshots-gate` are one-line jobs that carry the required name and assert `needs.<job>.result == 'success'`, so the shard count can change without anybody editing repository settings. They need `if: always()`, or a failed shard *skips* the gate rather than failing it — and a skipped required check does not block.

**The backend suite runs `-n auto`, and both Playwright suites are sharded *and* parallel within each shard.** A pull request used to wait about three and three-quarter minutes; the three longest jobs were the two Playwright runs and the backend suite, and none had a single slow part to fix — they are 5,900 tests and 70 browser specs. The backend suite is split across processes, which depends on **nothing in it sharing state between tests** (in-memory database per test; the data directory is per xdist worker, which `conftest.py` had to be taught). The Playwright browser is cached on its version — 150 MB that never changes between runs, and a third of each of those jobs.

**A performance number belongs to the machine it was measured on, and CI is not that machine.** Three claims this session did not survive the trip. Zeroing the timer prober's settle was worth 17% locally at four workers, measured twice each way, and moved CI from 83 seconds to 84. Dropping the Playwright jobs to one runner made the *test phase* two to three times faster and the *job* four seconds faster. Removing the font install was predicted at 30–41 seconds and gave 54, some of which was a slow runner on the run before. A hosted runner has a fraction of the cores, a fixed setup cost that no amount of parallelism reaches, and enough variance that a single run proves little. Measure locally to find the cause; quote a CI number only from CI, and prefer the test *step* to the job when the job is mostly setup.

**Sharding and in-run parallelism compose, and both are needed.** They were briefly treated as alternatives, on the reasoning that a dependency project re-runs in full in every shard — which is true and is not a cost: **a shard is a separate runner with its own backend and its own data directory**, so the setup project a shard runs is the one that shard needs, and it takes about two seconds. Dropping to one runner was measured and barely moved the wall clock, because a job is not all test time: preparing a runner — checkout, `npm ci`, the browser and its system libraries — is around fifty seconds whatever happens inside, and no amount of parallelism reaches it. Parallelism cuts the test phase; sharding cuts what is left. The `End-to-End` and `Doc Screenshots` gate jobs carry the names the ruleset requires, so the shard count is free to change.

**Read a slow CI step's log before optimising it — the name is not the work.** `Install Playwright system libraries` cost 30–41 seconds on every Playwright job and looked like an obvious thing to cache. It installed no libraries: `ubuntu-latest` already carries every one Chromium links against, and the log says so of each. What it installed was nine font packages — Japanese, Chinese, Thai and Cyrillic — for an app that renders nothing outside Latin-1. Caching them would have recovered about a fifth of the cost, because the download is 2 seconds and `apt-get update` refreshing four mirrors is most of the rest. Removing the step took all of it. `--with-deps` stays on the cache-miss path, so a runner image that ever does drop a library is covered the next time the Playwright version changes.

Two things worth knowing:

- **The release workflow has its own test gate.** CI runs on pull requests and on `main`; a tag is neither, so without it, tagging any commit publishes it to GHCR and the release page whatever state it was in.
- **The release notes are drafted as the work lands, not reconstructed at the tag.** `.github/workflows/release-drafter.yml` keeps a draft release up to date on every merge to `main`, so the notes for the next version are visible — and correctable — before anybody cuts a tag; `release.yml`'s `create-release` runs the same drafter with the concrete tag, attaches the installers to that draft, and only then publishes it. Three things about it, each a way of getting it wrong. **The draft is filled in before the assets and published after them**, because `releases/latest/download/<asset>` is what every install guide links to ([#474](https://github.com/dknowles2/trusty-track/issues/474)) and a release page that appears without its assets is a broken link on the front page. **A category is a repository label**, so an unlabelled pull request heads the notes with no heading rather than falling off them — which is the right default here, since an unlabelled change is a change to the app itself. And the autolabeler matches only the three title prefixes this project actually uses (`docs:`, `fix:`, `fix(docs):`) — the titles are prose, not conventional commits, so a rule inferring a category from file paths would file half the features under Documentation, every change here carrying its own docs.
- **The e2e suite runs against a real backend, on ports and a data directory derived from the checkout** (`frontend/e2e/environment.ts`), so two worktrees can run it at once. It replaced a mocked one that had been failing silently — the mocks predated the normalized cache (#12) and answered without `__typename`, which graphcache cannot store, so the page rendered nothing. Nothing ran it, so nobody found out. If you add a browser test, add it there rather than mocking the API.

### What the functional e2e specs are for

`frontend/e2e/functional/` holds two files and one shared `support.ts`: `roster.spec.ts` for the management side, `raceDay.spec.ts` for what happens once racing starts. Between them they cover generating a schedule, running a heat on the fake timer, standings arriving over the subscription, a championship field filling from the cascade, overriding a recorded time, skipping a heat, and reordering one.

They exist because every *rule* in those paths is already unit-tested and none of that says the answer survives the GraphQL round trip and the normalized cache. That gap is not hypothetical: writing `raceDay.spec.ts` found the subscription snapshot race below.

Three conventions, each learned from a failure:

- **Seed through GraphQL, drive the one step under test with the browser.** `support.ts` builds the race, roster and schedule. A spec that clicks its way through setup reports a break anywhere in the app as a failure of the thing it was testing.
- **One test per question.** The docs screenshot specs are a single long `test()` where each step depends on the last, and a break a third of the way through looked for months like a spec that ran (#114).
- **Drive dnd-kit from the keyboard, not a synthesised mouse drag.** `ScheduleManagement` registers `KeyboardSensor` alongside the pointer one: Space lifts, an arrow moves, Space drops. Leave a settle between the keys — dnd-kit animates the lift and the move, and three in one tick drop the item back where it started.
- **The specs share one backend and run at the same time on it**, so the same rules as `e2e/docs/` apply: unique race names, no assuming a race id, and nothing outside the setup project may touch the install's own settings. `configure.setup.ts` clears the first-run gate once, before anything else.
- **A track is global state; a race is not.** Each spec seeds its own race, so races cannot collide, and that made the convention above look sufficient. Tracks are shared: a spec that adds one puts a second row on System Settings for every other spec, which is how an unscoped `getByLabel('Timer Type')` started matching two elements. A spec touching the settings page **finds its own card by the name in its own input** and reads back through `initialConfig` — the source the page renders from — rather than `Query.tracks`, which need not agree on order. Never by index: `#track-timer-type-0` says nothing about which track it is once specs run together.

**The functional suite runs in parallel, and getting there meant naming what was global.** `fullyParallel: true` with a worker per core, against one backend — 123 seconds to about 30. Three things were in the way, and each is a rule now:

- **The first-run gate.** Seven workers open an unconfigured install together, every one of them submits `createInitialConfig`, one wins and the rest hang on a navigation that never comes. `configure.setup.ts` is a setup project every test depends on. Six tests were failing on their full two-minute timeout, and the error named `ensureConfigured` rather than anything that had gone wrong.
- **The timer is per track.** `TimerManager` is one per *track* (#9), so a race that arms a heat holds a device exclusively; two races sharing a track arm over the top of each other and the run is abandoned (#50). The setup project builds **one track per worker** and `seedRace` takes its worker's own. A track per *race* was the first attempt and was worse twice over: sixty `createTrack` calls cost 26 seconds serially, and a race inserted against a track committed microseconds earlier failed the foreign key about one run in ten under seven concurrent writers.
- **`timerModel.spec.ts` switched the shared track off the fake timer and never switched it back.** It has its own track now. That was latent debt rather than a new problem: it survived only because the file sorts near the end of an alphabetical, single-worker run, which is not a property anybody should have to know about.

**A test that asserts a client-side consequence and then navigates is racing its own mutation.** `raceDay`'s skipped-heat spec clicked Skip, waited for "Heat 2" — which `raceFlow` puts on screen by itself — and then called `page.goto`, a full document load that aborts whatever is in flight. Serially `updateHeatResult` always won; in parallel it did not, and the failure landed on an assertion three steps further on. It waits for the server to hold the skip before navigating. Look for this shape whenever a parallel run fails somewhere that reads correctly on its own.

**A subscription must register its queue before it sends its opening snapshot.** `pubsub.subscribe` registers on entry, so anything published earlier reaches no queue, and every payload these emit is a full snapshot rather than a delta — nothing catches up. `heatSession`, `timerStatus` and `freeRaceHeat` built the snapshot first and subscribed afterwards, and the operator screen arms the heat itself, so its own `prepareHeat` landed squarely in the window: the screen sat at "Waiting for Timer…" with the start button disabled while the timer was ARMED. `test_subscription_snapshot_race.py` pins all three by taking the opening payload and *then* publishing. The existing subscription tests could not catch it — they trigger concurrently after a 50 ms sleep, by which time the subscription has long since subscribed.

---

## Documentation

**`docs/` is part of the change, not a follow-up.** The docs are published from `main` on every merge, so a stale page ships the moment the code does. Everything below has already gone wrong at least once.

**The reader is a parent volunteer, not an engineer.** Every user-facing page leads with what a non-technical person does; technical detail is worth keeping but goes last — in a troubleshooting section, a parenthetical, or a callout that says when it can be ignored — never front-and-center. Baud rates, port framing and device paths are things a reader should only meet when something is broken. When a detail matters mostly to developers, it belongs in `design.md`, `spec.md` or `development.md`, linked rather than inlined. The site's own promise is "you don't need to be a software developer", and a page that opens with jargon breaks it in the first paragraph.

**The rule covers the app's own text, not just the docs.** Labels, helper text, state descriptions and alerts are the user-facing surface most people read first — "Auto-Detect (Backend Connected)" and "No serial port is open" shipped there and meant nothing to a volunteer. Say what the person sees or does: "Plugged into this machine", "Trusty Track cannot see a timer". Enum *values* stay technical (`AUTO_DETECT_BACKEND` is API); only their display text changes. When a doc table mirrors UI strings (the timer states table does), change both together — that is the "grep for the control's label" rule from the other direction.

### The site is one deployment, and the landing page is part of it

**`trusty-track.com` serves both halves from one origin**: the landing page at
the root, built from `www/` (one HTML file, one stylesheet, no framework and no
build step of its own), and the mkdocs site under `/docs/`.
`scripts/build_site.sh` assembles them into `dist/`, Cloudflare Pages runs that
script on every push to `main`, and CI's **Docs Build** job runs the same script
rather than a bare `mkdocs build` — so a failure that only appears once the two
are put together appears on the pull request.

Two things follow from sharing an origin, and both are the point of it:

- **The landing page borrows `docs/assets/` rather than copying it.** The logo
  and its four screenshots are referenced as `/docs/assets/...`, which resolve
  to the same files the guides use — and those are regenerated by the Playwright
  specs in `frontend/e2e/docs/`. A second copy would go stale the first time
  somebody re-ran a spec, silently, because a stale screenshot still renders.
- **Its links into the guides are ordinary root-relative paths**, about fifteen
  of them. `mkdocs build --strict` never looks at `www/`, so renaming a page
  fixes every link inside `docs/` and leaves the front door on a 404.
  `backend/tests/test_landing_page_links.py` is what turns that into a red
  build — it maps each `/docs/<path>/` back to the Markdown file mkdocs built it
  from, and checks every borrowed image exists.

**The demo is one shared instance, and the copy must not imply otherwise.**
`deploy/cloudrun/deploy.sh` runs it at `--max-instances=1`, so every visitor at a
given moment is in the same race, and the reset is the instance scaling to zero
after a quiet spell rather than anything to do with one person leaving. A private
instance per visitor is [#296](https://github.com/dknowles2/trusty-track/issues/296),
and it is open.

The marketing copy said "it forgets everything you do when you leave" in three
places, which invents per-visitor isolation the deployment does not have. It is
the shape of wrong that matters most here: a visitor who finds a race they did not
create, or their own changes still sitting there an hour later, concludes the
software is broken. `docs/demo.md` had it right the whole time — "a restart is its
reset" — because it was written from the deployment rather than from the pitch.
When #296 lands, these three lines and the comparison table's **Try before
installing** row are what change.

**Adding to the landing page means deciding what comes out.** It is the one page
in the tree with a fixed size — a person scrolls it once, deciding whether to keep
reading — so it does not have the property every other file here has, that more is
harmless. Everything on it was added by somebody who was right that their thing
mattered. It still drifts, because each addition is judged on its own and never
against the block it lands in.

There is deliberately no test for this. The failure is "these two sentences are
about different things", which no assertion can see, and a word or bullet budget
would be an invented number that fails on honest rewrites and passes on bad ones.
It is a review rule instead:

- **A feature block is one paragraph and three bullets.** Four means one of the
  three has stopped earning its place. Say which, and cut it — moving a fact into
  the paragraph is usually the right answer, since the paragraph is prose and can
  absorb a clause.
- **Fine print under a row of buttons is about the product**, not about one of the
  buttons. A note about a single button is its own line.
- **No caveats about what is not finished yet.** Those are true, and they belong
  in the reference page for that feature, where somebody who has already chosen
  will read them.
- **Nothing whose value only appears in a second season.** Keyboard shortcuts are
  the example; they are a pleasure to discover and no reason to choose anything.
- **Read the whole block after editing it, not the line you added.** All three
  failures below were invisible from the diff and obvious from the rendered page.

Three instances, all of them shipped:

| What happened | What it looked like |
| --- | --- |
| The demo's explanation was appended to the hero's existing fine print | One paragraph explaining a button and listing supported platforms |
| The Race Control bullets led with the keyboard shortcuts | The least interesting of three, first |
| Two later features each appended a bullet to Audience displays, and a fourth change added a `<small>` hedge about theming being incomplete | Five bullets and an implementation caveat, on a landing page |

**The landing page's timer list is held to `ALL_PROFILES`, in both directions.**
Each row carries `data-timer-key`, so the page states which profiles it is
naming rather than being matched on wording — the display names differ
deliberately ("Micro Wizard", two words, as the docs write it). A profile added
to `devices/` and not to the page costs the pack that owns that timer; a row
outliving its profile is worse, because they turn up with the device.

**"Tested" on that page means a recording, and the badge tracks
`RECORDED_PROFILES`.** `backend/tests/timer_recordings/` holds real output from
three devices — the MicroWizard, the Derby Timer and the PDT — and replaying it
is the whole of what has been verified; nothing here has been run against
hardware physically present. The first version of the page badged the MicroWizard
alone and called it tested, which was wrong twice over, and writing the guard is
what found it. Adding a recording should light a badge up.

**There is deliberately no version number on the page.** The only source of
truth is the git tag `release.yml` writes into `backend/version.py`, which a
test cannot read — CI checks out shallow, and the tag lands after the merge, so
`main` would be wrong between a release and the next commit. A claim with no
checkable source is a claim that goes stale on its own, so it is not made.

**One favicon, shared.** `docs/assets/favicon.png` is a square crop of the
logo's car, set as `theme.favicon` in `mkdocs.yml` and as `rel="icon"` on every
page in `www/`. The documentation had Material's generic default while the
landing page had the logo, so one site had two tab icons; and `logo.png` is a
wide sticker, which a browser letterboxes into a sliver at 16px. Both facts are
guarded.

**The copy is the docs' voice, not a brochure's.** Same reader as every user
page — a parent volunteer, once a year — so the same rule applies with the
volume turned up rather than a different one: say what the person does, name
things the way the app names them, and put the honest caveat next to the claim
it qualifies. The timer list says outright which seven profiles have never been
run against their hardware, because a page that implies eight tested devices is
worse for the pack that turns up with the eighth than a page that says nothing.

**The two halves share a palette, a display face and a header treatment**, and
nothing else. `docs/assets/extra.css` defines the same four colours as
`www/styles.css` from the same source — the app's own `--scouting-blue` and
`--cub-scouting-gold` — puts Outfit on Material's headings, and ends the header
with the gold rule the landing page's hero ends with. Material's *layout* stays:
it is better at long documents than anything worth hand-writing here.

Two things that changed in the process, both worth not undoing:

- **The gold is no longer Material's accent colour.** `--md-accent-fg-color` is
  what Material paints a hovered link, a focused input and the active
  table-of-contents entry, all of which are text, and `#FCD116` is about 1.6:1
  against white — the link a reader was pointing at was the least legible thing
  on the page. The accent is the blue now, and the gold is decoration that never
  has to be read, which is what it already was on the landing page.
- **The guides follow `prefers-color-scheme`.** They were light-only while the
  landing page was not, so a reader in the dark crossed from the front page into
  a white flash. `mkdocs.yml` now carries Material's three-entry palette, with
  the system-following one first so it is the default.

**`docs/comparison.md` sets Trusty Track beside the other derby programs, and
its rules are about honesty rather than completeness.** A comparison page written
by an author about their own project is not a neutral document, and a reader can
tell. So: every claim about somebody else comes from *their* own site, linked,
with the date it was checked stated near the top; a cell nobody could confirm is
blank and the page says a blank means unknown rather than no; and **When to pick
something else** comes before **When to pick this one**, naming seven months of
history against DerbyNet's eleven years, five timer profiles that have never met
their hardware, and no support desk. It credits DerbyNet directly — seven of our
eight profiles are adapted from theirs.

**It is written as prose, and the first draft was not.** That draft had a callout
box titled "The honest headline", five parallel `**Choose X** if…` blocks, and a
bolded lead-in on almost every paragraph; the section announcing the project's
weaknesses opened by explaining how honest it was being. All of that reads as
generated, which on a page whose only asset is credibility is the one thing it
cannot afford. Keep it plain: ordinary paragraphs, no admonition boxes, no
repeated sentence frames, and no line that congratulates the page on its own
candour.

Only one thing on that page is checkable, and it is checked. The "Timer models
listed" count for Trusty Track is a fact about this repository, so
`test_comparison_page.py` holds it to `ALL_PROFILES`. Overstating that row is the
worst failure the page can have — a pack reads it, buys a timer, and finds
nothing on the other end of the cable. Everything else is prose about other
people's software and needs a person to re-check it; the page carries no other
counts for that reason, an earlier draft's "eight models, three of them tested"
being two more numbers to keep in step for no gain.

**The landing page links to it and does not summarise it.** A comparison table in
a selling position is a different genre from the same table in the documentation:
the honest version recommends a competitor, which is not what a front page is
for, and a dishonest one would undo the page it links to. One sentence in the
closing section is the whole of it.

**`dknowles2.github.io/trusty-track/` is not retired.** `gh-pages` now holds
`deploy/ghpages-redirect/` — a 404 page that forwards every path to its
equivalent under `/docs/`, keeping the query and fragment. Links to the old
address exist in earlier releases' READMEs and in search results, and neither
can be edited. `.github/workflows/docs.yml` publishes it and nothing else.

**`docs/requirements.txt` and the `docs` dependency group must agree.**
Cloudflare Pages builds with pip and reads the file; CI and a local `uv run
mkdocs` read the group. `mkdocs-callouts` is a plugin `mkdocs.yml` loads and was
in `dev` and only in `dev`, so `uv sync --only-group docs` produced an
environment that could not build the site — which worked for anybody who had run
a full sync and for nobody else.

### What to update, by what you touched

| Changed | Update |
| --- | --- |
| A screen the guides describe | **Every** page that mentions it — see below — and **re-run its screenshot spec** |
| A control that moved, was renamed, or went away | Grep the docs for the control's *label*, not the feature's name |
| A rule (scoring, advancement, permissions, timers…) | Its one `docs/reference/` page — and check the guides' link-out sentences still summarize it truthfully |
| GraphQL schema, a REST endpoint, a model field | `docs/design.md` §3.2 / §3.3 — `test_docs_stay_current.py` fails the build if you don't |
| Something `spec.md` calls unimplemented | That line in `docs/spec.md` |
| A feature worth a user's attention | `README.md`, `docs/index.md`, and `mkdocs.yml`'s nav |
| A rule an agent needs | This file |

**The user docs are two sets, and which set owns a sentence is a rule, not a style.** The practical guides (`getting-started.md`, `race-day.md`, `hardware-timer.md` and the rest) are the HOW, written for a volunteer with a queue behind them — short sentences, bullets, one job per section. `docs/reference/` is the lookup: one topic per page (scoring, round styles, championship rounds, mid-race changes, race and track settings, timers, display views, printing, stats and exports, backups, roles, glossary), slightly more technical, holding *every* rule and table in full. A **rule lives in exactly one reference page and is linked from the guides that need it** — restating it in both is how the two drift, which is the failure the split exists to end. When a rule changes, change its reference page and check that the guides' short link-out sentences still summarize it truthfully; when a screen or flow changes, that is the practical guide's half. `scoring-and-championships.md` sits between the two deliberately: it is the *decision* guide (how to choose a scoring method, which round style, which championship setup) and defers every exact rule to `reference/`. New detail goes to `reference/`; a new screen or workflow gets guide coverage plus a reference entry for its rules.

**A new page goes *inside* a nav group, not beside one.** `navigation.tabs` turns every top-level entry into a tab across the top, and adding one page at a time got to fifteen — the row scrolled sideways, so several pages were reachable only by finding a scrollbar nobody looks for. It is seven now (Home, Install, Running a Race, Timers, Displays and Printouts, Network and Backups, Developers — Timers before Displays, because an operator sets the timer up before they worry about the audience), and `docs/index.md` follows the same grouping, because a flat list there re-teaches the shape the tabs just lost. Grouping moves nothing on disk, so links and anchors are unaffected either way.

### Finding the prose that just went stale

**The table above is not the hard part — following it is not enough, and that has been measured.** Every finding of the audit that produced this section came from a change whose docs task was done and whose CI was green.

Three habits, each of which is a failure that happened:

- **One screen is described by several pages, so fix the screen and grep for the *control*.** Moving three buttons into an overflow menu broke sentences in `race-setup.md`, `race-day.md`, `printables.md` and `getting-started.md`; only the first was found, because that is the page the change "belonged" to. `grep -rn "Upload Photos" docs/` would have found the rest in one command. Grepping the *feature* name would not — the stale sentence usually does not contain it.
- **A caption is a claim about the picture above it, and regenerating the picture does not update the claim.** *"The Upload Photos button sits in the toolbar, between Scan and Print"* sat under a screenshot showing it in a menu, for a release, because the image was regenerated by a spec and the sentence was written by a person. When you re-run a spec, **read the captions of every image it writes**.
- **Renaming a thing in the UI renames it in the docs.** The roster page was called Details in the navigation and Roster on the page; merging the two rows settled on Roster, and eight sentences across three guides went on saying Race Details. `git grep -i` the old label before you finish.

**What is checkable is checked, so don't rely on remembering it.** `backend/tests/test_docs_stay_current.py` holds the mechanical half:

- every query, mutation and subscription is named in `docs/design.md` **and** in this file, and neither may name one the schema no longer has;
- every table is named in `design.md` §3.2, or exempted there with a reason;
- every checked-in screenshot is linked by some page — an orphan means a subject that went away, which is how `09-bulk-actions-menu.png` outlived the Bulk Actions menu by a release while still being regenerated every time;
- **every link into a heading lands on one.** `--strict` validates the file half of `race-day.md#part-5-final-standings` and ignores everything after the hash, so a link to a renamed section still builds, still passes CI, and drops the reader at the top of the right page saying nothing — worse than a broken link, which is at least visible. Two were written and merged in one afternoon. The check renders each page with the real `toc` extension and reads the ids it assigns, rather than reimplementing the slug rules, which would agree right up until a heading with a bracket in it.

That guard exists because the guideline was not enough on its own: `setLaneOutages`, `timerModels`, the four award mutations, the `LaneOutage` model and `Round.disrupted` all shipped documented-nowhere with this section already in place. It is the same reasoning as #45 — a rule nobody enforces accumulates debt in files nobody opens.

**What it cannot check is whether a sentence is true**, which is the failure that actually happens. That still means reading the page.

### The screenshots

They come from Playwright specs in `frontend/e2e/docs/`, each building its own data against a real backend. `race-day.spec.ts` covers setting a race up and then running it; `screenshot-first-run.spec.ts`, `screenshot-observation.spec.ts`, `screenshot-race-stats.spec.ts`, `screenshot-awards.spec.ts`, `screenshot-balanced.spec.ts`, `screenshot-bulk-upload.spec.ts`, `screenshot-elimination.spec.ts`, `screenshot-free-race.spec.ts`, `screenshot-printables.spec.ts`, `screenshot-settings.spec.ts`, `screenshot-slowest-race.spec.ts` and `screenshot-timers.spec.ts` cover the rest.

**They run in parallel against one backend, in two phases**, set out in `playwright.screenshots.config.ts` as Playwright *projects*. That is not a scheduling detail; it is where the rules below are enforced. Worker count is `75%` of the cores locally and a flat `4` in CI: ten cores run the set in 23 seconds against 30 at four workers, which is a third of a developer's run thrown away — but a hosted runner has a fraction of those cores, and every worker drives a real browser against the one shared backend.

- **`first-run` is a setup project every other project depends on**, so it runs first whatever is being filtered to, and it owns everything belonging to the **install** rather than to a race. The setup wizard, which a configured install never shows. The empty Home page — it deletes every race to make that caption true, and **it is the only spec allowed to delete somebody else's data**. The Access panel, which needs an operator PIN to exist, and while a PIN is set every caller without one is a `VIEWER` and *no* mutation is allowed (#15). And the activity log, which is a list of what *everyone* has done, so from the parallel phase it would hold whatever the other specs had got to.
- **Everything else runs together.** A spec in this phase is race-scoped: it seeds its own race, assumes no race id, and never touches the install's own settings.

**Ask what a picture is *of*, not which page it is on.** Those last two are System Settings pictures filed in `docs/assets/screenshots/settings/`, and leaving them with the rest of that page cost a whole serial phase — the settings spec had to run alone for the two seconds its PIN existed. Moving them let `screenshot-settings.spec.ts` join the pool, which also meant giving it a **track of its own**: it takes a lane out of service, and six specs schedule races on the shared track, where two lanes instead of three is a wrong picture with no error behind it.

**`e2e/docs/support.ts` is where the seeding lives** — `gql`, `ensureConfigured`, `seedRace`, `seedRacingGroups`, `seedRacers`, `runRoundWizard`, `readHeats`, `recordEveryHeat`, `raceToFinish`. Nine specs each carried a private copy of `gql` and of the first-run gate before it existed, which is why "seed through the API, drive the one screen under test with the browser" had to be re-derived by every new spec. Its `gql` defaults `T` to `any` rather than to `unknown`, which is the opposite of `e2e/functional/support.ts` and is deliberate: the functional specs reach GraphQL through typed helpers, where a docs spec builds its fixture out of raw one-off queries.

**A spec whose pictures are about *track records* takes a track of its own** (`support.ownTrack`), and `screenshot-observation` and `screenshot-race-stats` both do. A record is the fastest car the **track** has ever seen across every race on it, so on the shared track the record board and the record-break banner would show whatever the other specs had raced — which under a parallel run is not even stable between runs. `docsTrackId` is for everything else: somewhere to race, with no view on records.

**A screenshot's caption is a constraint on the seeding.** Two of these specs deliberately leave heats unrun — the observation one leaves three, so "Now Racing", "On Deck" and "After That" are all populated as its caption claims, and the stats one leaves the final, so the Heats Completed card shows partial completion as *its* caption claims. Both assert the state rather than trusting it, because a page that had run out of heats screenshots perfectly well.

**`screenshot-timers.spec.ts` photographs a timer that does not exist.** No CI runner has serial hardware, so it plays a Micro Wizard over the proxy WebSocket — the same wire protocol `test_timer_ws.py` speaks: answer `configure` with `ready`, answer the `RV` probe with a genuine K2 banner, reply results in the K2's format. The prober, profile and page are all real; only the far end of the wire is pretend. It adds its own proxy track and **deletes it on the way out**, so the settings and timer-check pages are not left photographing it. It finds its own card by the name in its `<input>` rather than by being the last card, which was true only while one spec ran at a time.

```bash
cd frontend && npx playwright test --config=playwright.screenshots.config.ts e2e/docs/screenshot-printables.spec.ts
```

They write to `docs/assets/screenshots/`. That path was wrong in all three original specs — resolved one level short, into an untracked `frontend/docs/` — so regenerating a screenshot updated nothing and nobody noticed. If a run produces no diff, check where the files landed before concluding nothing changed.

**They run in CI now** (`Doc Screenshots`), because the same failure happened a second way: the race-day spec died a third of the way through for months, so most of the images it owns had not been regenerated by anyone (#114). Nothing compares pixels; the job only checks the specs still drive the app.

**A regeneration that changed nothing visible now produces no diff, and keeping it that way is a rule.** It used to rewrite about fifty of the seventy-eight images every single run, so a change to one page conflicted with any other branch that had touched the docs — and none of that churn was visible in a diff, so it read as noise rather than as something with a cause. Four things were moving, and each was fixed where it lived:

| What moved | Where it is now settled |
| --- | --- |
| The version stamp in the navigation bar — built from the git hash, so it changed on *every commit* | Hidden during a docs run by `e2e/docs/screenshots-setup.ts`. Import `test` from there, never from `@playwright/test` |
| The fake timer's lane times | `TRUSTYTRACK_DEMO_SEED`, set by `playwright.screenshots.config.ts` |
| The roster `populateRace` invents, and the PPC shuffle that decides who is in which lane | The same seed, read in `backend/demo_seed.py` |
| A `Math.random()` jitter the spec added to force-completed heats | `jitter(key)` in `screenshots-setup.ts` |

**`demo_seed.generator` and `demo_seed.rng` are keyed, not sequential**, and this is the part that is easy to undo. A single generator drawn from in the order things happened to be created would give a spec regenerated on its own different values from the same spec regenerated beside the others — so the churn would come back for a reason nobody could see in the diff. Key on the *thing being invented*, and on something stable: the race's **name**, not its id, because an id depends on how many races the specs before it created.

**The seed is opt-in and stays that way.** Left on in ordinary use, re-running a heat would report the identical time to three decimal places and a practice race would introduce the operator to the same thirty children every evening — which reads as the app being broken rather than as the data being invented. `domain/scheduling.generate_ppc` therefore takes an injectable `rng` and reads no environment; `crud._schedule_rng` does the I/O, which is the usual split.

**A query feeding a seeded draw carries an `ORDER BY`, and a set is `sorted` first** ([#240](https://github.com/dknowles2/trusty-track/issues/240)). A seeded shuffle is only as repeatable as the order of what it shuffles, and a query without `ORDER BY` promises none — SQLite usually returns rowid order, which is why the seeding *measured* stable and then intermittently was not: same seed, same key, different field on the free-race screenshots. The failure mode is invisible in the code and unreproducible on demand, so the rule is structural: the free-race pool, the heat-generation roster and `get_racing_groups`/`get_racers` are ordered by id, the championship field is `sorted(current_racers)`, and `test_seeded_draw_inputs.py` recomputes each draw from a hand-ordered copy of its input.

**Every screenshot waits for the images and freezes the animation**, in the `page` fixture in `screenshots-setup.ts` rather than at seventy call sites. Both were being handled by sleeping — `waitForTimeout(500)` after opening a modal, `waitForTimeout(3000)` after populating a roster — and a sleep is a guess about a machine, too short on a loaded runner and always too long on a laptop. `animations: 'disabled'` fast-forwards a CSS transition to its end state, so a modal is photographed where it is going to settle. Note the fixture wraps *this spec's* page: a second tab the app opens (projector mode) needs the option passed by hand.

**A screenshot races the data it photographs, and the spec must wait for the *settled content*, not just for an element.** The fixture's image wait only covers `<img>` elements that already exist — for roughly the first 50ms of a view the racer and car photos render as their initials fallback while the names are already painted, so `race-day/12` flipped between initials and photographs depending on whether "Ready to start" (a subscription payload, which can beat the pictures) was already up when the view switched. The same shape, all found by pixel-diffing two full runs: the readiness strip's "Checking…" before the first `timerStatus` payload, "Ready to race" persisting over a finished heat until its refetch lands, the setup checklist's counts trailing the roster row, and "Loading tracks..." in the race form. `race-day.spec.ts` waits for each settled state by content (six `/static/` images, "3 of 4 done", "Fake Timer", the banner hidden); give a new picture the same treatment, and suspect this class first when a screenshot differs between runs with the seeds working. Two corollaries: the projector's results overlay is an *edge*, not a state ([#392](https://github.com/dknowles2/trusty-track/pull/392) made a fresh projector treat the opening payload as history), so `screenshot-observation.spec.ts` records a heat *while the projector tab is watching* to photograph it — and a `.first()` locator re-resolves at every use, so the displays list re-sorting (connected first) between an `expect` and a clipped screenshot could hand the clip a different row; target rows by name.

About a dozen images still differ run to run, and `settings/04-activity-log.png` (real clock times) and `printables/check-in-scanner.png` (where the camera viewfinder sits) are the two with a known cause. A handful more can differ by a few dozen pixels of font rasterisation — and after an OS or browser update, the navigation bar's race pill can re-rasterise in *every* image at once, a one-time step to commit and move past, not a regression. A run that rewrites fifty images with **content** changes (different racers in lanes, different times) means something above has been undone.

Two things that job protects, both learned the hard way:

- **A spec that dies part-way looks like a spec that ran.** `race-day.spec.ts` is a single `test()` where each step depends on the last, so a break anywhere silently stops every screenshot after it. It is half the length it was — the observation and stats pictures only ever needed *a race that had finished*, which the API builds in seconds, so they are their own specs and no longer sit behind the race-day chain.

- **A wait nobody expects to fire must not be swallowed.** `race-day.spec.ts` waited ten seconds for the "Round Complete!" dialog and caught the timeout, so every run spent ten seconds producing `16-round-completion-modal.png` — *a picture of an ordinary Race tab with no modal in it*, under a caption on two pages saying it "lists who made it, with their scores". The cause is [`roundCompletion.ts`](frontend/src/features/racing/roundCompletion.ts): there is no event for "a round's field was just decided", so it is recovered by comparing one query result against the last, and `seen === null` — a fresh page — means history rather than news. A round finished entirely through the API and then reloaded can therefore never raise the summary. The spec runs the **last** qualifying heat on screen for that reason, and asserts the dialog rather than hoping for it.

- **Running them at once exposes races the app already had.** `RaceForm` derives its track as `formData.track_id || tracks[0]?.id || 0` and does not stop you submitting before that query answers, so a fast click posts `trackId: 0` and the insert fails the foreign key — "Failed to create race", with nothing saying why. Rare by hand, reliable against a cold dev server with every worker hitting it at once, and it surfaced three steps away from anything about tracks (a `waitForURL` timeout on the click that creates the race). The form is fixed — it will not submit without a track — and the workaround the specs carried in the meantime is gone. Expect more of this shape rather than fewer: a screen a person drives one step at a time is not the same test as seven browsers driving it together, and every latent race in it comes due at once.

- **The file name decides the running order, and the longest spec must go first.** Playwright runs files alphabetically, and `screenshot-*` sorts before `screenshots.spec.ts` — so the one spec that took longer than all the others put together was scheduled *last*, and the run ended several seconds after every worker but one had gone idle. Renaming it `race-day.spec.ts` (which is what it is now) put it first and took seven seconds off. If you add a long spec, check where its name sorts.
- **The CI job retries once, and gives a test five minutes rather than ten.** They drive a real backend, a real browser and a fake timer over a WebSocket on a shared runner; a heat that does not arm inside the deadline is usually that. A break that reproduces still fails twice, and a stuck spec now says so in five minutes instead of ten.
- **They share one backend, and now run at the same time on it.** No two specs may use the same race name (`races.name` is unique), no spec may assume its race is id 1, and nothing outside `first-run` may touch the install's settings. **Regenerating one spec still works** — the documented command above — because the setup projects run whatever the filter is; it costs the first-run and settings phases, about seven seconds. **Run the whole set once before committing, though**: a spec that scopes nothing to its own race passes alone and fails beside the others, which used to be a break only CI could find and is now one a local run finds too.

Fixing the harness is how three app bugs surfaced: the first-run gate bouncing back to setup, a "Round Complete!" summary over an unraced race, and identical concurrent `uploadImage` mutations not all returning.

**A new screen with no spec is the failure this section cannot see.** The `Doc Screenshots` job proves the *existing* specs still drive the app; it says nothing about a page nobody photographed. Awards, the backup panel and lanes-in-service all shipped documented and unillustrated, and everything was green throughout. **If a change adds a screen the docs describe, it needs a spec in the same change** — a picture is the part of a page `mkdocs --strict` cannot check and a reader notices first.

### What the gates do and do not catch

Two gates run on every PR, and between them they cover the mechanical half:

- `mkdocs build --strict` — a broken link, a missing image. **Not an anchor**: it ignores everything after the `#`.
- `test_docs_stay_current.py` — an operation or a table absent from `design.md` or this file, an entry naming something the schema has lost, an orphaned screenshot, a link into a heading that does not exist.

**Neither can catch prose that is simply wrong**, which is the failure that actually happens, twice now in audits. The first found a "sort the roster by clicking a column header" tip for a table that has never been sortable, a check-in instruction pointing at the row rather than the button, and a paragraph describing a free-race history list that does not exist. The second found a caption contradicting the screenshot directly above it, four instructions pointing at buttons that had moved into a menu, and a page name that had been changed a release earlier. Every one was written accurately and then outlived its screen.

So: when a change invalidates a page, **read the page** — and use the three habits above to work out which pages those are.
