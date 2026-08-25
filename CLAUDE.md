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
                timer_profile?, remote_start_installed
  └─ Race[]

Race            id, name, date_time, location, group_id, track_id,
                car_numbering_strategy, global_start_number, scoring_strategy,
                championship_trophies, rules_configuration, auto_advance_heat,
                weight_limit_oz?
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
                advancement_source, advancement_num_racers, den_id?,
                advancement_from_bottom

Heat            id, race_id, round_id?, kind, heat_number,
                created_at?, recorded_at?
  └─ HeatLane[]       (cascade delete; see below)


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

**Queries:** `auditLog`, `races`, `race`, `racers`, `racer`, `tracks`, `groups`, `rounds`, `initialConfig`, `advancementStatus`, `raceStats`, `timerStatus`, `timerModels`, `heatSession`, `freeRaceHeats`, `activeFreeRaceHeat`, `randomFreeRaceLanes`, `displays`, `version`

**Mutations:**

- Race: `createRace`, `updateRace`, `deleteRace`
- Racer: `createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`
- Bulk: `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToDen`, `bulkDeleteRacers`, `bulkCheckIn`, `bulkAssignPhotos`
- Den: `createDen`, `updateDen`, `deleteDen`
- Track: `createTrack`, `updateTrack`, `deleteTrack`, `setLaneOutages`
- Round/Heat: `createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `updateHeatResult`, `reorderHeats`
- Timer: `prepareHeat`, `abortHeat`, `forceResults`, `releaseStartGate`, `resetTimer`, `reconnectTimer`, `startTimerTest`, `fakeTimerStart`, `fakeTimerFinish`
- Award: `createAward`, `updateAward`, `deleteAward`, `reorderAwards`
- Audience displays: `assignDisplay`, `renameDisplay`, `forgetDisplay`
- Free race: `startFreeRaceHeat`, `recordFreeRaceResult`, `deleteFreeRaceHeat`
- System/data: `createInitialConfig`, `updateInitialConfig`, `importRacers`, `uploadImage`, `populateRace`, `createPracticeRace`

**Subscriptions:** `raceStateChanged`, `timerStatus`, `heatSession`, `leaderboard`, `heats`, `onDeck`, `currentlyRacing`, `timingStats`, `freeRaceHeat`, `activeFreeRaceHeat`, `displayAssignment`, `displays`

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
- **Cascade deletes:** deleting a `Race` cascades to `Den` and `Round`, and removes its heats of both kinds; deleting a `Round` cascades to its `Heat`s.
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

**`crud.usable_lanes_for_race` is the one place that decides** — every lane the track has, less its outages. Four call sites read it, and #48 is why it is a function rather than the expression written out at each.

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

### Scoring

Rules in `domain/scoring.py`, database wiring in `services/scoring.py`. `TIMED` averages heat times (a recorded `0.0` is treated as a 9.999s DNF penalty); `POINTS` sums placements. Both are lower-is-better. `get_leaderboard(db, race_id)` returns sorted standings.

**Standings cover preliminary rounds only** — rounds with no `advancement_source`. Settled in #17. A championship field is chosen *from* the standings, so folding championship results back in is circular: `record_heat_result` re-runs advancement on every result, so a final-round time could change who was supposed to be in the final. It also mixes populations, since a championship average is taken against the fastest cars rather than the whole field.

`get_leaderboard(db, race_id)` is prelim-scoped by default. Pass `round_id` for one round (this is how the UI shows championship results) or `scope=ALL` for the pre-#17 whole-race average. The `Race.leaderboard` GraphQL field takes `roundId` and `includeAllRounds` to match.

**A missing placement must never be a reward under `POINTS`** ([#225](https://github.com/dknowles2/trusty-track/issues/225)). `POINTS` sums, so a racer with fewer placements scores *better* — the failure #26 keeps arriving by new routes. Four routes are now closed, two ways: a lane outage mid-round (#171) and a latecomer (#172) set `Round.disrupted` and the round is dropped from `POINTS` standings; a **skipped lane** and a **DNF** (a recorded time ≤ 0, which the timer assigns no place) are scored as **last place in their heat** — the racers assigned, not the track's lane count. The penalty routes and the drop routes are different because they are different facts: a penalised lane *exists* and can classify last; a disrupted round has racers who were *scheduled fewer heats*, and there is no lane to penalise. `TIMED` needs neither for a skip — an average is scale-free — and keeps its 9.999 s penalty for a DNF. A lane with a real time but no place stays uncounted: that is a half-finished hand entry, not a scratch.

**A tie shares a rank** ([#226](https://github.com/dknowles2/trusty-track/issues/226)). `rank_key` still breaks ties by racer id so the *order* is deterministic, but `standings_ranks` stamps competition ranks (1, 1, 3) over it — otherwise a tie for a trophy or the last championship slot was resolved by registration order and no screen ever said so. Racers who have not raced keep strictly increasing positions; tying them would make a pre-race leaderboard a wall of rank 1. Advancement and awards still cut by position (`standings[:n]`, `standings[place-1]`), which is unchanged and now *visible*: the operator sees the shared rank and settles it with a race-off or a corrected time.

### Championship advancement

Rules in `domain/advancement.py`; entry points are `advanceRound` and `scoring.get_advancing_racers()`.

- `advancement_source = "PACK"` — top N overall
- `advancement_source = "DEN"` — top N from each den
- `advancement_source = "ROUND:<id>"` — top N from that round

**`Round.advancement_from_bottom` flips which end of those standings the field comes from — the Slowest Race bracket.** The source vocabulary is deliberately unchanged; `AdvancementRule.from_bottom` reverses the pick in `domain/advancement._picking_order`, slowest first (slot 1 is the slowest car, mirroring slot 1 being the fastest). Two rules ride on it: a racer with no recorded result is never picked (`Standing.has_raced` — the leaderboard sorts the unraced *below* everyone, so the naive bottom of the list is cars that never ran), and the round's standings view is reversed **on display only** (`features/stats/slowestFirst.ts` — the stored leaderboard stays lower-is-better, so anything chaining off the round reads it unchanged). Everything else — invalidation, `should_populate`, `field_is_short`, withdrawal — is direction-agnostic and needed no change. The operator reaches it from the add-round dialog's "Which cars race" control; placeholder slots and the round-summary sentence read "Slowest N" via `AdvancementStatus.fromBottom` and `Round.advancementFromBottom`.

`crud.record_heat_result` cascades: it calls `invalidate_future_rounds` and `trigger_auto_advancements` on **every** heat result.

**The invalidation rule**, since it is easy to get wrong: recording *or clearing* a result in round N resets the field of every later championship round back to placeholders, because the standings they were drawn from just moved. A later round that has **already been raced** is left alone — a stale field the operator can see and fix beats silently wiping heats people ran. General rounds are never invalidated; their field is the roster.

**"Can see" is `AdvancementStatus.fieldIsStale`** ([#229](https://github.com/dknowles2/trusty-track/issues/229)) — for years the premise above had no seeing half. True when a raced, advanced round's actual field (as a *set*; lane order is the scheduler's business) no longer matches who would advance today; the schedule shows a **Field out of date** badge. Only a *raced* round can be stale — an unraced one is re-fielded outright, so a mismatch there is a bug, not a state.

**The rebuild paths preserve runs-per-lane** ([#230](https://github.com/dknowles2/trusty-track/issues/230)). `generate_heats_for_round` takes `runs`, and `runs=None` — what every rebuild passes — means *preserve what the round had*, derived from the heats about to be cleared (heat count over `total_participants`, floor). The derivation lives there and nowhere else because it used to live in exactly one caller (`regenerateRound`, from #143) while `invalidate_future_rounds` and `populate_round_field` had nothing — so a two-run final quietly became a one-run final on the first recorded prelim result. `_reset_heats_in_place` checks divisibility, not equality, for the same reason. `test_multi_run_rounds.py` holds it, and contains the first tests in the tree with `runs > 1`.

**A withdrawal is the mirror of an admission** ([#228](https://github.com/dknowles2/trusty-track/issues/228)): un-checking a racer runs `crud.withdraw_absent_racers` from the same `_admit_late_racers` hook, withdrawal before admission, both idempotent — which is what lets a mistaken un-check heal on re-check. Same three cases as #172: unraced rounds regenerate without them, part-raced rounds keep every finished heat and vacate their pending lanes (no `disrupted` flag — an absent car empties a lane, it does not give anyone extra runs), finished rounds stand. An unraced championship round naming a withdrawn racer is re-fielded so the next qualifier steps up, and `get_advancing_racers` skips racers who are not checked in — their results stay on the leaderboard, but a slot in a race yet to run never goes to a car that has left the building.

**Putting racers in goes through `crud.populate_round_field`**, never `resolve_round_placeholders` directly — both `trigger_auto_advancements` and the `advanceRound` mutation call it, and having two copies of the call is how #48 ended up on only one path at first.

**Population asks about the state of the race *now*, never about which round just finished** ([#248](https://github.com/dknowles2/trusty-track/issues/248)). `advancement.should_populate` used to fire a `ROUND:`-scoped rule only on its source round's completion *event* — so a chained final whose field was reset after that event had passed (a prelim correction, say) waited for a completion that never came again, and one created after its source finished had no event at all. Stated over the present — "is the source round complete?" — the answer is the same wherever it is asked from, and a stranded round heals on the next cascade. `crud.populate_round_if_decided` is the one asker; the recorded-result cascade calls it per future round and `createRound` calls it for the round just made. Multiple championship rounds chain this way — the wizard wires every round after the first to `ROUND:<previous>`, and the add-round dialog offers the same once a championship round exists.

**The wizard's rollback deletes in reverse creation order, and a round joins the rollback list the moment its row exists** ([#249](https://github.com/dknowles2/trusty-track/issues/249)). `create_round` commits, so a failure in heat generation leaves a committed round; and a general round cannot be deleted while championship rounds exist, so forward-order deletion raised out of the rollback and left half a schedule that made every later wizard run refuse.

**A new round's number comes from `max(round_number) + 1`, not the count** ([#250](https://github.com/dknowles2/trusty-track/issues/250)). Deleting a middle round makes the two disagree, and two rounds sharing a number are invisible to each other in advancement's strict `<`/`>` ordering.

**`advancement_num_racers` is per *den* when the source is `DEN`**, and absolute otherwise. The rule is `domain/advancement.field_size`, wrapped by `crud.round_field_size` which counts the dens — use those, never the raw column. It had grown five copies, two of them wrong, and the wrong ones shrank a DEN final to a fraction of its field on every preliminary result (#52).

`advancement_num_racers` is also a **request**, not a guarantee: "top four" from a den of three can only ever supply three. Heats are generated from the request, before anyone qualifies, so a round can hold more slots than the race can fill. Left alone the surplus is fatal rather than untidy — `phase` reports `NOT_READY` while any placeholder remains, and the operator screen has no controls in that state, so the round cannot be run, edited or skipped. `domain/advancement.field_is_short` detects it and the round is rebuilt for the field that actually qualified. A round that has already been raced is filled in place regardless, following the same rule as invalidation.

### Awards

Rules in `domain/awards.py`, database wiring in `services/awards.py`, storage in the `awards` table (#170). Two kinds, and the difference is only where the recipient comes from:

| Kind | Recipient | Fields |
| --- | --- | --- |
| `SPEED` | computed from the standings | `source` + `place`, optionally `den_id` |
| `SPECIAL` | chosen by a person | `racer_id` |

**A speed award names a source, never a winner**, and the recipient is resolved on every read. An award defined before the racing has to stay correct when a time is corrected after it; storing the racer id would make this the first thing in the app able to disagree with the leaderboard, which is the loop #17 closed. Same principle as the standings themselves: computed on demand, never stored.

**`DEN` is not a source, and that is the one departure from advancement's vocabulary.** For advancement `DEN` means "the top N of *each* den", which yields a set — right for filling a field, wrong for an award, which has exactly one recipient. A den-scoped award is an ordinary source with `den_id` set, so "fastest Wolf" is the pack standings narrowed. Six of them is six awards, which is also how they are announced.

**`place` is 1-based and refused below 1** in both `SpeedRule.__post_init__` and the Pydantic schema. `standings[place - 1]` with a place of 0 indexes from the end and hands the trophy to the slowest car.

**A null recipient is the ordinary state**, not an error — third place has nobody until three cars have run, and Best Paint has nobody until somebody decides. A `SPEED` row missing its source or place resolves to nobody too, rather than raising: an award nobody can win is visible on the operator screen, and an exception takes down the presentation display mid-ceremony.

**`crud._clear_fields_of_other_kind` runs *after* an update applies**, not before. Changing the kind is what makes the other kind's fields stale, and the new kind and the stale fields arrive in the same payload.

**Resolution is whole-race and memoised** (`loaders.award_recipients`). One speed award is a full scoring pass over the heats it draws from, and a pack hands out a dozen; `services/awards` loads each *distinct source* once within that. `test_query_counts.py` compares eight awards against one.

**`Race.championship_trophies` is not this.** It means how many cars advance to the final — a scheduling input. An award is an outcome.

On the frontend, `/race/:raceId/awards` is a fourth tab on `RaceModeToggle` beside Roster, Standings and Stats. `features/awards/awardText.ts` turns a stored rule into the sentence both the operator screen and (later) the presentation display show — `{source: "ROUND:4", place: 1, denId: 3}` is exactly the wrong thing to put in front of somebody choosing trophies. It is pure, and it holds the ordinal edge cases (11th, not 11st) and the two "that no longer exists" messages for a round or den deleted out from under an award. **Editing a speed award must not seed the racer picker from its computed recipient** — switching it to judged would then freeze the trophy on whoever happened to be fastest at that moment.

**The ceremony is its own route** (`/race/:raceId/awards/present`), not another tab on the audience display. The observation views rotate on a timer because nobody is driving them; a ceremony is paced by whoever is holding the microphone, and a screen that advanced on its own would announce the next trophy over the applause for the last one. `ceremony.ts` holds the stepping rules: it **clamps rather than wraps**, because putting the first award back up reads as "we are starting again" and the last slide is the one people photograph, and it shows an award with no recipient rather than skipping it, because most are undecided right up until they are announced. It sits at `zIndex: 3000` — the navigation is 1000 and painted its Details/Control/Standings menu across the top of a projector until somebody loaded the page.

### Car numbering

`PER_GROUP` fills within each den's range; `GLOBAL` numbers sequentially from `global_start_number`; `MANUAL` disables auto-numbering.

### The practice race

`crud.create_practice_race`, behind the `createPracticeRace` mutation and the **Try a practice race** button on Home ([#201](https://github.com/dknowles2/trusty-track/issues/201)). The operator is a parent volunteer who uses this app once a year, and the night before is when they want to know what race day feels like. Everything needed already existed — `populate` builds a believable roster, the fake timer runs heats without hardware — but reaching it meant creating a race, adding dens, populating, checking everybody in and running the round wizard, which is most of the thing being rehearsed.

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
- **Mutation-testing a backend rule: change the file's size, or force a new mtime.** CPython validates a cached `.pyc` on (mtime, size), and the usual mutation-test dance — save a copy, edit, run, `shutil.move` the copy back — restores *both*. Flipping `ON_DECK_DEPTH = 2` to `1` is the same length, and the copy's mtime came from a second earlier, so the interpreter went on serving the mutated bytecode: the unit tests were fine and the *end-to-end* run kept failing against a server that no source file described. Restore with `git checkout --` (which writes a fresh mtime) rather than `shutil.move`.

**The suite must never touch real hardware.** `conftest.py`'s autouse `no_real_serial_ports` stubs both `probe.usb_ports` and `probe.open_serial`. Tests that exercise probing pass their own `open_port` to `probe.detect`.
- **`_timer_status(s)` in `schema.py` is the only converter.** The `timerStatus` query and its subscription both go through it. They used to build the type separately, which is how a field lands on one and not the other — and with a normalized cache, a subscription payload missing a field the query supplied is how a value vanishes from a screen mid-event.
- **A gate watcher is a poll, and its answers are scoped to the poll.** A profile may carry `gate_watcher` (a command plus matchers) for a device that only reports the gate when asked. Real answers are as short as `0`, `U`, `O` and `.` — PDT's gate-closed pattern is a bare `.`, which matches any character — so `read_gate` is consulted **only** inside the window following a query, never as part of `parse_line`. Putting them in the general matcher list would have them claim every line the timer sends.
- **The debounce is for polled gate state only** (`GateBelief` in `state_machine.py`). A device that *pushes* an edge has already debounced it and says so once; requiring a second confirming observation would mean never believing it, which is the trap that kept the gate debounce out of [#90](https://github.com/dknowles2/trusty-track/pull/90). A poll is a sample and the next one re-observes, which is what makes waiting for persistence work there and only there. `min_change_seconds=0` means no debounce — the first sample is believed.
- **Polling runs only while ARMED or READY.** Not RUNNING: the answer cannot change a run under way, and DerbyNet found some timers resend the previous heat's results when queried too soon after gate-open. Not IDLE: nothing is waiting on the answer.
- **The MicroWizard is deliberately not polled.** `N2` makes it push both edges, so a query would be traffic for an answer already volunteered — and untested risk on the one device anybody runs.
- **`backend/tests/timer_recordings/` holds real device output** — DerbyNet's `.playback` files (MIT, attributed), replayed by `test_timer_recordings.py`. It is the only evidence here that did not come from us, and it immediately found that our MicroWizard could not identify a **K3**: that firmware writes `Serial Number 15985` with a space, and the prober needs the whole banner. **Check a new or edited profile against a recording if one exists** — a test written from the same notes as the profile agrees with the profile's mistakes.
- **Seven profiles are adapted from DerbyNet** (`devices/derbynet.py`, MIT, attributed) and **none has run against its hardware** — nor, strictly, has the MicroWizard. Every profile carries a `provenance` string that the timer check page displays; don't let a device name imply support. `test_timer_derbynet_profiles.py` feeds each one a line from its DerbyNet definition, which catches a mistyped pattern but *not* a wrong one.
- **The vocabulary the import needed**: `command_eol` (the Champ, The Judge and SuperTimer ignore commands without a `\r`), `on_event` (mostly "results overdue → force a report"), `LaneCount` (a timer reporting 6 lanes on a 4-lane track is a real misconfiguration), and `pre_probe` (a settle command before probing). SuperTimer II is deliberately absent — two-part results, a binary-encoded lane mask, and a 10000 scale factor, all for one device.
- **`/timer-check` is the diagnostics page** (`features/settings/pages/TimerDiagnostics.tsx`), linked from System Settings. It exists because the serial log was only reachable from inside a running heat, so "is my timer working" required setting up a race first. Serial-log rendering is `features/racing/serialLog.ts` — pure, tested, shared with `HardwareTimerMole`. Its command annotations describe the MicroWizard specifically; a second device means sourcing them from the active profile rather than from that table.
- **The bench test is how an untested profile becomes a tested one** ([#235](https://github.com/dknowles2/trusty-track/issues/235)). `startTimerTest` arms every lane with **no heat behind it** — `TimerManager.prepare_test_heat` sends exactly the commands a real heat would, and `_finish_test_run` writes nothing anywhere: no heats row, no lanes, no audit entry (`test_timer_test_run.py` pins all three). `_test_run` stays set through the finish so the diagnostics page can label the results a test; arming a real heat, aborting or resetting clears it. Refused while a real heat is armed — a bench test must not disarm race day. `GET /api/timer-test/{track_id}/report` packages the profile, framing and full serial conversation as a download; the frontend's `features/settings/timerTest.ts` (pure) builds the prefilled issue link that asks for the *file*, because asking a volunteer to describe serial traffic in prose is the failure the feature replaces. A good report is a `timer_recordings/` fixture waiting to be written.

**Remote start is two claims, not one** (#111). `TimerProfile.remote_start` says the device has a command for releasing the gate; `Track.remote_start_installed` says this track has the solenoid that command drives. Both are needed, and only the first is knowable from a protocol — the MicroWizard's gate release is a separately-sold accessory and `LG` is silently ignored without it, which is why DerbyNet gates theirs behind a command-line flag and we gate ours behind an operator setting. `TimerManager.can_remote_start()` is the conjunction; it rides on `TimerStatus` because the client has no copy of the profiles. `release_start_gate` refuses outside ARMED and READY and returns *why* as a string: releasing a gate with no heat armed sends cars down a track nothing is timing.

**`TimerManager` writes to the DB via its own `SessionLocal()`**, outside the request lifecycle — which is why the test suite maintains a second, file-backed database. See issue #9.

That database lives in `$TMPDIR/trustytrack_test`, which the suite **wipes at the start of a run** rather than at the end — a run that crashes or is killed still leaves a virgin directory for the next one, which teardown cannot promise, and the artefacts of a failed run stay put to be looked at. It is cleaned at all because nothing ever removed the images `POST /upload/` writes: the directory had reached 8,000 files and 3.5 GB before anybody looked, and the first test to zip it (the backup endpoint, #176) had to be killed. A run leaves about 40 files now.

Three things about that header, each of which has a wrong-looking alternative:

- **The `os.environ` assignment must be the only statement before the imports.** Ruff's E402 tolerates exactly that one write ahead of them and nothing else, which is why the wipe happens *after* the imports and recreates `UPLOAD_DIR` — `database.py` makes it on import and `main.py` mounts it as static files, so removing it without putting it back breaks every upload test.
- **Read the path from `database.DATA_DIR`, never repeat it.** `test_init_db.py` hardcoded `/tmp/trustytrack_test`, so moving the directory would have pointed the test at one place and the app at another.
- **`test_the_suite_writes_to_a_temporary_data_directory` is the guard that matters.** Without conftest's assignment the suite writes into a real `~/.trustytrack` — deleting its database and dropping images beside the operator's photos — and nothing else in the tree would fail.

**A heat id used to stop being a stable handle** (#50). `invalidate_future_rounds` rewrites the heats of every later championship round on *every* earlier result; when it did that by deleting and re-inserting, an armed heat could vanish — or, since SQLite reuses rowids, come back as a different heat holding a different field. Three things now hold:

- **`_reset_heats_in_place` rewrites the existing rows** when the shape has not changed, so ids survive. It falls back to full regeneration only when the heat count differs (a den added to a `DEN` round, say).
- **`_record_results` verifies before writing.** It compares the heat's current lane assignment against the `racer_by_lane` it was armed with and calls `_abandon_run` on a mismatch. `racer_by_lane` absent means *unknown*, not *no racers*, so the check sits out when the caller did not supply one.
- **`_revalidate_timers(info)` disarms proactively.** Call it from any mutation that regenerates, deletes or re-fields heats — it is already on `updateHeatResult`, `regenerateRound`, `deleteRound`, `deleteHeat` and `advanceRound`. Without it the operator only finds out after a run, holding times they must key in by hand.

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

**A full-screen view hides the app's chrome through `ChromeContext`, not the URL.** `Navigation` used to read `?projector=true`, which stopped being sufficient the moment a view could be *assigned*: an operator switching a screen to Projector from across the room got projector mode with the navigation bar across the top, because no URL had changed. Rewriting the display's URL on assignment is the tempting fix and is worse — the URL is the fallback the assignment overrides, so writing to it makes a reload flash the previous view.

`Display` is **keyed on `displayId`** in graphcache, not embedded: `assignDisplay` returns one and the panel's list has to recognise it as the row it is already holding. `CUSTOM_KEYED_TYPES` in `api/graphqlClient.ts` exists for it, and `graphqlClient.test.ts` requires every id-less type to be in exactly one of the two lists.

### One row of race navigation

`Navigation.tsx` holds every race view — Roster, Control, Standings, Awards, Stats, Live — and that is the only race navigation there is. There used to be a second: a `RaceModeToggle` rendered by four pages, offering Roster/Standings/Awards/Stats. Standings and Stats therefore appeared **twice**, two rows apart, and the same page was called Details in one and Roster in the other. Awards appeared only on the toggle, so it was unreachable from Control or Live.

The merged row keeps the toggle's word — **Roster**, which is what the page calls itself — and Standings and RaceStats lost header rows that existed only to centre the toggle between two spacer divs.

If you add a race view, it goes in `links` in `Navigation.tsx`. Don't reintroduce a per-page toggle.

### The roster toolbar

`RaceDetails.tsx`. Six buttons competed for one row and four of them wrapped their labels at 1280px. The rule now: **the first row holds Add Racer, Scan and an overflow menu, and nothing else.** Manage dens, upload photos and print are things an operator does once before an event, so they live behind the `⋯`; add and scan are the two reached for repeatedly. Search and the group-by-den toggle sit on their own row beneath.

**There is no Bulk Actions button.** It was disabled for most of the day — space spent saying "not yet" — and what it held is now a selection bar that exists only while rows are ticked, with a clear-selection ✕. `roster-selection-bar` and `roster-more-menu` are the test ids; the individual `bulk-*-btn` ids survived the move, so what changed for a test is only that the actions no longer need a menu opened first.

Move-to-den is still a menu, because six dens will not fit on the bar — but it opens **downward** now rather than flying out sideways, which retired `denMenuSide`, `denMenuContainerRef`, `moveDenTimeoutRef` and the two hover handlers that measured which side had room.

### Printables

Pit passes, driver's licences and check-in codes. `/race/:raceId/print`, from the roster's **Print** button.

**HTML the browser prints, not server-rendered PDFs** — the plan assumed PDFs. There is no PDF toolchain on a Pi, the branding already lives in the frontend, and a sheet of sixty is a CSS grid rather than a page-composition problem. The one thing a page cannot draw for itself is the QR code, so that is the only part the server renders: `GET /api/printables/barcode/{racer_id}.png`, registered **at both `/printables/...` and `/api/printables/...`** because the Vite dev proxy strips the prefix — the `/api`-only form works in production and 404s on the machine it is written on.

**Sheet-first.** Nobody prints one pit pass; they print sixty before check-in opens. The page is the sheet, the roster's selection arrives on `?racers=`, and an *empty* selection means the whole roster rather than nothing.

**The layout numbers live in `documents.ts`, not the stylesheet.** The page has to say "2 sheets of Letter" before the operator commits paper, so the card geometry is read by both TypeScript and CSS (as custom properties set inline) rather than kept in two places. `inPrintOrder` is the other rule worth knowing: car number ascending, unnumbered racers last — they are the ones still needing a number, which is easier to spot at the bottom of a stack than the middle.

The payload is `TT1:<race_id>:<racer_id>` — versioned because these live on paper and get scanned by a later version of the app, race-scoped because a bare racer id from last year's derby resolves to whoever holds that id now. `domain/printables.py` owns encode and decode; `features/printables/scanning.ts` is its mirror on the frontend, and **both pin the literal payload in a test** so neither can drift alone.

**Scanning is Chromium-only, by decision.** `CheckInScanner.tsx` decodes with the browser's own `BarcodeDetector` rather than adding a decode library — the same trade the browser-proxied serial timer already makes. Safari and Firefox get the car-number entry and a line saying why. That entry is **not** a fallback branch: it is on screen next to the viewfinder everywhere, because a creased code with a queue behind the table is the common case. It resolves only when exactly one racer holds the number — manual numbering allows duplicates, and picking the first would check in the wrong child.

A scan has **four** outcomes, not racer-or-nothing (`scanning.resolveScan`): the racer, not one of ours, a code from another race, or a racer deleted since printing. They are separate because the operator's next move differs for each.

**The heat sheet is a table, not a card** ([#173](https://github.com/dknowles2/trusty-track/issues/173)). `/race/:raceId/print/heat-sheet`, linked from the schedule rather than the roster's print menu, because it prints the *schedule*. `heatSheet.ts` holds the rules and shares only the stylesheet with the cards above — `DocumentSpec` and `perSheet` are card geometry and do not apply.

Two rules there, both about what paper needs that a screen does not: a lane's three states are **distinct** — an unadvanced championship slot reads "To be decided" because somebody will write a name in, an empty lane reads "—" because nobody is coming, and rendering both as blank loses that. And every row gets a column for every lane the **track** has rather than every lane the heat holds, so a heat short a lane still lines up with the rows above it. The blank **Result** column is deliberate: this sheet exists for the moment the network drops.

**CSV lives in `utils/csv.ts`**, not in whichever page needed it. `RaceStats` had the only copy and it quoted every field without escaping an embedded quote, so a car named `The "Beast"` produced a malformed row and silently shifted every later column. Use `downloadCsv` / `filenameFor`; don't inline a third.

### Roles and the operator PIN

`backend/api/auth.py`. Three roles — `VIEWER` (the wall displays, no credential, **no mutations at all**), `CHECKIN` (the registration desk: racers, photos, check-in), `OPERATOR` (everything). Derived from who is physically in the room, not from an abstract permission model.

**Off until a PIN is set.** An install with no `Group.operator_pin_hash` treats every caller as `OPERATOR`, which is exactly what every install did before #15. That is what lets this land without locking an operator out of their own event mid-season, and it is why the deferral's concern — nobody wants a login prompt on race morning — is met: the prompt exists only if they choose to set a PIN.

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

`App.tsx` queries `initialConfig()`; if the system is unconfigured, all routes redirect to `/system-settings`, which creates the `Group` and `Track`.

---

## Known architectural debt

The architecture review of 2026-07-24 is **closed** ([#18](https://github.com/dknowles2/trusty-track/issues/18)) — all three of its theses are resolved and its backlog is empty. It is worth reading before a substantial change anyway, not as a tracker but as a retrospective: it records which of its own premises expired between filing and implementation, what verification caught that reading the code did not, and when a surviving mutation is evidence versus a broken harness. None of that is re-derivable from the tree.

**Still open, and it is not engineering work:**

| Issue | Area |
| --- | --- |
| #112 | SuperTimer II timer profile. **Needs hardware** — two-part results, a binary lane mask and a 10000 scale factor, none reusable, and a test written from the same notes as the profile would agree with its mistakes |

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

## Implementation plans (`docs/tasks/`)

Staged plans live in `docs/tasks/<area>/`, numbered in intended order. Areas: `free-race`, `graphql`, `improvements`, `install`, `observation`, `printables`, `stats`, `timers`.

**All of them are built** — free racing, observation subscriptions, hardware timers, the GraphQL migration, race stats, printables, and all five install channels — and those files are design notes, not a backlog. Every plan says so in its header, so **the absence of a `[COMPLETED]` marker is meaningful**: it means something is left, and right now nothing is.

Two headers say something else, and both are deliberate. `printables/01_backend_generation.md` is `[PARTLY BUILT]` because steps 3 and 4 were **not** built as specified — the licence and the pit pass are HTML the browser prints rather than server-rendered PDFs — and the header records the departure. `printables/00_overview.md` and `timers/derbynet-protocol-spec.md` carry no marker at all because neither is a plan: one is background, the other is a protocol reference.

Use `[COMPLETED]`, not a synonym. Ten of these said `[DONE]`, which meant the same thing and defeated the grep the rule above depends on.

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

`frontend/e2e/functional/` holds two files and one shared `support.ts`: `roster.spec.ts` for the management side, `raceDay.spec.ts` for what happens once racing starts. Between them they cover generating a schedule, running a heat on the fake timer, standings arriving over the subscription, a championship field filling from the cascade, overriding a recorded time, skipping a heat, and reordering one.

They exist because every *rule* in those paths is already unit-tested and none of that says the answer survives the GraphQL round trip and the normalized cache. That gap is not hypothetical: writing `raceDay.spec.ts` found the subscription snapshot race below.

Three conventions, each learned from a failure:

- **Seed through GraphQL, drive the one step under test with the browser.** `support.ts` builds the race, roster and schedule. A spec that clicks its way through setup reports a break anywhere in the app as a failure of the thing it was testing.
- **One test per question.** The docs screenshot specs are a single long `test()` where each step depends on the last, and a break a third of the way through looked for months like a spec that ran (#114).
- **Drive dnd-kit from the keyboard, not a synthesised mouse drag.** `ScheduleManagement` registers `KeyboardSensor` alongside the pointer one: Space lifts, an arrow moves, Space drops. Leave a settle between the keys — dnd-kit animates the lift and the move, and three in one tick drop the item back where it started.
- **The specs share one backend**, so the same rules as `e2e/docs/` apply: unique race names, no assuming a race id, and the first-run gate is only there for whichever spec goes first (`ensureConfigured` handles it either way).
- **A track is global state; a race is not.** Each spec seeds its own race, so races cannot collide, and that made the convention above look sufficient. Tracks are shared: a spec that adds one puts a second row on System Settings for every other spec, which is how an unscoped `getByLabel('Timer Type')` started matching two elements. A spec touching the settings page scopes to a track's own controls by index (`#track-timer-type-0`), and reads back through `initialConfig` — the source the page renders from — rather than `Query.tracks`, which need not agree on order.

