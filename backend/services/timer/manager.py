"""
TimerManager: one instance per Track.

Owns byte framing, state machine, result recording, and pub/sub publishing.
Shared by all connectivity modes (fake, backend-direct, frontend-proxy).
"""

import asyncio
import contextlib
import logging
import re
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import serial
from sqlalchemy.orm import Session

from backend.api.pubsub import pubsub
from backend.db import crud, models
from backend.db.database import SessionLocal
from backend.domain import audit

from . import probe
from .devices import ALL_PROFILES, DEFAULT_PROFILE, FAKE

# Circular import handled by importing inside methods or using full module path
# from backend.api.schema import _publish_race_state
from .devices.base import (
    DeviceError,
    Event,
    GateClosed,
    GateOpen,
    GateWatcherUnsupported,
    LaneCount,
    LaneResult,
    RaceStarted,
    TimerEvent,
    TimerProfile,
)
from .state_machine import GateBelief, TimerState

logger = logging.getLogger(__name__)

MAX_SERIAL_LOG = 100

#: How often to ask a connected-but-unidentified device who it is. Slow enough
#: not to chatter at a device that is simply not a timer, quick enough that an
#: operator watching the badge sees it settle.
NUDGE_SECONDS = 3.0

#: How often the watchdog checks the connection. Named so tests can shorten it
#: rather than sleeping through it.
WATCHDOG_SECONDS = 1.0

#: How often to ask a device for the start gate's state, and how long after
#: asking its answer is still an answer. DerbyNet's pacing.
#:
#: The window matters more than the interval. Gate answers are as short as `0`,
#: `U` or `.`, so they are only read as gate answers inside it — outside, they
#: are ordinary traffic and must be left to the profile's real matchers.
GATE_POLL_SECONDS = 0.25
GATE_WINDOW_SECONDS = 0.1

#: How long after a device says anything before the gate may be polled again.
#:
#: Pack936, via DerbyNet's Champ profile: a gate query sent too soon after the
#: gate opened made the timer resend the *previous* heat's results. Polling is
#: never urgent, so it yields.
GATE_QUIET_SECONDS = 0.1


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
    device_name: str | None
    #: What is known about where this device description came from, and whether
    #: anyone has run it. Most have not — see `devices/derbynet.py`.
    device_provenance: str | None = None
    lane_count: int | None = None
    active_heat_id: int | None = None
    last_error: str | None = None
    #: The serial port in use, once there is one. Worth surfacing because in
    #: backend-direct mode it is now usually *found* rather than configured
    #: (#89), and "which port did it pick" is otherwise unanswerable from the
    #: operator's side.
    port: str | None = None
    #: Whether the operator can be offered a "release the gate" control: the
    #: device has the command *and* this track has the hardware it drives.
    can_remote_start: bool = False
    pending_results: list[dict[str, Any]] = field(default_factory=list)
    serial_log: list[SerialLogEntry] = field(default_factory=list)
    racer_by_lane: dict[int, int | None] = field(default_factory=dict)


SessionFactory = Callable[[], Session]


