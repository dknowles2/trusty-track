from unittest.mock import AsyncMock

import pytest

from backend.services.timer.devices import MICROWIZARD
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


@pytest.mark.anyio
async def test_microwizard_reconnect_stuck_check():
    """Reproduce the scenario where the timer might be stuck in CONNECTED."""
    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()

    # 1. Trigger connect
    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED

    # Verify commands sent on connect (N1, N2), but NOT arming (MG, LR)
    sent_commands = [call.args[0] for call in manager._send_commands.call_args_list]
    flat_commands = [cmd for sublist in sent_commands for cmd in sublist]
    assert b"N1" in flat_commands
    assert b"N2" in flat_commands

    # 2. Simulate hardware responding with the identification
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    # Transitions to IDLE immediately on first ident line
    assert manager._state == TimerState.IDLE


@pytest.mark.anyio
async def test_microwizard_reconnect_with_active_heat():
    """Test reconnection when a heat is already active."""
    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()

    # Set up active heat
    manager._active_heat_id = 123
    manager._lane_mask = 0b11

    # 1. Trigger connect
    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED

    # 2. Simulate hardware responding with the RV identification
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    # Transition to ARMED
    assert manager._state == TimerState.ARMED

    # Verify arming commands (MG, LR) were sent AFTER identification
    sent_commands = [call.args[0] for call in manager._send_commands.call_args_list]
    flat_commands = [cmd for sublist in sent_commands for cmd in sublist]
    assert b"MG" in flat_commands
    assert b"LR" in flat_commands


@pytest.mark.anyio
async def test_microwizard_reconnect_stuck_with_garbage_data():
    """Reproduce potential stuck state where identification is delayed or obscured."""
    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()

    # 1. Trigger connect
    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED

    # 2. Simulate hardware sending junk data first (e.g. results from a previous heat)
    # "A=3.001!" parses as a valid event; robust handling transitions CONNECTED → IDLE.
    await manager.receive_bytes(b'A=3.001! B=3.002"\r\n')
    assert manager._state == TimerState.IDLE

    # 3. Now send identification (triggered by e.g. unsolicited boot message)
    # Line 1 (Copyright) -> matches unsolicited ident check
    # -> calls handle_connect -> CONNECTED
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    assert manager._state == TimerState.CONNECTED

    # Line 2 (Version) -> informational, no state change (stays in CONNECTED)
    await manager.receive_bytes(b"K2 Version 2.3A  Serial Number29284\r\n")
    assert manager._state == TimerState.CONNECTED

    # Send ident line again (as if hardware responded to our probe)
    # -> transitions back to IDLE
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    assert manager._state == TimerState.IDLE


@pytest.mark.anyio
async def test_microwizard_reconnect_delimiter_mismatch():
    """Test what happens if the hardware sends \n but we expect \r\n."""
    device = MICROWIZARD
    # the MicroWizard profile's delimiter is b'\r\n'
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()

    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED

    # 1. Send identification line 1 with only \n (not the expected \r\n delimiter)
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\n")
    assert manager._state == TimerState.CONNECTED
    assert manager._buf == b"Copyright (c) Micro Wizard 2002-2009\n"

    # 2. Send \r\n — completes the buffered line 1
    await manager.receive_bytes(b" Micro Wizard 2002-2009\r\n")
    # Transitions to IDLE immediately on first ident line completion
    assert manager._state == TimerState.IDLE


@pytest.mark.anyio
async def test_microwizard_reboot_during_idle():
    """Test that an unsolicited ident line (reboot) triggers re-init."""
    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()

    # Start in IDLE
    manager._state = TimerState.IDLE

    # 1. Receive unsolicited identification (e.g. from a hardware reboot)
    # Line 1 (Copyright) -> transitions IDLE -> CONNECTED (via handle_connect)
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    assert manager._state == TimerState.CONNECTED

    # 2. Complete re-initialization sequence by seeing identification again
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    assert manager._state == TimerState.IDLE


@pytest.mark.anyio
async def test_microwizard_reboot_during_heat():
    """Test that a reboot during a heat transitions to CONNECTED then ARMED."""
    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()

    # Start in ARMED state with an active heat
    manager._state = TimerState.ARMED
    manager._active_heat_id = 456
    manager._lane_mask = 0b01

    # 1. Receive unsolicited identification Line 1
    # Transitions ARMED -> CONNECTED
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    assert manager._state == TimerState.CONNECTED

    # 2. Complete re-initialization by seeing identification again
    # Transitions CONNECTED -> ARMED
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    assert manager._state == TimerState.ARMED
