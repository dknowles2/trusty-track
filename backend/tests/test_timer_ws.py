import asyncio
import base64
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import WebSocketDisconnect

from backend.api.main import TIMER_MANAGERS, TIMER_WS_CONNECTIONS, timer_websocket
from backend.db import crud, models, schemas
from backend.services.timer.devices import MICROWIZARD
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
    device = MICROWIZARD
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
        # All four framing parameters, not the baud rate alone. Web Serial
        # defaults to 8-N-1 exactly as pyserial does, so a device that is not
        # 8-N-1 was opened wrong on this path too (issue #88).
        assert data["baud_rate"] == 9600
        assert data["data_bits"] == 8
        assert data["stop_bits"] == 1
        assert data["parity"] == "N"

        # 2. Frontend sends ready message
        websocket.send_json({"type": "ready"})

        # 3. The first thing out is the probe, not the setup commands: this
        # path detects now rather than assuming a MicroWizard (issue #89).
        probe_msg = websocket.receive_json()
        assert base64.b64decode(probe_msg["data"]) == b"RV"

        # Frontend relays the device's banner, both lines of it
        websocket.send_json(
            {
                "type": "serial_rx",
                "data": base64.b64encode(
                    b"Copyright (c) Micro Wizard 2002-2009\r"
                    b"K2 Version 2.3A  Serial Number29284\r"
                ).decode("utf-8"),
            }
        )

        # 4. Identified, so the setup commands go out and the manager is IDLE
        # without ever sitting in CONNECTED — the banner already happened.
        n1_msg = websocket.receive_json()
        assert base64.b64decode(n1_msg["data"]) == b"N1"

        n2_msg = websocket.receive_json()
        assert base64.b64decode(n2_msg["data"]) == b"N2"

        await asyncio.sleep(0.1)
        assert manager._state == TimerState.IDLE
        assert manager._device is MICROWIZARD

        # 5. Prepare a heat (lanes 1 and 2 active; lanes 3-6 masked)
        # Mock _record_results to avoid needing a full Heat DB record
        manager._record_results = AsyncMock()

        await manager.prepare_heat(
            heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
        )
        assert manager._state == TimerState.ARMED

        # Expect: MG MC MD ME MF LR
        expected_commands = [b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"]
        for expected in expected_commands:
            msg = websocket.receive_json()
            assert msg["type"] == "serial_tx"
            assert base64.b64decode(msg["data"]) == expected

        # 6. Send results in old single-line format
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


class _FakeProxyWebSocket:
    """A minimal double for the parts of ``fastapi.WebSocket`` the endpoint
    uses, driven directly from the test's own coroutine — via ``asyncio.
    create_task`` on the test's own event loop — rather than through two
    independent ``TestClient`` websocket sessions.

    Two real proxy connections share nothing but the track's ``TimerManager``,
    and a ``TestClient`` websocket session runs its connection on its own
    dedicated thread and event loop unless the client itself is entered as a
    context manager. Driving both connections as plain tasks on one loop is
    what a real server actually does — one process, one loop, concurrent
    connections as coroutines rather than threads — and it is what lets
    ``manager._event_lock`` (an ``asyncio.Lock``) and the ``ProxySession``
    tasks be touched from both "connections" without a cross-loop hazard that
    two TestClient portals would add and that no production server has.
    """

    def __init__(self) -> None:
        self.query_params: dict[str, str] = {}
        self._inbound: asyncio.Queue = asyncio.Queue()
        self._outbound: asyncio.Queue = asyncio.Queue()
        self.close_code: int | None = None
        self.close_reason: str | None = None

    # -- the fastapi.WebSocket surface the endpoint uses --

    async def accept(self) -> None:
        pass

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.close_code = code
        self.close_reason = reason
        # A close the app initiates ends its own receive loop too, exactly as
        # a real ASGI server eventually delivers a disconnect once the close
        # completes.
        await self._inbound.put(_CLOSE)

    async def send_json(self, data: dict) -> None:
        await self._outbound.put(data)

    async def receive_json(self) -> dict:
        item = await self._inbound.get()
        if item is _CLOSE:
            raise WebSocketDisconnect(
                code=self.close_code or 1000, reason=self.close_reason or ""
            )
        return item

    # -- the browser's half, driven by the test --

    async def deliver(self, message: dict) -> None:
        await self._inbound.put(message)

    async def recv(self) -> dict:
        return await self._outbound.get()

    async def hang_up(self) -> None:
        """Simulate the browser tab closing this connection on its own."""
        await self._inbound.put(_CLOSE)


_CLOSE = object()


async def _identify_microwizard(ws: _FakeProxyWebSocket) -> None:
    """Drive one proxy connection through the identification handshake to a
    Micro Wizard banner, exactly as ``test_timer_websocket_proxy_flow`` does
    over a real ``TestClient`` socket, but against the fake above."""
    configure = await ws.recv()
    assert configure["type"] == "configure"
    await ws.deliver({"type": "ready"})

    probe_msg = await ws.recv()
    assert base64.b64decode(probe_msg["data"]) == b"RV"

    await ws.deliver(
        {
            "type": "serial_rx",
            "data": base64.b64encode(
                b"Copyright (c) Micro Wizard 2002-2009\r"
                b"K2 Version 2.3A  Serial Number29284\r"
            ).decode("utf-8"),
        }
    )

    assert base64.b64decode((await ws.recv())["data"]) == b"N1"
    assert base64.b64decode((await ws.recv())["data"]) == b"N2"


@pytest.mark.anyio
async def test_a_second_connection_takes_over_the_timer(proxy_track, db_session):
    """A second proxy connection for the same track (#301): the first is told
    why it lost the timer, with an explicit reason rather than a silent
    disconnect, and the second is the one whose commands actually reach the
    device from then on."""
    track_id = proxy_track.id
    manager = TimerManager(track_id, MICROWIZARD)
    manager._active_heat_id = None
    TIMER_MANAGERS[track_id] = manager

    ws1 = _FakeProxyWebSocket()
    ws2 = _FakeProxyWebSocket()

    with patch("backend.api.main.SessionLocal", return_value=db_session):
        task1 = asyncio.create_task(timer_websocket(ws1, track_id))
        await _identify_microwizard(ws1)
        await asyncio.sleep(0.1)
        assert manager._state == TimerState.IDLE
        first_registered_websocket = TIMER_WS_CONNECTIONS[track_id][0]
        first_write_fn = manager._write_fn

        task2 = asyncio.create_task(timer_websocket(ws2, track_id))

        # The outgoing connection is closed with an explicit reason, not left
        # to read as an ordinary, unremarkable disconnect — and its own
        # handler runs to completion rather than hanging.
        await asyncio.wait_for(task1, timeout=2)
        assert ws1.close_code == 4000
        assert ws1.close_reason == "Another connection took over this timer"

        # The manager's write function was reset and reassigned, not left
        # pointing at the connection that just lost the timer.
        assert manager._write_fn is not first_write_fn

        await _identify_microwizard(ws2)
        await asyncio.sleep(0.1)
        assert manager._state == TimerState.IDLE
        assert manager._device is MICROWIZARD

        # Commands go to the surviving connection.
        manager._record_results = AsyncMock()
        await manager.prepare_heat(
            heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
        )
        for expected in (b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"):
            msg = await ws2.recv()
            assert msg["type"] == "serial_tx"
            assert base64.b64decode(msg["data"]) == expected

        # Only the surviving connection is registered as owning the timer.
        assert TIMER_WS_CONNECTIONS[track_id][0] is not first_registered_websocket

        # Clean up the second connection so its task does not outlive the test.
        await ws2.hang_up()
        await asyncio.wait_for(task2, timeout=2)
        assert track_id not in TIMER_WS_CONNECTIONS
