"""The armed heat disappearing or changing underneath the timer.

A heat id is not a stable handle. ``invalidate_future_rounds`` regenerates
every later championship round on *every* earlier result — deleting the rows
and inserting new ones — so an operator who arms a championship heat and then
corrects a preliminary time has the row replaced while the cars are on the
track.
"""

import json

import pytest
from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import lanes
from backend.services.timer.devices.base import LaneResult
from backend.services.timer.devices.fake import FakeTimerDevice
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


def _setup(db: Session, label: str, extra_round: bool):
    crud.create_initial_config(
        db,
        schemas.InitialConfigCreate(
            group_name=f"G{label}",
            tracks=[
                schemas.TrackCreate(
                    name=f"T{label}",
                    lane_count=4,
                    length_feet=40,
                    timer_type=models.TimerType.FAKE,
                )
            ],
        ),
    )
    group = db.query(models.Group).filter(models.Group.name == f"G{label}").one()
    track = db.query(models.Track).filter(models.Track.name == f"T{label}").one()
    crud.create_race(
        db,
        schemas.RaceCreate(name=f"R{label}", group_id=group.id, track_id=track.id),
    )
    race = db.query(models.Race).filter(models.Race.name == f"R{label}").one()
    for i in range(6):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"R{i}",
                last_name="T",
                car_number=i + 1,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    db.commit()

    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Finals",
        advancement_source="PACK",
        advancement_num_racers=4,
    )
    db.flush()
    crud.generate_heats_for_round(db, r2.id, num_placeholders=4)

    if extra_round:
        # A round after the championship one, so its heats are no longer the
        # highest rowids and SQLite cannot hand their ids back on regeneration.
        r3 = crud.create_round(
            db,
            race.id,
            3,
            models.SchedulingStrategy.PPC,
            "Super",
            advancement_source=f"ROUND:{r2.id}",
            advancement_num_racers=2,
        )
        db.flush()
        crud.generate_heats_for_round(db, r3.id, num_placeholders=2)

    return race, r1, r2


def _run_heat(db: Session, heat, offset: float = 0.0, reverse: bool = False) -> None:
    results = json.loads(heat.lane_results)
    for res in results:
        rid = res.get("racer_id")
        if rid is None or rid < 0:
            continue
        base = (10 - rid) if reverse else rid
        res["time"] = 1.0 + offset + base / 100.0
    crud.record_heat_result(db, heat.id, json.dumps(results))


def _armed_manager(db: Session, heat) -> TimerManager:
    """A manager armed for `heat`, exactly as the prepareHeat mutation does."""
    racer_by_lane = {
        lane.lane: lane.racer_id
        for lane in lanes.parse(heat.lane_results)
        if lane.racer_id is not None
    }
    mask = 0
    for lane_no in racer_by_lane:
        mask |= 1 << (lane_no - 1)
    return (
        TimerManager(track_id=1, device=FakeTimerDevice(), session_factory=lambda: db),
        racer_by_lane,
        mask,
    )


async def _arm(db: Session, heat):
    mgr, racer_by_lane, mask = _armed_manager(db, heat)
    await mgr.prepare_heat(
        heat.id, models.HeatKind.OFFICIAL, lane_mask=mask, racer_by_lane=racer_by_lane
    )
    return mgr


async def _finish(mgr: TimerManager) -> None:
    for lane in range(1, 5):
        await mgr._handle_event(
            LaneResult(lane=lane, time_seconds=3.0 + lane / 10, place=lane)
        )
    await mgr.force_record()


@pytest.mark.anyio
async def test_a_deleted_heat_does_not_wedge_the_timer(db: Session):
    """It used to return early, leaving RUNNING on a heat that was gone."""
    race, r1, r2 = _setup(db, "wedge", extra_round=True)
    for heat in crud.get_heats(db, race.id, round_id=r1.id):
        _run_heat(db, heat)

    target = crud.get_heats(db, race.id, round_id=r2.id)[0]
    mgr = await _arm(db, target)

    # Correcting a preliminary time regenerates the championship round.
    _run_heat(db, crud.get_heats(db, race.id, round_id=r1.id)[0], offset=0.5)
    assert target.id not in [h.id for h in crud.get_heats(db, race.id, round_id=r2.id)]

    await _finish(mgr)

    status = mgr.status()
    assert status.state == TimerState.IDLE.value
    assert status.active_heat_id is None
    assert status.last_error and "no longer exists" in status.last_error


