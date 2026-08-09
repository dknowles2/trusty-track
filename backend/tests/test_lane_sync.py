"""How `heat_lanes` rows get written.

Issue #5, step two: migration 0003 backfilled the table, and this is what stops
it decaying from the first recorded result onward. #72 then turned it round —
the rows are built from the lane *values* a writer supplied — and finally
removed the other copy altogether.

Three tests went with it, and their absence is the point rather than an
oversight: one asserted the verifier caught the table and the blob disagreeing,
one that the rows followed the staged values rather than the string, and one
that a blob written without staging still projected. None can be written now.
There is one copy of a heat's lanes, so there is nothing to disagree with,
nothing to prefer, and no second way in.

What holds the property instead is earlier and narrower:
`test_heat_lanes_write.py` asserts `crud.set_heat_lanes` is the only writer,
across the whole backend package.
"""

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.tests.helpers import as_lanes, lane_dicts


def _race(db: Session) -> int:
    group = crud.create_group(db, schemas.GroupCreate(name="Pack 1"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )
    return race.id


def _racers(db: Session, race_id: int, count: int) -> list[int]:
    ids = []
    for i in range(count):
        racer = crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                race_id=race_id,
                car_passed_inspection=True,
            ),
        )
        ids.append(racer.id)
    return ids


def _lanes(db: Session, heat_id: int):
    return (
        db.query(models.HeatLane)
        .filter(models.HeatLane.heat_id == heat_id)
        .order_by(models.HeatLane.lane)
        .all()
    )


def _round_with_heats(db: Session, race_id: int, racer_count: int = 4):
    _racers(db, race_id, racer_count)
    round_obj = crud.create_round(db, race_id, round_number=1)
    crud.generate_heats_for_round(db, round_obj.id)
    db.commit()
    return round_obj


def test_generated_heats_arrive_with_their_lanes(db: Session):
    race_id = _race(db)
    round_obj = _round_with_heats(db, race_id)

    heats = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
    assert heats
    for heat in heats:
        assert len(_lanes(db, heat.id)) == len(lane_dicts(db, heat))


def test_recording_a_result_lands_in_the_table(db: Session):
    race_id = _race(db)
    round_obj = _round_with_heats(db, race_id)
    heat = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).first()

    blob = lane_dicts(db, heat)
    blob[0]["time"] = 3.421
    blob[0]["place"] = 1
    crud.record_heat_result(
        db, heat.id, as_lanes(blob), source=audit.ResultSource.OPERATOR
    )

    row = _lanes(db, heat.id)[0]
    assert row.time_seconds == 3.421
    assert row.place == 1


def test_clearing_a_result_clears_the_row(db: Session):
    """Operators re-run heats; a projection that only ever adds would be wrong."""
    race_id = _race(db)
    round_obj = _round_with_heats(db, race_id)
    heat = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).first()

    blob = lane_dicts(db, heat)
    blob[0]["time"] = 3.421
    crud.record_heat_result(
        db, heat.id, as_lanes(blob), source=audit.ResultSource.OPERATOR
    )
    assert _lanes(db, heat.id)[0].time_seconds == 3.421

    blob[0]["time"] = None
    crud.record_heat_result(
        db, heat.id, as_lanes(blob), source=audit.ResultSource.OPERATOR
    )
    assert _lanes(db, heat.id)[0].time_seconds is None


def test_the_skipped_flag_is_projected(db: Session):
    """Written only by the operator UI, and never read by the backend — which is
    exactly why a projection is liable to drop it."""
    race_id = _race(db)
    round_obj = _round_with_heats(db, race_id)
    heat = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).first()

    blob = lane_dicts(db, heat)
    for lane in blob:
        lane["skipped"] = True
    crud.record_heat_result(
        db, heat.id, as_lanes(blob), source=audit.ResultSource.OPERATOR
    )

    assert all(row.skipped for row in _lanes(db, heat.id))


def test_placeholders_become_slots_and_then_racers(db: Session):
    """The negative-id encoding, which a real foreign key cannot hold."""
    race_id = _race(db)
    racer_ids = _racers(db, race_id, 4)
    round_obj = crud.create_round(
        db,
        race_id,
        round_number=1,
        advancement_source="PACK",
        advancement_num_racers=2,
    )
    crud.generate_heats_for_round(db, round_obj.id)
    db.commit()

    heat = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).first()
    rows = _lanes(db, heat.id)
    assert {r.placeholder_slot for r in rows if r.placeholder_slot} == {1, 2}
    assert all(r.racer_id is None for r in rows)

    crud.resolve_round_placeholders(db, round_obj.id, racer_ids[:2])
    db.commit()

    rows = _lanes(db, heat.id)
    assert {r.racer_id for r in rows if r.racer_id} == set(racer_ids[:2])
    assert all(r.placeholder_slot is None for r in rows)


