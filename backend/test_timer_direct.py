import asyncio
from unittest.mock import MagicMock, patch, AsyncMock
import pytest
import serial
from .timer.manager import TimerManager
from .timer.devices.microwizard import MicroWizardDevice
from .timer.state_machine import TimerState

@pytest.mark.anyio
async def test_timer_manager_connect_direct_success():
    """Verifies that connect_direct successfully opens a port and starts reading."""
    mock_serial = MagicMock(spec=serial.Serial)
    mock_serial.is_open = True
    mock_serial.read.side_effect = [b"", b"N1\n", b""]
    
    with patch("serial.Serial", return_value=mock_serial):
        device = MicroWizardDevice()
        manager = TimerManager(track_id=1, device=device)
        
        await manager.connect_direct("/dev/ttyUSB0")
        
        assert manager._serial == mock_serial
        assert manager._read_task is not None
        
        # Give some time for the read loop to run
        await asyncio.sleep(0.3)
        
        # Should have transitioned to IDLE after seeing N1\n
        assert manager._state == TimerState.IDLE
        
        await manager.stop()
        assert manager._serial is None
        assert manager._read_task is None

@pytest.mark.anyio
async def test_timer_manager_connect_direct_failure():
    """Verifies that connect_direct handles port opening failure."""
    with patch("serial.Serial", side_effect=Exception("Port busy")):
        device = MicroWizardDevice()
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
        device = MicroWizardDevice()
        manager = TimerManager(track_id=1, device=device)
        
        await manager.connect_direct("/dev/ttyUSB0")
        
        # Give time for the read loop to hit the exception
        await asyncio.sleep(0.2)
        
        assert manager._state == TimerState.FAULT
        assert "Serial error" in manager._last_error
        await manager.stop()