@pytest.mark.anyio
async def test_a_reused_heat_id_does_not_take_the_results(db: Session):
    """The dangerous one: the id resolves, but to a different field.

    SQLite hands a rowid back when the deleted rows were the highest, so the
    lookup succeeds and returns a heat whose lanes have been re-drawn from the
    new standings. Recording would attribute each lane's time to whoever now
    occupies that lane.
    """
    race, r1, r2 = _setup(db, "reuse", extra_round=False)
    for heat in crud.get_heats(db, race.id, round_id=r1.id):
        _run_heat(db, heat)

    target = crud.get_heats(db, race.id, round_id=r2.id)[0]
    armed_lanes = [lane.racer_id for lane in lanes.parse(target.lane_results)]
    mgr = await _arm(db, target)

    # Re-record the prelim with the order flipped, so the championship field is
    # drawn differently and lands different racers in different lanes.
    for heat in crud.get_heats(db, race.id, round_id=r1.id):
        _run_heat(db, heat, reverse=True)
    db.expire_all()

    reused = db.query(models.Heat).filter(models.Heat.id == target.id).first()
    assert reused is not None, "this test needs the id to be reused"
    assert [
        lane.racer_id for lane in lanes.parse(reused.lane_results)
    ] != armed_lanes, "this test needs the lanes to have changed"

    await _finish(mgr)

    db.expire_all()
    after = db.query(models.Heat).filter(models.Heat.id == target.id).one()
    assert not lanes.has_results(lanes.parse(after.lane_results)), (
        "times were written against a heat the timer never armed"
    )
    status = mgr.status()
    assert status.state == TimerState.IDLE.value
    assert status.last_error and "changed while it was armed" in status.last_error


@pytest.mark.anyio
async def test_the_times_are_kept_for_the_operator(db: Session):
    """The run happened. Losing the numbers as well would be its own bug."""
    race, r1, r2 = _setup(db, "keep", extra_round=True)
    for heat in crud.get_heats(db, race.id, round_id=r1.id):
        _run_heat(db, heat)

    target = crud.get_heats(db, race.id, round_id=r2.id)[0]
    mgr = await _arm(db, target)
    _run_heat(db, crud.get_heats(db, race.id, round_id=r1.id)[0], offset=0.5)

    await _finish(mgr)

    pending = mgr.status().pending_results
    assert len(pending) == 4
    assert {p["lane"] for p in pending} == {1, 2, 3, 4}


@pytest.mark.anyio
async def test_an_unchanged_heat_still_records(db: Session):
    """The ordinary path, which the guard must not get in the way of."""
    race, r1, _ = _setup(db, "normal", extra_round=False)
    target = crud.get_heats(db, race.id, round_id=r1.id)[0]
    mgr = await _arm(db, target)

    await _finish(mgr)

    db.expire_all()
    after = db.query(models.Heat).filter(models.Heat.id == target.id).one()
    assert lanes.has_results(lanes.parse(after.lane_results))
    assert mgr.status().state == TimerState.IDLE.value
    assert mgr.status().active_heat_id is None


@pytest.mark.anyio
async def test_a_free_heat_with_nobody_assigned_still_records(db: Session):
    """`racer_by_lane` is empty there, so there is nothing to verify against.

    An exhibition run arms the whole track deliberately; the guard has to sit
    out rather than refuse every free race.
    """
    race, _, _ = _setup(db, "free", extra_round=False)
    # Empty lanes, no racers — what the "arm the whole track" branch of
    # `prepareHeat` produces a mask for.
    free = crud.create_free_race_heat(
        db, race.id, [{"lane": n, "racer_id": None} for n in range(1, 5)]
    )
    mgr = TimerManager(track_id=1, device=FakeTimerDevice(), session_factory=lambda: db)
    await mgr.prepare_heat(free.id, models.HeatKind.FREE, lane_mask=0b1111)

    await _finish(mgr)

    db.expire_all()
    after = db.query(models.Heat).filter(models.Heat.id == free.id).one()
    assert lanes.has_results(lanes.parse(after.lane_results))
    assert mgr.status().state == TimerState.IDLE.value


@pytest.mark.anyio
async def test_arming_without_a_racer_mapping_still_records(db: Session):
    """`racer_by_lane` is optional on `prepare_heat`, so absent means "unknown".

    Absent is not the same as "no racers", and treating it that way would make
    every heat with racers refuse to record. Six existing tests in the suite
    arm this way; this one says why it has to keep working.
    """
    race, r1, _ = _setup(db, "nomap", extra_round=False)
    target = crud.get_heats(db, race.id, round_id=r1.id)[0]

    mgr = TimerManager(track_id=1, device=FakeTimerDevice(), session_factory=lambda: db)
    await mgr.prepare_heat(target.id, models.HeatKind.OFFICIAL, lane_mask=0b1111)

    await _finish(mgr)

    db.expire_all()
    after = db.query(models.Heat).filter(models.Heat.id == target.id).one()
    assert lanes.has_results(lanes.parse(after.lane_results))
    assert mgr.status().state == TimerState.IDLE.value