**A subscription must register its queue before it sends its opening snapshot.** `pubsub.subscribe` registers on entry, so anything published earlier reaches no queue, and every payload these emit is a full snapshot rather than a delta — nothing catches up. `heatSession`, `timerStatus` and `freeRaceHeat` built the snapshot first and subscribed afterwards, and the operator screen arms the heat itself, so its own `prepareHeat` landed squarely in the window: the screen sat at "Waiting for Timer…" with the start button disabled while the timer was ARMED. `test_subscription_snapshot_race.py` pins all three by taking the opening payload and *then* publishing. The existing subscription tests could not catch it — they trigger concurrently after a 50 ms sleep, by which time the subscription has long since subscribed.

---

## Documentation

**`docs/` is part of the change, not a follow-up.** The docs are published from `main` on every merge, so a stale page ships the moment the code does. Everything below has already gone wrong at least once.

**The reader is a parent volunteer, not an engineer.** Every user-facing page leads with what a non-technical person does; technical detail is worth keeping but goes last — in a troubleshooting section, a parenthetical, or a callout that says when it can be ignored — never front-and-center. Baud rates, port framing and device paths are things a reader should only meet when something is broken. When a detail matters mostly to developers, it belongs in `design.md`, `spec.md` or `development.md`, linked rather than inlined. The site's own promise is "you don't need to be a software developer", and a page that opens with jargon breaks it in the first paragraph.

