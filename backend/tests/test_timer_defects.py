"""Timer defects found by reading DerbyNet's implementation (issue #88).

Each test here pins one behaviour that was wrong, and each fails against the
code as it stood. They are grouped because they were found together, not
because they interact.

Everything here drives ``TimerManager`` and the device classes directly, with
no database and no serial port: the defects are all in framing, state
transitions and port configuration, which is exactly the part that can be
exercised without hardware.
"""

import asyncio
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest
import serial

from backend.services.timer import manager as manager_module
from backend.services.timer.devices import MICROWIZARD
from backend.services.timer.devices.base import GateClosed, LaneResult
from backend.services.timer.devices.derbynet import PDT
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

#: A device that is not 8-N-1.
#:
#: Modelled on the NewBold DT/TURBO/DerbyStick family, which runs at 1200 baud
#: with 7 data bits and 2 stop bits. Nothing about its protocol is exercised
#: here — only that the port gets opened the way it asks.
NEWBOLDISH = replace(
    MICROWIZARD,
    name="NewBold-ish",
    key="newboldish",
    baud_rate=1200,
    data_bits=7,
    stop_bits=2,
    parity="E",
)


# ---------------------------------------------------------------------------
# The gate is knowable, so READY is reachable
# ---------------------------------------------------------------------------


async def test_a_closed_gate_moves_an_armed_timer_to_ready():
    """ARMED means the lane mask is sent; READY means the cars are staged.

    `gate_state_is_knowable` was False on every device we ship, so the
    transition guarded by it could not fire and READY was dead. The
    MicroWizard does report the closing edge — `N2` is in its initialization
    commands precisely to turn that on.
    """
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.ARMED

    await manager.inject_event(GateClosed())

    assert manager._state == TimerState.READY


async def test_the_gate_closing_signal_reaches_the_manager_as_an_event():
    """The whole path, from bytes to state, rather than the transition alone.

    A parser that recognises `>` is worth nothing if the framing swallows it,
    and `>` is in `immediate_chars` rather than delimiter-terminated.
    """
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.ARMED

    await manager.receive_bytes(b">")

    assert manager._state == TimerState.READY


async def test_a_ready_timer_still_starts_racing():
    """READY must not be a cul-de-sac: the gate opening still starts the run."""
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.ARMED

    await manager.receive_bytes(b">")
    assert manager._state == TimerState.READY

    await manager.receive_bytes(b"@")
    assert manager._state == TimerState.RUNNING


# ---------------------------------------------------------------------------
# The port is opened with all four framing parameters
# ---------------------------------------------------------------------------


async def test_a_device_that_is_not_8n1_gets_the_port_it_asks_for():
    """Only the baud rate used to be passed, so everything else took pyserial's
    defaults of 8-N-1. Opening a 1200/7/E/2 timer that way does not fail — it
    yields silent garbage, which is worse."""
    mock_serial = MagicMock(spec=serial.Serial)
    mock_serial.is_open = True
    mock_serial.read.return_value = b""

    with patch("serial.Serial", return_value=mock_serial) as ctor:
        manager = TimerManager(track_id=1, device=NEWBOLDISH)
        await manager.connect_direct("/dev/ttyUSB0")
        await manager.stop()

    kwargs = ctor.call_args.kwargs
    assert kwargs["baudrate"] == 1200
    assert kwargs["bytesize"] == 7
    assert kwargs["stopbits"] == 2
    assert kwargs["parity"] == "E"


async def test_the_microwizard_still_gets_8n1():
    """The defaults have to stay what the one device we support needs."""
    mock_serial = MagicMock(spec=serial.Serial)
    mock_serial.is_open = True
    mock_serial.read.return_value = b""

    with patch("serial.Serial", return_value=mock_serial) as ctor:
        manager = TimerManager(track_id=1, device=MICROWIZARD)
        await manager.connect_direct("/dev/ttyUSB0")
        await manager.stop()

    kwargs = ctor.call_args.kwargs
    assert kwargs["baudrate"] == 9600
    assert kwargs["bytesize"] == 8
    assert kwargs["stopbits"] == 1
    assert kwargs["parity"] == "N"


# ---------------------------------------------------------------------------
# An unterminated final line is not stranded
# ---------------------------------------------------------------------------


#: The same device with a short idle timeout, so tests do not sleep.
QUICK_IDLE = replace(MICROWIZARD, line_idle_timeout_seconds=0.05)


async def test_a_result_with_no_terminator_is_processed_once_the_device_goes_quiet():
    """Some timers omit the terminator on their last result.

    Framing waited for the delimiter indefinitely, so those bytes sat in the
    buffer while the manager stayed in RUNNING waiting for a lane the device
    considered already reported — a heat that never records.
    """
    manager = TimerManager(track_id=1, device=QUICK_IDLE)
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0

    await manager.receive_bytes(b"  1    3.452  1")
    assert manager._pending_results == {}, "nothing should happen before the wait"

    await asyncio.sleep(0.15)

    assert 1 in manager._pending_results
    assert manager._pending_results[1].time_seconds == 3.452
    assert manager._buf == b""


async def test_more_bytes_postpone_the_flush():
    """The flush must fire only when the device has genuinely stopped talking,
    or a line split across two reads gets processed as two half-lines."""
    manager = TimerManager(track_id=1, device=QUICK_IDLE)
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0

    await manager.receive_bytes(b"  1    3.4")
    await asyncio.sleep(0.03)
    await manager.receive_bytes(b"52  1")
    await asyncio.sleep(0.03)
    assert manager._pending_results == {}, "the second read should have rescheduled"

    await asyncio.sleep(0.1)
    assert manager._pending_results[1].time_seconds == 3.452


