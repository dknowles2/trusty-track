"""Query-count guards for the expensive page-load queries.

Strawberry types here are duck-typed shells filled with ORM objects, so it is
very easy to add a field resolver that issues a query per row and never notice.
These tests pin the cost of the queries the app actually sends on race day.

The ceilings are deliberately a little above the measured counts so unrelated
changes don't cause spurious failures, but far below N+1 behaviour.
"""

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

from backend.api.schema import Subscription
from backend.db import crud, models, schemas
from backend.domain import lanes as domain_lanes
from backend.domain.displays import DisplayRole
from backend.services.displays import registry
from backend.tests.helpers import as_lanes

# The query RaceControl.tsx actually sends.
RACE_CONTROL_QUERY = """
query($id: Int!) {
  race(raceId: $id) {
    id
    name
    championshipTrophies
    scoringStrategy
    autoAdvanceHeat
    track { id laneCount timerType }
    racingGroups { id name }
    racers { id firstName lastName carNumber racerImageUrl carImageUrl }
    heats { id heatNumber roundNumber roundId roundName
            lanes { lane racerId time place } }
    rounds {
      id
      roundNumber
      name
      advancementSource
      advancementStatus {
        isReady
        requiresAdvancement
        alreadyAdvanced
        source
        numRacers
        advancingRacers {
          racerId firstName lastName carNumber racingGroupName score rank isAdvancing
        }
      }
    }
  }
}
"""

# The same page asking for every lane field there is. Selecting more of them
# must not cost more queries — the lanes come from one load per race (#5).
RACE_CONTROL_LANES_QUERY = RACE_CONTROL_QUERY.replace(
    "heats { id heatNumber roundNumber roundId roundName\n"
    "            lanes { lane racerId time place } }",
    "heats { id heatNumber roundNumber roundId roundName "
    "lanes { lane racerId placeholderSlot time place skipped } }",
)

# The same page asking for every heat's stored replay clips too (#177 stage
# 2) — `Heat.replays` reads a table exactly like `Heat.lanes` does, so it is
# the same obvious place for an N+1.
RACE_CONTROL_REPLAYS_QUERY = RACE_CONTROL_QUERY.replace(
    "heats { id heatNumber roundNumber roundId roundName\n"
    "            lanes { lane racerId time place } }",
    "heats { id heatNumber roundNumber roundId roundName "
    "lanes { lane racerId time place } "
    "replays { cameraId url durationMs t0OffsetMs } }",
)

# The same page also asking for the round plan (#1088). `roundPlan` derives
# its answer from the same `_loaders(info).rounds_for_race` batch `rounds`
# above already reads, so asking for it too must not cost an extra query.
RACE_CONTROL_WITH_ROUND_PLAN_QUERY = RACE_CONTROL_QUERY.replace(
    "    rounds {",
    "    roundPlan {\n"
    "      generalRound { type schedulingStrategy runsPerLane }\n"
    "      championshipRounds { name source numTopRacers sourceRoundId }\n"
    "    }\n"
    "    rounds {",
)

# `Race.replayCount` (#177 stage 3) reads off the same per-race
# `replays_for_heat` batch `Heat.replays` already uses — asking for it
# alongside the ordinary page must not cost an extra query.
RACE_CONTROL_WITH_REPLAY_COUNT_QUERY = RACE_CONTROL_QUERY.replace(
    "    rounds {",
    "    replayCount\n    rounds {",
)

# `Race.highlightsSummary` (#177 stage 3) reads off the same per-race
# `heats_for_race`/`replays_for_heat` batches — asking for it too must not
# cost an extra query either.
RACE_CONTROL_WITH_HIGHLIGHTS_SUMMARY_QUERY = RACE_CONTROL_QUERY.replace(
    "    rounds {",
    "    highlightsSummary { clipCount roundNumber roundName }\n    rounds {",
)

OBSERVATION_QUERY = """
query($id: Int!) {
  race(raceId: $id) {
    id
    name
    leaderboard { racerId firstName lastName carNumber racingGroupName score rank }
    heats { id heatNumber roundNumber roundName
            lanes { lane racerId time place } }
  }
}
"""


