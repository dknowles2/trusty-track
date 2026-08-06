import json

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.tests.helpers import as_lanes


def _create_race(db: Session) -> int:
    group = crud.create_group(db, schemas.GroupCreate(name="Test Group"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Test Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Test Race",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )
    return race.id


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


def test_create_free_race_heat(db: Session):
    race_id = _create_race(db)
    assignments = [
        {"lane": 1, "racer_id": 1},
        {"lane": 2, "racer_id": 2},
    ]
    heat = crud.create_free_race_heat(db, race_id, as_lanes(assignments))
    assert heat.id is not None
    assert heat.race_id == race_id
    # The schedule goes straight into `lane_results` with no times, exactly as
    # a generated official heat does (#6). "Has it run" is then one question
    # for both kinds.
    assert heat.kind is models.HeatKind.FREE
    assert heat.round_id is None
    parsed = json.loads(heat.lane_results)
    assert len(parsed) == 2
    assert parsed[0]["lane"] == 1
    assert parsed[0]["racer_id"] == 1


def test_update_free_race_heat_result(db: Session):
    race_id = _create_race(db)
    assignments = [{"lane": 1, "racer_id": 1}, {"lane": 2, "racer_id": 2}]
    heat = crud.create_free_race_heat(db, race_id, as_lanes(assignments))

    results = [
        {"lane": 1, "racer_id": 1, "time": 3.141, "place": 1},
        {"lane": 2, "racer_id": 2, "time": 3.500, "place": 2},
    ]
    updated = crud.update_free_race_heat_result(db, heat.id, as_lanes(results))
    assert updated is not None
    assert updated.id == heat.id
    parsed = json.loads(updated.lane_results)
    assert parsed[0]["time"] == 3.141
    assert parsed[0]["place"] == 1


def test_update_free_race_heat_result_invalid_id(db: Session):
    _create_race(db)
    result = crud.update_free_race_heat_result(db, 9999, as_lanes([]))
    assert result is None


def test_get_free_race_heats_newest_first(db: Session):
    race_id = _create_race(db)
    crud.create_free_race_heat(db, race_id, as_lanes([{"lane": 1, "racer_id": 1}]))
    crud.create_free_race_heat(db, race_id, as_lanes([{"lane": 1, "racer_id": 2}]))
    crud.create_free_race_heat(db, race_id, as_lanes([{"lane": 1, "racer_id": 3}]))

    heats = crud.get_free_race_heats(db, race_id)
    assert len(heats) == 3
    # Newest first: ID should be descending
    assert heats[0].id > heats[1].id > heats[2].id


def test_get_free_race_heats_limit(db: Session):
    race_id = _create_race(db)
    for i in range(5):
        crud.create_free_race_heat(
            db, race_id, as_lanes([{"lane": 1, "racer_id": i + 1}])
        )

    heats = crud.get_free_race_heats(db, race_id, limit=3)
    assert len(heats) == 3


def test_get_random_lane_assignments_with_enough_racers(db: Session):
    race_id = _create_race(db)
    for i in range(6):
        _add_checked_in_racer(db, race_id, f"Racer{i}", "Test")

    assignments = crud.get_random_lane_assignments(db, race_id, 4)
    assert len(assignments) == 4
    lanes = [a["lane"] for a in assignments]
    assert lanes == [1, 2, 3, 4]
    racer_ids = [a["racer_id"] for a in assignments]
    # All racer_ids should be non-None (we have 6 checked-in, need 4)
    assert all(rid is not None for rid in racer_ids)
    # No duplicates
    assert len(set(racer_ids)) == 4


def test_get_random_lane_assignments_pads_with_none(db: Session):
    race_id = _create_race(db)
    # Add only 2 checked-in racers but request 4 lanes
    _add_checked_in_racer(db, race_id, "Alice", "Smith")
    _add_checked_in_racer(db, race_id, "Bob", "Jones")

    assignments = crud.get_random_lane_assignments(db, race_id, 4)
    assert len(assignments) == 4
    non_none = [a["racer_id"] for a in assignments if a["racer_id"] is not None]
    assert len(non_none) == 2
    none_count = sum(1 for a in assignments if a["racer_id"] is None)
    assert none_count == 2


def test_get_random_lane_assignments_excludes_not_checked_in(db: Session):
    race_id = _create_race(db)
    # Add 2 checked-in and 3 not checked-in
    checked_id1 = _add_checked_in_racer(db, race_id, "Alice", "Smith")
    checked_id2 = _add_checked_in_racer(db, race_id, "Bob", "Jones")
    for i in range(3):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"NotIn{i}",
                last_name="Test",
                race_id=race_id,
                car_passed_inspection=False,
            ),
        )

    assignments = crud.get_random_lane_assignments(db, race_id, 4)
    non_none_ids = {a["racer_id"] for a in assignments if a["racer_id"] is not None}
    # Only the 2 checked-in racers should appear
    assert non_none_ids.issubset({checked_id1, checked_id2})
