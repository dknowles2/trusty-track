import pytest
from unittest.mock import AsyncMock
from backend.services.timer.manager import TimerManager
from backend.services.timer.devices.microwizard import MicroWizardDevice
from backend.services.timer.state_machine import TimerState

@pytest.mark.anyio
async def test_repro_hang():
    print("Testing identification hang...")
    track_id = 1
    device = MicroWizardDevice()
    manager = TimerManager(track_id, device)
    
    # Mock write_fn
    write_mock = AsyncMock()
    manager.set_write_fn(write_mock)
    
    # Simulate connection
    await manager.handle_connect()
    print(f"State after handle_connect: {manager._state}")
    assert manager._state == TimerState.CONNECTED
    
    # Check what was sent
    print(f"Commands sent: {write_mock.call_args_list}")
    
    # Simulate receiving data with wrong delimiter (e.g. \r only instead of \r\n)
    # Note: MicroWizard now uses \r\n as delimiter, so \r is just part of the buffer
    print("Sending 'Micro Wizard\\r' (not a complete line)...")
    await manager.receive_bytes(b"Micro Wizard\r")
    print(f"State after Micro Wizard\\r: {manager._state}")
    assert manager._state == TimerState.CONNECTED
    
    # Simulate receiving data with correct delimiter
    print("Sending '\\n' to complete the line...")
    await manager.receive_bytes(b"\n")
    print(f"State after \\n: {manager._state}")
    assert manager._state == TimerState.IDLE
    
    # Simulate being stuck in CONNECTED and receiving a result
    print("\nTesting result during CONNECTED state...")
    manager = TimerManager(track_id, device)
    manager.set_write_fn(write_mock)
    await manager.handle_connect()
    
    # Sending a result line without identifying first
    print("Sending result line '  1    3.452  1\\r\\n' during CONNECTED state...")
    # NOTE: It should now transition out of CONNECTED because it found a valid event
    await manager.receive_bytes(b"  1    3.452  1\r\n")
    print(f"State after result line: {manager._state}")
    # Should have transitioned to IDLE (or ARMED if heat active) because it parsed a valid LaneResult
    assert manager._state == TimerState.IDLE
