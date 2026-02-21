"""
TimerManager: one instance per Track.

Owns byte framing, state machine, result recording, and pub/sub publishing.
Shared by all connectivity modes (fake, backend-direct, frontend-proxy).
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Awaitable, Dict, List, Optional

from ..pubsub import pubsub
from ..database import SessionLocal
from .. import crud, models
from .state_machine import TimerState
from .devices.base import TimerDevice, TimerEvent, RaceStarted, LaneResult, GateClosed, DeviceError

logger = logging.getLogger(__name__)

# Leading bytes to strip from incoming result lines
_STRIP_CHARS = b'@>'


@dataclass
class TimerStatus:
    state: str
    device_name: Optional[str]
    lane_count: Optional[int]
    active_heat_id: Optional[int]
    last_error: Optional[str]


class TimerManager:
    def __init__(self, track_id: int, device: TimerDevice) -> None:
        self._track_id = track_id
        self._device = device
        self._buf: bytes = b''
        self._active_heat_id: Optional[int] = None
        self._lane_mask: int = 0
        self._pending_results: Dict[int, LaneResult] = {}
        self._last_error: Optional[str] = None
        self._write_fn: Callable[[bytes], Awaitable[None]] = self._noop_write

        if not device.requires_serial:
            # Fake timer: skip DISCONNECTED/CONNECTED/identification; start in IDLE
            self._state = TimerState.IDLE
        else:
            self._state = TimerState.DISCONNECTED

    # ------------------------------------------------------------------ #
    # Write-path configuration                                             #
    # ------------------------------------------------------------------ #

    async def _noop_write(self, data: bytes) -> None:
        pass

    def set_write_fn(self, fn: Callable[[bytes], Awaitable[None]]) -> None:
        """Set the function used to write bytes to the serial device.

        For backend-direct mode, called with a function that writes to pyserial.
        For proxy mode, called with a function that sends serial_tx WS messages.
        """
        self._write_fn = fn

    async def _send_commands(self, commands: List[bytes]) -> None:
        for cmd in commands:
            await self._write_fn(cmd)

    # ------------------------------------------------------------------ #
    # Status                                                               #
    # ------------------------------------------------------------------ #

    def status(self) -> TimerStatus:
        lane_count = bin(self._lane_mask).count('1') if self._lane_mask else None
        return TimerStatus(
            state=self._state.value,
            device_name=self._device.name,
            lane_count=lane_count,
            active_heat_id=self._active_heat_id,
            last_error=self._last_error,
        )

    # ------------------------------------------------------------------ #
    # Race control                                                         #
    # ------------------------------------------------------------------ #

    async def prepare_heat(self, heat_id: int, lane_mask: int) -> None:
        """Arm the timer for a heat. Sends device commands and transitions to ARMED."""
        self._active_heat_id = heat_id
        self._lane_mask = lane_mask
        self._pending_results = {}
        await self._send_commands(self._device.prepare_heat_commands(lane_mask))
        await self._transition(TimerState.ARMED)

    async def abort_heat(self) -> None:
        """Abort the current heat. Sends device reset commands and returns to IDLE."""
        self._active_heat_id = None
        self._pending_results = {}
        await self._send_commands(self._device.abort_commands())
        await self._transition(TimerState.IDLE)

    # ------------------------------------------------------------------ #
    # Byte framing (proxy and direct modes)                                #
    # ------------------------------------------------------------------ #

    async def receive_bytes(self, data: bytes) -> List[bytes]:
        """Buffer incoming bytes and process any complete messages.

        Returns bytes that should be written back to the serial device.
        For Phase 1 this is always empty; Phase 2/3 will fill in responses
        during the identification handshake.
        """
        self._buf += data
        while self._device.delimiter in self._buf:
            line, self._buf = self._buf.split(self._device.delimiter, 1)
            await self._process_line(line)
        return []

    async def _process_line(self, line: bytes) -> None:
        line = line.lstrip(_STRIP_CHARS).strip()
        if not line:
            return
        event = self._device.parse_line(line)
        if event is not None:
            await self._handle_event(event)

    # ------------------------------------------------------------------ #
    # Fake timer injection                                                 #
    # ------------------------------------------------------------------ #

    async def inject_event(self, event: TimerEvent) -> None:
        """Inject a timer event directly, bypassing serial parsing.

        Called by fakeTimerStart / fakeTimerFinish mutations. The same
        _handle_event logic runs as for real timers — no fake-specific branching.
        """
        await self._handle_event(event)

    # ------------------------------------------------------------------ #
    # State machine                                                        #
    # ------------------------------------------------------------------ #

    async def _transition(self, new_state: TimerState) -> None:
        if self._state == new_state:
            return
        logger.debug("Timer %d: %s → %s", self._track_id, self._state.value, new_state.value)
        self._state = new_state
        await pubsub.publish(f"timer_state:{self._track_id}", self.status())

    async def _handle_event(self, event: TimerEvent) -> None:
        if isinstance(event, RaceStarted):
            if self._state in (TimerState.ARMED, TimerState.READY):
                await self._transition(TimerState.RUNNING)
            else:
                logger.warning(
                    "Timer %d: RaceStarted in unexpected state %s",
                    self._track_id, self._state.value,
                )

        elif isinstance(event, GateClosed):
            if self._state == TimerState.ARMED and self._device.gate_state_is_knowable:
                await self._transition(TimerState.READY)

        elif isinstance(event, LaneResult):
            if self._state != TimerState.RUNNING:
                logger.warning(
                    "Timer %d: LaneResult received in state %s, ignoring",
                    self._track_id, self._state.value,
                )
                return
            self._pending_results[event.lane] = event
            expected_lanes = {
                i for i in range(1, 17) if self._lane_mask & (1 << (i - 1))
            }
            if expected_lanes and expected_lanes.issubset(self._pending_results.keys()):
                await self._record_results()

        elif isinstance(event, DeviceError):
            self._last_error = event.message
            logger.error("Timer %d device error: %s", self._track_id, event.message)
            await self._transition(TimerState.FAULT)

    async def _record_results(self) -> None:
        """Persist accumulated lane results to the database and notify subscribers."""
        heat_id = self._active_heat_id
        if heat_id is None:
            logger.error("Timer %d: _record_results called with no active heat", self._track_id)
            return

        # Build result list sorted by lane
        timer_results = sorted(self._pending_results.values(), key=lambda r: r.lane)

        db = SessionLocal()
        try:
            heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
            if heat is None:
                logger.error("Timer %d: heat %d not found", self._track_id, heat_id)
                return

            # Preserve racer_id assignments from the existing lane_results
            existing = json.loads(heat.lane_results) if heat.lane_results else []
            racer_by_lane: Dict[int, Optional[int]] = {r["lane"]: r.get("racer_id") for r in existing}

            results = [
                {
                    "lane": r.lane,
                    "racer_id": racer_by_lane.get(r.lane),
                    "time": r.time_seconds,
                    "place": r.place,
                }
                for r in timer_results
            ]

            crud.record_heat_result(db, heat_id, json.dumps(results))
            race_id = heat.race_id
        finally:
            db.close()

        # Notify race-state subscribers (e.g. RaceExecution, Observation)
        # Lazy import avoids circular dependency: schema.py will import timer in task 5.
        from ..schema import _publish_race_state
        await _publish_race_state(race_id)

        self._active_heat_id = None
        self._pending_results = {}
        await self._transition(TimerState.IDLE)

    # ------------------------------------------------------------------ #
    # Phase 2 stub                                                         #
    # ------------------------------------------------------------------ #

    async def connect_direct(self, port: str) -> None:
        """Open a serial port and begin reading (implemented in Phase 2)."""
        raise NotImplementedError("Backend-direct serial mode is not yet implemented")