class _QueryCounter:
    """Count SQL statements issued during a block."""

    def __init__(self) -> None:
        self.count = 0

    def __enter__(self):
        event.listen(Engine, "before_cursor_execute", self._on_execute)
        return self

    def __exit__(self, *exc):
        event.remove(Engine, "before_cursor_execute", self._on_execute)
        return False

    def _on_execute(self, *_args, **_kwargs):
        self.count += 1


@pytest.fixture
def populated_race(db):
    """A realistically sized race: 60 racers, 5 racing_groups, 3 rounds, 45 heats."""
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Perf Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Perf Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Perf Race", organization_id=group.id, track_id=track.id
        ),
    )

    racing_groups = []
    for i in range(5):
        racing_group = models.RacingGroup(name=f"RacingGroup {i}", race_id=race.id)
        db.add(racing_group)
        racing_groups.append(racing_group)
    db.commit()

    racers = []
    for i in range(60):
        racer = models.Racer(
            race_id=race.id,
            first_name=f"Racer{i}",
            last_name="Test",
            car_number=100 + i,
            racing_group_id=racing_groups[i % 5].id,
            car_passed_inspection=True,
        )
        db.add(racer)
        racers.append(racer)
    db.commit()

    for round_number in range(1, 4):
        round_obj = crud.create_round(db, race_id=race.id, round_number=round_number)
        for heat_number in range(1, 16):
            heat = models.Heat(
                race_id=race.id,
                round_id=round_obj.id,
                heat_number=heat_number,
            )
            # Through the door, like production. Setting `lane_results`
            # directly still works — `lane_sync` falls back to parsing it — but
            # then the one fixture measuring the app's real cost would be the
            # only place in the suite taking a path nothing else takes.
            crud.set_heat_lanes(
                heat,
                [
                    domain_lanes.Lane(
                        lane=lane,
                        racer_id=racers[(heat_number * 4 + lane) % 60].id,
                        time=3.0 + lane * 0.01,
                        place=lane,
                    )
                    for lane in range(1, 5)
                ],
            )
            db.add(heat)
        db.commit()

    return race


def _run(client, query, race_id):
    response = client.post(
        "/graphql", json={"query": query, "variables": {"id": race_id}}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "errors" not in body, body["errors"]
    return body


def test_race_control_query_count(client, populated_race):
    """The main race-day page must not scale its query count with heat count.

    Before DataLoaders this issued 140 queries for this fixture, dominated by
    two per heat for roundNumber/roundName.
    """
    with _QueryCounter() as counter:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)

    assert counter.count <= 25, (
        f"RaceControl page load issued {counter.count} SQL queries for "
        f"60 racers / 3 rounds / 45 heats. This should not grow with the "
        f"number of heats — check for a field resolver querying per row."
    )


def test_heat_lanes_cost_one_query_for_the_whole_race(client, populated_race):
    """`Heat.lanes` reads a table, so it is the obvious place for an N+1.

    Asking for more of a lane must not cost more queries: both requests below
    load the same 180 lanes, one selecting four fields and one selecting six,
    and the lanes come from a single per-race batch either way.
    """
    with _QueryCounter() as fewer_fields:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)
    with _QueryCounter() as every_field:
        body = _run(client, RACE_CONTROL_LANES_QUERY, populated_race.id)

    heats = body["data"]["race"]["heats"]
    assert sum(len(h["lanes"]) for h in heats) == 180, (
        "45 heats of 4 lanes; a cheap query that returns nothing proves nothing"
    )
    assert every_field.count <= fewer_fields.count + 1, (
        f"Selecting every lane field cost {every_field.count} queries against "
        f"{fewer_fields.count} for four of them; the per-race batch is not "
        f"batching."
    )


