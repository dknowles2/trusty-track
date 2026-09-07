"""A database-write FAULT must not make the watchdog reconnect a working port.

Issue #764. Since #342, `TimerManager._recording_failed` lands the manager in
FAULT when a result write fails -- its own docstring and error message both
say "the timer link is fine; enter the times with Override". But the
watchdog's reconnect condition still read `self._state == TimerState.FAULT`
as its own reason to `connect_direct()` again on a backend-direct track:
closing a perfectly good serial port and re-sending the identification and
initialisation commands within a second of a SQLite hiccup that has nothing
to do with the hardware -- the same re-initialisation-loop shape `9f09cee`
removed, reintroduced by a different route.

`not self._serial or not self._serial.is_open` already covers every case
where the port is genuinely gone (a failed `connect_direct`, or the
`SerialException` handler in `_read_loop`, both of which clear `self._serial`
before landing in FAULT) -- so dropping the `or self._state == FAULT` clause
is a pure narrowing, not a new signal to compute.
"""

import asyncio
from unittest.mock import MagicMock

import pytest
import serial
from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.services.timer import manager as manager_module
from backend.services.timer.devices import MICROWIZARD
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState
from backend.tests.test_timer_record_db_error import _fail_once, _finish, _setup


async def _arm_direct(db: Session, heat, mgr: TimerManager) -> None:
    """Arm `mgr` for `heat`, exactly as `prepareHeat` does for a real timer."""
    racer_by_lane = {
        lane.lane: lane.racer_id
        for lane in crud.heat_lanes_of(db, heat)
        if lane.racer_id is not None
    }
    mask = 0
    for lane_no in racer_by_lane:
        mask |= 1 << (lane_no - 1)
    await mgr.prepare_heat(
        heat.id, models.HeatKind.OFFICIAL, lane_mask=mask, racer_by_lane=racer_by_lane
    )


@pytest.mark.anyio
async def test_a_write_fault_does_not_close_and_reopen_a_working_port(
    db: Session, monkeypatch: pytest.MonkeyPatch
):
    """The regression this pins: before the fix, a few watchdog ticks after a
    write failure were enough to see the port closed and reopened and the
    device's setup commands sent again -- visible here as the mocked
    `serial.Serial` constructor being called a second time and the mock's
    `close()` being invoked, neither of which a database hiccup should cause.
    """
    monkeypatch.setattr(manager_module, "WATCHDOG_SECONDS", 0.02)

    mock_serial = MagicMock(spec=serial.Serial)
    mock_serial.is_open = True
    mock_serial.read.return_value = b""
    serial_ctor = MagicMock(return_value=mock_serial)
    monkeypatch.setattr(serial, "Serial", serial_ctor)

    race, r1 = _setup(db, "writefault")
    heat = crud.get_heats(db, race.id, round_id=r1.id)[0]

    mgr = TimerManager(track_id=1, device=MICROWIZARD, session_factory=lambda: db)
    await mgr.connect_direct("/dev/ttyFAKE")
    assert serial_ctor.call_count == 1

    await _arm_direct(db, heat, mgr)

    monkeypatch.setattr(crud, "record_heat_result", _fail_once(crud.record_heat_result))
    await _finish(mgr)

    assert mgr._state == TimerState.FAULT
    assert mgr._serial is mock_serial

    # Several watchdog ticks' worth of time, on a port nothing closed.
    await asyncio.sleep(0.2)

    assert mgr._state == TimerState.FAULT, "a write fault must not self-heal"
    assert serial_ctor.call_count == 1, "the port was reopened over a DB hiccup"
    mock_serial.close.assert_not_called()
    assert mgr._serial is mock_serial

    await mgr.stop()


@pytest.mark.anyio
async def test_a_genuinely_closed_port_is_still_reconnected(
    monkeypatch: pytest.MonkeyPatch,
):
    """The other half of the same condition: a port that really is gone must
    still bring the watchdog back to reconnect it. This is what
    `not self._serial.is_open` alone already covers, and stays covered with
    the FAULT clause removed.
    """
    monkeypatch.setattr(manager_module, "WATCHDOG_SECONDS", 0.02)

    mock_serial = MagicMock(spec=serial.Serial)
    mock_serial.is_open = True
    mock_serial.read.return_value = b""
    serial_ctor = MagicMock(return_value=mock_serial)
    monkeypatch.setattr(serial, "Serial", serial_ctor)

    mgr = TimerManager(track_id=1, device=MICROWIZARD)
    await mgr.connect_direct("/dev/ttyFAKE")
    assert serial_ctor.call_count == 1

    # The port really did go away.
    mock_serial.is_open = False

    for _ in range(50):
        await asyncio.sleep(0.02)
        if serial_ctor.call_count > 1:
            break

    assert serial_ctor.call_count > 1, "a genuinely closed port must be reconnected"

    await mgr.stop()