async def test_a_terminated_line_leaves_nothing_pending():
    """The ordinary case must not also fire a flush."""
    manager = TimerManager(track_id=1, device=QUICK_IDLE)
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0

    await manager.receive_bytes(b"  1    3.452  1\r")
    assert manager._buf == b""
    assert manager._idle_flush_task is None


async def test_a_disconnect_discards_a_partial_line():
    """A device cut off mid-message did not send a short message."""
    manager = TimerManager(track_id=1, device=QUICK_IDLE)
    manager._state = TimerState.RUNNING

    await manager.receive_bytes(b"  1    3.4")
    await manager.handle_disconnect()
    await asyncio.sleep(0.15)

    assert manager._pending_results == {}


# ---------------------------------------------------------------------------
# The places the device reports are believed
# ---------------------------------------------------------------------------


async def test_reported_places_survive_a_tie_in_the_times():
    """This is the case the whole rule exists for.

    Two cars can cross a millisecond apart and be reported with equal times,
    and the finish-line hardware still knows which was first. Deriving place by
    sorting those times calls it a tie and loses the answer the timer gave us.
    """
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0b11

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.456, place=2))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.456, place=1))

    assert manager._pending_results[1].place == 2
    assert manager._pending_results[2].place == 1


async def test_places_are_derived_when_the_device_reports_none():
    """Old-style output and the winner-marking format both leave lanes at 0."""
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.9, place=0))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.1, place=0))
    await manager.inject_event(LaneResult(lane=3, time_seconds=3.5, place=0))

    assert manager._pending_results[2].place == 1
    assert manager._pending_results[3].place == 2
    assert manager._pending_results[1].place == 3


async def test_a_partial_set_of_places_is_derived_rather_than_mixed():
    """One format marks the winner alone.

    Keeping that lane's 1 and sorting the others would number a second lane 1
    as well. A partial set says nothing about the lanes it omits, so the whole
    ordering comes from the times.
    """
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.5, place=0))
    await manager.inject_event(LaneResult(lane=3, time_seconds=3.9, place=0))

    assert [manager._pending_results[lane].place for lane in (1, 2, 3)] == [1, 2, 3]


async def test_a_dnf_lane_does_not_make_the_reported_places_look_partial():
    """A lane with no time is excluded from the question entirely.

    It keeps place 0 either way, and must not drag the timed lanes into a
    recomputation by looking like a lane whose place is missing.
    """
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.456, place=2))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.456, place=1))
    await manager.inject_event(LaneResult(lane=3, time_seconds=0.0, place=0))

    assert manager._pending_results[1].place == 2
    assert manager._pending_results[2].place == 1
    assert manager._pending_results[3].place == 0


# ---------------------------------------------------------------------------
# RESULTS_OVERDUE is reachable, and can fire a second time (issue #339)
# ---------------------------------------------------------------------------

#: PDT with a timeout short enough for a test to wait out.
_QUICK_OVERDUE = replace(PDT, result_timeout_seconds=0.02)


def _collecting(manager: TimerManager) -> list[bytes]:
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    return sent


async def test_a_running_heat_with_no_results_goes_overdue():
    """Before #339, PDT (like DerbyTimer, Bert Drake, The Judge and the Champ)
    set no `result_timeout_seconds`, so the watchdog's guard in
    `_watchdog_loop` never let the state machine leave RUNNING -- the give-up
    command each of these declares under `on_event[RESULTS_OVERDUE]` was
    unreachable, and a DNF left the manager RUNNING forever."""
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(manager_module, "WATCHDOG_SECONDS", 0.01)
    try:
        manager = TimerManager(track_id=1, device=_QUICK_OVERDUE)
        sent = _collecting(manager)
        manager._state = TimerState.RUNNING
        manager._running_since = asyncio.get_event_loop().time()
        manager._watchdog_task = asyncio.create_task(manager._watchdog_loop())

        for _ in range(100):
            await asyncio.sleep(0.01)
            if manager._state == TimerState.RESULTS_OVERDUE:
                break

        assert manager._state == TimerState.RESULTS_OVERDUE
        assert sent == [b"F"], "the give-up command must reach the device"
        await manager.stop()
    finally:
        monkeypatch.undo()


async def test_a_still_incomplete_heat_can_go_overdue_a_second_time():
    """A lane reporting in after the first give-up does not mean the heat is
    decided -- it may still be short a lane. `_running_since` used to stay
    cleared across the RESULTS_OVERDUE -> LaneResult -> RUNNING transition, so
    the watchdog's `self._running_since is not None` guard was permanently
    false from the first timeout on and could never fire again."""
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(manager_module, "WATCHDOG_SECONDS", 0.01)
    try:
        manager = TimerManager(track_id=1, device=_QUICK_OVERDUE)
        sent = _collecting(manager)
        manager._state = TimerState.RUNNING
        manager._running_since = asyncio.get_event_loop().time()
        # An empty mask never looks "complete" (see the derived-place tests
        # above), so a reported lane cannot finish the heat and mask this bug
        # behind an ordinary result recording.
        manager._lane_mask = 0
        manager._watchdog_task = asyncio.create_task(manager._watchdog_loop())

        for _ in range(100):
            await asyncio.sleep(0.01)
            if manager._state == TimerState.RESULTS_OVERDUE:
                break
        assert manager._state == TimerState.RESULTS_OVERDUE, (
            "never went overdue the first time"
        )

        # A straggling lane reports in, but the heat is still short a lane.
        await manager.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))
        assert manager._state == TimerState.RUNNING
        assert manager._running_since is not None, "the clock must restart"

        for _ in range(100):
            await asyncio.sleep(0.01)
            if sent.count(b"F") >= 2:
                break

        assert sent.count(b"F") >= 2, "the give-up command must be sent again"
        await manager.stop()
    finally:
        monkeypatch.undo()
