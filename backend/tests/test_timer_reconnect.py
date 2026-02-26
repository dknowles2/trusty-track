import pytest
from unittest.mock import AsyncMock
from backend.services.timer.manager import TimerManager
from backend.services.timer.devices.microwizard import MicroWizardDevice
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
    
    # Verify commands sent: N1 and any initialization
    # manager.handle_connect sends: identification_commands() + initialization_commands()
    sent_commands = [call.args[0] for call in manager._send_commands.call_args_list]
    # Flatten list of lists
    flat_commands = [cmd for sublist in sent_commands for cmd in sublist]
    assert b'RV\n' in flat_commands
    
    # 2. Simulate hardware responding
    await manager.receive_bytes(b"Copyright\r\n")
    
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
    
    assert b'M3\n' in flat_commands
    assert b'LR\n' in flat_commands
    
    # 2. Simulate hardware responding
    await manager.receive_bytes(b"Copyright\r\n")
    
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
    
    # 2. Simulate hardware sending some junk data first (e.g. results from a previous heat)
    # A=3.001! B=3.002"
    await manager.receive_bytes(b"A=3.001! B=3.002\"\r\n")
    
    # Wait, the string "A=3.001!" parses as a valid event according to the old regex!
    # Because of the new robust handling, if it finds valid events while CONNECTED, it transitions to IDLE.
    assert manager._state == TimerState.IDLE
    
    # 3. Now send the valid identification (won't do much state-wise since it's already IDLE)
    await manager.receive_bytes(b"Copyright\r\n")
    
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
    
    # 1. Send Copyright with only \n
    await manager.receive_bytes(b"Copyright\n")
    
    # Should still be in CONNECTED because \r\n was not found
    assert manager._state == TimerState.CONNECTED
    assert manager._buf == b"Copyright\n"
    
    # 2. Now send \r\n
    await manager.receive_bytes(b"\r\n")
    
    # Now it should have processed the line (even if it's just \r because of how split works)
    # Actually, if we send \r\n, it finds \r\n. The previous b"Copyright\n" is still in buffer.
    # Buffer is now b"Copyright\n\r\n"
    # delim_idx will be 9 (at \r\n)
    # line will be b"Copyright\n"
    # is_identified_by(b"N1\n") should be True (it uses regex.search)
    assert manager._state == TimerState.IDLE
