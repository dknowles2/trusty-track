"""Reading a heat's lanes back out of `heat_lanes` (#72).

The table is where lanes are written since #120. These are the reads that have
moved off parsing `lane_results`, and the cases that would otherwise change
behaviour silently — the projection agrees with the blob everywhere else, so a
read that came out subtly different would pass the rest of the suite.
"""

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import lanes


def _round(db: Session) -> models.Round:
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
    return crud.create_round(db, race_id=race.id, round_number=1)


def _racer(db: Session, round_obj: models.Round) -> int:
    """A racer for a lane to name.

    ``heat_lanes.racer_id`` is a real foreign key and SQLite enforces it now
    (#125), so a lane carrying an assignment has to name a racer that exists
    rather than an id picked out of the air.
    """
    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Racer",
            last_name="Test",
            race_id=round_obj.race_id,
            car_passed_inspection=True,
        ),
    )
    return racer.id


def _heat(db: Session, round_obj: models.Round, number: int, heat_lanes: list) -> int:
    heat = models.Heat(
        race_id=round_obj.race_id, round_id=round_obj.id, heat_number=number
    )
    crud.set_heat_lanes(heat, heat_lanes)
    db.add(heat)
    db.commit()
    return heat.id


def test_a_heat_with_no_lanes_stays_in_the_list(db: Session):
    """The trap in moving this read off the blob.

    Parsing an empty blob gives `[]` and keeps the heat in the list. A join
    from `heat_lanes` would drop it, because it has no rows to join to.
    `is_round_complete` reaches the same answer either way, but
    `field_is_short` and `may_rebuild` both reason about the *number* of heats,
    so a heat quietly dropping out changes what they decide.
    """
    round_obj = _round(db)
    _heat(db, round_obj, 1, [lanes.Lane(lane=1, racer_id=None)])
    _heat(db, round_obj, 2, [])

    result = crud._round_heat_lanes(db, round_obj.id)

    assert len(result) == 2
    assert [len(heat) for heat in result] == [1, 0]


def test_the_heats_come_back_in_order(db: Session):
    """`may_rebuild` and `field_is_short` do not care, but a list whose order
    depends on which heat happened to have rows is a trap for whatever reads it
    next."""
    round_obj = _round(db)
    _heat(db, round_obj, 1, [])
    _heat(db, round_obj, 2, [lanes.Lane(lane=1, racer_id=None)])
    _heat(db, round_obj, 3, [])

    result = crud._round_heat_lanes(db, round_obj.id)

    assert [len(heat) for heat in result] == [0, 1, 0]


def test_lanes_come_back_in_lane_order(db: Session):
    round_obj = _round(db)
    _heat(
        db,
        round_obj,
        1,
        [lanes.Lane(lane=3), lanes.Lane(lane=1), lanes.Lane(lane=2)],
    )

    (heat,) = crud._round_heat_lanes(db, round_obj.id)

    assert [lane.lane for lane in heat] == [1, 2, 3]


def test_a_placeholder_survives_the_round_trip(db: Session):
    """Stored and read back as `placeholder_slot`, both sides.

    It used to come back as the negative racer id `Lane` spoke internally, so
    the crossing had to re-encode. #164 gave the dataclass the field, and the
    round trip is now the identity — which is the point of the change: an
    undecided slot has no racer, and says so.
    """
    round_obj = _round(db)
    _heat(db, round_obj, 1, [lanes.Lane(lane=1, placeholder_slot=2)])

    (heat,) = crud._round_heat_lanes(db, round_obj.id)

    assert heat[0].placeholder_slot == 2
    assert heat[0].racer_id is None
    assert not heat[0].is_empty


def test_a_skipped_lane_survives_the_round_trip(db: Session):
    """`skipped` is a column on the table and a key in `extra` on the value.
    Losing it in the crossing would make a skipped heat look unrun, which is
    what decides whether the running order moves on."""
    round_obj = _round(db)
    racer_id = _racer(db, round_obj)
    _heat(
        db,
        round_obj,
        1,
        [lanes.Lane(lane=1, racer_id=racer_id, skipped=True)],
    )

    (heat,) = crud._round_heat_lanes(db, round_obj.id)

    assert heat[0].skipped is True
    assert lanes.is_finished(heat) is True


def test_a_time_comes_back_as_a_number(db: Session):
    """The blob held a mixed float/string; the column is a float. A read that
    handed back the string form would put `seconds` at the mercy of whatever
    wrote it."""
    round_obj = _round(db)
    racer_id = _racer(db, round_obj)
    _heat(
        db, round_obj, 1, [lanes.Lane(lane=1, racer_id=racer_id, time="3.25", place=1)]
    )

    (heat,) = crud._round_heat_lanes(db, round_obj.id)

    assert heat[0].time == 3.25
    assert heat[0].seconds == 3.25
