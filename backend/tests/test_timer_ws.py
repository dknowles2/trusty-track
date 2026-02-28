import asyncio
import base64
from unittest.mock import AsyncMock, patch

import pytest

from backend.api.main import TIMER_MANAGERS
from backend.db import crud, schemas
from backend.services.timer.devices.microwizard import MicroWizardDevice
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


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
    manager._active_heat_id = None  # clear any leaking state from previous tests
    TIMER_MANAGERS[track_id] = manager

    # Patch SessionLocal in main to return our test db session
    with (
        patch("backend.api.main.SessionLocal", return_value=db_session),
        client.websocket_connect(f"/ws/timer/{track_id}") as websocket,
    ):
        # 1. Received initial configuration
        data = websocket.receive_json()
        assert data["type"] == "configure"
        assert data["baud_rate"] == 9600

        # 2. Frontend sends ready message
        websocket.send_json({"type": "ready"})

        # 3. TimerManager should have sent initialization commands
        # upon connection: N1, N2.
        n1_msg = websocket.receive_json()
        assert base64.b64decode(n1_msg["data"]) == b"N1"

        n2_msg = websocket.receive_json()
        assert base64.b64decode(n2_msg["data"]) == b"N2"

        assert manager._state == TimerState.CONNECTED

        # Frontend sends identification response
        websocket.send_json(
            {
                "type": "serial_rx",
                "data": base64.b64encode(
                    b"Copyright (c) Micro Wizard 2002-2009\r\n"
                ).decode("utf-8"),
            }
        )

        # Give backend a moment to process — it will transition to IDLE
        await asyncio.sleep(0.1)
        assert manager._state == TimerState.IDLE

        # 4. Prepare a heat (lanes 1 and 2 active; lanes 3-6 masked)
        # Mock _record_results to avoid needing a full Heat DB record
        manager._record_results = AsyncMock()

        await manager.prepare_heat(heat_id=1, lane_mask=0b11)
        assert manager._state == TimerState.ARMED

        # Expect: MG MC MD ME MF LR
        expected_commands = [b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"]
        for expected in expected_commands:
            msg = websocket.receive_json()
            assert msg["type"] == "serial_tx"
            assert base64.b64decode(msg["data"]) == expected

        # 5. Send results in old single-line format
        websocket.send_json(
            {
                "type": "serial_rx",
                "data": base64.b64encode(b"A=3.452! B=3.501\r\n").decode("utf-8"),
            }
        )

        # Give backend a moment to transition
        await asyncio.sleep(0.1)

        assert manager._state == TimerState.RUNNING
        assert 1 in manager._pending_results
        assert 2 in manager._pending_results

        # Should have called _record_results
        manager._record_results.assert_awaited_once()
