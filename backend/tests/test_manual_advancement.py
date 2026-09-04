"""Manually picking a championship field (#711).

`crud.pin_round_field` / `crud.unpin_round_field` and the `pinRoundField` /
`unpinRoundField` mutations. The crux the design has to hold: a hand-picked
field must survive `invalidate_future_rounds`, which otherwise resets every
unraced championship round back to placeholders on *every* recorded or
cleared preliminary result.
"""

import pytest
from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.tests.helpers import as_lanes, lane_dicts


def _build_race(db: Session, *, racer_count: int = 6) -> tuple[models.Race, list[int]]:
    """A race with a general round, a two-slot championship round, and
    ``racer_count`` checked-in racers, sorted by id for a stable pick."""
    config = schemas.InitialConfigCreate(
        organization_name="Manual Advancement Pack",
        tracks=[
            schemas.TrackCreate(
                name="Manual Advancement Track",
                lane_count=4,
                timer_type=models.TimerType.FAKE,
            )
        ],
    )
    crud.create_initial_config(db, config)
    org = db.query(models.Organization).first()
    track = db.query(models.Track).first()
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Manual Advancement Race", organization_id=org.id, track_id=track.id
        ),
    )

    racer_ids = []
    for i in range(racer_count):
        r = crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=i + 1,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        racer_ids.append(r.id)
    db.commit()
    racer_ids.sort()

    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelims")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)

    r2 = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Finals",
        advancement_source="ALL",
        advancement_num_racers=2,
    )
    db.flush()
    crud.generate_heats_for_round(db, r2.id, num_placeholders=2)
    db.commit()

    return race, racer_ids


def _round(db: Session, round_id: int) -> models.Round:
    db.expire_all()
    return db.query(models.Round).filter(models.Round.id == round_id).first()


def _round2(race: models.Race, db: Session) -> models.Round:
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race.id, models.Round.round_number == 2)
        .first()
    )


def _round1(race: models.Race, db: Session) -> models.Round:
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race.id, models.Round.round_number == 1)
        .first()
    )


def _heats_of(db: Session, round_id: int) -> list[models.Heat]:
    return db.query(models.Heat).filter(models.Heat.round_id == round_id).all()


def _racers_in(db: Session, round_id: int) -> set[int]:
    heats = _heats_of(db, round_id)
    return {
        lane["racer_id"]
        for heat in heats
        for lane in lane_dicts(db, heat)
        if lane.get("racer_id") is not None and lane["racer_id"] > 0
    }


def test_pinning_writes_exactly_the_pick(db: Session):
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)

    pick = [racer_ids[4], racer_ids[1]]
    round_obj = crud.pin_round_field(db, r2.id, pick)
    assert round_obj.field_pinned is True
    assert _racers_in(db, r2.id) == set(pick)


def test_a_pinned_field_survives_the_recorded_result_cascade(db: Session):
    """The crux: recording a prelim result must not reset a pinned final."""
    race, racer_ids = _build_race(db)
    r1 = _round1(race, db)
    r2 = _round2(race, db)

    pick = [racer_ids[5], racer_ids[0]]
    crud.pin_round_field(db, r2.id, pick)

    r1_heats = _heats_of(db, r1.id)
    for heat in r1_heats:
        rows = lane_dicts(db, heat)
        for row in rows:
            if row.get("racer_id"):
                row["time"] = 1.0
        crud.record_heat_result(
            db, heat.id, as_lanes(rows), source=audit.ResultSource.OPERATOR
        )

    assert _racers_in(db, r2.id) == set(pick)
    assert _round(db, r2.id).field_pinned is True


def test_pinning_is_refused_for_a_general_round(db: Session):
    race, racer_ids = _build_race(db)
    r1 = _round1(race, db)
    with pytest.raises(ValueError, match="championship round"):
        crud.pin_round_field(db, r1.id, racer_ids[:2])


def test_pinning_is_refused_once_the_round_has_been_raced(db: Session):
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)
    crud.pin_round_field(db, r2.id, racer_ids[:2])

    for heat in _heats_of(db, r2.id):
        rows = lane_dicts(db, heat)
        for row in rows:
            if row.get("racer_id"):
                row["time"] = 2.0
        crud.record_heat_result(
            db, heat.id, as_lanes(rows), source=audit.ResultSource.OPERATOR
        )

    with pytest.raises(ValueError, match="already been raced"):
        crud.pin_round_field(db, r2.id, [racer_ids[2], racer_ids[3]])


