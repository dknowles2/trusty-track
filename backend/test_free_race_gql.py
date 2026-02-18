import json

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .main import app

client = TestClient(app)


def _create_race_with_track(db: Session) -> tuple[int, int]:
    """Returns (race_id, track_id)."""
    db.query(models.Group).delete()
    db.query(models.Track).delete()
    db.commit()

    group = crud.create_group(db, schemas.GroupCreate(name="GQL Test Group"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="GQL Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="GQL Race",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )
    return race.id, track.id


def _add_checked_in_racer(db: Session, race_id: int, first: str, last: str) -> int:
    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=first,
            last_name=last,
            race_id=race_id,
            car_passed_inspection=True,
        ),
    )
    assert racer is not None
    return racer.id


def test_random_free_race_lanes_query(db: Session):
    race_id, _ = _create_race_with_track(db)
    for i in range(4):
        _add_checked_in_racer(db, race_id, f"Racer{i}", "Test")

    query = """
    query($raceId: Int!) {
        randomFreeRaceLanes(raceId: $raceId) {
            lane
            racerId
        }
    }
    """
    resp = client.post(
        "/graphql", json={"query": query, "variables": {"raceId": race_id}}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "errors" not in data, data.get("errors")
    lanes = data["data"]["randomFreeRaceLanes"]
    assert len(lanes) == 4
    lane_numbers = [lane["lane"] for lane in lanes]
    assert sorted(lane_numbers) == [1, 2, 3, 4]


def test_start_free_race_heat_mutation(db: Session):
    race_id, _ = _create_race_with_track(db)
    r1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")
    r2 = _add_checked_in_racer(db, race_id, "Bob", "Jones")

    mutation = """
    mutation($raceId: Int!, $laneAssignments: [FreeRaceLaneAssignmentInput!]!) {
        startFreeRaceHeat(raceId: $raceId, laneAssignments: $laneAssignments) {
            id
            raceId
            laneAssignments
            laneResults
            createdAt
        }
    }
    """
    variables = {
        "raceId": race_id,
        "laneAssignments": [
            {"lane": 1, "racerId": r1},
            {"lane": 2, "racerId": r2},
            {"lane": 3, "racerId": None},
            {"lane": 4, "racerId": None},
        ],
    }
    resp = client.post("/graphql", json={"query": mutation, "variables": variables})
    assert resp.status_code == 200
    data = resp.json()
    assert "errors" not in data, data.get("errors")
    heat = data["data"]["startFreeRaceHeat"]
    assert heat["id"] is not None
    assert heat["raceId"] == race_id
    assert heat["laneResults"] is None
    parsed = json.loads(heat["laneAssignments"])
    assert len(parsed) == 4


def test_record_free_race_result_mutation(db: Session):
    race_id, _ = _create_race_with_track(db)
    r1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")

    # First create a heat
    heat = crud.create_free_race_heat(
        db, race_id, [{"lane": 1, "racer_id": r1}, {"lane": 2, "racer_id": None}]
    )

    results = json.dumps(
        [
            {"lane": 1, "racer_id": r1, "time": 3.1415, "place": 1},
            {"lane": 2, "racer_id": None, "time": None, "place": None},
        ]
    )

    mutation = """
    mutation($heatId: Int!, $results: String!) {
        recordFreeRaceResult(heatId: $heatId, results: $results) {
            id
            laneResults
        }
    }
    """
    resp = client.post(
        "/graphql",
        json={"query": mutation, "variables": {"heatId": heat.id, "results": results}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "errors" not in data, data.get("errors")
    updated = data["data"]["recordFreeRaceResult"]
    assert updated["id"] == heat.id
    parsed = json.loads(updated["laneResults"])
    assert parsed[0]["time"] == 3.1415
    assert parsed[0]["place"] == 1


def test_record_free_race_result_invalid_heat_id(db: Session):
    _create_race_with_track(db)

    mutation = """
    mutation($heatId: Int!, $results: String!) {
        recordFreeRaceResult(heatId: $heatId, results: $results) {
            id
        }
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation,
            "variables": {"heatId": 9999, "results": "[]"},
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["recordFreeRaceResult"] is None


def test_free_race_heats_query_newest_first(db: Session):
    race_id, _ = _create_race_with_track(db)
    crud.create_free_race_heat(db, race_id, [{"lane": 1, "racer_id": None}])
    crud.create_free_race_heat(db, race_id, [{"lane": 1, "racer_id": None}])
    crud.create_free_race_heat(db, race_id, [{"lane": 1, "racer_id": None}])

    query = """
    query($raceId: Int!) {
        freeRaceHeats(raceId: $raceId) {
            id
            raceId
        }
    }
    """
    resp = client.post(
        "/graphql", json={"query": query, "variables": {"raceId": race_id}}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "errors" not in data, data.get("errors")
    heats = data["data"]["freeRaceHeats"]
    assert len(heats) == 3
    # Newest first
    assert heats[0]["id"] > heats[1]["id"] > heats[2]["id"]
    for h in heats:
        assert h["raceId"] == race_id


def test_active_free_race_heat_returns_running_heat(db: Session):
    race_id, _ = _create_race_with_track(db)
    heat = crud.create_free_race_heat(db, race_id, [{"lane": 1, "racer_id": None}])

    query = """
    query($raceId: Int!) {
        activeFreeRaceHeat(raceId: $raceId) {
            id
            laneResults
        }
    }
    """
    resp = client.post(
        "/graphql", json={"query": query, "variables": {"raceId": race_id}}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "errors" not in data, data.get("errors")
    active = data["data"]["activeFreeRaceHeat"]
    assert active is not None
    assert active["id"] == heat.id
    assert active["laneResults"] is None


def test_active_free_race_heat_returns_none_when_completed(db: Session):
    race_id, _ = _create_race_with_track(db)
    heat = crud.create_free_race_heat(db, race_id, [{"lane": 1, "racer_id": None}])
    crud.update_free_race_heat_result(
        db, heat.id, [{"lane": 1, "racer_id": None, "time": None, "place": None}]
    )

    query = """
    query($raceId: Int!) {
        activeFreeRaceHeat(raceId: $raceId) {
            id
        }
    }
    """
    resp = client.post(
        "/graphql", json={"query": query, "variables": {"raceId": race_id}}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["activeFreeRaceHeat"] is None
