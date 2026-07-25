"""`Heat.lanes` and `FreeRaceHeat.lanes` — the structured read path.

Issue #5, step three. `laneResults` is still what mutations accept and still
what the frontend reads; this adds the field that replaces it, so the two are
checked against each other rather than in isolation.
"""

import json

import pytest

from backend.db import crud, models, schemas

LANES_QUERY = """
query($id: Int!) {
  race(raceId: $id) {
    heats {
      id
      laneResults
      lanes { lane racerId placeholderSlot time place skipped }
    }
  }
}
"""

FREE_LANES_QUERY = """
query($id: Int!) {
  freeRaceHeats(raceId: $id) {
    id
    recorded
    lanes { lane racerId placeholderSlot time place skipped }
  }
}
"""


def _run(client, query, race_id):
    response = client.post(
        "/graphql", json={"query": query, "variables": {"id": race_id}}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "errors" not in body, body["errors"]
    return body["data"]


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
def racers(db, race):
    made = []
    for i in range(4):
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


def test_lanes_report_a_recorded_result(client, db, race, racers):
    _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": racers[0].id, "time": 3.452, "place": 2},
            {"lane": 2, "racer_id": racers[1].id, "time": 3.311, "place": 1},
        ],
    )

    lanes = _run(client, LANES_QUERY, race.id)["race"]["heats"][0]["lanes"]
    assert lanes == [
        {
            "lane": 1,
            "racerId": racers[0].id,
            "placeholderSlot": None,
            "time": 3.452,
            "place": 2,
            "skipped": False,
        },
        {
            "lane": 2,
            "racerId": racers[1].id,
            "placeholderSlot": None,
            "time": 3.311,
            "place": 1,
            "skipped": False,
        },
    ]


def test_a_placeholder_is_a_slot_rather_than_a_negative_racer(client, db, race):
    """The encoding clients had to know about, now a field of its own."""
    _heat(db, race, [{"lane": 1, "racer_id": -2, "time": None, "place": None}])

    lane = _run(client, LANES_QUERY, race.id)["race"]["heats"][0]["lanes"][0]
    assert lane["racerId"] is None, "a slot is not a racer"
    assert lane["placeholderSlot"] == 2


def test_an_empty_lane_is_distinguishable_from_a_placeholder(client, db, race):
    _heat(db, race, [{"lane": 1, "racer_id": None}, {"lane": 2, "racer_id": -1}])

    lanes = _run(client, LANES_QUERY, race.id)["race"]["heats"][0]["lanes"]
    assert (lanes[0]["racerId"], lanes[0]["placeholderSlot"]) == (None, None)
    assert (lanes[1]["racerId"], lanes[1]["placeholderSlot"]) == (None, 1)


def test_skipped_is_exposed(client, db, race, racers):
    """Previously the backend carried this key without ever reading it."""
    _heat(db, race, [{"lane": 1, "racer_id": racers[0].id, "skipped": True}])

    assert _run(client, LANES_QUERY, race.id)["race"]["heats"][0]["lanes"][0]["skipped"]


def test_a_string_time_arrives_as_a_number(client, db, race, racers):
    """The frontend has written times as strings, which is why every client
    that reads the blob has to coerce."""
    _heat(db, race, [{"lane": 1, "racer_id": racers[0].id, "time": "3.45"}])

    lane = _run(client, LANES_QUERY, race.id)["race"]["heats"][0]["lanes"][0]
    assert lane["time"] == 3.45


def test_lanes_track_the_blob_after_a_result_is_recorded(client, db, race, racers):
    heat = _heat(db, race, [{"lane": 1, "racer_id": racers[0].id, "time": None}])

    crud.record_heat_result(
        db,
        heat.id,
        json.dumps([{"lane": 1, "racer_id": racers[0].id, "time": 3.2, "place": 1}]),
    )

    lane = _run(client, LANES_QUERY, race.id)["race"]["heats"][0]["lanes"][0]
    assert (lane["time"], lane["place"]) == (3.2, 1)


def test_lanes_agree_with_the_blob_they_replace(client, db, race, racers):
    """The whole point of the step: the two read paths say the same thing."""
    _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": racers[0].id, "time": 3.1, "place": 1},
            {"lane": 2, "racer_id": None, "time": None, "place": None},
            {"lane": 3, "racer_id": -1, "time": None, "place": None},
            {"lane": 4, "racer_id": racers[1].id, "time": "3.9", "skipped": True},
        ],
    )

    heat = _run(client, LANES_QUERY, race.id)["race"]["heats"][0]
    blob = json.loads(heat["laneResults"])

    assert len(heat["lanes"]) == len(blob)
    for lane, entry in zip(heat["lanes"], blob, strict=True):
        assert lane["lane"] == entry["lane"]
        raw = entry.get("racer_id")
        assert lane["racerId"] == (raw if (raw or 0) > 0 else None)
        assert lane["placeholderSlot"] == (abs(raw) if (raw or 0) < 0 else None)
        expected = entry.get("time")
        assert lane["time"] == (float(expected) if expected is not None else None)
        assert lane["place"] == entry.get("place")
        assert lane["skipped"] == bool(entry.get("skipped"))


def test_free_race_lanes_merge_the_schedule_and_the_results(client, db, race, racers):
    """A lane that has not run still reports who is in it: a free heat holds
    its schedule in the same place an official one does (#6)."""
    heat = crud.create_free_race_heat(
        db,
        race.id,
        [
            {"lane": 1, "racer_id": racers[0].id},
            {"lane": 2, "racer_id": racers[1].id},
        ],
    )
    # Recording replaces the lanes wholesale, as it does for an official heat —
    # so a caller sends every lane, including the ones with no time. Before #6
    # the schedule lived in its own column and survived a partial write; it does
    # not now, and the timer and the UI both send the full set.
    crud.update_free_race_heat_result(
        db,
        heat.id,
        [
            {"lane": 1, "racer_id": racers[0].id, "time": 3.2, "place": 1},
            {"lane": 2, "racer_id": racers[1].id, "time": None, "place": None},
        ],
    )
    db.commit()

    lanes = _run(client, FREE_LANES_QUERY, race.id)["freeRaceHeats"][0]["lanes"]
    assert [lane["racerId"] for lane in lanes] == [racers[0].id, racers[1].id]
    assert [lane["time"] for lane in lanes] == [3.2, None]


def test_an_official_and_a_free_heat_can_no_longer_share_an_id(
    client, db, race, racers
):
    """The collision that caused #4 is now structurally impossible: one table,
    one sequence."""
    official = _heat(db, race, [{"lane": 1, "racer_id": racers[0].id, "time": 9.9}])
    free = crud.create_free_race_heat(
        db, race.id, [{"lane": 1, "racer_id": racers[1].id}]
    )
    db.commit()
    assert official.id != free.id

    official_lanes = _run(client, LANES_QUERY, race.id)["race"]["heats"][0]["lanes"]
    free_lanes = _run(client, FREE_LANES_QUERY, race.id)["freeRaceHeats"][0]["lanes"]

    assert official_lanes[0]["racerId"] == racers[0].id
    assert official_lanes[0]["time"] == 9.9
    assert free_lanes[0]["racerId"] == racers[1].id
    assert free_lanes[0]["time"] is None
