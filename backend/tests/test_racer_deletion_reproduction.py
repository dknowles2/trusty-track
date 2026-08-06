import json
import uuid

from backend.db import crud, models, schemas
from backend.tests.helpers import as_lanes


def _setup_race_with_heats(db, num_racers=3):
    """Setup a race with multiple racers and rounds."""
    suffix = str(uuid.uuid4())[:8]
    group = crud.create_group(db, schemas.GroupCreate(name=f"Regen Group {suffix}"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"Regen Track {suffix}", lane_count=4)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Regen Race {suffix}", group_id=group.id, track_id=track.id
        ),
    )

    racers = []
    for i in range(num_racers):
        r = crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer {i}",
                last_name=suffix,
                car_number=100 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        racers.append(r)

    # Create regular round (unstarted)
    round_unstarted = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.PPC, "Unstarted Round"
    )
    crud.generate_heats_for_round(db, round_unstarted.id)

    # Create regular round (started)
    round_started = crud.create_round(
        db, race.id, 2, models.SchedulingStrategy.PPC, "Started Round"
    )
    crud.generate_heats_for_round(db, round_started.id)
    heat_started = (
        db.query(models.Heat).filter(models.Heat.round_id == round_started.id).first()
    )
    # Record a result for the first heat
    results_json = json.dumps(
        [{"lane": 1, "racer_id": racers[0].id, "time": 3.0, "place": 1}]
    )
    crud.record_heat_result(db, heat_started.id, results_json)

    # Create free race heat
    free_heat = crud.create_free_race_heat(
        db,
        race.id,
        as_lanes(
            [
                {"lane": 1, "racer_id": racers[0].id},
                {"lane": 2, "racer_id": racers[1].id},
            ]
        ),
    )

    db.commit()
    return race.id, racers, round_unstarted.id, round_started.id, free_heat.id


def test_delete_racer_regenerates_unstarted_round(db):
    # With 3 racers and 4 lanes, PPC should generate 3 heats (12 slots, 12 assignments)
    race_id, racers, unstarted_id, started_id, free_id = _setup_race_with_heats(
        db, num_racers=3
    )
    r1_id = racers[0].id

    # Initial check
    initial_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == unstarted_id).all()
    )
    assert len(initial_heats) == 3

    # Delete Racer 0
    crud.delete_racer(db, r1_id)
    db.commit()

    # Unstarted round should be REGENERATED
    # Now only 2 racers left. 2 racers * 4 lanes = 8 slots = 2 heats.
    heats_unstarted = (
        db.query(models.Heat).filter(models.Heat.round_id == unstarted_id).all()
    )
    assert len(heats_unstarted) == 2, "Should have regenerated to 2 heats"

    alice_found = False
    for h in heats_unstarted:
        results = json.loads(h.lane_results)
        for lane in results:
            if lane.get("racer_id") == r1_id:
                alice_found = True

    assert not alice_found, "Deleted racer should be gone from regenerated heats"


def test_delete_racer_nullifies_started_round(db):
    race_id, racers, unstarted_id, started_id, free_id = _setup_race_with_heats(
        db, num_racers=3
    )
    r1_id = racers[0].id

    # Initial check
    initial_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == started_id).all()
    )
    assert len(initial_heats) == 3

    # Delete Racer 0
    crud.delete_racer(db, r1_id)
    db.commit()

    # Started round should be NULLIFIED (leave hole), NOT regenerated
    heats_started = (
        db.query(models.Heat).filter(models.Heat.round_id == started_id).all()
    )
    assert len(heats_started) == 3, "Started round should NOT be regenerated"

    alice_found = False
    hole_found = False
    for h in heats_started:
        results = json.loads(h.lane_results)
        for lane in results:
            if lane.get("racer_id") == r1_id:
                alice_found = True
            if lane.get("racer_id") is None:
                hole_found = True

    assert not alice_found, "Deleted racer should be removed"
    assert hole_found, "Hole should be left in started round"


def test_delete_racer_nullifies_free_heat(db):
    race_id, racers, unstarted_id, started_id, free_id = _setup_race_with_heats(
        db, num_racers=3
    )
    r1_id = racers[0].id

    # Delete Racer 0
    crud.delete_racer(db, r1_id)
    db.commit()

    # Free heat should be nullified
    free_heat = db.query(models.Heat).filter(models.Heat.id == free_id).first()
    assignments = json.loads(free_heat.lane_results)
    assert assignments[0]["racer_id"] is None, (
        "Deleted racer should be nullified in free heat"
    )
