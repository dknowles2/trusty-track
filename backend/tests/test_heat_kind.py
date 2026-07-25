"""A free race heat in the `heats` table must not reach anything official.

Issue #6, step one. `heats` can now hold free race heats, and nothing puts one
there yet — step two moves the rows. These tests put one there directly, which
is the only way to check the filters *before* the data exists to test them with.

The failure this guards against is quiet: a missing `kind` filter does not
raise, it just adds an exhibition run to someone's standings.
"""

import json

import pytest

from backend.db import crud, models, schemas
from backend.services import scoring, stats


@pytest.fixture
def race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


@pytest.fixture
def racers(db, race):
    made = []
    for i in range(2):
        made.append(
            crud.create_racer(
                db,
                schemas.RacerCreate(
                    first_name=f"Racer{i}",
                    last_name="Test",
                    race_id=race.id,
                    car_passed_inspection=True,
                ),
            )
        )
    return made


@pytest.fixture
def official_heat(db, race, racers):
    """One official heat, raced: racer 0 in 9.0s, racer 1 in 9.5s."""
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [
                {"lane": 1, "racer_id": racers[0].id, "time": 9.0, "place": 1},
                {"lane": 2, "racer_id": racers[1].id, "time": 9.5, "place": 2},
            ]
        ),
    )
    db.add(heat)
    db.commit()
    return heat


@pytest.fixture
def free_heat(db, race, racers):
    """A free race heat with times fast enough to be obvious if they leak."""
    heat = models.Heat(
        race_id=race.id,
        round_id=None,
        kind=models.HeatKind.FREE,
        heat_number=1,
        created_at="2026-07-25T12:00:00Z",
        lane_results=json.dumps(
            [
                {"lane": 1, "racer_id": racers[0].id, "time": 0.1, "place": 1},
                {"lane": 2, "racer_id": racers[1].id, "time": 0.2, "place": 2},
            ]
        ),
    )
    db.add(heat)
    db.commit()
    return heat


def test_a_heat_defaults_to_official(db, race):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
    db.add(heat)
    db.commit()
    assert heat.kind is models.HeatKind.OFFICIAL


def test_a_free_heat_needs_no_round(db, free_heat):
    """`round_id` is nullable now; a free heat belongs to no round."""
    db.refresh(free_heat)
    assert free_heat.round_id is None
    assert free_heat.round is None


@pytest.mark.usefixtures("free_heat")
def test_get_heats_returns_only_official_heats(db, race, official_heat):
    """Belt and braces: both branches of `get_heats` already exclude a null
    `round_id`, so this passes even without the kind filter. The filter states
    the intent, so that an `outerjoin` added later does not quietly open it."""
    heats = crud.get_heats(db, race.id)
    assert [h.id for h in heats] == [official_heat.id]


@pytest.mark.usefixtures("official_heat", "free_heat")
def test_the_leaderboard_ignores_free_heats(db, race, racers):
    """The free heat's 0.1s times would take over any standings they reached."""
    board = scoring.get_leaderboard(db, race.id)

    assert {entry["racer_id"] for entry in board} == {r.id for r in racers}
    scores = {entry["racer_id"]: entry["score"] for entry in board}
    assert scores[racers[0].id] == pytest.approx(9.0)
    assert scores[racers[1].id] == pytest.approx(9.5)
    assert all(entry["heats_completed"] == 1 for entry in board)


@pytest.mark.usefixtures("official_heat", "free_heat")
def test_advancement_ignores_free_heats(db, race, racers):
    """Who advances is drawn from the standings, so a leak here picks the field
    for a championship round out of exhibition runs."""
    advancing = scoring.get_advancing_racers(db, race.id, "PACK", 1)
    assert advancing == [racers[0].id]


@pytest.mark.usefixtures("official_heat", "free_heat")
def test_race_stats_ignore_free_heats(db, race):
    result = stats.compute_race_stats(db, race.id)
    assert result is not None
    fastest = min(row["time"] for row in result["heat_results"])
    assert fastest == pytest.approx(9.0), "a 0.1s exhibition time reached the stats"


@pytest.mark.usefixtures("racers", "official_heat", "free_heat")
def test_scheduling_ignores_free_heats(db, race):
    """Regenerating a round must not see a free heat as an obstacle or a slot."""
    round_obj = crud.create_round(db, race_id=race.id, round_number=2)
    crud.generate_heats_for_round(db, round_obj.id)
    db.commit()

    generated = [h for h in crud.get_heats(db, race.id) if h.round_id == round_obj.id]
    assert generated
    assert all(h.kind is models.HeatKind.OFFICIAL for h in generated)


@pytest.mark.usefixtures("official_heat", "free_heat")
def test_deleting_the_race_takes_free_heats_with_it(db, race):
    """`delete_race` deliberately does *not* filter by kind."""
    crud.delete_race(db, race.id)
    assert db.query(models.Heat).count() == 0


@pytest.mark.anyio
@pytest.mark.parametrize("subscription", ["currently_racing", "on_deck"])
@pytest.mark.usefixtures("official_heat", "free_heat")
async def test_the_audience_subscriptions_ignore_free_heats(db, race, subscription):
    """These build their own heat query with no join to `rounds`, so unlike
    `get_heats` they have nothing but the kind filter keeping free heats out.

    Only the first value is taken: it is produced before the resolver waits on
    the pub/sub stream, and it is the query that matters here.
    """
    from backend.api.schema import Subscription

    class MockInfo:
        context = {"db": db}

    generator = getattr(Subscription(), subscription)(MockInfo(), race.id)
    try:
        first = await generator.__anext__()
    finally:
        await generator.aclose()

    if subscription == "currently_racing":
        # Every official heat is raced, so there is nothing currently racing.
        # A leaked free heat would show up here as the next thing to run.
        assert first is None
    else:
        assert first == []


@pytest.mark.parametrize("query_name", ["heats", "leaderboard"])
@pytest.mark.usefixtures("free_heat")
def test_the_graphql_race_query_excludes_free_heats(
    client, race, official_heat, query_name
):
    """The loaders have their own heat query, separate from crud's."""
    response = client.post(
        "/graphql",
        json={
            "query": """
            query($id: Int!) {
              race(raceId: $id) {
                heats { id }
                leaderboard { racerId score }
              }
            }
            """,
            "variables": {"id": race.id},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "errors" not in body, body["errors"]
    data = body["data"]["race"]

    if query_name == "heats":
        assert [h["id"] for h in data["heats"]] == [official_heat.id]
    else:
        assert min(e["score"] for e in data["leaderboard"]) == pytest.approx(9.0)
