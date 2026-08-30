# Trusty Track - Technical Design Document

## 1. Introduction

This document outlines the technical design for Trusty Track, a Cub Scout Pinewood Derby race management system. It details the architectural choices, component designs, data structures, and API specifications to meet the product vision and basic requirements described in the [Specification](spec.md). The system aims for ease of use, fairness, accuracy, and aesthetic appeal across various user interfaces and device types.

## 2. Architectural Overview

Trusty Track will follow a client-server architecture, comprising a Python-based backend API, a React-based frontend application, and optional remote proxy services for hardware interaction.

-   **Backend (Python):** Serves as the core application logic, data plane, and control plane. It will manage configuration, racer information, race scheduling, and result processing.
-   **Frontend (React):** Provides user interfaces for various device types (laptops, desktops, mobile phones, tablets, kiosks, large-format displays). It will consume data and interact with the backend via a well-defined API.
-   **Remote Proxies:** Optional services (e.g., Raspberry Pi) to bridge physical timing devices with the backend, especially when the backend is cloud-hosted or physically remote from the track.

```mermaid
graph LR
    A[Timing Device] -- Serial/USB --> RP((Remote Proxy))
    RP -- WebSocket/HTTP --> B[Backend API (Python/FastAPI)]
    F1[Frontend (React) - Admin] -- GraphQL/WebSocket --> B
    F2[Frontend (React) - Observer] -- GraphQL/WebSocket --> B
    B -- SQLAlchemy ORM --> DB[(SQLite / PostgreSQL)]
    F3[Frontend (React) - Kiosk/Display] -- WebSocket --> B
```

## 3. Backend Design (Python)

The backend will be developed in Python, leveraging a robust framework (e.g., FastAPI or Django REST Framework) to provide a scalable and maintainable API.

### 3.1. Core Application Logic

-   **Race Management:** Heat scheduling (PPC — see [Scheduling Algorithms](scheduling-algorithms.md)), championship advancement, and overall race progression. The rules live in `backend/domain/` as plain functions over plain values, with the database I/O in their callers.

-   **Data Processing:** Coalescing race results, calculating standings based on predefined rules.
-   **Configuration Management:** Handling global settings and race-specific configurations.

### 3.2. Data Storage

A relational database (e.g., PostgreSQL or SQLite for simpler deployments) will be used for persistence. An ORM (e.g., SQLAlchemy or Django ORM) will abstract database interactions.

**Key Entities:**