class TimerManager:
    def __init__(
        self,
        track_id: int,
        device: TimerProfile,
        session_factory: SessionFactory | None = None,
        remote_start_installed: bool = False,
    ) -> None:
        """Create a manager for one track.

        ``session_factory`` produces the session used to persist results. It is
        injected rather than imported because recording happens on a background
        task, outside any request — so tests need to point it at their own
        database instead of the process-wide one.
        """
        self._track_id = track_id
        self._device = device
        self._remote_start_installed = remote_start_installed
        self._session_factory: SessionFactory = session_factory or SessionLocal
        self._buf: bytes = b""
        self._active_heat_id: int | None = None
        self._active_heat_kind: models.HeatKind | None = None
        self._lane_mask: int = 0
        self._pending_results: dict[int, LaneResult] = {}
        self._racer_by_lane: dict[int, int | None] = {}
        self._last_error: str | None = None
        self._write_fn: Callable[[bytes], Awaitable[None]] = self._noop_write
        self._serial: serial.Serial | None = None
        self._read_task: asyncio.Task | None = None
        self._direct_port: str | None = None
        self._watchdog_task: asyncio.Task | None = None
        self._idle_flush_task: asyncio.Task | None = None
        self._last_nudge: float | None = None
        self._gate = GateBelief()
        self._gate_poll_task: asyncio.Task | None = None
        #: Until when an incoming line may be read as a gate answer.
        self._gate_window_until: float = 0.0
        #: The device said its gate option is off; stop asking until reconnect.
        self._gate_watcher_off = False
        #: When the device last said anything, so polling can yield to it.
        self._last_rx: float = 0.0
        #: Lanes the device says it has, when it says so at all.
        self._reported_lane_count: int | None = None
        self._running_since: float | None = None
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

    async def set_device(self, device: TimerProfile) -> None:
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

    async def set_remote_start_installed(self, installed: bool) -> None:
        """The track's gate-release setting changed.

        Published rather than merely stored: the control it governs is on the
        operator screen, and a setting saved in another tab should make the
        button appear or go without a refresh.
        """
        if self._remote_start_installed == installed:
            return
        self._remote_start_installed = installed
        await pubsub.publish(f"timer_state:{self._track_id}", self.status())

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
            # Through the same formatter the operator's serial log uses, two
            # lines below. Interpolating the bytes directly logged
            # `b'RV\r'` — the repr, escapes and all — where the diagnostics
            # page showed the readable form, so the two records of the same
            # command did not look like the same command.
            logger.info(
                "Timer %d sending command: %s",
                self._track_id,
                _format_serial_bytes(cmd),
            )
            self._serial_log.append(
                SerialLogEntry(
                    direction="TX",
                    data=_format_serial_bytes(cmd),
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
            )
            await pubsub.publish(f"timer_state:{self._track_id}", self.status())
            # The terminator is added here rather than baked into every
            # command in a profile: acknowledgement matching, the echo check
            # and the serial log all want the command as written.
            await self._write_fn(self._device.wire(cmd))
            expected = self._device.expected_response_for(cmd)
            if expected is not None:
                self._pending_acks.append((cmd, expected))

    # ------------------------------------------------------------------ #
    # Status                                                               #
    # ------------------------------------------------------------------ #

    def status(self) -> TimerStatus:
        # The armed lanes, when a heat is armed; otherwise whatever the device
        # said about itself, which is the only lane count there is before the
        # first heat and the one worth checking against the track's setting.
        lane_count = (
            bin(self._lane_mask).count("1")
            if self._lane_mask
            else self._reported_lane_count
        )
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
            device_provenance=self._device.provenance or None,
            port=self._direct_port,
            can_remote_start=self.can_remote_start(),
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
            self._schedule_idle_flush()
            self._pending_results = {}
            self._racer_by_lane = {}
            await self._transition(TimerState.IDLE)

    async def prepare_heat(
        self,
        heat_id: int,
        kind: models.HeatKind,
        lane_mask: int,
        racer_by_lane: dict[int, int | None] | None = None,
    ) -> None:
        """Arm the timer for a heat. Sends device commands and transitions to ARMED.

        ``kind`` is no longer load-bearing — heat ids are unique across both
        kinds since #6, and recording reads the kind off the heat. It is kept on
        the signature because callers still pass it and the state is useful in
        the status payload.
        """
        async with self._event_lock:
            self._active_heat_id = heat_id
            self._active_heat_kind = kind
            self._lane_mask = lane_mask
            self._pending_results = {}
            self._racer_by_lane = racer_by_lane or {}
            # A new heat starts from "gate not yet closed", whatever the last
            # one ended on, so staging has to be observed afresh.
            self._gate.reset(closed=False)
            await self._send_commands(self._device.prepare_heat_commands(lane_mask))
            await self._transition(TimerState.ARMED)
            self._start_gate_polling()

    async def abort_heat(self) -> None:
        """Abort the current heat. Sends device reset commands and returns to IDLE."""
        async with self._event_lock:
            self._active_heat_id = None
            self._active_heat_kind = None
            self._pending_results = {}
            self._racer_by_lane = {}
            await self._send_commands(self._device.abort_commands())
            await self._transition(TimerState.IDLE)
            self._stop_gate_polling()

    def can_remote_start(self) -> bool:
        """Whether releasing the start gate from software is available here.

        Two conditions, and they are different claims: the device has a command
        for it, and this track has the solenoid the command drives. Nothing in
        any protocol reports the second — the MicroWizard's gate release is a
        separately-sold accessory and ``LG`` is silently ignored without it —
        so it is the operator's setting, off until they say otherwise.
        """
        return self._device.releases_the_gate() and self._remote_start_installed

    async def release_start_gate(self) -> str | None:
        """Open the start gate. Returns None, or why it did not.

        Only from ARMED or READY. Not IDLE: releasing a gate with no heat armed
        sends cars down a track nothing is timing, and the times are gone. Not
        RUNNING: the gate is already open.
        """
        async with self._event_lock:
            if not self._device.releases_the_gate():
                return f"{self._device.name} cannot release the start gate"
            if not self._remote_start_installed:
                return "This track is not set up with a remote start gate"
            if self._state not in (TimerState.ARMED, TimerState.READY):
                return f"No heat is armed (timer is {self._state.value})"

            logger.info("Timer %d: releasing the start gate", self._track_id)
            await self._send_commands(list(self._device.remote_start))
            return None

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

        # A fresh connection gets a fresh nudge interval, so a reconnect does
        # not inherit a recent one and sit unidentified for longer than it
        # needs to.
        self._last_nudge = None
        # A reconnect may be a different device, or the same one with its
        # options changed, so a previous "gate query is off" finding expires.
        self._gate_watcher_off = False
        self._gate.reset(closed=False)

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
        # Nothing more is coming, so a partial line is not a line — it is the
        # front of a message the device was cut off mid-way through.
        self._schedule_idle_flush()
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
                self._last_rx = asyncio.get_event_loop().time()
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
            self._schedule_idle_flush()
            return []

    def _schedule_idle_flush(self) -> None:
        """Arrange for a partial line to be treated as complete if it goes quiet.

        Called with ``_event_lock`` held, at the end of every read. The flush
        task takes the lock itself, so it is created rather than awaited.
        """
        if self._idle_flush_task is not None:
            self._idle_flush_task.cancel()
            self._idle_flush_task = None

        timeout = self._device.line_idle_timeout_seconds
        if timeout is None or not self._buf:
            return

        self._idle_flush_task = asyncio.create_task(self._idle_flush(timeout))

    async def _idle_flush(self, timeout: float) -> None:
        """Process buffered bytes that never arrived at a delimiter.

        A timer that omits the terminator on its last result would otherwise
        leave it in ``_buf`` forever, with the manager waiting in RUNNING for a
        lane the device considers already reported — and the operator waiting
        for a heat that will never record.

        Every further read reschedules this, so it only fires once the device
        has genuinely stopped talking.
        """
        try:
            await asyncio.sleep(timeout)
        except asyncio.CancelledError:
            return

        async with self._event_lock:
            line, self._buf = self._buf, b""
            if not line.strip():
                return
            logger.info(
                "Timer %d: no delimiter after %.2fs, treating %r as complete",
                self._track_id,
                timeout,
                line,
            )
            await self._process_line(line)

    async def _process_line(self, line: bytes) -> None:
        raw_line = line  # Keep raw for logging
        line = line.strip()
        if not line:
            return

        logger.info("Timer %d received line: %r", self._track_id, raw_line)

        # Inside a gate poll's response window, this line gets first read as an
        # answer to that poll. Outside it, the gate matchers are not consulted
        # at all: they are short enough (`0`, `U`, `.`) to claim traffic that
        # has nothing to do with the gate.
        if asyncio.get_event_loop().time() < self._gate_window_until:
            reading = self._device.read_gate(line)
            if reading is not None:
                self._gate_window_until = 0.0
                if await self._handle_gate_reading(reading):
                    return

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
                # Nothing the gate says can change a run that is under way, and
                # asking during one is what made some timers resend the previous
                # heat's results.
                self._stop_gate_polling()
                await self._transition(TimerState.RUNNING)
                await self._send_for(Event.RACE_STARTED)
            else:
                logger.warning(
                    "Timer %d: RaceStarted in unexpected state %s",
                    self._track_id,
                    self._state.value,
                )

        elif isinstance(event, GateClosed):
            # A *pushed* edge, not a polled sample — a polled one is consumed in
            # `_process_line` before reaching here. The device has done its own
            # edge detection and says so once, so waiting for a second
            # confirming observation would mean never believing it at all.
            # That asymmetry is the whole reason the debounce lives with
            # polling rather than with the event.
            if self._state == TimerState.ARMED and self._device.gate_state_is_knowable:
                self._gate.reset(closed=True)
                await self._transition(TimerState.READY)
                await self._send_for(Event.GATE_CLOSED)

        elif isinstance(event, GateOpen):
            if self._state == TimerState.READY:
                self._gate.reset(closed=False)
                await self._transition(TimerState.ARMED)

        elif isinstance(event, GateWatcherUnsupported):
            self._gate_watcher_off = True
            self._stop_gate_polling()

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

        elif isinstance(event, LaneCount):
            if event.lanes != self._reported_lane_count:
                logger.info(
                    "Timer %d: device reports %d lanes", self._track_id, event.lanes
                )
            self._reported_lane_count = event.lanes
            await pubsub.publish(f"timer_state:{self._track_id}", self.status())

        elif isinstance(event, DeviceError):
            self._last_error = event.message
            logger.error("Timer %d device error: %s", self._track_id, event.message)
            await self._transition(TimerState.FAULT)

    async def _send_for(self, trigger: Event) -> None:
        """Send whatever the profile wants sent when ``trigger`` happens.

        Most profiles want nothing. The ones that do are timers which have to
        be *told* to report — "force the end of the race and send what you
        have" when results are overdue — or which can only be reset once the
        gate is closed.
        """
        commands = self._device.commands_for(trigger)
        if commands:
            logger.info(
                "Timer %d: sending %s for %s", self._track_id, commands, trigger.value
            )
            await self._send_commands(commands)

    def _recalculate_places(self) -> None:
        """Give every timed lane a place, preferring the ones the device reported.

        Finish-line hardware resolves orderings that the reported times do not.
        Two cars whose times are equal to the millisecond may still have a
        detected order, and deriving place by sorting those times calls it a
        tie — so where the device has told us the places, we keep them.

        Reported places are taken only when *every* timed lane has one. Some
        MicroWizard output marks the winner alone, and a partial set is not a
        partial answer: it is one lane's place and nothing at all about the
        rest, which sorting can supply and mixing cannot.
        """
        # Collect results that have a time
        results = [r for r in self._pending_results.values() if r.time_seconds > 0]
        if not results:
            return

        if all(r.place > 0 for r in results):
            return

        # Sort by time
        results.sort(key=lambda r: r.time_seconds)

        # Assign places, handling ties
        current_place = 1
        for i, res in enumerate(results):
            if i > 0 and res.time_seconds > results[i - 1].time_seconds:
                current_place = i + 1
            res.place = current_place

    def _armed_heat_is_stale(self, db: Session, heat: models.Heat) -> str | None:
        """Why *heat* is no longer the one we armed, or ``None``.

        Pure lookup, no state change, so it serves both the record path and
        :meth:`revalidate_armed_heat`.

        Takes the row rather than loading it, because the record path needs the
        same one immediately afterwards. Loading it twice meant the guarantee
        "the heat exists" lived in *this* function's return value, as a string,
        while the dereference happened in the caller — so a checker could not
        see the link and neither could a reader. The caller now handles a
        missing heat itself, next to the code that would have crashed on one.
        """
        heat_id = self._active_heat_id

        # Absent means *unknown*, not "no racers" — a caller that did not
        # supply a mapping has given us nothing to compare against.
        armed = self._racer_by_lane
        if not armed:
            return None

        current = {
            lane.lane: lane.racer_id
            for lane in crud.heat_lanes_of(db, heat)
            if lane.racer_id is not None
        }
        if current != armed:
            return (
                f"Heat {heat_id} changed while it was armed "
                f"(lanes were {armed}, are now {current})"
            )
        return None

    async def revalidate_armed_heat(self, db: Session) -> str | None:
        """Disarm now if the armed heat has changed underneath us.

        Recording already refuses a stale heat, but only once the cars have
        run — the operator finds out after the fact, with a set of times they
        must now key in by hand. Calling this after anything that rewrites
        heats moves that discovery to the moment it happens, while the track
        is still empty.

        Returns the reason it disarmed, or ``None`` if nothing was wrong.
        """
        heat_id = self._active_heat_id
        if heat_id is None:
            return None

        heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        if heat is None:
            reason = f"Heat {heat_id} no longer exists"
        else:
            stale = self._armed_heat_is_stale(db, heat)
            if stale is None:
                return None
            reason = stale

        await self._abandon_run(f"{reason} — the heat has been disarmed")
        return reason

    async def _abandon_run(self, reason: str) -> None:
        """Give up on the armed heat without writing anything to it.

        A heat id is not a stable handle. ``invalidate_future_rounds``
        regenerates every later championship round on *every* earlier result,
        deleting the heat rows and inserting new ones, so an operator who arms
        a championship heat and then corrects a preliminary time has the row
        replaced underneath the armed timer. Two things then went wrong:

        * The id may no longer exist. ``_record_results`` returned early
          without resetting anything, leaving the timer stuck in RUNNING on a
          heat that was gone — "Racing..." forever, and the run's times lost
          with only a log line to say so.
        * Worse, the id may be *reused*. SQLite hands a rowid back when the
          deleted rows were the highest, so the lookup succeeds and returns a
          different heat — one whose lanes have been re-drawn from the new
          standings. Recording then attributed each lane's time to whichever
          racer now occupies that lane. Silent, and wrong about who won.

        So this resets the timer to IDLE and says why, rather than writing.
        ``_pending_results`` is deliberately kept, exactly as a successful
        record does, so the times stay in the status for the operator to enter
        by hand instead of vanishing.
        """
        logger.error("Timer %d: %s", self._track_id, reason)
        self._last_error = reason
        self._active_heat_id = None
        self._active_heat_kind = None
        self._running_since = None
        self._stop_gate_polling()
        await self._transition(TimerState.IDLE)

    async def _record_results(self) -> None:
        """Persist accumulated lane results to the database and notify subscribers."""
        heat_id = self._active_heat_id
        if heat_id is None:
            logger.error(
                "Timer %d: _record_results called with no active heat", self._track_id
            )
            return

        db = self._session_factory()
        try:
            heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
            if heat is None:
                await self._abandon_run(
                    f"Heat {heat_id} no longer exists — results not recorded"
                )
                return

            stale = self._armed_heat_is_stale(db, heat)
            if stale is not None:
                await self._abandon_run(f"{stale} — results not recorded")
                return

            # One path for both kinds since #6. A free race heat used to keep
            # its schedule in `lane_assignments` and this had to know that;
            # both now hold it in `lane_results`, written when the heat is
            # created and filled in here.
            heat_lanes = crud.heat_lanes_of(db, heat)
            for lane in heat_lanes:
                result = self._pending_results.get(lane.lane)
                if result is not None:
                    lane.time = result.time_seconds
                    lane.place = result.place

            logger.info(
                "Timer %d: recording %d timer results into %d lanes of %s heat %d",
                self._track_id,
                len(self._pending_results),
                len(heat_lanes),
                heat.kind.value.lower(),
                heat_id,
            )

            if heat.kind is models.HeatKind.FREE:
                # Deliberately not `record_heat_result`: that re-runs
                # advancement, and an exhibition run must not move a
                # championship field.
                crud.update_free_race_heat_result(
                    db, heat_id, heat_lanes, source=audit.ResultSource.TIMER
                )
            else:
                crud.record_heat_result(
                    db, heat_id, heat_lanes, source=audit.ResultSource.TIMER
                )
            race_id = heat.race_id
        finally:
            db.close()

        # Notify race-state subscribers (e.g. RaceExecution, Observation)
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

        self._active_heat_id = None
        self._active_heat_kind = None
        self._running_since = None
        self._stop_gate_polling()
        # Note: we do NOT clear self._pending_results here so they remain available
        # in the status (IDLE state) until the next heat is prepared.
        await self._transition(TimerState.IDLE)

    # ------------------------------------------------------------------ #
    # Backend-direct serial                                                #
    # ------------------------------------------------------------------ #

    async def autodetect(
        self, profiles: Sequence[TimerProfile] | None = None
    ) -> str | None:
        """Find a timer on some USB serial port and connect to it.

        What ``AUTO_DETECT_BACKEND`` was named for. Returns the port it settled
        on, or ``None`` — in which case the reason is on the status as
        ``last_error``, because a track whose timer was not found looks exactly
        like a track whose timer is unplugged and the operator deserves to be
        told which.

        ``profiles`` narrows the walk. An operator who has named their timer
        model is asking a different question — *which port is my Champ on* —
        and a probe writes to every port it tries, so trying six other models'
        probe commands on their hardware is not a free extra (#143).
        """
        candidates = ALL_PROFILES if profiles is None else profiles
        ports = probe.usb_ports()
        if not ports:
            await self._detection_failed("No USB serial ports found")
            return None

        logger.info("Timer %d: probing %s", self._track_id, ", ".join(ports))
        detection = await probe.detect(ports, candidates)
        if detection is None:
            named = (
                ""
                if profiles is None
                else f" for {', '.join(p.name for p in candidates)}"
            )
            await self._detection_failed(
                f"No timer answered on {', '.join(ports)}{named}. "
                f"Check the cable, or set the serial port by hand."
            )
            return None

        await self.adopt(detection)
        return detection.port

    async def _detection_failed(self, reason: str) -> None:
        logger.warning("Timer %d: %s", self._track_id, reason)
        self._last_error = reason
        await self._transition(TimerState.DISCONNECTED)
        await pubsub.publish(f"timer_state:{self._track_id}", self.status())

    async def adopt(self, detection: "probe.Detection") -> None:
        """Take over the port a probe found, already open and already identified.

        Straight to IDLE, skipping CONNECTED. The probe has seen the banner,
        and it is the only greeting the device is going to send — reopening the
        port to go through the normal handshake would leave the manager waiting
        for something that already happened.
        """
        async with self._event_lock:
            await self.stop()

            self._device = detection.profile
            self._direct_port = detection.port
            self._serial = detection.connection  # type: ignore[assignment]
            self._buf = b""
            self._last_error = None

            self.set_write_fn(self._make_serial_writer())
            self._read_task = asyncio.create_task(self._read_loop())
            if not self._watchdog_task:
                self._watchdog_task = asyncio.create_task(self._watchdog_loop())

            await self._send_commands(self._device.initialization_commands())
            await self._transition(TimerState.IDLE)

            logger.info(
                "Timer %d: adopted %s on %s",
                self._track_id,
                detection.profile.name,
                detection.port,
            )

    async def adopt_profile(self, profile: TimerProfile) -> None:
        """Take a profile that has already identified itself over an open link.

        The browser-proxy counterpart of ``adopt``, and it goes straight to
        IDLE for the same reason: the banner has been seen, and it is the only
        greeting the device is going to send, so waiting in CONNECTED would be
        waiting for something already past. What it does *not* do is take over
        a port — in proxy mode the browser owns that and the link is already up.
        """
        async with self._event_lock:
            self._device = profile
            self._buf = b""
            self._pending_acks.clear()
            self._last_error = None
            # A fresh identification gets a fresh nudge interval and no
            # inherited findings about the previous device's gate, exactly as
            # handle_connect does — this replaces that call, not follows it.
            self._last_nudge = None
            self._gate_watcher_off = False
            self._gate.reset(closed=False)

            if not self._watchdog_task:
                self._watchdog_task = asyncio.create_task(self._watchdog_loop())

            await self._send_commands(self._device.initialization_commands())
            await self._transition(TimerState.IDLE)

            logger.info(
                "Timer %d: adopted %s over the browser proxy",
                self._track_id,
                profile.name,
            )

    def _make_serial_writer(self) -> Callable[[bytes], Awaitable[None]]:
        async def send_to_serial(data: bytes) -> None:
            if self._serial and self._serial.is_open:
                try:
                    await asyncio.to_thread(self._serial.write, data)
                except Exception as e:
                    logger.error("Timer %d write error: %s", self._track_id, e)

        return send_to_serial

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
                    serial.Serial,
                    port,
                    baudrate=self._device.baud_rate,
                    bytesize=self._device.data_bits,
                    stopbits=self._device.stop_bits,
                    parity=self._device.parity,
                    timeout=0.1,
                )
            except Exception as e:
                self._last_error = f"Failed to open port {port}: {e}"
                logger.error("Timer %d: %s", self._track_id, self._last_error)
                await self._transition(TimerState.FAULT)

                # Still start watchdog even if it fails once
                if not self._watchdog_task:
                    self._watchdog_task = asyncio.create_task(self._watchdog_loop())
                return

            self.set_write_fn(self._make_serial_writer())
            await self.handle_connect()

            # Start background read task
            self._read_task = asyncio.create_task(self._read_loop())

            # Start watchdog if not already running
            if not self._watchdog_task:
                self._watchdog_task = asyncio.create_task(self._watchdog_loop())

            logger.info(
                "Timer %d: Started direct serial mode on %s", self._track_id, port
            )

    # ------------------------------------------------------------------ #
    # Watching the start gate                                              #
    # ------------------------------------------------------------------ #

    def _start_gate_polling(self) -> None:
        """Begin asking the device about the gate, if it is the asking kind."""
        self._stop_gate_polling()
        if not self._device.polls_the_gate() or self._gate_watcher_off:
            return
        self._gate_poll_task = asyncio.create_task(self._gate_poll_loop())

    def _stop_gate_polling(self) -> None:
        if self._gate_poll_task is not None:
            self._gate_poll_task.cancel()
            self._gate_poll_task = None
        self._gate_window_until = 0.0

    async def _gate_poll_loop(self) -> None:
        """Ask about the gate while a heat is armed, and only then.

        Not while RUNNING: the answer cannot change anything once the cars are
        away, and DerbyNet found that asking during a run makes some timers
        resend the previous heat's results. Not while IDLE either — nothing is
        waiting on the answer, and every question is bytes down a serial line
        somebody else's device is also trying to talk on.
        """
        watcher = self._device.gate_watcher
        assert watcher is not None  # guarded by polls_the_gate()

        try:
            while True:
                await asyncio.sleep(GATE_POLL_SECONDS)

                if self._state not in (TimerState.ARMED, TimerState.READY):
                    continue
                if self._gate_watcher_off:
                    return

                now = asyncio.get_event_loop().time()
                if now - self._last_rx < GATE_QUIET_SECONDS:
                    continue

                self._gate_window_until = now + GATE_WINDOW_SECONDS
                await self._write_fn(self._device.wire(watcher.command))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Timer %d gate poll error: %s", self._track_id, e)

    async def _handle_gate_reading(self, event: TimerEvent) -> bool:
        """Fold one polled gate answer into the belief. True if it was one."""
        if isinstance(event, GateWatcherUnsupported):
            logger.info(
                "Timer %d: the device's gate query is switched off; not asking again",
                self._track_id,
            )
            self._gate_watcher_off = True
            self._stop_gate_polling()
            return True

        if isinstance(event, (GateClosed, GateOpen)):
            closed = isinstance(event, GateClosed)
            if not self._gate.observe(closed, asyncio.get_event_loop().time()):
                return True
            if closed and self._state is TimerState.ARMED:
                await self._transition(TimerState.READY)
                await self._send_for(Event.GATE_CLOSED)
            elif not closed and self._state is TimerState.READY:
                # The gate came back up without a start — somebody reloading,
                # or a car pulled off the line. Back to merely armed.
                await self._transition(TimerState.ARMED)
            return True

        return False

    async def nudge_if_unidentified(self) -> bool:
        """Ask a connected-but-silent device who it is.

        A connection that opens and then goes quiet is the *normal* case, not
        an edge case. ``handle_connect`` sends the profile's setup commands,
        the device acknowledges them, and those acknowledgements are consumed
        by the pending-ack queue — which returns before reaching the code that
        leaves CONNECTED. So a working MicroWizard that has just been told
        ``N1`` and ``N2`` sits in CONNECTED, and the operator's badge reads
        "Connecting…" until the first heat is armed. Nothing is wrong with the
        timer; nothing is going to say so either.

        The watchdog used to cover this by resending
        ``identification_commands()``, which is empty for every profile we
        ship — a no-op, logged once a second.

        Sending the *probe* is safe here in a way it is not on connect, which
        is why the two are separate fields: this only fires with no heat armed,
        so it can never interrogate a timer mid-run.

        Returns whether it sent anything.
        """
        if self._state is not TimerState.CONNECTED:
            return False
        if self._active_heat_id is not None:
            return False
        if not self._device.probe:
            return False

        now = asyncio.get_event_loop().time()
        if self._last_nudge is not None and now - self._last_nudge < NUDGE_SECONDS:
            return False
        self._last_nudge = now

        logger.info(
            "Timer %d: connected but unidentified, asking what is there",
            self._track_id,
        )
        await self._send_commands(list(self._device.probe))
        return True

    async def _watchdog_loop(self) -> None:
        """Monitor connection health and attempt reconnects."""
        try:
            while True:
                await asyncio.sleep(WATCHDOG_SECONDS)

                await self.nudge_if_unidentified()

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
                            # Most timers that can be asked to give up and
                            # report what they have want telling here.
                            await self._send_for(Event.RESULTS_OVERDUE)

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

        if self._idle_flush_task:
            self._idle_flush_task.cancel()
            self._idle_flush_task = None

        self._stop_gate_polling()

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


