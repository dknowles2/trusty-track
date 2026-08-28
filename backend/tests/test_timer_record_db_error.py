"""A database error while recording results must not take the timer link down.

Issue #342. ``_record_results`` runs inline on the byte-receive path, with no
request or GraphQL resolver between it and the database — so before the fix,
a ``SQLAlchemyError`` there (a locked SQLite file, an integrity error)
propagated straight out through ``_handle_event``/``receive_bytes``: on
backend-direct serial that kills ``_read_loop`` and drops the port, and over
the proxy it reaches ``main.py``'s generic WebSocket handler, which closes
the socket. The frontend has no auto-reconnect for the proxy case, so a
one-heat write failure took the whole timer offline mid-event.
"""

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import audit, lanes
from backend.services.timer.devices import FAKE
from backend.services.timer.devices.base import LaneResult
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState
from backend.tests.helpers import as_lanes


def _locked_database() -> OperationalError:
    """What SQLite hands back when another writer is holding the file."""
    return OperationalError(
        "UPDATE heat_lanes SET time_seconds=?", {}, Exception("database is locked")
    )


def _fail_once(real):
    """Wrap a crud function so its first call raises, and later ones behave.

    Standing in for a transient failure — the lock clears, the next attempt
    to save (an operator's Override, in practice) succeeds.
    """
    calls = {"n": 0}

    def wrapper(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise _locked_database()
        return real(*args, **kwargs)

    return wrapper


def _setup(db: Session, label: str):
    """One race, one preliminary round, four racers, heats generated."""
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
    for i in range(4):
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
    return race, r1


async def _arm(db: Session, heat) -> TimerManager:
    """A manager armed for `heat`, exactly as the prepareHeat mutation does."""
    racer_by_lane = {
        lane.lane: lane.racer_id
        for lane in crud.heat_lanes_of(db, heat)
        if lane.racer_id is not None
    }
    mask = 0
    for lane_no in racer_by_lane:
        mask |= 1 << (lane_no - 1)
    mgr = TimerManager(track_id=1, device=FAKE, session_factory=lambda: db)
    await mgr.prepare_heat(
        heat.id, models.HeatKind.OFFICIAL, lane_mask=mask, racer_by_lane=racer_by_lane
    )
    return mgr


async def _finish(mgr: TimerManager) -> None:
    """Report all four lanes, exactly as the fake timer's read loop would.

    The last event is what drives `_record_results` from inside
    `_handle_event` — the real call path, not a direct call to the private
    method.
    """
    for lane in range(1, 5):
        await mgr._handle_event(
            LaneResult(lane=lane, time_seconds=3.0 + lane / 10, place=lane)
        )


@pytest.mark.anyio
async def test_a_locked_database_does_not_tear_down_the_timer_link(
    db: Session, monkeypatch: pytest.MonkeyPatch
):
    """The exception must not reach `receive_bytes`/`_process_line`.

    Without the fix, `_finish`'s last `_handle_event` call raises the
    `OperationalError` straight out of this test rather than reaching the
    assertions below at all — which is exactly the failure that killed
    `_read_loop` and the WebSocket in the two real connectivity modes.
    """
    race, r1 = _setup(db, "locked")
    heat = crud.get_heats(db, race.id, round_id=r1.id)[0]
    heat_id = heat.id
    mgr = await _arm(db, heat)

    monkeypatch.setattr(crud, "record_heat_result", _fail_once(crud.record_heat_result))

    await _finish(mgr)

    status = mgr.status()
    assert status.state == TimerState.FAULT.value
    assert status.active_heat_id is None
    assert status.last_error is not None
    assert str(heat_id) in status.last_error
    assert "could not be saved" in status.last_error

    # The times survive the failure and stay on the live lane display, so the
    # operator can read them off the screen and key them in through Override
    # rather than having to remember four numbers off a stopwatch.
    pending = {p["lane"]: p["time"] for p in status.pending_results}
    assert pending == {1: 3.1, 2: 3.2, 3: 3.3, 4: 3.4}

    # Nothing was half-written: the heat is exactly as it was before the run.
    # `_record_results`'s `db.close()` detaches every instance the manager
    # touched, `heat` included, so this re-fetches rather than reusing it —
    # the same rule the assertions in `test_timer_stale_heat.py` follow.
    after = db.query(models.Heat).filter(models.Heat.id == heat_id).one()
    assert not lanes.has_results(crud.heat_lanes_of(db, after))


@pytest.mark.anyio
async def test_the_heat_can_still_be_recorded_after_the_failure(
    db: Session, monkeypatch: pytest.MonkeyPatch
):
    """The failed write leaves nothing behind that would stop a real one.

    The operator's actual recovery is Override, which re-submits through
    `updateHeatResult`. This calls the same `crud.record_heat_result` the
    mutation does, standing in for that save.
    """
    race, r1 = _setup(db, "recover")
    heat = crud.get_heats(db, race.id, round_id=r1.id)[0]
    heat_id = heat.id
    mgr = await _arm(db, heat)

    monkeypatch.setattr(crud, "record_heat_result", _fail_once(crud.record_heat_result))
    await _finish(mgr)

    # `db.close()` in `_record_results`'s `finally` detached `heat`, so this
    # re-fetches it rather than reusing the instance from before the failure.
    reloaded = db.query(models.Heat).filter(models.Heat.id == heat_id).one()
    heat_lanes = crud.heat_lanes_of(db, reloaded)
    for lane in heat_lanes:
        lane.time = 3.0 + lane.lane / 10
        lane.place = lane.lane
    crud.record_heat_result(db, heat_id, heat_lanes, source=audit.ResultSource.OPERATOR)

    after = db.query(models.Heat).filter(models.Heat.id == heat_id).one()
    assert lanes.has_results(crud.heat_lanes_of(db, after))


@pytest.mark.anyio
async def test_a_locked_database_recording_a_free_heat_does_not_tear_down_the_link(
    db: Session, monkeypatch: pytest.MonkeyPatch
):
    """The same containment on the free-race write path.

    `_record_results` calls `update_free_race_heat_result` rather than
    `record_heat_result` for a `FREE` heat, and both go through the same
    `try`/`except` — this pins that the free-race branch is covered too.
    """
    crud.create_initial_config(
        db,
        schemas.InitialConfigCreate(
            group_name="Gfree342",
            tracks=[
                schemas.TrackCreate(
                    name="Tfree342",
                    lane_count=4,
                    length_feet=40,
                    timer_type=models.TimerType.FAKE,
                )
            ],
        ),
    )
    group = db.query(models.Group).filter(models.Group.name == "Gfree342").one()
    track = db.query(models.Track).filter(models.Track.name == "Tfree342").one()
    crud.create_race(
        db,
        schemas.RaceCreate(name="Rfree342", group_id=group.id, track_id=track.id),
    )
    race = db.query(models.Race).filter(models.Race.name == "Rfree342").one()
    free = crud.create_free_race_heat(
        db, race.id, as_lanes([{"lane": n, "racer_id": None} for n in range(1, 5)])
    )
    free_id = free.id

    mgr = TimerManager(track_id=1, device=FAKE, session_factory=lambda: db)
    await mgr.prepare_heat(free_id, models.HeatKind.FREE, lane_mask=0b1111)

    monkeypatch.setattr(
        crud,
        "update_free_race_heat_result",
        _fail_once(crud.update_free_race_heat_result),
    )

    await _finish(mgr)

    status = mgr.status()
    assert status.state == TimerState.FAULT.value
    assert status.active_heat_id is None

    after = db.query(models.Heat).filter(models.Heat.id == free_id).one()
    assert not lanes.has_results(crud.heat_lanes_of(db, after))