-   **`Organization`**: Represents the racing organization (e.g., Cub Scout Pack).
    -   `id` (PK)
    -   `name`
    -   `display_theme`, `printables_theme` (`varchar`, default `"MATCH_APP"`) — which theme the Display and Printables surfaces render, install-wide (#498). A `ThemeKey` (`frontend/src/theming/themes.ts` — the frontend holds the one canonical copy of what a theme is) or the sentinel `"MATCH_APP"`; never validated server-side, since nothing here branches on the value. The App theme is not a column — it lives only in each device's own `localStorage` and never reaches the server.
    -   `racing_group_singular`, `racing_group_plural`, `organization_singular`, `organization_plural` (`varchar`, nullable — #496 stage 3) — the install-wide default words for a racing group and for the organization itself, replacing "Den"/"Dens" and "Pack"/"Packs". Null means "use the built-in Scouting word", the same layering `Race`'s own six columns below sit under; `domain/terminology.py` resolves both layers into a `Terminology` served on `Race.terminology` and `InitialConfigStatus.terminology`. The frontend reads the resolved words through `useTerminology()` (#496 stage 4) — see CLAUDE.md's Terminology section.
    -   `vehicle_singular`, `vehicle_plural` (`varchar`, nullable — #551) — the install-wide default word for a racer's vehicle, replacing "Car"/"Cars". The third configurable term, same null-means-inherit shape as the two pairs above; storage identifiers (`car_number`, `car_name`, `CarNumberingStrategy`, ...) are deliberately not renamed — only the word a screen shows is configurable.
-   **`Track`**: Configuration of the physical track.
    -   `id` (PK)
    -   `lane_count`
    -   `length_feet`
    -   `timer_type` (Enum: `FAKE`, `AUTO_DETECT_BACKEND`, `AUTO_DETECT_PROXY`, `NONE`) — the **transport**. `NONE` means the track has no timer at all (#490): arming is refused and hand entry through the Override/Edit modal is how every result is recorded
    -   `timer_profile` (optional) — the **model**. Separate from the transport because the same device can be on either, and knowing the model does not tell you which; null means detect it (#143)
    -   `serial_port` (for direct backend connection)
    -   `remote_start_installed` (a solenoid is fitted to the start gate)
    -   `reverse_lanes` (the timer's own lane 1 is wired to this track's highest lane — a fact about the venue's cable, not the device model, same reasoning as `remote_start_installed` — #553)
-   **`LaneOutage`**: A lane that does not work (#171).
    -   `id` (PK), `track_id` (FK to Track, `ON DELETE CASCADE`), `lane`, unique on (`track_id`, `lane`)
    -   A row means the lane is out of service and its absence means it works. There is deliberately no `is_out_of_service` flag, which could disagree with the row's own absence, and no list-of-lanes column — a schedule asks for a *set* of lanes, and a set of small integers in a string column is the shape #5 spent a release removing.
    -   Scoped to the track, not the race: the sensor is hardware in the room, so a venue running two races has the same dead lane in both.
-   **`HistoricalTrackRecord`**: A track record from before Trusty Track was keeping them (table `track_records`).
    -   `id` (PK), `track_id` (FK to Track, `ON DELETE CASCADE`), `time_seconds`, `racer_name`, `car_number?`, `race_name?`, `race_date?`
    -   Primary data, not a cache: the computed records (`services/records.py`) are never stored, but a record from the 2019 derby has no heats in this database to compute from, so it stands exactly as the operator typed it — the same distinction the audit log draws. `racer_name` is free text rather than a `Racer` foreign key, because the child who set it is on no roster this install holds.
    -   Merged into `raceStats.trackRecords` beside the computed entries, sorted by time; a null `race_id` in that payload marks the historical ones.
-   **`Race`**: Specific race event instance.
    -   `id` (PK)
    -   `organization_id` (FK to Organization)
    -   `track_id` (FK to Track, optional)
    -   `name` (unique)
    -   `date_time` (optional)
    -   `location` (optional)
    -   `car_numbering_strategy` (Enum: `PER_GROUP`, `GLOBAL`, `MANUAL`)
    -   `global_start_number` (if GLOBAL, default 1)
    -   `championship_trophies` (int, number of top finishers for championship, default 3)
    -   `scoring_strategy` (Enum: `TIMED`, `POINTS` - default `TIMED`)
    -   `tiebreaker` (Enum: `SHARED`, `BEST_TIME`, `TOTAL_TIME`, `COUNTBACK`, `HEAD_TO_HEAD` - default `SHARED`) — how a shared score is broken at a cut: advancement, an award's place (#540). `SHARED` means not resolved — a cut still reports the tie and takes a provisional pick, today's behaviour made visible rather than a new default nobody chose. Resolved in `services.scoring.get_leaderboard` alone (`domain/tiebreak.py` holds the five rules), never stored — the same "computed on every read" shape the standings themselves follow (#17).
    -   `rules_configuration` (JSON string, optional — vestigial; nothing reads or writes it)
    -   `weight_limit_oz` (Float, optional — the pack's weight limit; null means the race does not check weights)
    -   `auto_advance_heat` (Boolean — move to the next heat on a countdown after a result)
    -   `master_running_order` (Boolean, default `false`) — one interleaved running order across racing groups rather than a block per group (#549). The flag alone reorders no stored heat; `applyMasterRunningOrder` computes the interleave (`domain/running_order.py`) over the general rounds and writes it through the same door `reorderHeats` uses. The execution surfaces — the Race tab, `currentlyRacing`/`onDeck` — read the order back through `domain/running_order.execution_sort_key`: heats follow `heat_number` across general rounds when the flag is on, with championship rounds after them all, and the default `(round_number, heat_number)` block order when it is off.
    -   `voting_open` (Boolean, default `false`) — whether a phone holding no PIN may vote for a `SPECIAL` award right now (#305); an operator toggle, not tied to racing progress
    -   `racing_group_singular`, `racing_group_plural`, `organization_singular`, `organization_plural` (`varchar`, nullable — #496 stage 3) — a per-race override of the organization's terminology default, for one install running two differently-worded events. Null means inherit the organization's word; `clearTerminology` on `updateRace` is the explicit way back to null, following `weight_limit_oz`/`clearWeightLimit` above.
    -   `vehicle_singular`, `vehicle_plural` (`varchar`, nullable — #551) — a per-race override of the organization's vehicle word, same shape as the four columns above.
    -   Note: Per-race `scheduling_strategy` was moved to the `Round` level. Rounds each have their own scheduling strategy.
-   **`RacingGroup`**: Sub-divisions within a race (table `racing_groups`; called `Den` before #496). A *different* table of the same name, a vestigial shadow of this concept, briefly existed early on and was dropped (`0008_drop_racing_groups`) once it turned out to be written on every racer save and read by nothing — this table is the rename, not a resurrection of that one.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `name`
    -   `color` (hex color for branding)
    -   `division` (free text, optional — a category, usually a Cub Scout rank; #496 stage 2 replaced a seven-value enum with this, and the frontend offers the traditional ranks as picker suggestions rather than a constraint)
    -   `car_number_range_start` (if PER_GROUP)
    -   `car_number_range_end` (if PER_GROUP)

-   **`Racer`**: Participant details.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `racing_group_id` (FK to RacingGroup, optional) — the primary grouping
    -   `first_name`
    -   `last_name`
    -   `car_number` (unique per race)
    -   `car_name` (optional)
    -   `car_weight` (optional)
    -   `car_passed_inspection` (Boolean, default `false`)
    -   `racer_image_url` (optional)
    -   `car_image_url` (optional)
-   **`Round`**: A collection of heats within a race (e.g., "Wolves Round", "Championship").
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `racing_group_id` (FK to RacingGroup, optional — a round scoped to one racing group)
    -   `round_number`
    -   `name` (optional display name)
    -   `scheduling_strategy` (Enum: `PPC`, `ELIMINATION`, `BALANCED`) — `BALANCED` is GPRM's "Dynamic" method: the first phase is random, each later phase matches cars with similar records (most heat wins, then fewest points per heat), and the round ends after `balanced_phases` phases. Everyone races once per phase, so balanced heats feed the ordinary standings; a latecomer joining mid-round marks it `disrupted` for the same reason as #172. `ELIMINATION` is ladderless elimination: losses are counted per car (a loss is any heat not won), a car is out at `elimination_losses`, and the schedule grows a wave at a time from the recorded-result cascade rather than being generated up front. Elimination heats are excluded from the aggregate standings — heat counts are uneven by design — and the round's own leaderboard reads survival: score is the loss count, survivors first, then the eliminated by how long they lasted.
    -   `elimination_losses` (optional) — the loss limit; null for every other strategy
    -   `balanced_phases` (optional) — how many phases a `BALANCED` round runs; null for every other strategy
    -   `advancement_source` (optional: `ALL`, `EACH_GROUP`, or `ROUND:<id>`)
    -   `advancement_num_racers` (optional — **per racing group** when the source is `EACH_GROUP`, absolute otherwise)
    -   `advancement_from_bottom` (Boolean, default `false`) — a "Slowest Race" bracket: the field is drawn from the *bottom* of the source standings rather than the top, slowest first, and cars with no recorded result are never picked. The source vocabulary is unchanged; only the end of the standings changes.
    -   `disrupted` — set when the round was raced on an uneven field: a lane went out of service part-way through (#171), or a latecomer was admitted and heats were appended (#172). Either way some racers ran more often than others, which `TIMED` tolerates (an average is scale-free) and `POINTS` does not (a sum where lower is better). Disrupted rounds are dropped from `POINTS` standings only. The same asymmetry has two more routes — a skipped heat and a DNF — which `POINTS` handles by scoring the lane as last place in its heat rather than by dropping the round (#225); equal scores share a rank rather than being split by registration order (#226).

-   **`Heat`**: Individual race instances. Official heats belong to a round; free race heats do not.
    -   `id` (PK)
    -   `race_id` (FK to Race)
    -   `round_id` (FK to Round, **nullable** — null for a free race heat)
    -   `kind` (Enum: `OFFICIAL`, `FREE`)
    -   `heat_number`
    -   `created_at` — when the row was written. For an official heat that is when its *round* was generated, not when it ran.
    -   `recorded_at` — when a result was last recorded, cleared on a re-run. The only field the two heat kinds can be ranked on together.
-   **`HeatLane`**: One row per lane of a heat.
    -   `heat_id` (FK to Heat, `ON DELETE CASCADE`), `lane`, `racer_id` (FK to Racer, `ON DELETE SET NULL`), `placeholder_slot`, `time_seconds`, `place`, `skipped`
    -   Rows are built from the lane *values* a writer supplied: `crud.set_heat_lanes` is the one door, and a session listener writes the rows once the flush has given a new heat its id. This is the **only** copy — `heats.lane_results` was dropped in migration `0013`, which rebuilt every blob from these rows and compared before dropping (#72).
    -   The two `ON DELETE` actions are load-bearing rather than decorative. Five delete paths used to remove a parent while lane rows still pointed at it, and nothing noticed because SQLite enforces no foreign key unless asked; see issue #125.
-   **`Award`**: A trophy, and where its recipient comes from (#170).
    -   `id` (PK)
    -   `race_id` (FK to Race, `ON DELETE CASCADE`)
    -   `name`, `sort_order` (presentation order)
    -   `kind` (Enum: `SPEED`, `SPECIAL`)
    -   `source` (`SPEED` only: `ALL` or `ROUND:<id>` — the same vocabulary `Round.advancement_source` uses, but never `EACH_GROUP`)
    -   `place` (`SPEED` only, 1-based: the winner is 1)
    -   `from_bottom` (`SPEED` only: which end `place` counts from — false is the fastest car, true the slowest. The same flip `Round.advancement_from_bottom` makes for a Slowest Race bracket, and a car that has not raced is never picked)
    -   `racing_group_id` (`SPEED` only, FK to RacingGroup, `ON DELETE CASCADE` — narrows the standings to one racing group, which is how "fastest Wolf" is expressed rather than a third kind of source)
    -   `racer_id` (`SPECIAL` only, FK to Racer, `ON DELETE SET NULL` — deleting a racer un-assigns the award rather than deleting the trophy)
    -   `artwork_key` (nullable — which clipart the ceremony slide and the printed certificate draw; null prints a plain certificate. A `SPEED` award has this defaulted from its rule rather than offered as a picker; a `SPECIAL` award gets it from the ready-made superlative picker, or free text over it (#306))
    -   `votable` (`SPECIAL` only, Boolean, default `false`) — whether this award takes ballots while the race's `voting_open` is true (#305); always forced false for `SPEED`
    -   A `SPEED` recipient is **computed on demand and never stored**, like the leaderboard: an award defined before the racing stays correct when a time is corrected after it. Storing one would make this the first thing in the app able to disagree with the standings (#17).
-   **`AwardVote`**: One ballot for a `SPECIAL` award (table `award_votes`, #305).
    -   `id` (PK)
    -   `award_id` (FK to Award, `ON DELETE CASCADE`)
    -   `racer_id` (FK to Racer, `ON DELETE CASCADE`)
    -   `ballot_key` — a client-generated token, unique per award (`uq_award_ballot`). It makes one *submission* idempotent against a doubled click or a retried request; it does not limit how many times a device may vote — a shared iPad at the event casts many ballots on purpose.
    -   `cast_at` — ISO 8601 UTC, the same shape as `Heat.recorded_at`.
    -   A ballot is **primary data, stored, and never recomputed** — the opposite of a recipient, which is worked out fresh from the standings on every read. `services/awards.vote_tallies_for` counts them; `crud.cast_vote` writes them, and is the only place one is created. Closing voting never writes `Award.racer_id` on its own — the operator applies the tally's winner with an ordinary award edit.

**Authentication** is implemented — see `backend/api/auth.py` and issue #15.
Three roles (`VIEWER`, `CHECKIN`, `OPERATOR`) derived from a PIN, enforced by a
Strawberry extension on every mutation field and by explicit checks on the
non-GraphQL routes. It is **off until an operator PIN is set**, which is what
every install did before it existed. There is no `User` entity and no audit
trail: one shared PIN per role, which is the right size of solution for a pack
derby and would not be for anything larger.

### 3.3. API Design

The backend exposes a **GraphQL API** at `/graphql` (using Strawberry) for all data operations and mutations. A small set of REST endpoints handle binary/file responses that GraphQL is unsuitable for.

**GraphQL Queries:**

-   `races(skip, limit)` — List all races.
-   `race(raceId)` — Get a single race with nested `racers`, `racingGroups`, `rounds`, `heats`, `leaderboard`, `awards`. Carries `votingOpen` (#305); each `Award` carries `votable` and `voteTally` (ranked `(racer, voteCount)` pairs, from `services/awards.vote_tallies_for` — one query for the whole race, not one per award). Carries `terminology` — this race's override layered over its organization's default (`domain/terminology.py`, #496 stage 3; #551 adds the vehicle term) — plus the raw `racingGroupSingular`/`racingGroupPlural`/`organizationSingular`/`organizationPlural`/`vehicleSingular`/`vehiclePlural` override fields the edit form reads back.
-   `racers(raceId, skip, limit)` — List racers.
-   `auditLog(raceId, limit, beforeId)` — The activity timeline, newest first. Operator-only, and it enforces that itself: the role policy guards mutations, and this is the query a wall display must never be able to run (#219).
-   `racer(racerId)` — Get a single racer.
-   `tracks()` — List configured tracks.
-   `organizations()` — List organizations.
-   `initialConfig()` — Initial configuration status (organization + track). Carries `terminology` (the organization's default words, resolved) and the raw `racingGroupSingular`/`racingGroupPlural`/`organizationSingular`/`organizationPlural`/`vehicleSingular`/`vehiclePlural` overrides the settings form reads back (#496 stage 3; #551 adds the vehicle term).
-   `rounds(raceId)` — List rounds for a race.
-   `advancementStatus(raceId, roundId)` — Check round advancement eligibility.
-   `raceStats(raceId)` — Lane fairness, per-racer aggregates, top moments, racing group comparison, and the track's all-time records (`trackRecords`: the fastest cars across every race on this race's track, computed on read by `services/records.py`).
-   `timerStatus(trackId)` — Device state for a track's timer.
-   `displays(raceId)` — Audience displays known for this race, connected or not. Presence is in-memory (see below), so this is not a database read.
-   `suggestDisplayName(displayId, avoid)` — Operator-only, enforced the same way as `auditLog`. A rerolled name for one display, drawn from `whimsical_name` against the race's *other* display names, so it can never repeat one already in use (#521). `avoid` is the draft currently in the rename form's input, so pressing the reroll button twice does not hand back the same word.
-   `timerModels()` — The timer models an operator can pick from, with the provenance of each profile. The fake timer is deliberately absent: it is reachable by `timer_type`, and offering it as a *model* would let a track ask for a fake timer over a real serial port.
-   `heatSession(trackId, heatId)` — What is on the track right now (see below).
-   `freeRaceHeats(raceId)`, `activeFreeRaceHeat(raceId)`, `randomFreeRaceLanes(raceId, shuffle, enabledLanes)` — the draw runs over the race's usable lanes (`usable_lanes_for_race`, #171); `enabledLanes` narrows it further to a session-only subset the Free Race screen's per-lane toggle asks for (#303), and is intersected against usable rather than trusted outright
-   `version` — Running application version.
-   `networkAddresses` — This machine's own LAN address(es), best-effort (`services/network.py`). The voting page's share step uses this to replace `window.location`'s `localhost`/`127.0.0.1` with something a phone on the venue wifi can actually open (#414); an empty list means none could be found.

**GraphQL Mutations:**

-   Race: `createRace`, `updateRace` (absent means leave alone throughout, so a per-race terminology override — racing group, organization, and, since #551, vehicle — takes `clearTerminology` to get back to inheriting — the same shape as `clearWeightLimit`, #496 stage 3), `deleteRace`
-   Racer: `createRacer`, `updateRacer`, `deleteRacer`, `checkInRacer`
-   Bulk racer actions: `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToRacingGroup`, `bulkDeleteRacers`, `bulkCheckIn`, `bulkAssignPhotos`, `bulkSetExcludedFromStandings`
-   RacingGroup: `createRacingGroup`, `updateRacingGroup`, `deleteRacingGroup`
-   Award: `createAward`, `updateAward`, `deleteAward`, `reorderAwards` (all take/return `Award`, whose `recipient` is resolved from the standings rather than stored; `artworkKey` is accepted but overwritten server-side for a `SPEED` award — see `crud._set_speed_artwork_key` — since only `SPECIAL` offers a picker for it, #306)
-   Voting (#305): `castVote(awardId, racerId, ballotKey)` — returns null on success or a sentence saying why the vote was refused, the same shape as `releaseStartGate`. The **one mutation `VIEWER` may run** (`api.auth.VOTE_MUTATIONS`): a phone with no PIN can cast a ballot only while the award's `votable` and the race's `votingOpen` are both true — `crud.cast_vote` checks both, and the role policy only says the attempt is allowed. Toggling `votingOpen` is an ordinary field on `updateRace`, not a separate mutation; applying a tally's winner is an ordinary `updateAward` setting `racerId`.
-   Track: `createTrack`, `updateTrack`, `deleteTrack`, `setLaneOutages`
-   Track records: `createTrackRecord`, `updateTrackRecord`, `deleteTrackRecord` — the hand-entered historical records (`HistoricalTrackRecord`), merged into `raceStats.trackRecords` beside the computed ones
-   Audience displays: `assignDisplay`, `advanceDisplay`, `identifyDisplay`, `renameDisplay`, `forgetDisplay` (operator-only — a display is a `VIEWER` and is *told*, never asks) (takes the whole set of out-of-service lanes, since the screen is a row of checkboxes and a repaired lane is simply absent; brings existing scheduled heats into line). `identifyDisplay(displayId)` bumps `Display.identifySeq` (#495) — the same step-not-state shape as `advanceDisplay`'s `slideSeq`, so the screen flashes its own name once rather than on every reconnect.
-   Round/schedule: `createRoundWizard`, `createRound`, `regenerateRound`, `deleteRound`, `deleteHeat`, `advanceRound`, `reorderHeats`, `applyMasterRunningOrder` (interleaves the race's current general rounds' pending heats into one running order across racing groups, #549 — recorded heats keep their `heatNumber`, championship rounds are left out and always run last; off by default via `Race.masterRunningOrder`)
-   Heat: `updateHeatResult` (takes `[HeatLaneInput!]!` — the same shape the read path returns)
-   Timer: `prepareHeat`, `abortHeat`, `forceResults`, `releaseStartGate`, `resetTimer`, `reconnectTimer`, `startTimerTest`, `fakeTimerStart`, `fakeTimerFinish`
-   Free race: `startFreeRaceHeat`, `recordFreeRaceResult`, `deleteFreeRaceHeat`
-   Config: `createInitialConfig`, `updateInitialConfig` — both accept the organization's terminology default (racing group, organization, and, since #551, vehicle) the same way they accept the PINs and the themes: absent leaves it alone, and `clearTerminology` (not a non-null sentinel — the built-in Scouting words *are* the null state) is the way back to it (#496 stage 3)
-   Data: `importRacers` (CSV), `uploadImage` (base64), `populateRace` (test data), `createPracticeRace` (a whole rehearsal event on a fake timer)

**REST Endpoints (binary responses):**

-   `POST /upload/` — File upload, returns URL. Check-in role or above, and capped at 16 MB. It is guarded at the check-in level rather than the operator's because its GraphQL twin `uploadImage` is a check-in mutation and photographing a car is the registration desk's job. Nothing in the frontend calls it — images travel as data URLs through `uploadImage` — but it wrote a permanent file from an unauthenticated, unbounded request until the check existed.
-   `GET /printables/barcode/{racer_id}.png` and `GET /api/printables/barcode/{racer_id}.png` — the check-in QR code. Registered at both paths because the Vite dev proxy strips the `/api` prefix; the payload is `TT1:<race_id>:<racer_id>`.
-   `GET /printables/vote-qr/{race_id}.png` and `GET /api/printables/vote-qr/{race_id}.png` — a QR code for the ballot address (#414), encoding the `url` query parameter as-is (refused if it does not contain `/race/{race_id}/vote`) rather than recomputing it, so the text and the code cannot disagree. Not cached `immutable`: the address depends on the machine's current network.
-   `GET /backup` and `GET /api/backup` — the whole install as one zip: a SQLite snapshot, the uploads directory, and a manifest recording the schema revision. Operator-only.
-   `POST /backup/restore` and `POST /api/backup/restore` — replaces the database and uploads with an archive's copies. Operator-only. Refuses an archive whose schema revision this install has no migrations for, and validates everything before it moves anything.
-   `GET /timer-test/{track_id}/report` and `GET /api/timer-test/{track_id}/report` — the timer test report as a JSON download: app version, matched profile and provenance, port framing, and the full timestamped serial conversation. Operator-only, self-guarding like the backup endpoints. The serial capture is the same kind of evidence as `backend/tests/timer_recordings/`, which is what lets a user's report become a regression fixture (#235).

Both backup routes are registered at the two prefixes for the same reason the
barcode is. They are REST rather than GraphQL because one direction is a binary
download and the other a file upload, and they carry their own role check —
`RolePolicyExtension` guards GraphQL mutations and these are not GraphQL, which
is the same reason `/ws/timer/{track_id}` checks for itself.

The driver's licence and pit pass have **no endpoint**. They are HTML the
browser prints, rendered by the frontend at `/race/:raceId/print` — there is no
PDF toolchain on a Raspberry Pi, the branding already lives in the frontend,
and a sheet of sixty is a CSS grid rather than a page-composition problem. The
QR code is the one part a page cannot draw for itself, which is why it is the
only part the server renders.

**GraphQL Subscriptions (real-time observation):**

Delivered over the existing `/graphql` endpoint using the `graphql-ws` subprotocol. Clients use urql's `useSubscription` hook; no separate WebSocket URL is needed.

-   `subscription raceStateChanged(raceId)` — Anything that changed the race, for cache invalidation.
-   `subscription racesChanged()` — Argument-free: a bare `true` whenever a race is created, renamed or deleted anywhere, so the navigation's race selector and the browser tab's title (#300) can re-run `GET_RACES_NAV` instead of going stale in every tab but the one that made the change.
-   `subscription leaderboard(raceId)` — Current standings, pushed on every heat result.
-   `subscription onDeck(raceId)` — Next-up racers.
-   `subscription currentlyRacing(raceId)` — Current heat racers and lane assignments.
-   `subscription timingStats(raceId)` — Per-lane timing for the most recently recorded heat, official or free. Carries `recordBreak` when the heat beat the track record as it stood before this race (`services/records.py`); a free heat never does, since an exhibition run cannot hold a record.
-   `subscription heats(raceId)` — Full round/heat list with completion status.
-   `subscription displayAssignment(displayId, raceId, name)` — What one screen should show. **Subscribing is how a display registers**: it holds no PIN and is a `VIEWER`, so it can make no mutation, and the socket closing is the only signal it has gone.
-   `subscription displays(raceId)` — The operator's list, as screens come and go.
-   `subscription timerStatus(trackId)` — Device state.
-   `subscription heatSession(trackId, heatId)` — The merged live view; see below.
-   `subscription freeRaceHeat(heatId)`, `subscription activeFreeRaceHeat(raceId)`

**`heatSession` is where "what is on the track" is decided**, on the server.
It merges the stored heat with the timer's pending lane times and reports a
phase — `NO_HEAT`, `NOT_READY`, `WAITING`, `RUNNING`, `RECORDED` — so no screen
has to re-derive it. A recorded heat ignores the timer, and a time that is only
in the timer is flagged as pending rather than presented as final.

## 4. Frontend Design (React)

The frontend will be built using React, providing a dynamic and responsive user experience across various devices.

### 4.1. Technology Stack

-   **`AuditEntry`**: One thing somebody did, and when (#219).
    -   `id` (PK), `at` (ISO 8601 UTC), `action`, `role`, `outcome`, `source_ip`, `race_id`, `details`
    -   `action` is a mutation's field name, or one of `heatResultRecorded` / `backupDownloaded` / `backupRestored` for the seams that are not mutations.
    -   `role` is `VIEWER` / `CHECKIN` / `OPERATOR` / `SYSTEM`, not a person: this app has no user accounts, and a shared PIN cannot tell two volunteers apart. `SYSTEM` is the app acting with no request behind it — the timer recording a heat it just ran.
    -   `outcome` is `OK` / `REFUSED` / `FAILED`. A refusal is recorded with the same weight as a success; "the check-in tablet tried to delete a round" is the most interesting line the log holds.
    -   `details` is a small JSON object of scalars, filtered by `domain.audit.redact` — PINs and image data are never written, under any spelling of the argument name.
    -   `race_id` is a **plain integer, not a foreign key**, and is the one place the schema deliberately declines a cascade (#125): deleting a race must not take the record of what was done to it.
    -   Append-only. Trimmed to the newest `crud.AUDIT_LOG_MAX_ENTRIES` at startup.
-   **Framework:** React 19
-   **Language:** TypeScript
-   **Build Tool:** Vite
-   **Styling:** Plain CSS with CSS custom properties (BSA color palette defined as variables).
-   **State Management:** React Context API (`AlertContext` for notifications); component-local state via hooks. The race-day flow between heats is a pure state machine (`features/racing/raceFlow.ts`) rather than effects.
-   **Routing:** React Router for navigation between pages.
-   **API Client:** `urql` with `@urql/exchange-graphcache` — subscriptions carry typed payloads into a normalized cache. Native `fetch` for file uploads.
-   **Types:** `src/gql/` and `schema.graphql` are generated from the backend schema; CI fails if they are stale.
-   **Testing:** Vitest + React Testing Library for unit/component tests; Playwright for end-to-end tests and for the documentation screenshots.

### 4.2. User Interfaces

The frontend will provide distinct interfaces tailored for different user journeys and device types:

-   **Admin/Configuration Interface:**
    -   Responsive layout for laptops, desktops, tablets.
    -   Forms for initial configuration, race setup, racer details (manual entry, CSV upload).
    -   Tables for managing racers and racing groups with editing capabilities.
    -   Printable generation interface.
-   **Check-In Interface:**
    -   Optimized for tablets and mobile phones.
    -   Camera scanning of printed check-in codes, using the browser's own `BarcodeDetector` — Chromium-only, with car-number entry alongside it on every browser.
    -   Quick toggles for `car_passed_inspection`.
    -   Forms for adding car name, racer/car pictures.
-   **Race Control Interface:**
    -   Designed for laptops/desktops.
    -   Heat scheduling visualization.
    -   Buttons to start/stop heats.
    -   Real-time feedback on heat progress.
-   **Observation Interfaces (Kiosks/Large Displays):**
    -   Minimalist, high-contrast "Projector Mode" designs.
    -   Dedicated views for "On Deck," "Currently Racing," "Timing Stats," "Leaderboard," and "Heats."
    -   Utilizes WebSocket for real-time updates without page refreshes.

### 4.3. UI & Branding Adherence

The BSA Official Colors — Scouting Blue (`#003F87`) and Cub Scouting Gold
(`#FCD116`) — are **Field Uniform**, the default of seven themes (#498), not
a fixed requirement. Three surfaces are independently themeable: **App** (the
operator's own screens), **Display** (the audience/projector views), and
**Printables** (pit passes, licences, heat sheets, certificates). Each is a
CSS custom property redefinition at that surface's own scoping root
(`applyTheme` in `frontend/src/theming/applyTheme.ts`), never a generated
stylesheet — the seven records in `frontend/src/theming/themes.ts` are the
one place their values live. See `docs/reference/themes.md` for the full
rule set: what each theme is for, the "Field Uniform (default)" option, and
which settings are per-device versus per-install.

-   **Typography:**
    -   Headers: `Roboto Condensed Bold`
    -   Body: `Roboto Regular`
    -   Fonts are **bundled with the app**, not fetched from a font CDN. The
        machine is usually a Raspberry Pi at a venue, frequently with no
        internet, so a remote font would fail exactly where it matters and
        succeed only on a developer's laptop. One variable file per family
        covers every weight the UI uses; see `frontend/src/assets/fonts/`.
        No theme introduces a third family — every occasion a theme covers
        is reachable by varying weight within these two.
-   **Design Elements:**
    -   Rounded corners (12px radius) and 8px spacing are never themed —
        every theme changes color, weight and decoration only, never layout.
    -   Every Display definition is a high-contrast, dark palette (what used
        to be a single hardcoded "Projector Mode"), for readability in a gym
        and on large displays regardless of which theme is active.

## 5. Timer Connectivity

A timer is reached one of two ways, chosen per track by `Track.timer_type`.
Either way the backend owns every piece of protocol state; nothing about a
device's byte format lives outside `backend/services/timer/`.

### 5.1. Backend-direct (`AUTO_DETECT_BACKEND`)

The server opens the serial port itself with `pyserial`. This is the mode for a
Raspberry Pi at the venue with the timer plugged into it.

The port is found rather than configured. On startup — and whenever the track's
timer settings change, or the operator asks it to reconnect — the server walks
every USB serial port, opening each with a candidate profile's framing, sending
that profile's probe command, and watching for its identification banner. The
first port that answers is adopted, still open, and the profile that answered
becomes the track's device.

Only USB ports are probed. Probing writes to a port, and a machine's built-in
serial ports are as likely to be a console as a timer — on a Pi, `/dev/ttyAMA0`
is the GPIO header. A track that *does* have a serial port configured by hand is
connected to exactly that port and never probed, which is the escape hatch for an
RS-232 timer or for a machine where guessing would be wrong.

### 5.2. Browser-proxied (`AUTO_DETECT_PROXY`)

The operator's browser holds the serial port, using the Web Serial API, and
relays raw bytes over the WebSocket at `/ws/timer/{track_id}`. This is the mode
for a laptop, and it needs nothing installed.

The browser is a wire, not a driver. It receives a `configure` message giving
the port's baud rate, data bits, stop bits and parity — the backend describes
the device in `pyserial`'s vocabulary and the frontend translates, so there is
one description of a device rather than two. After that it forwards bytes in
both directions and does not interpret them.

This mode detects too. The backend walks the same profiles it would probe a
local port with, sending a `configure` before each candidate whose framing
differs from the one currently open and waiting for the browser's `ready` — so
the browser closes and reopens the port as the walk goes. With the profiles
shipped today the port opens once, because every device that can be probed for
runs at 9600 8-N-1. If nothing identifies itself the assumed profile is kept,
which is what this mode did before it could detect.

Web Serial is a Chromium-only API, which is the same trade the check-in scanner
makes; a browser without it can still use a track in backend-direct or fake
mode.

**At most one browser owns a track's proxy socket at a time.** A second
connection — another device, or a reload whose old tab has not gone away yet
— *is* a second timer for the same track, and letting both run left the
manager's write function silently repointed to whichever connected last: the
first tab kept showing a connected-looking timer while its bytes went nowhere
(#301). `/ws/timer/{track_id}` now tears the outgoing session down itself —
`ProxySession.close()`, which resets the write function and tells the manager
the connection is down — before installing the new one, so the two sessions
can never fight over the write function; the outgoing socket is then closed
with code `4000` and the reason `"Another connection took over this timer"`,
which is only for the person watching that screen. The frontend's
`SerialProxyContext` surfaces the close reason rather than reporting a plain
disconnect, so a demoted tab says so.

### 5.3. Device support

A timer model is a `TimerProfile` record in
`backend/services/timer/devices/` — port framing, an identification banner,
setup commands, how to mask lanes and arm, and a list of matchers pairing a
pattern with the event it means and the captured groups holding the lane, time
and place. There is no per-device parsing code, which is what lets a prober
walk the list in `ALL_PROFILES` and try each candidate in turn.

Eight real devices are described today — the MicroWizard K1/K2/K3 and seven
adapted from DerbyNet — alongside a fake timer that skips the serial layer
entirely. None has been run against its hardware; each carries a `provenance`
string saying what it was written from, shown on the timer check page. A
profile with no `probe` command or
no identification banner is skipped by the prober — it cannot be detected, only
chosen.

Both auto-detect modes probe. They differ only in who opens the port:
`backend/services/timer/probe.py` opens it directly, and
`backend/services/timer/proxy.py` asks the browser to.

One profile departs from the usual framing: the NewBold DT/TURBO/DerbyStick
family runs at 1200 baud with 7 data bits and 2 stop bits, against everything
else's 9600 8-N-1 — and answers no identifying question, so it can only be
chosen, never detected.

### 5.4. Reading the serial log

The timer check page (and the timer test report) show the raw conversation
between the manager and the device, annotated. What a healthy MicroWizard
session looks like, for anyone reading a report or the live panel:

A start-up — the setup commands go out the moment the connection opens, which
is why a log usually begins here:

```
→ N1                                        enable new-format results
→ N2                                        enable gate feedback
← *                                         command acknowledged
← *                                         command acknowledged
```

If the server found the timer by probing the USB ports, the identification
happened during the probe, before this log began — so the question and the
banner are not in it. A hand-entered port is never probed, so there the
server asks every few seconds until something answers:

```
→ RV                                        request version
← Copyright (c) Micro Wizard 2002-2009      timer identified itself
```

During a heat:

```
→ MG                                        clear lane masks
→ ME                                        mask lane 5
→ LR                                        arm / reset timer
← >                                         gate closed
← @                                         gate opened - race started
← A=3.452! B=3.501"                         results received
```

The command annotations come from the MicroWizard's vocabulary; other devices
speak their own, described by their profiles in
`backend/services/timer/devices/`.

## 6. Data Models (Detailed)

(Already covered in Backend Design - 3.2. Data Storage, which includes key entities and their attributes).

## 7. API Design (Detailed)

(Already covered in Backend Design - 3.3. API Design, which includes key endpoints and interaction types).

## 8. UI/UX Considerations

The design emphasizes intuitive user journeys and accessibility.

-   **Initial Configuration:** Guided wizard-like flow with clear steps and reasonable defaults.
-   **Race Configuration:** Interactive forms with real-time feedback on proposed changes (e.g., car numbering strategy impact).
-   **Racer Details:** Flexible input options (bulk CSV, manual per-racer) with optional image uploads and auto-cropping.
-   **Race Check-In:** Streamlined process using camera-based scanning for quick racer lookup.
-   **Printables:** Sheet-first. The print page renders the whole sheet at paper size and the browser prints it; the operator's selection carries over from the roster, and an empty selection means the whole roster. Only the QR code comes from the backend.
-   **Race Operation:** Clear visualization of race progression and simple controls.
-   **Race Observation:** Real-time updates and high-visibility displays for various audience needs.

## 9. Future Considerations

Since built: automated testing (backend and frontend suites plus Playwright,
all gating CI) and a Docker image. Still open:

-   **BSA Integration:** Potential integration with BSA systems for roster import/export.
-   **Advanced Reporting:** More detailed race analytics and customizable reports.
-   **Internationalization (i18n):** Support for multiple languages.
-   **Accessibility (WCAG):** Ensure all UI components adhere to WCAG guidelines for inclusive design.
-   **Multiple operator accounts:** roles are derived from a shared PIN per device, with no record of who did what. Individual accounts would be a different model, and a heavier one than a pack needs.