def test_heat_replays_cost_one_query_for_the_whole_race(client, db, populated_race):
    """`Heat.replays` (#177 stage 2) reads a table off the same batched-per-
    race shape `Heat.lanes` already uses — asking for it alongside lanes
    must not add more than one query for the whole page, whatever the heat
    count."""
    heats = list(populated_race.heats)
    for heat in heats[:3]:
        db.add(
            models.HeatReplay(
                heat_id=heat.id,
                camera_id="cam-1",
                recorded_at="2026-09-16T12:00:00+00:00",
                path=f"clip-{heat.id}.webm",
                duration_ms=4000,
                t0_offset_ms=500,
                size_bytes=1000,
                created_at="2026-09-16T12:00:00+00:00",
            )
        )
    db.commit()

    with _QueryCounter() as without_replays:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)
    with _QueryCounter() as with_replays:
        body = _run(client, RACE_CONTROL_REPLAYS_QUERY, populated_race.id)

    returned_heats = body["data"]["race"]["heats"]
    assert sum(len(h["replays"]) for h in returned_heats) == 3, (
        "3 heats seeded with one clip each; a cheap query that returns "
        "nothing proves nothing"
    )
    assert with_replays.count <= without_replays.count + 1, (
        f"Selecting `Heat.replays` cost {with_replays.count} queries against "
        f"{without_replays.count} without it — the per-race batch is not "
        f"batching."
    )


def test_heat_replays_are_ordered_by_camera_order_at_no_extra_cost(
    client, db, populated_race
):
    """`Heat.replays` sorts by the operator's own camera order (#177 stage
    4, `_order_replay_clips`) — an in-memory registry lookup per clip, not
    a query, so this must cost exactly what `Heat.replays` alone already
    does (`test_heat_replays_cost_one_query_for_the_whole_race`).
    """
    registry.clear()
    heat = populated_race.heats[0]
    for camera_id in ("cam-b", "cam-a"):
        db.add(
            models.HeatReplay(
                heat_id=heat.id,
                camera_id=camera_id,
                recorded_at="2026-09-16T12:00:00+00:00",
                path=f"clip-{heat.id}-{camera_id}.webm",
                duration_ms=4000,
                t0_offset_ms=500,
                size_bytes=1000,
                created_at="2026-09-16T12:00:00+00:00",
            )
        )
    db.commit()
    # Registered in the reverse order to the one they should come out in —
    # if the sort silently fell back to upload/registration order rather
    # than `camera_order`, this would still pass by accident.
    registry.connect("cam-b", race_id=populated_race.id, role=DisplayRole.CAMERA)
    registry.connect("cam-a", race_id=populated_race.id, role=DisplayRole.CAMERA)
    registry.set_camera_order("cam-b", 2)
    registry.set_camera_order("cam-a", 1)

    with _QueryCounter() as without_replays:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)
    with _QueryCounter() as with_replays:
        body = _run(client, RACE_CONTROL_REPLAYS_QUERY, populated_race.id)

    registry.clear()
    returned = next(
        h for h in body["data"]["race"]["heats"] if h["id"] == heat.id
    )
    assert [c["cameraId"] for c in returned["replays"]] == ["cam-a", "cam-b"]
    assert with_replays.count <= without_replays.count + 1, (
        f"Ordering `Heat.replays` by camera order cost {with_replays.count} "
        f"queries against {without_replays.count} without it — the sort is "
        f"an in-memory registry lookup and must add no query at all."
    )


