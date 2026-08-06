"""Writing a heat through structured input.

Issue #5, step five. `updateHeatResult` and `recordFreeRaceResult` took a JSON
string that the server had to trust and every client had to construct — which
meant every client also had to know that an undecided championship slot was a
negative racer id.
"""

import json

import pytest

from backend.db import crud, models, schemas
from backend.tests.helpers import (
    RECORD_FREE_RACE_RESULT,
    UPDATE_HEAT_RESULT,
    as_lanes,
    lane_input,
)


def _post(client, query, variables):
    response = client.post("/graphql", json={"query": query, "variables": variables})
    assert response.status_code == 200, response.text
    return response.json()


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
            car_numbering_strategy="MANUAL",
        ),
    )


@pytest.fixture
def racer(db, race):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Ann", last_name="A", race_id=race.id, car_passed_inspection=True
        ),
    )


def _heat(db, race, blob):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(blob),
    )
    db.add(heat)
    db.commit()
    return heat


def _lanes(db, heat_id):
    return (
        db.query(models.HeatLane)
        .filter(models.HeatLane.heat_id == heat_id)
        .order_by(models.HeatLane.lane)
        .all()
    )


def test_a_recorded_time_reaches_the_database(client, db, race, racer):
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "time": 3.421, "place": 1})
            ],
        },
    )

    row = _lanes(db, heat.id)[0]
    assert (row.racer_id, row.time_seconds, row.place) == (racer.id, 3.421, 1)


def test_a_placeholder_slot_survives_the_round_trip(client, db, race):
    """The negative-id encoding is now the server's business alone."""
    heat = _heat(db, race, [{"lane": 1, "racer_id": -2}])

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                {
                    "lane": 1,
                    "racerId": None,
                    "placeholderSlot": 2,
                    "time": None,
                    "place": None,
                    "skipped": False,
                }
            ],
        },
    )

    row = _lanes(db, heat.id)[0]
    assert (row.racer_id, row.placeholder_slot) == (None, 2)
    # Storage still encodes it the old way; that is step 5b's problem.
    db.refresh(heat)
    assert json.loads(heat.lane_results)[0]["racer_id"] == -2


def test_skipping_and_then_unskipping_a_heat(client, db, race, racer):
    """`skipped` is a real field now, so clearing it has to actually clear it —
    a carried-over `skipped: true` would leave the heat permanently skipped."""
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])
    lane = lane_input({"lane": 1, "racer_id": racer.id})

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": heat.id, "lanes": [{**lane, "skipped": True}]},
    )
    assert _lanes(db, heat.id)[0].skipped

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": heat.id, "lanes": [{**lane, "skipped": False}]},
    )
    assert not _lanes(db, heat.id)[0].skipped

    # Stored by omission rather than as `"skipped": false`. Older blobs contain
    # both spellings and every reader has always treated absent as false, so
    # this normalises them without changing what any of them see.
    db.refresh(heat)
    assert "skipped" not in json.loads(heat.lane_results)[0]


def test_keys_the_client_cannot_see_are_not_dropped(client, db, race, racer):
    """The blob has always carried keys nothing models. A client that cannot
    see them cannot send them back, so the server has to keep them."""
    heat = _heat(
        db, race, [{"lane": 1, "racer_id": racer.id, "someFutureKey": "keep me"}]
    )

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [lane_input({"lane": 1, "racer_id": racer.id, "time": 3.0})],
        },
    )

    db.refresh(heat)
    stored = json.loads(heat.lane_results)[0]
    assert stored["someFutureKey"] == "keep me"
    assert stored["time"] == 3.0


def test_an_unknown_heat_is_answered_with_null(client, race):  # noqa: ARG001
    body = _post(client, UPDATE_HEAT_RESULT, {"heatId": 9999, "lanes": []})
    assert body["data"]["updateHeatResult"] is None


def test_a_malformed_lane_is_rejected_rather_than_stored(client, race):  # noqa: ARG001
    """The old string argument could not be validated at all: a typo in the
    client's JSON became a heat with no lanes, silently."""
    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": 1, "lanes": [{"lane": "not a number"}]},
    )
    assert "errors" in body, "the schema should reject this before it reaches the DB"


def test_free_race_results_take_the_same_input(client, db, race, racer):
    heat = crud.create_free_race_heat(
        db,
        race.id,
        as_lanes([{"lane": 1, "racer_id": racer.id}, {"lane": 2, "racer_id": None}]),
    )
    db.commit()

    _post(
        client,
        RECORD_FREE_RACE_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "time": 3.14, "place": 1}),
                lane_input({"lane": 2, "racer_id": None}),
            ],
        },
    )

    rows = _lanes(db, heat.id)
    assert [row.time_seconds for row in rows] == [3.14, None]


def test_an_unknown_free_race_heat_is_answered_with_null(client, race):  # noqa: ARG001
    body = _post(client, RECORD_FREE_RACE_RESULT, {"heatId": 9999, "lanes": []})
    assert body["data"]["recordFreeRaceResult"] is None