def test_deleting_a_racer_empties_their_lane(db: Session):
    race_id = _race(db)
    racer_ids = _racers(db, race_id, 4)
    round_obj = crud.create_round(db, race_id, round_number=1)
    crud.generate_heats_for_round(db, round_obj.id)
    db.commit()

    crud.delete_racer(db, racer_ids[0])
    db.commit()

    remaining = {
        row.racer_id for row in db.query(models.HeatLane).all() if row.racer_id
    }
    assert racer_ids[0] not in remaining


def test_deleting_a_heat_takes_its_lanes(db: Session):
    race_id = _race(db)
    round_obj = _round_with_heats(db, race_id)
    heat = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).first()
    heat_id = heat.id
    assert _lanes(db, heat_id)

    crud.delete_heat(db, heat_id)
    db.commit()

    assert _lanes(db, heat_id) == []


def test_deleting_a_round_takes_every_heats_lanes(db: Session):
    race_id = _race(db)
    round_obj = _round_with_heats(db, race_id)

    crud.delete_round(db, round_obj.id)
    db.commit()

    assert db.query(models.HeatLane).count() == 0


def test_deleting_a_race_leaves_no_orphan_lanes(db: Session):
    """`delete_race` removes heats with a bulk delete, which never loads a row
    and so never reaches the ORM's flush events. SQLite reuses the freed ids,
    so an orphan here would eventually reattach to an unrelated heat."""
    race_id = _race(db)
    _round_with_heats(db, race_id)
    (racer_id,) = _racers(db, race_id, 1)
    crud.create_free_race_heat(
        db, race_id, as_lanes([{"lane": 1, "racer_id": racer_id}])
    )
    db.commit()
    assert db.query(models.HeatLane).count() > 0

    crud.delete_race(db, race_id)

    assert db.query(models.HeatLane).count() == 0


def test_free_race_heats_project_assignments_then_results(db: Session):
    race_id = _race(db)
    racer_ids = _racers(db, race_id, 2)
    heat = crud.create_free_race_heat(
        db,
        race_id,
        as_lanes(
            [
                {"lane": 1, "racer_id": racer_ids[0]},
                {"lane": 2, "racer_id": racer_ids[1]},
            ]
        ),
    )
    db.commit()

    rows = _lanes(db, heat.id)
    assert [r.racer_id for r in rows] == racer_ids
    assert all(r.time_seconds is None for r in rows)

    crud.update_free_race_heat_result(
        db,
        heat.id,
        as_lanes(
            [
                {"lane": 1, "racer_id": racer_ids[0], "time": 3.1, "place": 1},
                {"lane": 2, "racer_id": racer_ids[1], "time": 3.4, "place": 2},
            ]
        ),
        source=audit.ResultSource.OPERATOR,
    )
    db.commit()

    rows = _lanes(db, heat.id)
    assert [r.time_seconds for r in rows] == [3.1, 3.4]


def test_an_official_and_a_free_heat_sharing_an_id_stay_apart(db: Session):
    """The two tables have independent autoincrement sequences (issue #4)."""
    race_id = _race(db)
    racer_ids = _racers(db, race_id, 4)
    round_obj = crud.create_round(db, race_id, round_number=1)
    crud.generate_heats_for_round(db, round_obj.id)
    free = crud.create_free_race_heat(
        db, race_id, as_lanes([{"lane": 1, "racer_id": racer_ids[0]}])
    )
    db.commit()

    official = db.query(models.Heat).filter(models.Heat.id == free.id).one_or_none()
    assert official is not None, "the ids should collide for this test to mean anything"

    assert len(_lanes(db, free.id)) == 1
    assert len(_lanes(db, official.id)) == len(lane_dicts(db, official))


def test_a_non_lane_change_leaves_the_rows_alone(db: Session):
    """Renumbering a heat must not disturb its lanes."""
    race_id = _race(db)
    racer_ids = _racers(db, race_id, 2)
    heat = crud.create_free_race_heat(
        db,
        race_id,
        as_lanes([{"lane": 1, "racer_id": racer_ids[0]}]),
    )

    heat.heat_number = 99
    db.commit()

    rows = db.query(models.HeatLane).filter_by(heat_id=heat.id).all()
    assert [(r.lane, r.racer_id) for r in rows] == [(1, racer_ids[0])]