def test_replay_count_costs_no_extra_query(client, db, populated_race):
    """`Race.replayCount` (#177 stage 3) — what `IntermissionControl.tsx`
    reads alongside `keepReplays` to decide whether to offer the highlights
    checkbox — is off the same per-race batch `Heat.replays` uses, so
    asking for both together must cost the same as `Heat.replays` alone.
    """
    heats = list(populated_race.heats)
    for heat in heats[:2]:
        db.add(
            models.HeatReplay(
                heat_id=heat.id,
                camera_id="cam-1",
                recorded_at="2026-09-16T12:00:00+00:00",
                path=f"clip-{heat.id}.webm",
                duration_ms=4000,
                t0_offset_ms=500,
                size_bytes=1000,
                created_at="2026-09-16T12:00:00+00:00",
            )
        )
    db.commit()

    with _QueryCounter() as without_count:
        _run(client, RACE_CONTROL_REPLAYS_QUERY, populated_race.id)
    with _QueryCounter() as with_count:
        body = _run(client, RACE_CONTROL_WITH_REPLAY_COUNT_QUERY, populated_race.id)

    assert body["data"]["race"]["replayCount"] == 2
    assert with_count.count <= without_count.count + 1, (
        f"Asking for replayCount cost {with_count.count} queries against "
        f"{without_count.count} without it — it should read off the same "
        f"per-race replays batch `Heat.replays` already uses."
    )


def test_highlights_summary_costs_no_extra_query(client, db, populated_race):
    """`Race.highlightsSummary` (#177 stage 3) reads off the same per-race
    `heats_for_race`/`replays_for_heat` batches `Heat.replays` and
    `Race.replayCount` already use — asking for it alongside the ordinary
    page must not cost an extra query.
    """
    heats = list(populated_race.heats)
    for heat in heats[:2]:
        db.add(
            models.HeatReplay(
                heat_id=heat.id,
                camera_id="cam-1",
                recorded_at="2026-09-16T12:00:00+00:00",
                path=f"clip-{heat.id}.webm",
                duration_ms=4000,
                t0_offset_ms=500,
                size_bytes=1000,
                created_at="2026-09-16T12:00:00+00:00",
            )
        )
    db.commit()

    with _QueryCounter() as without_summary:
        _run(client, RACE_CONTROL_REPLAYS_QUERY, populated_race.id)
    with _QueryCounter() as with_summary:
        body = _run(
            client, RACE_CONTROL_WITH_HIGHLIGHTS_SUMMARY_QUERY, populated_race.id
        )

    assert body["data"]["race"]["highlightsSummary"] is not None
    assert with_summary.count <= without_summary.count + 1, (
        f"Asking for highlightsSummary cost {with_summary.count} queries "
        f"against {without_summary.count} without it — it should read off "
        f"the same per-race heats/replays batches already used elsewhere."
    )


def test_round_plan_costs_no_extra_query(client, populated_race):
    """`Race.roundPlan` (#1088) reads off the same per-race `rounds` batch
    the `rounds` field already loads — asking for both must cost the same
    as asking for `rounds` alone."""
    with _QueryCounter() as without_plan:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)
    with _QueryCounter() as with_plan:
        body = _run(client, RACE_CONTROL_WITH_ROUND_PLAN_QUERY, populated_race.id)

    assert body["data"]["race"]["roundPlan"] is not None
    assert with_plan.count <= without_plan.count + 1, (
        f"Asking for roundPlan cost {with_plan.count} queries against "
        f"{without_plan.count} without it; it should read off the same "
        f"per-race rounds batch rather than issuing its own query."
    )


def test_observation_query_count(client, populated_race):
    """Observation displays refetch on every mutation; keep them cheap."""
    with _QueryCounter() as counter:
        _run(client, OBSERVATION_QUERY, populated_race.id)

    assert counter.count <= 25, (
        f"Observation page load issued {counter.count} SQL queries."
    )


class _SubscriptionInfo:
    """The minimal `Info` shape `display_assignment` reads (#1081) — just
    `context["db"]`, the same as `test_display_subscription.py`'s own
    `_info` helper. Not reused from there: this file counts queries with a
    `db` from its own `populated_race` fixture, not that module's."""

    def __init__(self, db):
        self.context = {"db": db}


@pytest.mark.asyncio
async def test_display_assignment_theme_lookup_does_not_add_a_query(populated_race, db):
    """A race's own Display theme override (#1081) is resolved by joining
    `Race` to its `Organization` in one query — `_display_theme_setting`
    used to read the organization row alone, and re-adding the race layer
    on top must not turn that into two queries fired on every event this
    subscription re-reads on."""
    stream = Subscription().display_assignment(
        _SubscriptionInfo(db),
        display_id="query-count-display",
        race_id=populated_race.id,
    )
    try:
        with _QueryCounter() as counter:
            await stream.__anext__()
    finally:
        await stream.aclose()

    assert counter.count <= 1, (
        f"display_assignment's opening payload issued {counter.count} SQL queries."
    )


