import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.main import app
from backend.api.pubsub import _PubSub
from backend.db import crud, models, schemas
from backend.tests.helpers import RECORD_FREE_RACE_RESULT, as_lanes, lane_input

client = TestClient(app)


def _create_race_with_track(db: Session) -> tuple[int, int]:
    """Returns (race_id, track_id)."""
    db.query(models.Organization).delete()
    db.query(models.Track).delete()
    db.commit()

    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="GQL Test Organization")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name="GQL Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="GQL Race",
            organization_id=group.id,
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


def test_random_free_race_lanes_query_excludes_lanes_out_of_service(db: Session):
    """#303: the draw must not put a car in a lane whose sensor is dead."""
    race_id, track_id = _create_race_with_track(db)
    for i in range(4):
        _add_checked_in_racer(db, race_id, f"Racer{i}", "Test")
    crud.set_lane_outages(db, track_id, [3])

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
    lane_numbers = sorted(lane["lane"] for lane in lanes)
    assert lane_numbers == [1, 2, 4]


def test_random_free_race_lanes_query_enabled_lanes_narrows_the_draw(db: Session):
    """The Free Race screen's per-lane toggle is session-only and lives on
    the client (#303) — this is how a temporarily disabled lane reaches the
    preview draw without ever being written anywhere."""
    race_id, track_id = _create_race_with_track(db)
    for i in range(4):
        _add_checked_in_racer(db, race_id, f"Racer{i}", "Test")

    query = """
    query($raceId: Int!, $enabledLanes: [Int!]) {
        randomFreeRaceLanes(raceId: $raceId, enabledLanes: $enabledLanes) {
            lane
            racerId
        }
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": query,
            "variables": {"raceId": race_id, "enabledLanes": [1, 2]},
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "errors" not in data, data.get("errors")
    lane_numbers = sorted(lane["lane"] for lane in data["data"]["randomFreeRaceLanes"])
    assert lane_numbers == [1, 2]

    # A lane out of service named in `enabledLanes` is still refused — the
    # client's list is narrowed against the server's own idea of usable,
    # never trusted outright.
    crud.set_lane_outages(db, track_id, [2])
    resp = client.post(
        "/graphql",
        json={
            "query": query,
            "variables": {"raceId": race_id, "enabledLanes": [1, 2]},
        },
    )
    lane_numbers = sorted(
        lane["lane"] for lane in resp.json()["data"]["randomFreeRaceLanes"]
    )
    assert lane_numbers == [1]


def test_random_free_race_lanes_query_excludes_not_checked_in_racers(db: Session):
    race_id, _ = _create_race_with_track(db)
    # Add one checked-in and one NOT checked-in racer
    _add_checked_in_racer(db, race_id, "Alice", "CheckedIn")
    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Bob",
            last_name="NotCheckedIn",
            race_id=race_id,
            car_passed_inspection=False,
        ),
    )

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
    lanes = data["data"]["randomFreeRaceLanes"]
    # Should find ONLY the checked-in racer
    racer_ids = [lane["racerId"] for lane in lanes if lane["racerId"] is not None]
    assert len(racer_ids) == 1


def test_start_free_race_heat_mutation(db: Session):
    race_id, _ = _create_race_with_track(db)
    r1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")
    r2 = _add_checked_in_racer(db, race_id, "Bob", "Jones")

    mutation = """
    mutation($raceId: Int!, $laneAssignments: [FreeRaceLaneAssignmentInput!]!) {
        startFreeRaceHeat(raceId: $raceId, laneAssignments: $laneAssignments) {
            id
            raceId
            recorded
            createdAt
            lanes { lane racerId time }
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
    assert heat["recorded"] is False
    assert len(heat["lanes"]) == 4
    assert all(lane["time"] is None for lane in heat["lanes"])


@pytest.mark.anyio
async def test_start_free_race_heat_publishes_to_active_free_race_heat_subscription(
    db: Session,
):
    """#317: `startFreeRaceHeat` published nothing, so `activeFreeRaceHeat` —
    what the observation display watches — only ever learned about a run once
    its *result* landed, missing the moment the crowd is actually watching."""
    import backend.api.schema as schema_mod
    from backend.api.schema import FreeRaceLaneAssignmentInput, Mutation, Subscription

    race_id, _ = _create_race_with_track(db)
    r1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")

    local_pubsub = _PubSub()
    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    class MockInfo:
        context = {"db": db}

    collected = []

    async def _sub():
        async for result in Subscription().active_free_race_heat(MockInfo(), race_id):
            collected.append(result)
            if len(collected) == 2:
                break

    async def _trigger():
        await asyncio.sleep(0.1)
        await Mutation().start_free_race_heat(
            MockInfo(),
            race_id,
            [FreeRaceLaneAssignmentInput(lane=1, racer_id=r1)],
        )

    try:
        await asyncio.wait_for(asyncio.gather(_sub(), _trigger()), timeout=2.0)
    finally:
        schema_mod.pubsub = original_pubsub

    assert len(collected) == 2
    # Nothing running before the mutation...
    assert collected[0] is None
    # ...and the heat the mutation just created is what the subscription
    # wakes up with, without waiting for a result to be recorded.
    assert collected[1] is not None
    assert collected[1].race_id == race_id
    assert not any(lane.time for lane in crud.heat_lanes_of(db, collected[1]))


def test_record_free_race_result_mutation(db: Session):
    race_id, _ = _create_race_with_track(db)
    r1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")

    # First create a heat
    heat = crud.create_free_race_heat(
        db,
        race_id,
        as_lanes([{"lane": 1, "racer_id": r1}, {"lane": 2, "racer_id": None}]),
    )

    lanes = [
        lane_input({"lane": 1, "racer_id": r1, "time": 3.1415, "place": 1}),
        lane_input({"lane": 2, "racer_id": None, "time": None, "place": None}),
    ]

    resp = client.post(
        "/graphql",
        json={
            "query": RECORD_FREE_RACE_RESULT,
            "variables": {"heatId": heat.id, "lanes": lanes},
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "errors" not in data, data.get("errors")
    updated = data["data"]["recordFreeRaceResult"]
    assert updated["id"] == heat.id
    assert updated["recorded"] is True
    assert updated["lanes"][0]["time"] == 3.1415
    assert updated["lanes"][0]["place"] == 1


def test_record_free_race_result_invalid_heat_id(db: Session):
    _create_race_with_track(db)

    resp = client.post(
        "/graphql",
        json={
            "query": RECORD_FREE_RACE_RESULT,
            "variables": {"heatId": 9999, "lanes": []},
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["recordFreeRaceResult"] is None


def test_free_race_heats_query_newest_first(db: Session):
    race_id, _ = _create_race_with_track(db)
    crud.create_free_race_heat(db, race_id, as_lanes([{"lane": 1, "racer_id": None}]))
    crud.create_free_race_heat(db, race_id, as_lanes([{"lane": 1, "racer_id": None}]))
    crud.create_free_race_heat(db, race_id, as_lanes([{"lane": 1, "racer_id": None}]))

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
    heat = crud.create_free_race_heat(
        db, race_id, as_lanes([{"lane": 1, "racer_id": None}])
    )

    query = """
    query($raceId: Int!) {
        activeFreeRaceHeat(raceId: $raceId) {
            id
            recorded
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
    assert active["recorded"] is False


def test_prepare_heat_is_free_race_flag(db: Session):
    # Use GQL to create track so TimerManager is initialized
    track_resp = client.post(
        "/graphql",
        json={
            "query": 'mutation { createTrack(track: {name: "Test Track", '
            'laneCount: 4, timerType: "FAKE"}) { id } }'
        },
    )
    track_id = track_resp.json()["data"]["createTrack"]["id"]

    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="Test Organization")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Test Race",
            organization_id=group.id,
            track_id=track_id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )

    # Force creation of a FreeRaceHeat
    free_heat = crud.create_free_race_heat(
        db, race.id, as_lanes([{"lane": 1, "racer_id": None}])
    )

    # Try to prepare it as a free race
    mutation = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        prepareHeat(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["prepareHeat"] is True

    # Start it
    mutation_start = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        fakeTimerStart(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation_start,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.json()["data"]["fakeTimerStart"] is True

    # Finish it
    mutation_finish = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        fakeTimerFinish(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation_finish,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.json()["data"]["fakeTimerFinish"] is True


def test_prepare_heat_anonymous_free_heat_arms_only_the_lanes_it_holds(db: Session):
    """#303: an anonymous heat's own rows already exclude a lane out of
    service — the fallback used to re-derive the mask from `track.lane_count`
    and arm it anyway. Without the fix this test fails: the mask comes out
    as every lane on the 4-lane track (0b1111) rather than just lanes 1, 2
    and 4 (0b1011)."""
    from backend.api.main import TIMER_MANAGERS

    track_resp = client.post(
        "/graphql",
        json={
            "query": 'mutation { createTrack(track: {name: "Outage Prepare Track", '
            'laneCount: 4, timerType: "FAKE"}) { id } }'
        },
    )
    track_id = track_resp.json()["data"]["createTrack"]["id"]
    crud.set_lane_outages(db, track_id, [3])

    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="Outage Prepare Organization")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Outage Prepare Race",
            organization_id=group.id,
            track_id=track_id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )

    # Mirrors what the Free Race screen now sends for an anonymous heat:
    # one unnamed lane per usable lane, lane 3 simply absent.
    free_heat = crud.create_free_race_heat(
        db,
        race.id,
        as_lanes(
            [
                {"lane": 1, "racer_id": None},
                {"lane": 2, "racer_id": None},
                {"lane": 4, "racer_id": None},
            ]
        ),
    )

    mutation = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        prepareHeat(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.json()["data"]["prepareHeat"] is True

    mgr = TIMER_MANAGERS[track_id]
    assert mgr._lane_mask == 0b1011  # lanes 1, 2, 4 — never lane 3


def test_prepare_heat_anonymous_free_heat_with_no_stored_lanes_falls_back_to_usable(
    db: Session,
):
    """A free heat that somehow holds no rows at all still must not arm a
    lane out of service."""
    from backend.api.main import TIMER_MANAGERS

    track_resp = client.post(
        "/graphql",
        json={
            "query": 'mutation { createTrack(track: {name: "Outage Empty Track", '
            'laneCount: 4, timerType: "FAKE"}) { id } }'
        },
    )
    track_id = track_resp.json()["data"]["createTrack"]["id"]
    crud.set_lane_outages(db, track_id, [3])

    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="Outage Empty Organization")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Outage Empty Race",
            organization_id=group.id,
            track_id=track_id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )
    free_heat = crud.create_free_race_heat(db, race.id, as_lanes([]))

    mutation = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        prepareHeat(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.json()["data"]["prepareHeat"] is True

    mgr = TIMER_MANAGERS[track_id]
    assert mgr._lane_mask == 0b1011  # lanes 1, 2, 4 — never lane 3


def test_fake_timer_finish_anonymous_free_heat_respects_lane_outages(
    db: Session, monkeypatch
):
    """#303: the matching fallback in fake_timer_finish must not invent a
    time for a lane nothing ran in. Without the fix, `occupied` is built
    from `range(1, track.lane_count + 1)` and lane 3 is included."""
    from backend.api import schema as schema_module
    from backend.api.main import TIMER_MANAGERS

    captured: dict[str, list[int]] = {}
    original_lane_times = schema_module.fake_timer.lane_times

    def spy(lanes, *, key):
        captured["lanes"] = list(lanes)
        return original_lane_times(lanes, key=key)

    monkeypatch.setattr(schema_module.fake_timer, "lane_times", spy)

    track_resp = client.post(
        "/graphql",
        json={
            "query": 'mutation { createTrack(track: {name: "Outage Finish Track", '
            'laneCount: 4, timerType: "FAKE"}) { id } }'
        },
    )
    track_id = track_resp.json()["data"]["createTrack"]["id"]
    crud.set_lane_outages(db, track_id, [3])

    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="Outage Finish Organization")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Outage Finish Race",
            organization_id=group.id,
            track_id=track_id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )
    free_heat = crud.create_free_race_heat(
        db,
        race.id,
        as_lanes(
            [
                {"lane": 1, "racer_id": None},
                {"lane": 2, "racer_id": None},
                {"lane": 4, "racer_id": None},
            ]
        ),
    )
    assert TIMER_MANAGERS[track_id]  # sanity: the manager exists

    mutation = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        prepareHeat(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.json()["data"]["prepareHeat"] is True

    mutation_start = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        fakeTimerStart(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation_start,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.json()["data"]["fakeTimerStart"] is True

    mutation_finish = """
    mutation($heatId: Int!, $isFreeRace: Boolean!) {
        fakeTimerFinish(heatId: $heatId, isFreeRace: $isFreeRace)
    }
    """
    resp = client.post(
        "/graphql",
        json={
            "query": mutation_finish,
            "variables": {"heatId": free_heat.id, "isFreeRace": True},
        },
    )
    assert resp.json()["data"]["fakeTimerFinish"] is True

    assert sorted(captured["lanes"]) == [1, 2, 4]


DELETE_FREE_RACE_HEAT = """
mutation($heatId: Int!) {
    deleteFreeRaceHeat(heatId: $heatId)
}
"""


def test_delete_free_race_heat_that_has_not_run(db: Session):
    """Found in a coverage audit: the mutation was classified in the role
    policy and never exercised anywhere."""
    race_id, _ = _create_race_with_track(db)
    r1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")
    heat = crud.create_free_race_heat(
        db, race_id, as_lanes([{"lane": 1, "racer_id": r1}])
    )

    resp = client.post(
        "/graphql",
        json={"query": DELETE_FREE_RACE_HEAT, "variables": {"heatId": heat.id}},
    )
    assert resp.json()["data"]["deleteFreeRaceHeat"] is True
    db.expire_all()
    assert db.query(models.Heat).filter(models.Heat.id == heat.id).first() is None


def test_delete_free_race_heat_refuses_a_recorded_one(db: Session):
    """An exhibition run is still a result somebody produced; deleting it is
    refused the same way an official heat's would be."""
    race_id, _ = _create_race_with_track(db)
    r1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")
    heat = crud.create_free_race_heat(
        db, race_id, as_lanes([{"lane": 1, "racer_id": r1, "time": 3.2, "place": 1}])
    )

    resp = client.post(
        "/graphql",
        json={"query": DELETE_FREE_RACE_HEAT, "variables": {"heatId": heat.id}},
    )
    # The refusal is a False, not an error: the schema treats "could not" as
    # an answer, and the heat must still be there afterwards.
    assert resp.json()["data"]["deleteFreeRaceHeat"] is False
    db.expire_all()
    assert db.query(models.Heat).filter(models.Heat.id == heat.id).first() is not None


def test_delete_free_race_heat_that_does_not_exist(db: Session):
    _create_race_with_track(db)
    resp = client.post(
        "/graphql",
        json={"query": DELETE_FREE_RACE_HEAT, "variables": {"heatId": 99999}},
    )
    assert resp.json()["data"]["deleteFreeRaceHeat"] is False
