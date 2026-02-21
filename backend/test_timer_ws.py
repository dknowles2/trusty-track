import base64
import json
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from . import crud, models, schemas
from .main import app, TIMER_MANAGERS
from .timer.devices.microwizard import MicroWizardDevice
from .timer.manager import TimerManager
from .timer.state_machine import TimerState


@pytest.fixture
def proxy_track(db):
    """Creates a track configured for proxy mode."""
    track_in = schemas.TrackCreate(
        name="Proxy Track", lane_count=4, timer_type="AUTO_DETECT_PROXY"
    )
    track = crud.create_track(db, track_in)
    return track


# Use the client fixture from conftest.py which provides TestClient(app)
# and overrides the get_db dependency.

@pytest.mark.anyio
async def test_timer_websocket_proxy_flow(client, proxy_track, db_session):
    """Verifies the full WebSocket proxy handshake and message relaying."""
    track_id = proxy_track.id
    device = MicroWizardDevice()
    manager = TimerManager(track_id, device)
    TIMER_MANAGERS[track_id] = manager

    # Patch SessionLocal in main to return our test db session
    with patch("backend.main.SessionLocal", return_value=db_session):
        with client.websocket_connect(f"/ws/timer/{track_id}") as websocket:
            # 1. Received initial configuration
            data = websocket.receive_json()
            assert data["type"] == "configure"
            assert data["baud_rate"] == 9600

            # 2. TimerManager should have sent identification probe upon connection
            data = websocket.receive_json()
            assert data["type"] == "serial_tx"
            assert base64.b64decode(data["data"]) == b"N1\n"
            assert manager._state == TimerState.CONNECTED

            # 3. Frontend (test) sends identification response
            websocket.send_json({
                "type": "serial_rx",
                "data": base64.b64encode(b"N1\n").decode("utf-8")
            })

            # Check state
            assert manager._state == TimerState.IDLE

            # 4. Prepare a heat
            # Inject a mock for _record_results to avoid having to setup a full Heat record
            manager._record_results = AsyncMock()
            
            await manager.prepare_heat(heat_id=1, lane_mask=0b11) # Lanes 1 and 2
            assert manager._state == TimerState.ARMED

            # Check for sent commands: M3\n and LR\n
            data1 = websocket.receive_json()
            data2 = websocket.receive_json()
            assert data1["type"] == "serial_tx"
            assert base64.b64decode(data1["data"]) == b"M3\n"
            assert data2["type"] == "serial_tx"
            assert base64.b64decode(data2["data"]) == b"LR\n"

            # 5. Send results
            # First result transitions state to RUNNING (MW auto-detects start on first result)
            websocket.send_json({
                "type": "serial_rx",
                "data": base64.b64encode(b"  1    3.452  1\n").decode("utf-8")
            })
            assert manager._state == TimerState.RUNNING
            assert 1 in manager._pending_results

            # Final result
            websocket.send_json({
                "type": "serial_rx",
                "data": base64.b64encode(b"  2    3.501  2\n").decode("utf-8")
            })
            
            # Should have called _record_results
            manager._record_results.assert_awaited_once()


def test_timer_websocket_wrong_mode(client, db):
    """Verifies that the WebSocket rejects connections for non-proxy tracks."""
    track_in = schemas.TrackCreate(
        name="Fake Track", lane_count=4, timer_type="FAKE"
    )
    track = crud.create_track(db, track_in)
    
    # Ensure manager exists
    TIMER_MANAGERS[track.id] = TimerManager(track.id, MicroWizardDevice())

    from fastapi import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(f"/ws/timer/{track.id}") as websocket:
            websocket.receive_json()
    assert excinfo.value.code == 4000