def test_pinning_is_refused_for_a_racer_who_is_not_checked_in(db: Session):
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)
    not_checked_in = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Not",
            last_name="Checked In",
            car_number=999,
            race_id=race.id,
            car_passed_inspection=False,
        ),
    )
    db.commit()
    with pytest.raises(ValueError, match="checked-in"):
        crud.pin_round_field(db, r2.id, [racer_ids[0], not_checked_in.id])


def test_pinning_is_refused_for_fewer_than_two_racers(db: Session):
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)
    with pytest.raises(ValueError, match="two racers"):
        crud.pin_round_field(db, r2.id, [racer_ids[0]])


def test_the_pick_need_not_match_advancement_num_racers(db: Session):
    """`advancement_num_racers` is a suggestion here, not a ceiling (#711)."""
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)
    pick = racer_ids[:4]
    crud.pin_round_field(db, r2.id, pick)
    assert _racers_in(db, r2.id) == set(pick)


def test_unpinning_an_unraced_round_re_fields_from_the_standings(db: Session):
    race, racer_ids = _build_race(db)
    r1 = _round1(race, db)
    r2 = _round2(race, db)

    # Make the standings unambiguous: the last two racers are fastest.
    r1_heats = _heats_of(db, r1.id)
    for heat in r1_heats:
        rows = lane_dicts(db, heat)
        for row in rows:
            rid = row.get("racer_id")
            if rid is None:
                continue
            row["time"] = 0.5 if rid in racer_ids[-2:] else 5.0
        crud.record_heat_result(
            db, heat.id, as_lanes(rows), source=audit.ResultSource.OPERATOR
        )

    # Hand-pick a different pair.
    pick = [racer_ids[0], racer_ids[1]]
    crud.pin_round_field(db, r2.id, pick)
    assert _racers_in(db, r2.id) == set(pick)

    round_obj = crud.unpin_round_field(db, r2.id)
    assert round_obj.field_pinned is False
    assert _racers_in(db, r2.id) == set(racer_ids[-2:])


def test_unpinning_a_raced_round_only_clears_the_flag(db: Session):
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)
    pick = [racer_ids[0], racer_ids[1]]
    crud.pin_round_field(db, r2.id, pick)

    for heat in _heats_of(db, r2.id):
        rows = lane_dicts(db, heat)
        for row in rows:
            if row.get("racer_id"):
                row["time"] = 1.5
        crud.record_heat_result(
            db, heat.id, as_lanes(rows), source=audit.ResultSource.OPERATOR
        )

    round_obj = crud.unpin_round_field(db, r2.id)
    assert round_obj.field_pinned is False
    # Results stand; the field is untouched.
    assert _racers_in(db, r2.id) == set(pick)


def test_unpinning_a_round_that_was_never_pinned_is_a_no_op(db: Session):
    race, _ = _build_race(db)
    r2 = _round2(race, db)
    before = _racers_in(db, r2.id)
    round_obj = crud.unpin_round_field(db, r2.id)
    assert round_obj.field_pinned is False
    assert _racers_in(db, r2.id) == before


def test_a_pinned_round_is_visible_through_advancement_status(client, db: Session):
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)
    pick = sorted([racer_ids[3], racer_ids[0]])
    crud.pin_round_field(db, r2.id, pick)

    query = f"""
    query {{
        advancementStatus(raceId: {race.id}, roundId: {r2.id}) {{
            fieldIsPinned
            fieldIsStale
            contestedCut
            advancingRacers {{ racerId isAdvancing }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": query})
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    status = body["data"]["advancementStatus"]
    assert status["fieldIsPinned"] is True
    assert status["fieldIsStale"] is False
    assert status["contestedCut"] is False
    advancing = {
        entry["racerId"] for entry in status["advancingRacers"] if entry["isAdvancing"]
    }
    assert advancing == set(pick)


def test_pin_and_unpin_mutations_round_trip(client, db: Session):
    race, racer_ids = _build_race(db)
    r2 = _round2(race, db)
    pick = [racer_ids[2], racer_ids[5]]

    mutation = f"""
    mutation {{
        pinRoundField(raceId: {race.id}, roundId: {r2.id}, racerIds: {pick}) {{
            id
            fieldPinned
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation})
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    assert body["data"]["pinRoundField"]["fieldPinned"] is True
    assert _racers_in(db, r2.id) == set(pick)

    unpin = f"""
    mutation {{
        unpinRoundField(raceId: {race.id}, roundId: {r2.id}) {{
            id
            fieldPinned
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": unpin})
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    assert body["data"]["unpinRoundField"]["fieldPinned"] is False
