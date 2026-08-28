"""Pins ``crud._participant_ids_for_round``, extracted from
``generate_heats_for_round`` by #435 so the top level reads as its five
actual steps.

The extraction was meant to change nothing about behavior, so these mostly
restate what ``generate_heats_for_round`` already guaranteed — except they
call the participant-selection step directly rather than through a full
round-generation call, which is the point: before the extraction there was no
such call to make.
"""

import pytest

from backend.db import crud, models, schemas
from backend.domain import lanes


def create_test_race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Participant Group"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Participant Track", lane_count=4)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Participant Race", group_id=group.id, track_id=track.id
        ),
    )
    return race.id


def make_racer(db, race_id, *, den_id=None, passed=True, car_number=1):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=f"Racer{car_number}",
            last_name="Test",
            car_number=car_number,
            race_id=race_id,
            den_id=den_id,
            car_passed_inspection=passed,
        ),
    )


def test_placeholders_win_over_everything_else(db):
    race_id = create_test_race(db)
    make_racer(db, race_id, car_number=1)
    round_obj = crud.create_round(db, race_id, round_number=1)

    p_ids = crud._participant_ids_for_round(
        db, round_obj, num_placeholders=3, racer_ids=[999]
    )

    assert p_ids == [-1, -2, -3]


def test_explicit_racer_ids_are_used_verbatim(db):
    race_id = create_test_race(db)
    round_obj = crud.create_round(db, race_id, round_number=1)

    p_ids = crud._participant_ids_for_round(
        db, round_obj, num_placeholders=0, racer_ids=[7, 3, 9]
    )

    assert p_ids == [7, 3, 9]


def test_championship_round_falls_back_to_placeholders_with_no_field_yet(db):
    race_id = create_test_race(db)
    round_obj = crud.create_round(
        db,
        race_id,
        round_number=2,
        advancement_source="PACK",
        advancement_num_racers=4,
    )

    p_ids = crud._participant_ids_for_round(
        db, round_obj, num_placeholders=0, racer_ids=None
    )

    assert p_ids == [-1, -2, -3, -4]


def test_championship_round_reads_its_already_advanced_field(db):
    race_id = create_test_race(db)
    r1 = make_racer(db, race_id, car_number=1)
    r2 = make_racer(db, race_id, car_number=2)
    round_obj = crud.create_round(
        db,
        race_id,
        round_number=2,
        advancement_source="PACK",
        advancement_num_racers=2,
    )
    heat = models.Heat(race_id=race_id, round_id=round_obj.id, heat_number=1)
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(
        heat,
        [
            lanes.Lane(lane=1, racer_id=r2.id),
            lanes.Lane(lane=2, racer_id=r1.id),
        ],
    )
    db.commit()
    db.refresh(round_obj)

    p_ids = crud._participant_ids_for_round(
        db, round_obj, num_placeholders=0, racer_ids=None
    )

    # Sorted, not lane order — set iteration order is not a promise.
    assert p_ids == sorted([r1.id, r2.id])


def test_general_round_uses_the_checked_in_roster(db):
    race_id = create_test_race(db)
    r1 = make_racer(db, race_id, passed=True, car_number=1)
    make_racer(db, race_id, passed=False, car_number=2)
    r3 = make_racer(db, race_id, passed=True, car_number=3)
    round_obj = crud.create_round(db, race_id, round_number=1)

    p_ids = crud._participant_ids_for_round(
        db, round_obj, num_placeholders=0, racer_ids=None
    )

    # Only the inspected racers, ordered by id.
    assert p_ids == sorted([r1.id, r3.id])


def test_general_round_scoped_to_a_den(db):
    race_id = create_test_race(db)
    den_a = crud.create_den(db, schemas.DenCreate(name="Wolves"), race_id=race_id)
    den_b = crud.create_den(db, schemas.DenCreate(name="Bears"), race_id=race_id)
    a1 = make_racer(db, race_id, den_id=den_a.id, car_number=1)
    a2 = make_racer(db, race_id, den_id=den_a.id, car_number=2)
    make_racer(db, race_id, den_id=den_b.id, car_number=3)
    round_obj = crud.create_round(db, race_id, round_number=1, den_id=den_a.id)

    p_ids = crud._participant_ids_for_round(
        db, round_obj, num_placeholders=0, racer_ids=None
    )

    assert sorted(p_ids) == sorted([a1.id, a2.id])


def test_general_round_refuses_fewer_than_two_racers(db):
    race_id = create_test_race(db)
    make_racer(db, race_id, car_number=1)
    round_obj = crud.create_round(db, race_id, round_number=1)

    with pytest.raises(ValueError, match="(?i)not enough racers"):
        crud._participant_ids_for_round(
            db, round_obj, num_placeholders=0, racer_ids=None
        )