def test_heat_fields_do_not_scale_with_heat_count(client, populated_race, db):
    """Doubling the heats must not roughly double the query count."""
    with _QueryCounter() as before:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)

    round_obj = crud.create_round(db, race_id=populated_race.id, round_number=4)
    for heat_number in range(1, 46):
        heat = models.Heat(
            race_id=populated_race.id,
            round_id=round_obj.id,
            heat_number=heat_number,
        )
        db.add(heat)
        db.flush()
        crud.set_heat_lanes(
            heat, as_lanes([{"lane": 1, "racer_id": None, "time": None, "place": None}])
        )
    db.commit()

    with _QueryCounter() as after:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)

    growth = after.count - before.count
    assert growth <= 5, (
        f"Adding 45 heats added {growth} SQL queries "
        f"({before.count} -> {after.count}); heat fields are still N+1."
    )


GET_RACES_QUERY = """
query GetRaces {
  races {
    id
    name
    registeredCount
    checkedInCount
    status
  }
}
"""


def _run_no_vars(client, query):
    response = client.post("/graphql", json={"query": query})
    assert response.status_code == 200, response.text
    body = response.json()
    assert "errors" not in body, body["errors"]
    return body


def _seed_race_with_racers(db, organization, track, name, racer_count=3):
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=name, organization_id=organization.id, track_id=track.id
        ),
    )
    for i in range(racer_count):
        db.add(
            models.Racer(
                race_id=race.id,
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=i + 1,
                car_passed_inspection=(i % 2 == 0),
            )
        )
    db.commit()
    return race


def _seed_heat(db, race, rows, heat_number=1):
    """One official heat with the given lanes, written the door production
    uses (`crud.set_heat_lanes`). Lanes carry no racer here — `status_of`
    only reads whether a lane holds a result or is skipped, not who is in
    it, so there is nothing to gain from a real roster tie-in for this
    guard.
    """
    heat = models.Heat(race_id=race.id, round_id=None, heat_number=heat_number)
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(rows))
    db.commit()
    return heat


def test_get_races_query_count_does_not_scale_with_race_count(client, db):
    """The Home page lists every race the install has ever run (#749).

    `Race.registeredCount`/`checkedInCount` used to run two `COUNT` queries
    per race outside `RequestLoaders`, so `GetRaces` scaled linearly with
    how many races an install had ever run — the one list that is never
    pruned, unlike every other page this guard already covers. A grouped
    query must serve any number of races at the same cost.

    `Race.status` (#847) rides on the same guard rather than a sibling test:
    it is exactly the shape #749 fixed once already, this time for a race's
    heats and lanes instead of its racers, and a second copy of this test
    would be free to drift from the first. Three races are seeded with
    heats in each of the three states below, so the count assertion is
    exercising real work rather than 26 races that all trivially have no
    heats at all.
    """
    organization = crud.create_organization(
        db, schemas.OrganizationCreate(name="Count Pack")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Count Track", lane_count=4, timer_type="FAKE"),
    )

    finished_race = _seed_race_with_racers(db, organization, track, "Finished Race")
    _seed_heat(db, finished_race, [{"lane": 1, "time": 5.0, "place": 1}])

    in_progress_race = _seed_race_with_racers(
        db, organization, track, "In Progress Race"
    )
    _seed_heat(
        db, in_progress_race, [{"lane": 1, "time": 5.0, "place": 1}], heat_number=1
    )
    _seed_heat(db, in_progress_race, [{"lane": 1}], heat_number=2)

    scheduled_race = _seed_race_with_racers(
        db, organization, track, "Scheduled Not Started Race"
    )
    _seed_heat(db, scheduled_race, [{"lane": 1}])

    for i in range(3):
        _seed_race_with_racers(db, organization, track, f"Small Race {i}")

    with _QueryCounter() as few_races:
        body = _run_no_vars(client, GET_RACES_QUERY)
    assert len(body["data"]["races"]) == 6, (
        "a cheap query that returns nothing proves nothing"
    )
    statuses = {race["name"]: race["status"] for race in body["data"]["races"]}
    assert statuses["Finished Race"] == "FINISHED"
    assert statuses["In Progress Race"] == "IN_PROGRESS"
    assert statuses["Scheduled Not Started Race"] == "NOT_STARTED", (
        "a heat exists but nothing has been raced or skipped yet"
    )
    assert statuses["Small Race 0"] == "NOT_STARTED", (
        "no heats generated at all reads the same as a schedule nobody has run"
    )

    for i in range(20):
        _seed_race_with_racers(db, organization, track, f"Bulk Race {i}")

    with _QueryCounter() as many_races:
        body = _run_no_vars(client, GET_RACES_QUERY)
    assert len(body["data"]["races"]) == 26

    assert many_races.count <= few_races.count, (
        f"26 races cost {many_races.count} SQL queries against "
        f"{few_races.count} for 6; registeredCount/checkedInCount/status "
        f"must not scale with the number of races."
    )


