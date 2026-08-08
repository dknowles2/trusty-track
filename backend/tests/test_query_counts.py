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

from backend.db import crud, models, schemas
from backend.domain import lanes as domain_lanes
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
    dens { id name }
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
          racerId firstName lastName carNumber denName score rank isAdvancing
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

OBSERVATION_QUERY = """
query($id: Int!) {
  race(raceId: $id) {
    id
    name
    leaderboard { racerId firstName lastName carNumber denName score rank }
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
    """A realistically sized race: 60 racers, 5 dens, 3 rounds, 45 heats."""
    group = crud.create_group(db, schemas.GroupCreate(name="Perf Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Perf Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Perf Race", group_id=group.id, track_id=track.id),
    )

    dens = []
    for i in range(5):
        den = models.Den(name=f"Den {i}", race_id=race.id)
        db.add(den)
        dens.append(den)
    db.commit()

    racers = []
    for i in range(60):
        racer = models.Racer(
            race_id=race.id,
            first_name=f"Racer{i}",
            last_name="Test",
            car_number=100 + i,
            den_id=dens[i % 5].id,
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


def test_observation_query_count(client, populated_race):
    """Observation displays refetch on every mutation; keep them cheap."""
    with _QueryCounter() as counter:
        _run(client, OBSERVATION_QUERY, populated_race.id)

    assert counter.count <= 25, (
        f"Observation page load issued {counter.count} SQL queries."
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


def test_bulk_move_to_den_is_a_single_update(client, db, populated_race):
    """Moving racers between dens is one UPDATE, whatever the count.

    It used to be four more statements than that: a SELECT for a racer, one for
    the den, one for the `racing_groups` row shadowing that den, and an INSERT
    with its own commit the first time. That table was written on every save
    and read by nothing, and was dropped in 0008 — this is the guard against
    something like it growing back on a bulk path.
    """
    den = db.query(models.Den).filter(models.Den.race_id == populated_race.id).first()
    racer_ids = [
        r.id
        for r in db.query(models.Racer)
        .filter(models.Racer.race_id == populated_race.id)
        .all()
    ]

    mutation = """
    mutation($ids: [Int!]!, $denId: Int) {
      bulkMoveToDen(racerIds: $ids, denId: $denId)
    }
    """
    with _QueryCounter() as counter:
        response = client.post(
            "/graphql",
            json={
                "query": mutation,
                "variables": {"ids": racer_ids, "denId": den.id},
            },
        )
    assert response.status_code == 200, response.text
    assert "errors" not in response.json(), response.json()

    # Exactly the measured count rather than the usual bit of headroom: the
    # behaviour this guards added a fixed handful of statements, so a ceiling
    # with slack in it would not have caught it.
    #
    # Four, not three, since #15: a mutation reads the configured PINs once to
    # work out the caller's role. That read is constant and only a mutation pays
    # it — queries and subscriptions resolve no role at all, which is why this
    # is the only count in this file that moved. What the number still holds is
    # the property that matters: it does not grow with the racers moved.
    assert counter.count <= 4, (
        f"Moving {len(racer_ids)} racers issued {counter.count} SQL statements; "
        f"it should be the UPDATE, the role lookup, and little else."
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
      den { id name }
      recipient { id firstName lastName carNumber racerImageUrl }
    }
  }
}
"""


def test_awards_do_not_scale_with_the_number_of_awards(client, populated_race, db):
    """Resolving a speed award is a full scoring pass, so it must be shared.

    A pack gives one award per den plus a podium, which is a dozen or more, and
    each of them names a source. Resolved per award that is a dozen passes over
    every heat in the race; `loaders.award_recipients` computes the whole race
    once and `services.awards` loads each distinct source once within that.

    The comparison is against the same query with a single award, so this fails
    on per-award work rather than on whatever the page costs in total.
    """
    dens = db.query(models.Den).filter(models.Den.race_id == populated_race.id).all()

    crud.create_award(
        db,
        populated_race.id,
        schemas.AwardCreate(
            name="Fastest Car", kind=models.AwardKind.SPEED, source="PACK", place=1
        ),
    )
    with _QueryCounter() as one_award:
        _run(client, AWARDS_QUERY, populated_race.id)

    # A podium plus one per den, which is what a real pack hands out.
    for place in (2, 3):
        crud.create_award(
            db,
            populated_race.id,
            schemas.AwardCreate(
                name=f"Place {place}",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=place,
            ),
        )
    for den in dens:
        crud.create_award(
            db,
            populated_race.id,
            schemas.AwardCreate(
                name=f"Fastest {den.name}",
                kind=models.AwardKind.SPEED,
                source="PACK",
                place=1,
                den_id=den.id,
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
