# Heat lanes, and free race heats

Part of the Trusty Track agent guide; the index is in [`CLAUDE.md`](../../CLAUDE.md). Read this before touching `heat_lanes`, `crud.set_heat_lanes`, `domain/lanes.py`, a delete path, or a heat's `kind`.

---

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