**The rule covers the app's own text, not just the docs.** Labels, helper text, state descriptions and alerts are the user-facing surface most people read first — "Auto-Detect (Backend Connected)" and "No serial port is open" shipped there and meant nothing to a volunteer. Say what the person sees or does: "Plugged into this machine", "Trusty Track cannot see a timer". Enum *values* stay technical (`AUTO_DETECT_BACKEND` is API); only their display text changes. When a doc table mirrors UI strings (the timer states table does), change both together — that is the "grep for the control's label" rule from the other direction.

### What to update, by what you touched

| Changed | Update |
| --- | --- |
| A screen the guides describe | **Every** page that mentions it — see below — and **re-run its screenshot spec** |
| A control that moved, was renamed, or went away | Grep the docs for the control's *label*, not the feature's name |
| GraphQL schema, a REST endpoint, a model field | `docs/design.md` §3.2 / §3.3 — `test_docs_stay_current.py` fails the build if you don't |
| Something `spec.md` calls unimplemented | That line in `docs/spec.md` |
| Behaviour a plan file describes | The `docs/tasks/**` header — mark it, or record the departure |
| A feature worth a user's attention | `README.md`, `docs/index.md`, and `mkdocs.yml`'s nav |
| A rule an agent needs | This file |

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

They come from Playwright specs in `frontend/e2e/docs/` — `screenshots.spec.ts` (getting started, setup, race day), `screenshot-bulk-upload.spec.ts`, `screenshot-printables.spec.ts`, `screenshot-free-race.spec.ts`, `screenshot-awards.spec.ts`, `screenshot-settings.spec.ts`, `screenshot-timers.spec.ts`. Each builds its own data against a real backend:

