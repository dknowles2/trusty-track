"""
TimerManager: one instance per Track.

Owns byte framing, state machine, result recording, and pub/sub publishing.
Shared by all connectivity modes (fake, backend-direct, frontend-proxy).
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Awaitable, Dict, List, Optional

import serial

from ..pubsub import pubsub
from ..database import SessionLocal
from .. import crud, models
from .state_machine import TimerState
from .devices.base import TimerDevice, TimerEvent, RaceStarted, LaneResult, GateClosed, DeviceError

logger = logging.getLogger(__name__)


# Leading bytes to strip from incoming result lines (now handled by device)


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
        self._serial: Optional[serial.Serial] = None
        self._read_task: Optional[asyncio.Task] = None
        self._direct_port: Optional[str] = None
        self._watchdog_task: Optional[asyncio.Task] = None
        self._event_lock = asyncio.Lock()

        if not device.requires_serial:
            # Fake timer: skip DISCONNECTED/CONNECTED/identification; start in IDLE
            self._state = TimerState.IDLE
        else:
            self._state = TimerState.DISCONNECTED

    # ------------------------------------------------------------------ #
    # Configuration                                                        #
    # ------------------------------------------------------------------ #

    async def set_device(self, device: TimerDevice) -> None:
        """Update the device and reset state. Stops any active connections."""
        await self.stop()
        self._device = device
        self._buf = b''
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

    async def _send_commands(self, commands: List[bytes]) -> None:
        for cmd in commands:
            logger.info(f"Timer {self._track_id} sending command: {cmd}")
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

    async def reset(self) -> None:
        """Manually reset the timer to IDLE state, clearing buffers and active heat."""
        self._active_heat_id = None
        self._buf = b''
        self._pending_results = {}
        await self._transition(TimerState.IDLE)

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

    async def handle_connect(self) -> None:
        """Called when a serial connection (direct or proxy) is established."""
        logger.info(f"Timer {self._track_id} connected")
        await self._transition(TimerState.CONNECTED)
        if not self._watchdog_task:
            self._watchdog_task = asyncio.create_task(self._watchdog_loop())

        # Send identification *and* initialization commands immediately.
        # This ensures that even if we are reconnecting to a device that is already 
        # in a high-speed or "new-style" format, we put it back into a known state.
        commands = self._device.identification_commands() + self._device.initialization_commands()

        # If we have an active heat, re-send lane mask
        if self._active_heat_id is not None:
            logger.info(f"Timer {self._track_id}: re-sending lane mask {self._lane_mask:X}")
            commands += self._device.prepare_heat_commands(self._lane_mask)

        if commands:
            await self._send_commands(commands)

    async def handle_disconnect(self) -> None:
        """Called when a serial connection is lost."""
        self._buf = b''
        self._write_fn = self._noop_write
        if self._device.requires_serial:
            await self._transition(TimerState.DISCONNECTED)

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
        while True:
            # 1. Try standard delimiter
            delim_idx = self._buf.find(self._device.delimiter)
            
            # 2. Try immediate characters
            imm_idx = -1
            imm_marker = b''
            for char in self._device.immediate_chars:
                idx = self._buf.find(char)
                if idx != -1 and (imm_idx == -1 or idx < imm_idx):
                    imm_idx = idx
                    imm_marker = char
            
            # Which one is first?
            if delim_idx != -1 and (imm_idx == -1 or delim_idx < imm_idx):
                # Process delimiter
                line = self._buf[0:delim_idx]
                self._buf = self._buf[delim_idx + len(self._device.delimiter):]
                await self._process_line(line)
            elif imm_idx != -1:
                # Process immediate char
                # We include the char in the "line" so process_line can see it
                line = self._buf[0:imm_idx + len(imm_marker)]
                self._buf = self._buf[imm_idx + len(imm_marker):]
                await self._process_line(line)
            else:
                break
        return []
    async def _process_line(self, line: bytes) -> None:
        raw_line = line # Keep raw for logging
        line = line.strip()
        if not line:
            return
        
        logger.info("Timer %d received line: %r", self._track_id, raw_line)

        # Try to parse the line first. Even in CONNECTED state, if it looks like
        # a valid event, we should handle it.
        event_or_list = self._device.parse_line(line)

        if self._state == TimerState.CONNECTED:
            if self._device.is_identified_by(line) or event_or_list is not None:
                # If identified OR if we got a valid event (like a result), we are good.
                logger.info("Timer %d: identified or event received, transitioning from CONNECTED", self._track_id)
                next_state = TimerState.ARMED if self._active_heat_id is not None else TimerState.IDLE
                await self._transition(next_state)
                # If it was just identification, we are done. If it was an event,
                # we'll fall through and handle it below.
                if self._device.is_identified_by(line) and event_or_list is None:
                    return

        if event_or_list is not None:
            events = event_or_list if isinstance(event_or_list, list) else [event_or_list]
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
        """Process a timer event, updating state and publishing results."""
        async with self._event_lock:
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
                if self._state in (TimerState.ARMED, TimerState.READY):
                    await self._transition(TimerState.RUNNING)

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
            # Try official Heat first
            heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
            if heat:
                # Official Heat
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
            else:
                # Check FreeRaceHeat
                free_heat = db.query(models.FreeRaceHeat).filter(models.FreeRaceHeat.id == heat_id).first()
                if not free_heat:
                    logger.error("Timer %d: heat %d not found in official or free race heats", self._track_id, heat_id)
                    return
                
                # FreeRaceHeat
                existing = json.loads(free_heat.lane_assignments) if free_heat.lane_assignments else []
                racer_by_lane = {r["lane"]: r.get("racer_id") for r in existing}

                results = [
                    {
                        "lane": r.lane,
                        "racer_id": racer_by_lane.get(r.lane),
                        "time": r.time_seconds,
                        "place": r.place,
                    }
                    for r in timer_results
                ]
                crud.update_free_race_heat_result(db, heat_id, results)
                race_id = free_heat.race_id
        finally:
            db.close()

        # Notify race-state subscribers (e.g. RaceExecution, Observation)
        from ..schema import _publish_race_state
        await _publish_race_state(race_id)

        self._active_heat_id = None
        self._pending_results = {}
        await self._transition(TimerState.IDLE)

    # ------------------------------------------------------------------ #
    # Phase 2 stub                                                         #
    # ------------------------------------------------------------------ #

    async def connect_direct(self, port: str) -> None:
        """Open a serial port and begin reading."""
        self._direct_port = port
        if self._serial:
            self._serial.close()
            self._serial = None # Ensure it's None before trying to re-open
        if self._read_task:
            self._read_task.cancel()
            self._read_task = None

        try:
            # We wrap this in to_thread because Serial() opening can block
            self._serial = await asyncio.to_thread(
                serial.Serial,
                port,
                baudrate=self._device.baud_rate,
                timeout=0.1
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

        logger.info("Timer %d: Started direct serial mode on %s", self._track_id, port)

    async def _watchdog_loop(self) -> None:
        """Monitor connection health and attempt reconnects."""
        try:
            while True:
                await asyncio.sleep(5.0)

                # Resend identification if stuck in CONNECTED (e.g. initial command lost due to Arduino bootloader)
                if self._state == TimerState.CONNECTED:
                    logger.info("Timer %d watchdog: still CONNECTED, resending identification", self._track_id)
                    await self._send_commands(self._device.identification_commands())

                if self._direct_port and (not self._serial or not self._serial.is_open or self._state == TimerState.FAULT):
                    logger.info("Timer %d watchdog: attempting reconnect on %s", self._track_id, self._direct_port)
                    # We call connect_direct again. It handles its own task/serial cleanup.
                    try:
                        await self.connect_direct(self._direct_port)
                    except Exception as e:
                        logger.error("Timer %d: Watchdog reconnect failed: %s", self._track_id, e)
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
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
            self._read_task = None
        
        self._direct_port = None

        if self._serial:
            self._serial.close()
            self._serial = None
        
        await self.handle_disconnect()
