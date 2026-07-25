"""
TimerManager: one instance per Track.

Owns byte framing, state machine, result recording, and pub/sub publishing.
Shared by all connectivity modes (fake, backend-direct, frontend-proxy).
"""

import asyncio
import contextlib
import json
import logging
import re
from collections import deque
from collections.abc import Awaitable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import serial

from backend.api.pubsub import pubsub
from backend.db import crud, models
from backend.db.database import SessionLocal

# Circular import handled by importing inside methods or using full module path
# from backend.api.schema import _publish_race_state
from .devices.base import (
    DeviceError,
    GateClosed,
    LaneResult,
    RaceStarted,
    TimerDevice,
    TimerEvent,
)
from .devices.fake import FakeTimerDevice
from .devices.microwizard import MicroWizardDevice
from .state_machine import TimerState

logger = logging.getLogger(__name__)

MAX_SERIAL_LOG = 100


def _format_serial_bytes(data: bytes) -> str:
    """Format bytes as a readable string, escaping non-printable characters."""
    result = []
    for b in data:
        if 32 <= b < 127:
            result.append(chr(b))
        elif b == 0x0D:
            result.append("\\r")
        elif b == 0x0A:
            result.append("\\n")
        elif b == 0x09:
            result.append("\\t")
        else:
            result.append(f"\\x{b:02x}")
    return "".join(result)


@dataclass
class SerialLogEntry:
    direction: str  # "RX" or "TX"
    data: str
    timestamp: str


@dataclass
class TimerStatus:
    state: str
    device_name: Optional[str]
    lane_count: Optional[int]
    active_heat_id: Optional[int]
    last_error: Optional[str]
    pending_results: list[dict[str, Any]] = field(default_factory=list)
    serial_log: list[SerialLogEntry] = field(default_factory=list)
    racer_by_lane: dict[int, Optional[int]] = field(default_factory=dict)


