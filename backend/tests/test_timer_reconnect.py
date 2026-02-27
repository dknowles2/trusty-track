from unittest.mock import AsyncMock

import pytest

from backend.services.timer.devices.microwizard import MicroWizardDevice
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


@pytest.mark.anyio
async def test_microwizard_reconnect_stuck_check():
    """Reproduce the scenario where the timer might be stuck in CONNECTED."""
    device = MicroWizardDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()
    
    # 1. Trigger connect
    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED
    
    # Verify commands sent on connect
    sent_commands = [call.args[0] for call in manager._send_commands.call_args_list]
    # Flatten list of lists
    flat_commands = [cmd for sublist in sent_commands for cmd in sublist]
    assert b'RV' in flat_commands
    
    # 2. Simulate hardware responding with the RV identification line
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")

    # Should transition to IDLE
    assert manager._state == TimerState.IDLE

@pytest.mark.anyio
async def test_microwizard_reconnect_with_active_heat():
    """Test reconnection when a heat is already active."""
    device = MicroWizardDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()

    # Set up active heat
    manager._active_heat_id = 123
    manager._lane_mask = 0b11

    # 1. Trigger connect
    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED

    # Verify commands include M (lane mask) and RA (force results)
    sent_commands = [call.args[0] for call in manager._send_commands.call_args_list]
    flat_commands = [cmd for sublist in sent_commands for cmd in sublist]

    # lane_mask 0b11 = lanes 1 and 2 active; lanes 3-6 masked out (MC MD ME MF)
    assert b'MG' in flat_commands
    assert b'MC' in flat_commands
    assert b'LR' in flat_commands

    # 2. Simulate hardware responding with the RV identification line
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")

    # Transition to ARMED
    assert manager._state == TimerState.ARMED

@pytest.mark.anyio
async def test_microwizard_reconnect_stuck_with_garbage_data():
    """Reproduce potential stuck state where identification is delayed or obscured."""
    device = MicroWizardDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()
    
    # 1. Trigger connect
    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED
    
    # 2. Simulate hardware sending junk data first (e.g. results from a previous heat)
    # "A=3.001!" parses as a valid event; robust handling transitions CONNECTED → IDLE.
    await manager.receive_bytes(b"A=3.001! B=3.002\"\r\n")
    assert manager._state == TimerState.IDLE

    # 3. Now send identification (no-op state-wise since already IDLE)
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    
    # Still IDLE
    assert manager._state == TimerState.IDLE

@pytest.mark.anyio
async def test_microwizard_reconnect_delimiter_mismatch():
    """Test what happens if the hardware sends \n but we expect \r\n."""
    device = MicroWizardDevice()
    # MicroWizardDevice.delimiter is b'\r\n'
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()
    
    await manager.handle_connect()
    assert manager._state == TimerState.CONNECTED
    
    # 1. Send identification line with only \n (not the expected \r\n delimiter)
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\n")

    # Still CONNECTED — \r\n delimiter not yet found
    assert manager._state == TimerState.CONNECTED
    assert manager._buf == b"Copyright (c) Micro Wizard 2002-2009\n"

    # 2. Send \r\n — completes the buffered line, triggering identification
    await manager.receive_bytes(b" Micro Wizard 2002-2009\r\n")
    assert manager._state == TimerState.IDLE

@pytest.mark.anyio
async def test_microwizard_reboot_during_idle():
    """Test that an unsolicited ident line (reboot) triggers re-init."""
    device = MicroWizardDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()
    
    # Start in IDLE
    manager._state = TimerState.IDLE
    
    # 1. Receive unsolicited identification (e.g. from a hardware reboot)
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    
    # Verify identification/initialization commands were re-sent
    sent_commands = [call.args[0] for call in manager._send_commands.call_args_list]
    flat_commands = [cmd for sublist in sent_commands for cmd in sublist]
    assert b'RV' in flat_commands
    assert b'N1' in flat_commands
    assert b'N2' in flat_commands
    
    # State should remain IDLE (after handle_connect re-initializes)
    assert manager._state == TimerState.IDLE

@pytest.mark.anyio
async def test_microwizard_reboot_during_heat():
    """Test that a reboot during a heat re-arms the active heat."""
    device = MicroWizardDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._send_commands = AsyncMock()
    
    # Start in ARMED state with an active heat
    manager._state = TimerState.ARMED
    manager._active_heat_id = 456
    manager._lane_mask = 0b01
    
    # 1. Receive unsolicited identification
    await manager.receive_bytes(b"Copyright (c) Micro Wizard 2002-2009\r\n")
    
    # Verify lane mask was re-sent
    sent_commands = [call.args[0] for call in manager._send_commands.call_args_list]
    flat_commands = [cmd for sublist in sent_commands for cmd in sublist]
    
    assert b'RV' in flat_commands
    # MG = clear masks, MB-MF = mask out lanes 2-6 for mask 0b01
    assert b'MG' in flat_commands
    assert b'MB' in flat_commands
    assert b'LR' in flat_commands
    
    # State remains ARMED
    assert manager._state == TimerState.ARMED