**`screenshot-timers.spec.ts` photographs a timer that does not exist.** No CI runner has serial hardware, so it plays a Micro Wizard over the proxy WebSocket — the same wire protocol `test_timer_ws.py` speaks: answer `configure` with `ready`, answer the `RV` probe with a genuine K2 banner, reply results in the K2's format. The prober, profile and page are all real; only the far end of the wire is pretend. It adds its own proxy track and **deletes it on the way out** — the main `screenshots.spec.ts` runs later and seeds races against `tracks[0]`.

```bash
cd frontend && npx playwright test --config=playwright.screenshots.config.ts e2e/docs/screenshot-printables.spec.ts
```

They write to `docs/assets/screenshots/`. That path was wrong in all three original specs — resolved one level short, into an untracked `frontend/docs/` — so regenerating a screenshot updated nothing and nobody noticed. If a run produces no diff, check where the files landed before concluding nothing changed.

**They run in CI now** (`Doc Screenshots`), because the same failure happened a second way: `screenshots.spec.ts` died a third of the way through for months, so most of the images it owns had not been regenerated by anyone (#114). Nothing compares pixels; the job only checks the specs still drive the app.

**A regeneration that changed nothing visible now produces no diff, and keeping it that way is a rule.** It used to rewrite about fifty of the seventy-eight images every single run, so a change to one page conflicted with any other branch that had touched the docs — and none of that churn was visible in a diff, so it read as noise rather than as something with a cause. Four things were moving, and each was fixed where it lived:

| What moved | Where it is now settled |
| --- | --- |
| The version stamp in the navigation bar — built from the git hash, so it changed on *every commit* | Hidden during a docs run by `e2e/docs/screenshots-setup.ts`. Import `test` from there, never from `@playwright/test` |
| The fake timer's lane times | `TRUSTYTRACK_DEMO_SEED`, set by `playwright.screenshots.config.ts` |
| The roster `populateRace` invents, and the PPC shuffle that decides who is in which lane | The same seed, read in `backend/demo_seed.py` |
| A `Math.random()` jitter the spec added to force-completed heats | `jitter(key)` in `screenshots-setup.ts` |

**`demo_seed.generator` and `demo_seed.rng` are keyed, not sequential**, and this is the part that is easy to undo. A single generator drawn from in the order things happened to be created would give a spec regenerated on its own different values from the same spec regenerated beside the others — so the churn would come back for a reason nobody could see in the diff. Key on the *thing being invented*, and on something stable: the race's **name**, not its id, because an id depends on how many races the specs before it created.

**The seed is opt-in and stays that way.** Left on in ordinary use, re-running a heat would report the identical time to three decimal places and a practice race would introduce the operator to the same thirty children every evening — which reads as the app being broken rather than as the data being invented. `domain/scheduling.generate_ppc` therefore takes an injectable `rng` and reads no environment; `crud._schedule_rng` does the I/O, which is the usual split.

**A query feeding a seeded draw carries an `ORDER BY`, and a set is `sorted` first** ([#240](https://github.com/dknowles2/trusty-track/issues/240)). A seeded shuffle is only as repeatable as the order of what it shuffles, and a query without `ORDER BY` promises none — SQLite usually returns rowid order, which is why the seeding *measured* stable and then intermittently was not: same seed, same key, different field on the free-race screenshots. The failure mode is invisible in the code and unreproducible on demand, so the rule is structural: the free-race pool, the heat-generation roster and `get_dens`/`get_racers` are ordered by id, the championship field is `sorted(current_racers)`, and `test_seeded_draw_inputs.py` recomputes each draw from a hand-ordered copy of its input.

Two images still move, and both are expected: `settings/04-activity-log.png` shows real clock times, and `printables/check-in-scanner.png` sometimes differs where the camera viewfinder sits. A handful more can differ by a few dozen pixels of font rasterisation — and after an OS or browser update, the navigation bar's race pill can re-rasterise in *every* image at once, a one-time step to commit and move past, not a regression. A run that rewrites fifty images with **content** changes (different racers in lanes, different times) means something above has been undone.

Two things that job protects, both learned the hard way:

- **A spec that dies part-way looks like a spec that ran.** This one is a single 500-line `test()` where each step depends on the last, so a break anywhere silently stops every screenshot after it.
- **The CI job retries once, and gives a test five minutes rather than ten.** They drive a real backend, a real browser and a fake timer over a WebSocket on a shared runner; a heat that does not arm inside the deadline is usually that. A break that reproduces still fails twice, and a stuck spec now says so in five minutes instead of ten.
- **They share one backend when run together**, which is what CI does. That means: no two specs may use the same race name (`races.name` is unique), no spec may assume its race is id 1, and the first-run setup screen is only there for whichever spec runs first. **Regenerate images one spec at a time** — the documented command above — and the config wipes the data directory per invocation, so that run always gets a virgin system. **Run the whole set once before committing, though**: a spec that scopes nothing to its own race passes alone and fails beside the others, which is a break CI finds and a single-spec run cannot.

Fixing the harness is how three app bugs surfaced: the first-run gate bouncing back to setup, a "Round Complete!" summary over an unraced race, and identical concurrent `uploadImage` mutations not all returning.

**A new screen with no spec is the failure this section cannot see.** The `Doc Screenshots` job proves the *existing* specs still drive the app; it says nothing about a page nobody photographed. Awards, the backup panel and lanes-in-service all shipped documented and unillustrated, and everything was green throughout. **If a change adds a screen the docs describe, it needs a spec in the same change** — a picture is the part of a page `mkdocs --strict` cannot check and a reader notices first.

### What the gates do and do not catch

Two gates run on every PR, and between them they cover the mechanical half:

- `mkdocs build --strict` — a broken link, a missing image. **Not an anchor**: it ignores everything after the `#`.
- `test_docs_stay_current.py` — an operation or a table absent from `design.md` or this file, an entry naming something the schema has lost, an orphaned screenshot, a link into a heading that does not exist.

**Neither can catch prose that is simply wrong**, which is the failure that actually happens, twice now in audits. The first found a "sort the roster by clicking a column header" tip for a table that has never been sortable, a check-in instruction pointing at the row rather than the button, and a paragraph describing a free-race history list that does not exist. The second found a caption contradicting the screenshot directly above it, four instructions pointing at buttons that had moved into a menu, and a page name that had been changed a release earlier. Every one was written accurately and then outlived its screen.

So: when a change invalidates a page, **read the page** — and use the three habits above to work out which pages those are.
