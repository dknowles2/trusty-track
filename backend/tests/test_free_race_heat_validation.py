"""`startFreeRaceHeat` validates nothing `randomFreeRaceLanes` enforces (#882).

`Query.randomFreeRaceLanes` narrows its draw to `crud.usable_lanes_for_race`
and to checked-in racers of the race being asked about; `Mutation.start_free_race_heat`
→ `crud.create_free_race_heat` persists whatever it is handed, checking
neither lane usability nor race membership nor distinctness. A racer from
another race makes the heat permanently unrecordable (`recordFreeRaceResult`
refuses it through `validate_lane_replacement`), a lane out of service or
past the track arms a device channel nothing is wired to, and the same racer
twice makes no sense to time.

These tests pin the refusals `crud.create_free_race_heat` should make, and
that nothing is written when it refuses.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.main import app
from backend.db import crud, models, schemas

client = TestClient(app)

START_FREE_RACE_HEAT = """
mutation($raceId: Int!, $laneAssignments: [FreeRaceLaneAssignmentInput!]!) {
    startFreeRaceHeat(raceId: $raceId, laneAssignments: $laneAssignments) {
        id
    }
}
"""


_counter = 0


def _build_race(db: Session, *, lane_count=4):
    global _counter
    _counter += 1
    org = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Pack 882 #{_counter}")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Free Race Track {_counter}", lane_count=lane_count),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Free Race 882 #{_counter}",
            organization_id=org.id,
            track_id=track.id,
        ),
    )
    return track, race


def _checked_in_racer(db: Session, race_id: int, number: int, *, passed=True):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=f"Racer{number}",
            last_name="Test",
            car_number=number,
            race_id=race_id,
            car_passed_inspection=passed,
        ),
    )


def _existing_free_heat_count(db: Session, race_id: int) -> int:
    return (
        db.query(models.Heat)
        .filter(
            models.Heat.race_id == race_id,
            models.Heat.kind == models.HeatKind.FREE,
        )
        .count()
    )


def _start(race_id, lane_assignments):
    resp = client.post(
        "/graphql",
        json={
            "query": START_FREE_RACE_HEAT,
            "variables": {"raceId": race_id, "laneAssignments": lane_assignments},
        },
    )
    assert resp.status_code == 200
    return resp.json()


def test_a_racer_from_another_race_is_refused(db: Session):
    track, race = _build_race(db)
    _checked_in_racer(db, race.id, 1)
    other_track, other_race = _build_race(db)
    intruder = _checked_in_racer(db, other_race.id, 2)

    body = _start(race.id, [{"lane": 1, "racerId": intruder.id}])

    assert "errors" in body, body
    assert str(intruder.id) in body["errors"][0]["message"]
    assert _existing_free_heat_count(db, race.id) == 0


def test_a_lane_out_of_service_is_refused(db: Session):
    track, race = _build_race(db, lane_count=4)
    racer = _checked_in_racer(db, race.id, 1)
    crud.set_lane_outages(db, track.id, [2])

    body = _start(race.id, [{"lane": 2, "racerId": racer.id}])

    assert "errors" in body, body
    assert "2" in body["errors"][0]["message"]
    assert _existing_free_heat_count(db, race.id) == 0


def test_a_lane_past_the_track_is_refused(db: Session):
    track, race = _build_race(db, lane_count=4)
    racer = _checked_in_racer(db, race.id, 1)

    body = _start(race.id, [{"lane": 99, "racerId": racer.id}])

    assert "errors" in body, body
    assert "99" in body["errors"][0]["message"]
    assert _existing_free_heat_count(db, race.id) == 0


def test_the_same_racer_in_two_lanes_is_refused(db: Session):
    track, race = _build_race(db, lane_count=4)
    racer = _checked_in_racer(db, race.id, 1)

    body = _start(
        race.id,
        [
            {"lane": 1, "racerId": racer.id},
            {"lane": 2, "racerId": racer.id},
        ],
    )

    assert "errors" in body, body
    assert _existing_free_heat_count(db, race.id) == 0


def test_a_racer_who_has_not_passed_inspection_is_refused(db: Session):
    track, race = _build_race(db, lane_count=4)
    not_checked_in = _checked_in_racer(db, race.id, 1, passed=False)

    body = _start(race.id, [{"lane": 1, "racerId": not_checked_in.id}])

    assert "errors" in body, body
    assert _existing_free_heat_count(db, race.id) == 0


def test_an_unknown_race_id_returns_a_sentence_not_a_raw_db_error(db: Session):
    before = db.query(models.Heat).count()

    body = _start(999999, [{"lane": 1, "racerId": None}])

    assert "errors" in body, body
    message = body["errors"][0]["message"]
    assert "IntegrityError" not in message
    assert "INSERT" not in message
    assert db.query(models.Heat).count() == before


def test_a_valid_draw_still_succeeds(db: Session):
    track, race = _build_race(db, lane_count=4)
    r1 = _checked_in_racer(db, race.id, 1)
    r2 = _checked_in_racer(db, race.id, 2)

    body = _start(
        race.id,
        [
            {"lane": 1, "racerId": r1.id},
            {"lane": 2, "racerId": r2.id},
            {"lane": 3, "racerId": None},
            {"lane": 4, "racerId": None},
        ],
    )

    assert "errors" not in body, body.get("errors")
    assert body["data"]["startFreeRaceHeat"]["id"] is not None