async def initialize_timer_managers(
    registry: dict[int, TimerManager],
    session_factory: SessionFactory | None = None,
) -> None:
    """Query all Track records and create a TimerManager for each.

    ``session_factory`` is handed to every manager it creates, so callers (and
    tests) can control which database results are recorded to.
    """
    session_factory = session_factory or SessionLocal
    db = session_factory()
    try:
        tracks = db.query(models.Track).all()
        for track in tracks:
            if track.timer_type == models.TimerType.FAKE:
                device = FAKE
            else:
                # The starting assumption for both auto-detect modes, replaced
                # by whatever answers a probe: below for backend-direct, and
                # when the browser connects for proxy mode. It survives only
                # when nothing identifies itself (issue #89).
                device = DEFAULT_PROFILE

            manager = TimerManager(
                track.id,
                device,
                session_factory=session_factory,
                remote_start_installed=track.remote_start_installed,
            )
            registry[track.id] = manager
            logger.info(
                "TimerManager created for track %d (%s) with device %s",
                track.id,
                track.name,
                device.name,
            )

            # Start connecting if in direct-backend mode. A port configured by
            # hand is honoured as given; without one, go and find the timer.
            if track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                if track.serial_port:
                    asyncio.create_task(manager.connect_direct(track.serial_port))
                else:
                    asyncio.create_task(manager.autodetect())
    finally:
        db.close()