class TimerManager:
    def __init__(self, track_id: int, device: TimerDevice) -> None:
        self._track_id = track_id
        self._device = device
        self._buf: bytes = b""
        self._active_heat_id: Optional[int] = None
        self._active_heat_kind: Optional[models.HeatKind] = None
        self._lane_mask: int = 0
        self._pending_results: dict[int, LaneResult] = {}
        self._racer_by_lane: dict[int, Optional[int]] = {}
        self._last_error: Optional[str] = None
        self._write_fn: Callable[[bytes], Awaitable[None]] = self._noop_write
        self._serial: Optional[serial.Serial] = None
        self._read_task: Optional[asyncio.Task] = None
        self._direct_port: Optional[str] = None
        self._watchdog_task: Optional[asyncio.Task] = None
        self._running_since: Optional[float] = None
        self._event_lock = asyncio.Lock()
        self._serial_log: deque = deque(maxlen=MAX_SERIAL_LOG)
        # Queue of (command, expected_response_pattern) for commands that have
        # been sent but whose acknowledgment has not yet been received.
        self._pending_acks: deque[tuple[bytes, re.Pattern[bytes]]] = deque()

        if not device.requires_serial:
            # Fake timer: skip DISCONNECTED/CONNECTED/identification; start in IDLE
            self._state = TimerState.IDLE
        else:
            self._state = TimerState.DISCONNECTED

    @property
    def track_id(self) -> int:
        return self._track_id

    # ------------------------------------------------------------------ #
    # Configuration                                                        #
    # ------------------------------------------------------------------ #

    async def set_device(self, device: TimerDevice) -> None:
        """Update the device and reset state. Stops any active connections."""
        async with self._event_lock:
            await self.stop()
            self._device = device
            self._buf = b""
            self._pending_results = {}
            self._last_error = None

            if not device.requires_serial:
                await self._transition(TimerState.IDLE)
            else:
                await self._transition(TimerState.DISCONNECTED)

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

    async def _send_commands(self, commands: list[bytes]) -> None:
        for cmd in commands:
            logger.info(f"Timer {self._track_id} sending command: {cmd}")
            self._serial_log.append(
                SerialLogEntry(
                    direction="TX",
                    data=_format_serial_bytes(cmd),
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
            )
            await pubsub.publish(f"timer_state:{self._track_id}", self.status())
            await self._write_fn(cmd)
            expected = self._device.expected_response_for(cmd)
            if expected is not None:
                self._pending_acks.append((cmd, expected))

    # ------------------------------------------------------------------ #
    # Status                                                               #
    # ------------------------------------------------------------------ #

    def status(self) -> TimerStatus:
        lane_count = bin(self._lane_mask).count("1") if self._lane_mask else None
        pending = [
            {
                "lane": r.lane,
                "time": r.time_seconds,
                "place": r.place,
            }
            for r in self._pending_results.values()
        ]
        return TimerStatus(
            state=self._state.value,
            device_name=self._device.name,
            lane_count=lane_count,
            active_heat_id=self._active_heat_id,
            last_error=self._last_error,
            pending_results=pending,
            serial_log=list(self._serial_log),
            racer_by_lane=self._racer_by_lane,
        )

    # ------------------------------------------------------------------ #
    # Race control                                                         #
    # ------------------------------------------------------------------ #

    async def reset(self) -> None:
        """Manually reset the timer to IDLE state, clearing buffers and active heat."""
        async with self._event_lock:
            self._active_heat_id = None
            self._active_heat_kind = None
            self._buf = b""
            self._pending_results = {}
            self._racer_by_lane = {}
            await self._transition(TimerState.IDLE)

    async def prepare_heat(
        self,
        heat_id: int,
        kind: models.HeatKind,
        lane_mask: int,
        racer_by_lane: Optional[dict[int, Optional[int]]] = None,
    ) -> None:
        """Arm the timer for a heat. Sends device commands and transitions to ARMED.

        ``kind`` is required: heat ids are only unique within their own table, so
        the caller must say which table this id belongs to.
        """
        async with self._event_lock:
            self._active_heat_id = heat_id
            self._active_heat_kind = kind
            self._lane_mask = lane_mask
            self._pending_results = {}
            self._racer_by_lane = racer_by_lane or {}
            await self._send_commands(self._device.prepare_heat_commands(lane_mask))
            await self._transition(TimerState.ARMED)

    async def abort_heat(self) -> None:
        """Abort the current heat. Sends device reset commands and returns to IDLE."""
        async with self._event_lock:
            self._active_heat_id = None
            self._active_heat_kind = None
            self._pending_results = {}
            self._racer_by_lane = {}
            await self._send_commands(self._device.abort_commands())
            await self._transition(TimerState.IDLE)

    async def force_record(self) -> None:
        """Force recording of whatever results have been collected so far."""
        async with self._event_lock:
            if self._active_heat_id is not None:
                logger.info("Timer %d: force_record called", self._track_id)
                await self._record_results()

    async def handle_connect(self) -> None:
        """Called when a serial connection (direct or proxy) is established."""
        # Always transition to CONNECTED when initialization starts.
        # This breaks re-initialization loops (unsolicited ident -> handle_connect)
        # because _process_line only calls handle_connect if state != CONNECTED.
        is_reboot = self._state not in (TimerState.DISCONNECTED, TimerState.FAULT)
        msg = f"Timer {self._track_id} {'re-' if is_reboot else ''}connecting"
        logger.info(msg)

        # Discard any pending acks from a previous session.
        if self._pending_acks:
            logger.warning(
                "Timer %d: clearing %d unacknowledged command(s) on reconnect: %s",
                self._track_id,
                len(self._pending_acks),
                [cmd for cmd, _ in self._pending_acks],
            )
            self._pending_acks.clear()

        await self._transition(TimerState.CONNECTED)

        if is_reboot:
            # Give hardware a moment to settle after a reboot signal
            await asyncio.sleep(1.0)

        if not self._watchdog_task:
            self._watchdog_task = asyncio.create_task(self._watchdog_loop())

        # Send identification *and* initialization commands immediately.
        # This ensures that even if we are reconnecting to a device that is already
        # in a high-speed or "new-style" format, we put it back into a known state.
        commands = (
            self._device.identification_commands()
            + self._device.initialization_commands()
        )

        if commands:
            await self._send_commands(commands)

    async def handle_disconnect(self) -> None:
        """Called when a serial connection is lost."""
        self._buf = b""
        self._write_fn = self._noop_write
        if self._device.requires_serial:
            await self._transition(TimerState.DISCONNECTED)

    # ------------------------------------------------------------------ #
    # Byte framing (proxy and direct modes)                                #
    # ------------------------------------------------------------------ #

    async def receive_bytes(self, data: bytes) -> list[bytes]:
        """Buffer incoming bytes and process any complete messages.

        Returns bytes that should be written back to the serial device.
        For Phase 1 this is always empty; Phase 2/3 will fill in responses
        during the identification handshake.
        """
        async with self._event_lock:
            if data:
                self._serial_log.append(
                    SerialLogEntry(
                        direction="RX",
                        data=_format_serial_bytes(data),
                        timestamp=datetime.now(timezone.utc).isoformat(),
                    )
                )
                await pubsub.publish(f"timer_state:{self._track_id}", self.status())
            self._buf += data
            while True:
                # 1. Try standard delimiter
                delim_idx = self._buf.find(self._device.delimiter)

                # 2. Try immediate characters
                imm_idx = -1
                imm_marker = b""
                for char in self._device.immediate_chars:
                    idx = self._buf.find(char)
                    if idx != -1 and (imm_idx == -1 or idx < imm_idx):
                        imm_idx = idx
                        imm_marker = char

                # Which one is first?
                if delim_idx != -1 and (imm_idx == -1 or delim_idx < imm_idx):
                    # Process delimiter
                    line = self._buf[0:delim_idx]
                    self._buf = self._buf[delim_idx + len(self._device.delimiter) :]
                    await self._process_line(line)
                elif imm_idx != -1:
                    # Process immediate char
                    # We include the char in the "line" so process_line can see it
                    line = self._buf[0 : imm_idx + len(imm_marker)]
                    self._buf = self._buf[imm_idx + len(imm_marker) :]
                    await self._process_line(line)
                else:
                    break
            return []

    async def _process_line(self, line: bytes) -> None:
        raw_line = line  # Keep raw for logging
        line = line.strip()
        if not line:
            return

        logger.info("Timer %d received line: %r", self._track_id, raw_line)

        # Check whether this line is the expected acknowledgment for the oldest
        # pending command. We do this before parse_line so that acks are consumed
        # here rather than falling through to the generic catch-alls in the device.
        if self._pending_acks:
            pending_cmd, expected_pattern = self._pending_acks[0]
            if expected_pattern.match(line):
                self._pending_acks.popleft()
                logger.debug(
                    "Timer %d: command %r acknowledged by %r",
                    self._track_id,
                    pending_cmd,
                    line,
                )
                return
            elif line == pending_cmd.strip():
                # This is a serial echo of the command we just sent.
                # Just ignore it and wait for the actual ack.
                logger.debug("Timer %d: ignoring echo of %r", self._track_id, line)
                return
            else:
                # The line doesn't match what we expected. Pop the stale entry,
                # log a warning, and continue so the line is still parsed normally.
                self._pending_acks.popleft()
                logger.warning(
                    "Timer %d: expected ack for %r but received %r; "
                    "command may have been dropped or response was out of order",
                    self._track_id,
                    pending_cmd,
                    line,
                )

        # Try to parse the line first. Even in CONNECTED state, if it looks like
        # a valid event, we should handle it.
        event_or_list = self._device.parse_line(line)

        events = []
        if event_or_list is not None:
            events = (
                event_or_list if isinstance(event_or_list, list) else [event_or_list]
            )

        is_ident = self._device.is_identified_by(line)
        # We only leave CONNECTED state if we see a definitive identification line.
        # Handshake/info lines (which return []) or standalone events are NOT
        # enough to transition from CONNECTED; we want to stay in CONNECTED
        # until we are sure we know what device we have.
        #
        # Note: If is_ident is true, we transition.

        identified = is_ident or len(events) > 0

        if is_ident and self._state != TimerState.CONNECTED:
            # If we see an identification line while not in CONNECTED state,
            # the device has likely rebooted (e.g. hard power cycle).
            # We should re-run our full initialization sequence.
            logger.warning(
                "Timer %d: unsolicited identification received in state %s; "
                "device likely rebooted. Re-initializing...",
                self._track_id,
                self._state.value,
            )
            await self.handle_connect()
            return

        if self._state == TimerState.CONNECTED and identified:
            logger.info(
                "Timer %d: identified or event received, leaving CONNECTED",
                self._track_id,
            )
            next_state = (
                TimerState.ARMED
                if self._active_heat_id is not None
                else TimerState.IDLE
            )

            # If we are transitioning to ARMED, we must send the lane mask now
            # because we removed it from the initial handle_connect sequence.
            #
            # HOWEVER, if we somehow have events in this same line that
            # indicate a race is already active, we should NOT interfere.
            should_configure = is_ident and not any(
                isinstance(e, (RaceStarted, LaneResult, GateClosed)) for e in events
            )

            if next_state == TimerState.ARMED and should_configure:
                logger.info(
                    "Timer %d: re-sending lane mask %X after identification",
                    self._track_id,
                    self._lane_mask,
                )
                await self._send_commands(
                    self._device.prepare_heat_commands(self._lane_mask)
                )

            await self._transition(next_state)
            # If it was just identification, we are done. If it was an event,
            # we'll fall through and handle it below.
            if is_ident and not events:
                return

        if event_or_list is not None:
            events = (
                event_or_list if isinstance(event_or_list, list) else [event_or_list]
            )
            for event in events:
                logger.info("Timer %d parsed event: %s", self._track_id, event)
                await self._handle_event(event)
        else:
            logger.debug("Timer %d failed to parse line: %r", self._track_id, line)

    # ------------------------------------------------------------------ #
    # Fake timer injection                                                 #
    # ------------------------------------------------------------------ #

    async def inject_event(self, event: TimerEvent) -> None:
        """Inject a timer event directly, bypassing serial parsing.

        Called by fakeTimerStart / fakeTimerFinish mutations. The same
        _handle_event logic runs as for real timers — no fake-specific branching.
        """
        async with self._event_lock:
            await self._handle_event(event)

    # ------------------------------------------------------------------ #
    # State machine                                                        #
    # ------------------------------------------------------------------ #

    async def _transition(self, new_state: TimerState) -> None:
        if self._state == new_state:
            return
        logger.debug(
            "Timer %d: %s → %s", self._track_id, self._state.value, new_state.value
        )
        self._state = new_state
        await pubsub.publish(f"timer_state:{self._track_id}", self.status())

    async def _handle_event(self, event: TimerEvent) -> None:
        """Process a timer event, updating state and publishing results."""
        if isinstance(event, RaceStarted):
            if self._state in (TimerState.ARMED, TimerState.READY):
                self._running_since = asyncio.get_event_loop().time()
                await self._transition(TimerState.RUNNING)
            else:
                logger.warning(
                    "Timer %d: RaceStarted in unexpected state %s",
                    self._track_id,
                    self._state.value,
                )

        elif isinstance(event, GateClosed):
            if self._state == TimerState.ARMED and self._device.gate_state_is_knowable:
                await self._transition(TimerState.READY)

        elif isinstance(event, LaneResult):
            if self._state in (
                TimerState.ARMED,
                TimerState.READY,
                TimerState.RESULTS_OVERDUE,
            ):
                await self._transition(TimerState.RUNNING)

            if self._state != TimerState.RUNNING:
                logger.warning(
                    "Timer %d: LaneResult received in state %s, ignoring",
                    self._track_id,
                    self._state.value,
                )
                return
            self._pending_results[event.lane] = event
            self._recalculate_places()
            # Publish status update with new pending results
            await pubsub.publish(f"timer_state:{self._track_id}", self.status())

            expected_lanes = {
                i for i in range(1, 17) if self._lane_mask & (1 << (i - 1))
            }
            if expected_lanes and expected_lanes.issubset(self._pending_results.keys()):
                await self._record_results()

        elif isinstance(event, DeviceError):
            self._last_error = event.message
            logger.error("Timer %d device error: %s", self._track_id, event.message)
            await self._transition(TimerState.FAULT)

    def _recalculate_places(self) -> None:
        """Re-sort pending results by time and assign places (1-indexed)."""
        # Collect results that have a time
        results = [r for r in self._pending_results.values() if r.time_seconds > 0]
        if not results:
            return

        # Sort by time
        results.sort(key=lambda r: r.time_seconds)

        # Assign places, handling ties
        current_place = 1
        for i, res in enumerate(results):
            if i > 0 and res.time_seconds > results[i - 1].time_seconds:
                current_place = i + 1
            res.place = current_place

    async def _record_results(self) -> None:
        """Persist accumulated lane results to the database and notify subscribers."""
        heat_id = self._active_heat_id
        kind = self._active_heat_kind
        if heat_id is None:
            logger.error(
                "Timer %d: _record_results called with no active heat", self._track_id
            )
            return
        if kind is None:
            logger.error(
                "Timer %d: _record_results called for heat %d with no heat kind; "
                "refusing to guess which table it belongs to",
                self._track_id,
                heat_id,
            )
            return

        db = SessionLocal()
        try:
            if kind is models.HeatKind.OFFICIAL:
                heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
                if not heat:
                    logger.error(
                        "Timer %d: official heat %d not found", self._track_id, heat_id
                    )
                    return

                # Official Heat: lane_results contains both assignments and results
                existing = json.loads(heat.lane_results) if heat.lane_results else []

                # Update a COPY of existing entries with timer results to be safe
                updated_results = []
                for entry in existing:
                    new_entry = dict(entry)
                    lane = new_entry.get("lane")
                    if lane in self._pending_results:
                        res = self._pending_results[lane]
                        new_entry["time"] = res.time_seconds
                        new_entry["place"] = res.place
                    updated_results.append(new_entry)

                logger.info(
                    "Timer %d: recording %d timer results into %d heat lanes "
                    "for heat %d",
                    self._track_id,
                    len(self._pending_results),
                    len(updated_results),
                    heat_id,
                )
                crud.record_heat_result(db, heat_id, json.dumps(updated_results))
                race_id = heat.race_id
            else:
                free_heat = (
                    db.query(models.FreeRaceHeat)
                    .filter(models.FreeRaceHeat.id == heat_id)
                    .first()
                )
                if not free_heat:
                    logger.error(
                        "Timer %d: free race heat %d not found",
                        self._track_id,
                        heat_id,
                    )
                    return

                # FreeRaceHeat: lane_assignments is the source of truth for
                # who is in which lane
                existing = (
                    json.loads(free_heat.lane_assignments)
                    if free_heat.lane_assignments
                    else []
                )

                # Create results list based on assignments
                updated_results = []
                for entry in existing:
                    new_entry = dict(entry)
                    lane = new_entry.get("lane")
                    if lane in self._pending_results:
                        res = self._pending_results[lane]
                        new_entry["time"] = res.time_seconds
                        new_entry["place"] = res.place
                    else:
                        # Ensure time/place keys exist even if no result
                        new_entry.setdefault("time", None)
                        new_entry.setdefault("place", None)
                    updated_results.append(new_entry)

                logger.info(
                    "Timer %d: updating %d free race heat results for heat %d",
                    self._track_id,
                    len(self._pending_results),
                    heat_id,
                )
                crud.update_free_race_heat_result(db, heat_id, updated_results)
                race_id = free_heat.race_id
        finally:
            db.close()

        # Notify race-state subscribers (e.g. RaceExecution, Observation)
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

        self._active_heat_id = None
        self._active_heat_kind = None
        self._running_since = None
        # Note: we do NOT clear self._pending_results here so they remain available
        # in the status (IDLE state) until the next heat is prepared.
        await self._transition(TimerState.IDLE)

    # ------------------------------------------------------------------ #
    # Phase 2 stub                                                         #
    # ------------------------------------------------------------------ #

    async def connect_direct(self, port: str) -> None:
        """Open a serial port and begin reading."""
        async with self._event_lock:
            self._direct_port = port
            if self._serial:
                self._serial.close()
                self._serial = None  # Ensure it's None before trying to re-open
            if self._read_task:
                self._read_task.cancel()
                self._read_task = None

            try:
                # We wrap this in to_thread because Serial() opening can block
                self._serial = await asyncio.to_thread(
                    serial.Serial, port, baudrate=self._device.baud_rate, timeout=0.1
                )
            except Exception as e:
                self._last_error = f"Failed to open port {port}: {e}"
                logger.error("Timer %d: %s", self._track_id, self._last_error)
                await self._transition(TimerState.FAULT)

                # Still start watchdog even if it fails once
                if not self._watchdog_task:
                    self._watchdog_task = asyncio.create_task(self._watchdog_loop())
                return

            async def send_to_serial(data: bytes) -> None:
                if self._serial and self._serial.is_open:
                    try:
                        await asyncio.to_thread(self._serial.write, data)
                    except Exception as e:
                        logger.error("Timer %d write error: %s", self._track_id, e)

            self.set_write_fn(send_to_serial)
            await self.handle_connect()

            # Start background read task
            self._read_task = asyncio.create_task(self._read_loop())

            # Start watchdog if not already running
            if not self._watchdog_task:
                self._watchdog_task = asyncio.create_task(self._watchdog_loop())

            logger.info(
                "Timer %d: Started direct serial mode on %s", self._track_id, port
            )

    async def _watchdog_loop(self) -> None:
        """Monitor connection health and attempt reconnects."""
        try:
            while True:
                await asyncio.sleep(1.0)

                # Resend identification if stuck in CONNECTED
                # (e.g. initial command lost due to Arduino bootloader)
                if self._state == TimerState.CONNECTED:
                    logger.info(
                        "Timer %d watchdog: still CONNECTED, resending identification",
                        self._track_id,
                    )
                    await self._send_commands(self._device.identification_commands())

                # Check for device-level result timeout (e.g. MicroWizard silently
                # discards results if no finish is detected within 10s of gate open).
                timeout = self._device.result_timeout_seconds
                if (
                    timeout is not None
                    and self._state == TimerState.RUNNING
                    and self._running_since is not None
                    and asyncio.get_event_loop().time() - self._running_since > timeout
                ):
                    async with self._event_lock:
                        # Check state again inside lock
                        if self._state == TimerState.RUNNING:
                            logger.warning(
                                "Timer %d: no results received within %.0fs of "
                                "gate open; device has likely reset silently",
                                self._track_id,
                                timeout,
                            )
                            self._running_since = None
                            await self._transition(TimerState.RESULTS_OVERDUE)

                if self._direct_port and (
                    not self._serial
                    or not self._serial.is_open
                    or self._state == TimerState.FAULT
                ):
                    logger.info(
                        "Timer %d watchdog: attempting reconnect on %s",
                        self._track_id,
                        self._direct_port,
                    )
                    # connect_direct handles its own task/serial cleanup.
                    try:
                        await self.connect_direct(self._direct_port)
                    except Exception as e:
                        logger.error(
                            "Timer %d: Watchdog reconnect failed: %s", self._track_id, e
                        )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Timer %d watchdog error: %s", self._track_id, e)

    async def _read_loop(self) -> None:
        """Background task for reading from serial."""
        try:
            while self._serial and self._serial.is_open:
                # Use to_thread for blocking read
                data = await asyncio.to_thread(self._serial.read, 64)
                if data:
                    await self.receive_bytes(data)
                else:
                    # Small sleep to yield if no data (timeout reached)
                    await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            logger.info("Timer %d: Serial read task cancelled", self._track_id)
        except serial.SerialException as e:
            self._last_error = f"Serial error: {e}"
            logger.error("Timer %d serial error: %s", self._track_id, e)
            async with self._event_lock:
                await self.handle_disconnect()
                await self._transition(TimerState.FAULT)
        except Exception as e:
            logger.error("Timer %d read loop error: %s", self._track_id, e)
        finally:
            if self._serial:
                self._serial.close()
                self._serial = None
            logger.info("Timer %d: Serial read loop stopped", self._track_id)

    async def stop(self) -> None:
        """Stop the timer manager and close any active connections."""
        if self._watchdog_task:
            self._watchdog_task.cancel()
            self._watchdog_task = None

        if self._read_task:
            self._read_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._read_task
            self._read_task = None

        self._direct_port = None

        if self._serial:
            self._serial.close()
            self._serial = None

        await self.handle_disconnect()


async def initialize_timer_managers(registry: dict[int, TimerManager]) -> None:
    """Query all Track records and create a TimerManager for each."""
    db = SessionLocal()
    try:
        tracks = db.query(models.Track).all()
        for track in tracks:
            if track.timer_type == models.TimerType.FAKE:
                device = FakeTimerDevice()
            else:
                # AUTO_DETECT_BACKEND / AUTO_DETECT_PROXY: use MicroWizard as the
                # target device; real connection logic is wired in Phase 2/3.
                device = MicroWizardDevice()

            manager = TimerManager(track.id, device)
            registry[track.id] = manager
            logger.info(
                "TimerManager created for track %d (%s) with device %s",
                track.id,
                track.name,
                device.name,
            )

            # Start connection automatically if in direct-backend mode
            if (
                track.timer_type == models.TimerType.AUTO_DETECT_BACKEND
                and track.serial_port
            ):
                asyncio.create_task(manager.connect_direct(track.serial_port))
    finally:
        db.close()