def test_bulk_move_to_den_is_a_single_update(client, db, populated_race):
    """Moving racers between racing_groups is one UPDATE, whatever the count.

    It used to be four more statements than that: a SELECT for a racer, one
    for the racing group, one for the `racing_groups` row shadowing that
    racing group, and an INSERT with its own commit the first time. That
    table was written on every save
    and read by nothing, and was dropped in 0008 — this is the guard against
    something like it growing back on a bulk path.
    """
    racing_group = (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.race_id == populated_race.id)
        .first()
    )
    racer_ids = [
        r.id
        for r in db.query(models.Racer)
        .filter(models.Racer.race_id == populated_race.id)
        .all()
    ]

    mutation = """
    mutation($ids: [Int!]!, $racingGroupId: Int) {
      bulkMoveToRacingGroup(racerIds: $ids, racingGroupId: $racingGroupId)
    }
    """
    with _QueryCounter() as counter:
        response = client.post(
            "/graphql",
            json={
                "query": mutation,
                "variables": {"ids": racer_ids, "racingGroupId": racing_group.id},
            },
        )
    assert response.status_code == 200, response.text
    assert "errors" not in response.json(), response.json()

    # Exactly the measured count rather than the usual bit of headroom: the
    # behaviour this guards added a fixed handful of statements, so a ceiling
    # with slack in it would not have caught it.
    #
    # Four, not three, since #15: a mutation reads the configured PINs once to
    # work out the caller's role. Five since #219: it also writes one audit
    # entry. Six since #804: the incoming `racingGroupId` is checked once
    # against the race's own id (`_validate_racing_group_membership`), a
    # different race's own group otherwise being accepted with nothing
    # saying so. All three are constant and only a mutation pays them —
    # queries and subscriptions resolve no role, record nothing, and check
    # no membership, which is why this is the only count in this file that
    # has moved. What the number still holds is the property that matters:
    # it does not grow with the racers moved.
    assert counter.count <= 6, (
        f"Moving {len(racer_ids)} racers issued {counter.count} SQL statements; "
        f"it should be the UPDATE, the role lookup, the membership check, the "
        f"audit entry, and little else."
    )


def test_scheduled_racers_cost_one_query(db, populated_race):
    """45 heats, 60 racers, one `DISTINCT` (#72).

    This used to load every heat in the race and parse each blob for the racer
    ids in it. The table has the ids as a column, so the database can answer
    the question — which was the point of normalizing it, and is the first of
    the wins #5 predicted to actually arrive.
    """
    from backend.api.loaders import RequestLoaders

    loaders = RequestLoaders(db)

    # Read the id outside the block: the fixture committed, so touching an
    # attribute on the Race refreshes it and that query is not this one's.
    race_id = populated_race.id

    with _QueryCounter() as counter:
        racer_ids = loaders.scheduled_racer_ids(race_id)

    assert len(racer_ids) > 0
    assert counter.count == 1, (
        f"scheduled_racer_ids issued {counter.count} queries, expected 1"
    )


