"""Query-count guards for the expensive page-load queries.

Strawberry types here are duck-typed shells filled with ORM objects, so it is
very easy to add a field resolver that issues a query per row and never notice.
These tests pin the cost of the queries the app actually sends on race day.

The ceilings are deliberately a little above the measured counts so unrelated
changes don't cause spurious failures, but far below N+1 behaviour.
"""

import json

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

from backend.db import crud, models, schemas

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
    heats { id heatNumber roundNumber roundId roundName laneResults }
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

# The same page once it reads the structured lanes instead of the blob (#5).
RACE_CONTROL_LANES_QUERY = RACE_CONTROL_QUERY.replace(
    "heats { id heatNumber roundNumber roundId roundName laneResults }",
    "heats { id heatNumber roundNumber roundId roundName "
    "lanes { lane racerId placeholderSlot time place skipped } }",
)

OBSERVATION_QUERY = """
query($id: Int!) {
  race(raceId: $id) {
    id
    name
    leaderboard { racerId firstName lastName carNumber denName score rank }
    heats { id heatNumber roundNumber roundName laneResults }
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
            lanes = [
                {
                    "lane": lane,
                    "racer_id": racers[(heat_number * 4 + lane) % 60].id,
                    "time": 3.0 + lane * 0.01,
                    "place": lane,
                }
                for lane in range(1, 5)
            ]
            db.add(
                models.Heat(
                    race_id=race.id,
                    round_id=round_obj.id,
                    heat_number=heat_number,
                    lane_results=json.dumps(lanes),
                )
            )
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

    Held to the blob's own budget: reading 45 heats' lanes out of `heat_lanes`
    must not cost more than reading the same data out of the JSON column did.
    """
    with _QueryCounter() as blob:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)
    with _QueryCounter() as table:
        body = _run(client, RACE_CONTROL_LANES_QUERY, populated_race.id)

    heats = body["data"]["race"]["heats"]
    assert sum(len(h["lanes"]) for h in heats) == 180, (
        "45 heats of 4 lanes; a cheap query that returns nothing proves nothing"
    )
    assert table.count <= blob.count + 1, (
        f"Reading lanes from the table cost {table.count} queries against "
        f"{blob.count} for the blob; the per-race batch is not batching."
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
        db.add(
            models.Heat(
                race_id=populated_race.id,
                round_id=round_obj.id,
                heat_number=heat_number,
                lane_results=json.dumps(
                    [{"lane": 1, "racer_id": None, "time": None, "place": None}]
                ),
            )
        )
    db.commit()

    with _QueryCounter() as after:
        _run(client, RACE_CONTROL_QUERY, populated_race.id)

    growth = after.count - before.count
    assert growth <= 5, (
        f"Adding 45 heats added {growth} SQL queries "
        f"({before.count} -> {after.count}); heat fields are still N+1."
    )
