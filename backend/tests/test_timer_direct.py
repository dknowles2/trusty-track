import asyncio
from unittest.mock import MagicMock, patch

import pytest
import serial

from backend.services.timer.devices import MICROWIZARD
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


@pytest.mark.anyio
async def test_timer_manager_connect_direct_success():
    """Verifies that connect_direct successfully opens a port and starts reading."""
    mock_serial = MagicMock(spec=serial.Serial)
    mock_serial.is_open = True
    mock_serial.read.side_effect = [b"", b"Copyright (c) Micro Wizard\r\n", b""]

    with patch("serial.Serial", return_value=mock_serial):
        device = MICROWIZARD
        manager = TimerManager(track_id=1, device=device)

        await manager.connect_direct("/dev/ttyUSB0")

        assert manager._serial == mock_serial
        assert manager._read_task is not None

        # Give some time for the read loop to run
        await asyncio.sleep(0.3)

        # Should have transitioned to IDLE after seeing identification string
        assert manager._state == TimerState.IDLE

        await manager.stop()
        assert manager._serial is None
        assert manager._read_task is None


@pytest.mark.anyio
async def test_timer_manager_connect_direct_failure():
    """Verifies that connect_direct handles port opening failure."""
    with patch("serial.Serial", side_effect=Exception("Port busy")):
        device = MICROWIZARD
        manager = TimerManager(track_id=1, device=device)

        await manager.connect_direct("/dev/ttyUSB1")

        assert manager._state == TimerState.FAULT
        assert "Failed to open port" in manager._last_error
        assert manager._watchdog_task is not None
        await manager.stop()


@pytest.mark.anyio
async def test_timer_manager_read_loop_exception():
    """Verifies that the read loop handles serial exceptions and triggers fault."""
    mock_serial = MagicMock(spec=serial.Serial)
    mock_serial.is_open = True
    mock_serial.read.side_effect = serial.SerialException("Device disconnected")

    with patch("serial.Serial", return_value=mock_serial):
        device = MICROWIZARD
        manager = TimerManager(track_id=1, device=device)

        await manager.connect_direct("/dev/ttyUSB0")

        # Give time for the read loop to hit the exception
        await asyncio.sleep(0.2)

        assert manager._state == TimerState.FAULT
        assert "Serial error" in manager._last_error
        await manager.stop()


@pytest.mark.anyio
async def test_timer_manager_reset():
    """Verifies that reset clears buffers and transitions to IDLE."""
    from backend.services.timer.devices.base import LaneResult

    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)
    manager._state = TimerState.FAULT
    manager._active_heat_id = 99
    manager._buf = b"some garbage"
    manager._pending_results = {1: LaneResult(lane=1, time_seconds=1.23, place=1)}

    await manager.reset()

    assert manager._state == TimerState.IDLE
    assert manager._active_heat_id is None
    assert manager._buf == b""
    assert manager._pending_results == {}


@pytest.mark.anyio
async def test_connect_direct_awaits_old_read_task_before_opening_new_serial():
    """Cancelling ``_read_task`` without awaiting it lets its ``finally`` block
    close and clear the newly opened ``_serial`` (#1375)."""
    first_serial = MagicMock(spec=serial.Serial)
    first_serial.is_open = True
    first_serial.read.return_value = b""

    second_serial = MagicMock(spec=serial.Serial)
    second_serial.is_open = True
    second_serial.read.return_value = b""

    manager = TimerManager(track_id=1, device=MICROWIZARD)
    old_task_done_at_open = []

    with patch("serial.Serial", return_value=first_serial):
        await manager.connect_direct("/dev/ttyUSB0")

    old_read_task = manager._read_task
    assert old_read_task is not None

    def open_second(*_args, **_kwargs):
        old_task_done_at_open.append(old_read_task.done())
        return second_serial

    with patch("serial.Serial", side_effect=open_second):
        await manager.connect_direct("/dev/ttyUSB0")

    assert old_task_done_at_open == [True]
    assert manager._serial is second_serial
    second_serial.close.assert_not_called()

    await manager.stop()


@pytest.mark.anyio
async def test_event_lock_serializes_concurrent_manager_entry_points(db):
    """``revalidate_armed_heat``, ``nudge_if_unidentified``, ``handle_connect``,
    and ``handle_disconnect`` must all wait for ``_event_lock`` (#1375)."""
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.CONNECTED
    completed: list[str] = []

    async def run_nudge():
        await manager.nudge_if_unidentified()
        completed.append("nudge")

    async def run_connect():
        await manager.handle_connect()
        completed.append("connect")

    async def run_disconnect():
        await manager.handle_disconnect()
        completed.append("disconnect")

    async def run_revalidate():
        await manager.revalidate_armed_heat(db)
        completed.append("revalidate")

    async with manager._event_lock:
        tasks = [
            asyncio.create_task(run_nudge()),
            asyncio.create_task(run_connect()),
            asyncio.create_task(run_disconnect()),
            asyncio.create_task(run_revalidate()),
        ]
        await asyncio.sleep(0.02)
        assert completed == []

    await asyncio.gather(*tasks)
    assert set(completed) == {"nudge", "connect", "disconnect", "revalidate"}

    await manager.stop()