AWARDS_QUERY = """
query($id: Int!) {
  race(raceId: $id) {
    id
    awards {
      id name kind place source sortOrder
      racingGroup { id name }
      recipient { id firstName lastName carNumber racerImageUrl }
    }
  }
}
"""


def test_awards_do_not_scale_with_the_number_of_awards(client, populated_race, db):
    """Resolving a speed award is a full scoring pass, so it must be shared.

    A pack gives one award per racing group plus a podium, which is a dozen or more, and
    each of them names a source. Resolved per award that is a dozen passes over
    every heat in the race; `loaders.award_recipients` computes the whole race
    once and `services.awards` loads each distinct source once within that.

    The comparison is against the same query with a single award, so this fails
    on per-award work rather than on whatever the page costs in total.
    """
    racing_groups = (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.race_id == populated_race.id)
        .all()
    )

    crud.create_award(
        db,
        populated_race.id,
        schemas.AwardCreate(
            name="Fastest Car", kind=models.AwardKind.SPEED, source="ALL", place=1
        ),
    )
    with _QueryCounter() as one_award:
        _run(client, AWARDS_QUERY, populated_race.id)

    # A podium plus one per racing group, which is what a real pack hands out.
    for place in (2, 3):
        crud.create_award(
            db,
            populated_race.id,
            schemas.AwardCreate(
                name=f"Place {place}",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=place,
            ),
        )
    for racing_group in racing_groups:
        crud.create_award(
            db,
            populated_race.id,
            schemas.AwardCreate(
                name=f"Fastest {racing_group.name}",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
                racing_group_id=racing_group.id,
            ),
        )

    with _QueryCounter() as many_awards:
        body = _run(client, AWARDS_QUERY, populated_race.id)

    assert len(body["data"]["race"]["awards"]) == 8, (
        "a cheap query that returns nothing proves nothing"
    )
    assert many_awards.count <= one_award.count + 1, (
        f"Eight awards cost {many_awards.count} queries against "
        f"{one_award.count} for one; the per-race recipient resolution is not "
        f"being shared."
    )


VOTE_TALLY_QUERY = """
query($id: Int!) {
  race(raceId: $id) {
    id
    awards {
      id
      voteTally { racerId voteCount }
    }
  }
}
"""


def test_vote_tallies_do_not_scale_with_the_number_of_awards(
    client, populated_race, db
):
    """One query for a whole race's ballots, the same shape as recipients (#305)."""
    racers = (
        db.query(models.Racer).filter(models.Racer.race_id == populated_race.id).all()
    )
    race = db.query(models.Race).filter(models.Race.id == populated_race.id).first()
    race.voting_open = True
    db.commit()

    award = crud.create_award(
        db,
        populated_race.id,
        schemas.AwardCreate(
            name="Best Paint", kind=models.AwardKind.SPECIAL, votable=True
        ),
    )
    crud.cast_vote(db, award.id, racers[0].id, "ballot-1")
    with _QueryCounter() as one_award:
        _run(client, VOTE_TALLY_QUERY, populated_race.id)

    for name in ("Most Original", "Judges' Choice"):
        other = crud.create_award(
            db,
            populated_race.id,
            schemas.AwardCreate(name=name, kind=models.AwardKind.SPECIAL, votable=True),
        )
        crud.cast_vote(db, other.id, racers[0].id, f"ballot-{name}")

    with _QueryCounter() as many_awards:
        body = _run(client, VOTE_TALLY_QUERY, populated_race.id)

    assert len(body["data"]["race"]["awards"]) == 3
    assert many_awards.count <= one_award.count + 1, (
        f"Three awards cost {many_awards.count} queries against "
        f"{one_award.count} for one; the per-race tally is not being shared."
    )
