# Timer Integration: Implementation Plan [COMPLETED]

> **Built.** `backend/services/timer/` — `TimerManager`, the state machine,
> and the fake, MicroWizard and browser-proxied devices.

## 1. Overview

This document describes the design for integrating real hardware timers into Trusty Track, starting
with the MicroWizard K1, and for refactoring the existing fake timer to share the same backend
infrastructure.

Goals:

- A clean abstraction over device-specific serial protocols so adding future timer models is
  straightforward.
- Support for both **backend-direct** (server has USB/serial access) and **frontend-proxy** (browser
  has USB/serial access via the Web Serial API) connectivity modes.
- A robust bidirectional communication channel for the proxy mode that does not assume any
  particular message framing on the frontend side — the backend owns all protocol state.
- **The fake timer goes through the same backend state machine as real timers.** Random times are
  generated server-side; the frontend is a thin button panel. This eliminates a whole class of
  potential bugs where fake and real timer code paths diverge.

---

## 2. Architecture

### 2.1 Connectivity Modes

#### Backend-direct (`AUTO_DETECT_BACKEND`)

```
Browser ──── GraphQL / WS ──── Backend ──── pyserial ──── Timer Hardware
```

The backend opens the serial port directly using pyserial. A long-running async task reads bytes
from the port and feeds them into the `TimerManager`. Commands from the `TimerManager` are written
directly to the serial port.

#### Frontend-proxy (`AUTO_DETECT_PROXY`)

```
Timer Hardware ──── Web Serial API ──── Browser ──── WS /ws/timer/{track_id} ──── Backend
```

The browser opens the serial port using the Web Serial API and acts as a transparent byte pipe to
the backend. The backend still owns all protocol logic; the frontend forwards raw bytes in both
directions. This means the same `TimerManager` / profile code runs in both modes —
the only difference is how bytes arrive and where commands are written.

#### Fake (`FAKE`)

```
Browser ──── GraphQL mutations ──── Backend TimerManager (the FAKE profile)
```

No serial port. The fake timer is a profile like any other but skips connection/identification and
starts in `IDLE` immediately. The frontend calls `fakeTimerStart` / `fakeTimerFinish` mutations;
the backend drives the same state machine and records results the same way as real timers.

### 2.2 Component Map

```
backend/timer/
  __init__.py
  manager.py          TimerManager — one per active track
  state_machine.py    TimerState enum + transition logic
  devices/
    __init__.py       ALL_PROFILES registry + by_key lookup       (as built, #89)
    base.py           TimerProfile record, Matcher, TimerEvent types
    fake.py           FAKE (no serial; driven by mutations)
    microwizard.py    MICROWIZARD profile

backend/main.py       Add /ws/timer/{track_id} WebSocket endpoint; initialize TimerManagers
backend/schema.py     Add timerStatus query + subscription; prepareHeat, abortHeat,
                      fakeTimerStart, fakeTimerFinish mutations

frontend/src/components/race-control/
  FakeTimerMole.tsx         Refactored: thin button panel calling mutations; reads timer
                            state from timerStatus subscription instead of local state
  SerialProxyConnector.tsx  New: Web Serial ↔ WebSocket bridge (proxy mode only)
  TimerStatusBadge.tsx      New: small status chip driven by timerStatus subscription;
                            shown for ALL timer types
```

---

## 3. State Machine

### 3.1 Timer States

| State             | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| `DISCONNECTED`    | No device detected or connection lost (not used by FakeTimer)   |
| `CONNECTED`       | Serial link up, waiting to identify device                      |
| `IDLE`            | Device identified and ready; no heat armed                      |
| `ARMED`           | Lane mask sent, timer reset and waiting for gate to close       |
| `READY`           | Gate closed (if detectable); start imminent                     |
| `RUNNING`         | Race in progress; timing active                                 |
| `RESULTS_OVERDUE` | Results not received within timeout; awaiting manual resolution |
| `FAULT`           | Unrecoverable error; requires operator action                   |

Not all devices can signal gate-close, so `ARMED` → `READY` is skipped when `gate_state_is_knowable`
is false for the driver. In that case the state jumps directly from `ARMED` to `RUNNING` when the
race starts.

The fake profile sets `requires_serial = False` and `gate_state_is_knowable = False`. Its
`TimerManager` is initialised in `IDLE` immediately at startup, bypassing `DISCONNECTED` /
`CONNECTED` / identification entirely.

### 3.2 Transitions

```
DISCONNECTED
  ──[serial link opens]──► CONNECTED
  ──[identification confirmed]──► IDLE

IDLE
  ──[prepareHeat called]──► ARMED

ARMED
  ──[gate closes (optional)]──► READY
  ──[race started signal]──► RUNNING

READY
  ──[race started signal]──► RUNNING

RUNNING
  ──[all lane results received]──► IDLE   (results auto-recorded)
  ──[timeout exceeded]──► RESULTS_OVERDUE

RESULTS_OVERDUE
  ──[results received]──► IDLE
  ──[abortHeat called]──► IDLE

ANY STATE
  ──[serial error / timeout]──► FAULT
  ──[abortHeat called]──► IDLE (best-effort reset sent to device)

FAULT
  ──[reconnect attempt succeeds]──► CONNECTED
```

For the fake profile, the two extra triggers are:

- `inject_event(RaceStarted())` from the `fakeTimerStart` mutation: ARMED → RUNNING
- `inject_event(LaneResult(...)) × N` from the `fakeTimerFinish` mutation: RUNNING → IDLE

All other state logic (accumulating results, recording to DB, publishing race state) is **identical**
to the real timer path.

A configurable `results_timeout_seconds` (default 60 s) controls when RUNNING → RESULTS_OVERDUE.

### 3.3 State Publishing

Every state transition publishes on the pub/sub channel `timer_state:{track_id}`. The GraphQL
subscription `timerStatus` reads from this channel so that all connected clients see updates in
real time — including `FakeTimerMole`, which now derives its button enabled/disabled state from
this subscription rather than from props passed through the component tree.

---

## 4. Backend Design

### 4.1 Device Interface (`backend/timer/devices/base.py`)

> As originally planned. The ABC below was replaced by a `TimerProfile` record in
> issue #89 — see the departure note after the code.

```python
class TimerDevice(ABC):
    # Subclasses declare these as class variables
    name: ClassVar[str]                      # Human-readable, e.g. "MicroWizard K1"
    baud_rate: ClassVar[int] = 9600
    delimiter: ClassVar[bytes] = b'\n'       # End-of-message bytes
    gate_state_is_knowable: ClassVar[bool] = False
    requires_serial: ClassVar[bool] = True   # False → skip connection; start in IDLE

    @abstractmethod
    def identification_commands(self) -> List[bytes]:
        """Bytes to send immediately after connecting, to probe identity."""

    @abstractmethod
    def is_identified_by(self, line: bytes) -> bool:
        """Return True if line confirms this is the expected device."""

    @abstractmethod
    def initialization_commands(self) -> List[bytes]:
        """Commands sent once after identification (e.g. set output format)."""

    @abstractmethod
    def prepare_heat_commands(self, lane_mask: int) -> List[bytes]:
        """Commands to arm the timer for a heat (reset + lane mask)."""

    @abstractmethod
    def abort_commands(self) -> List[bytes]:
        """Commands sent to put the device back into an idle/reset state."""

    @abstractmethod
    def parse_line(self, line: bytes) -> "TimerEvent | None":
        """Parse a complete message. Return a TimerEvent or None."""
```

**Departure (issue #88).** The class variables gained four more, because
declaring only the baud rate turned out to be a silent failure rather than a
missing feature:

-   `data_bits`, `stop_bits`, `parity` — the rest of the port framing,
    defaulting to 8-N-1. Both connectivity modes read them: `connect_direct`
    passes them to pyserial, and the proxy's `configure` message carries them
    to the Web Serial `open()` call. A device such as the NewBold family
    (1200/7/E/2) opened at the defaults yields garbage rather than an error.
-   `line_idle_timeout_seconds` — how long to wait for the delimiter before
    treating the buffered bytes as a complete message anyway, defaulting to
    200 ms. Some timers omit the terminator on their last result, which
    otherwise strands it in the buffer while the manager waits in `RUNNING`
    for a lane the device considers reported.

**Departure (issue #89): this ABC is gone.** A device is now a frozen
`TimerProfile` record rather than a subclass — the fields above plus `probe`,
`identification`, `setup`, `heat_prep`, `abort`, `force_results`, `acks` and
`matchers`. The method names in the block above survive as methods *on the
record*, holding only the rules for reading those fields, so `TimerManager` was
not touched.

The reason is that the plan's closing claim — "adding a new timer model
requires only a new file in `backend/timer/devices/`" — was true and not
sufficient. A subclass can identify a device with arbitrary Python, which means
nothing else can. A prober has to walk a list of candidates and try each one,
and it can only do that if identification, setup and parsing are data it can
read. DerbyNet reached the same conclusion and carries fourteen models as
`Profile` records.

Concretely:

-   `parse_line` is a tuple of `Matcher`s — a pattern, the event it means, and
    which captured groups hold the lane, the time and the place. A `repeat`
    matcher applies across the whole line, which is how one line reporting
    every lane becomes one event per lane.
-   Group readers (`lane_letter`, `lane_number`, `seconds`, `milliseconds`,
    `place_symbol`, `place_number`) are named, so a timer that letters its
    lanes or reports whole milliseconds is a different reader rather than a
    different parser.
-   `heat_prep` is `unmask` / `mask` / `first_lane` / `arm`, and the mask
    commands are generated from `max_lanes`.
-   `acks` pairs a command pattern with the response it should draw, so one
    entry covers the MicroWizard's `MA` through `MP`.

`backend/services/timer/devices/__init__.py` holds `ALL_PROFILES` — what a
prober will walk — and `by_key`. The fake timer is deliberately outside it: it
has no protocol to probe for.

**What is not built:** the prober itself. `AUTO_DETECT_BACKEND` and
`AUTO_DETECT_PROXY` still assume `DEFAULT_PROFILE`, and backend-direct still
needs the serial port entered by hand. That is the rest of #89.

**Not planned, contrary to the issue as filed:** exporting the profile set to
the frontend. DerbyNet does that because their browser-side timer *is* the
driver. Ours is a wire — the backend owns all protocol state, and the browser
needs the port parameters, which the `configure` message already carries.

`TimerEvent` is a dataclass union (defined in `base.py`):

```python
@dataclass
class RaceStarted: pass

@dataclass
class LaneResult:
    lane: int
    time_seconds: float
    place: int

@dataclass
class GateClosed: pass

@dataclass
class DeviceError:
    message: str

TimerEvent = RaceStarted | LaneResult | GateClosed | DeviceError
```

### 4.2 The fake timer (`backend/timer/devices/fake.py`)

> As originally planned; now the `FAKE` profile record, with every field left at its
> default. See the #89 departure note in 4.1.

```python
class FakeTimerDevice(TimerDevice):
    name = "Fake Timer"
    baud_rate = 0             # unused
    delimiter = b'\n'         # unused
    gate_state_is_knowable = False
    requires_serial = False   # TimerManager skips connection; starts in IDLE

    def identification_commands(self) -> List[bytes]: return []
    def is_identified_by(self, line: bytes) -> bool: return False
    def initialization_commands(self) -> List[bytes]: return []
    def prepare_heat_commands(self, lane_mask: int) -> List[bytes]: return []
    def abort_commands(self) -> List[bytes]: return []
    def parse_line(self, line: bytes) -> TimerEvent | None: return None
```

All methods are no-ops because the fake timer is driven entirely through `TimerManager.inject_event`
rather than through serial bytes.

### 4.3 MicroWizard K1 Driver (`backend/timer/devices/microwizard.py`)

Reference: `MicroWizardDevice.java` in the DerbyNet project.

**Serial parameters:** 9600 baud, 8N1, delimiter `b'\n'`

**Commands (all ASCII, terminated with `\n`):**

- `N1` — select "new format" output (sent on init; also used for identification probe)
- `LR` — reset/arm laser gate
- `M<HEX>` — set lane mask (e.g. `MF` for all 4 lanes)
- `RA` — force result reporting
- `LG` — pulse gate solenoid (remote start, optional)

**Result line format (N1 "new format"):**

```
  1    3.452  1
  2    3.321  2
  3    4.012  3
```

Each line: lane number, time in seconds (3 decimal places), placement.
Lines begin with spaces and may have leading `@` or `>` characters that must be stripped.

**Identification:** send `N1\n`; the device echoes `N1` or responds with a banner containing the
firmware version string. The driver considers itself identified once it receives any response within
2 seconds of sending the probe.

**Heat preparation sequence:**

1. `M<lane_mask_hex>\n` — mask unused lanes
2. `LR\n` — reset/arm gate

**Abort sequence:** `LR\n` (same as arm, puts device in known ready state)

**Result detection:** Line matches pattern `^\s*(\d+)\s+([\d.]+)\s+(\d+)\s*$` after stripping
leading `@`/`>` characters. A time of `0.000` with no placement means DNF for that lane.

The driver accumulates `LaneResult` events and emits them one at a time. The `TimerManager` tracks
which lanes are still outstanding (via the armed `lane_mask`) and transitions to IDLE once all
lanes have reported.

### 4.4 `TimerManager` Service (`backend/timer/manager.py`)

One `TimerManager` instance lives per Track, held in a `Dict[int, TimerManager]` registry in
`main.py`. Fake timer managers are created at app startup; real timer managers are created lazily
when the corresponding race becomes active (or also at startup if a port is configured).

```python
class TimerManager:
    def __init__(self, track_id: int, device: TimerDevice): ...

    # Backend-direct mode
    async def connect_direct(self, port: str) -> None: ...

    # Proxy mode — called by the WebSocket handler with incoming raw bytes
    async def receive_bytes(self, data: bytes) -> AsyncIterator[bytes]:
        """Buffer bytes, extract complete messages, process them.
        Yields bytes that should be sent back to the serial device."""

    # Fake timer only — bypasses serial, drives state machine directly
    async def inject_event(self, event: TimerEvent) -> None:
        """Inject a timer event without going through serial parsing.
        Called by fakeTimerStart / fakeTimerFinish mutations."""

    # Race control
    async def prepare_heat(self, heat_id: int, lane_mask: int) -> None: ...
    async def abort_heat(self) -> None: ...

    # Status
    def status(self) -> TimerStatus: ...
```

**Message framing** (`receive_bytes`):

```python
self._buf += data
while self.device.delimiter in self._buf:
    line, self._buf = self._buf.split(self.device.delimiter, 1)
    await self._process_line(line)
```

This is the single place where the delimiter is applied. The same code serves both direct and proxy
modes; the frontend never needs to know the delimiter.

**`_process_line`** strips leading `@`/`>` characters, calls `device.parse_line`, then hands the
result to `_handle_event`.

**`_handle_event`** drives the state machine based on the `TimerEvent` type:

- `RaceStarted` → RUNNING (if ARMED or READY)
- `GateClosed` → READY (if ARMED and `gate_state_is_knowable`)
- `LaneResult` → accumulate; when all expected lanes reported → record results via `crud`,
  publish race state via `_publish_race_state`, transition to IDLE
- `DeviceError` → FAULT, publish timer state

**`inject_event`** calls `_handle_event` directly, bypassing `_process_line`. This is the only
fake-timer-specific code in `TimerManager`; everything else is shared.

**Result recording** uses a DB session acquired from the app's `SessionLocal` factory — not from
GraphQL context, since this happens outside the request lifecycle.

**Connection watchdog:** A background task checks that bytes have been received within
`connection_timeout_seconds` (default 5 s). Skipped when `device.requires_serial` is False.

**Fake timer initialisation:** When `device.requires_serial` is False, the manager transitions
directly to IDLE in `__init__` (or `connect_direct` is simply not called). No identification
probe, no watchdog task.

### 4.5 GraphQL Integration (`backend/schema.py`)

#### New Strawberry types

```python
@strawberry.type
class TimerStatus:
    state: str            # "DISCONNECTED", "IDLE", "RUNNING", etc.
    device_name: str | None
    lane_count: int | None
    active_heat_id: int | None
    last_error: str | None

@strawberry.type
class TimerStateChangedEvent:
    track_id: int
    status: TimerStatus
    changed_at: str
```

#### New query

```graphql
timerStatus(trackId: Int!): TimerStatus
```

#### New subscription

```graphql
subscription TimerStatus($trackId: Int!) {
  timerStatus(trackId: $trackId) {
    state
    deviceName
    laneCount
    activeHeatId
    lastError
  }
}
```

Published on channel `timer_state:{track_id}` on every state transition.

#### New mutations

```graphql
# Arm the timer for a specific heat (all timer types)
prepareHeat(heatId: Int!): Boolean!

# Abort the current heat (all timer types)
abortHeat(trackId: Int!): Boolean!

# Fake timer only: signal race start (ARMED → RUNNING)
fakeTimerStart(heatId: Int!): Boolean!

# Fake timer only: generate random results and record them (RUNNING → IDLE)
fakeTimerFinish(heatId: Int!): Boolean!
```

**`prepareHeat`**: resolves the lane mask from the heat's lane assignments, calls
`timer_manager.prepare_heat(heat_id, lane_mask)`. Works for all timer types; for the fake timer
it transitions to ARMED even though no serial commands are sent.

**`fakeTimerStart`**: validates that the active heat matches `heatId`, then calls
`timer_manager.inject_event(RaceStarted())`. Returns False if the timer is not in ARMED state
or heatId does not match.

**`fakeTimerFinish`**: looks up the heat's lane assignments from `Heat.lane_results`, generates
random times (3.0 – 4.0 s) for each occupied lane, sorts them, assigns placements, then calls
`timer_manager.inject_event(LaneResult(...))` once per lane. The `TimerManager._handle_event`
accumulates them and records the result exactly as it would for a real timer.

Random time generation lives in the backend so it can be seeded for testing and is not subject to
clock skew in the browser.

---

## 5. Proxy Protocol

### 5.1 WebSocket Endpoint

A dedicated (non-GraphQL) WebSocket endpoint added to `main.py`:

```
/ws/timer/{track_id}
```

This keeps raw byte forwarding separate from the GraphQL subscription system. The `TimerManager`
for the given track must already exist and be in `AUTO_DETECT_PROXY` mode; the endpoint rejects
connections otherwise (including FAKE tracks).

Only one proxy connection per track is allowed at a time. A second connection attempt while one
is active causes the first to be closed (new browser tab/reload scenario).

### 5.2 Message Format

All messages are JSON objects with a `type` field.

**Frontend → Backend:**

```json
{ "type": "serial_rx", "data": "<base64-encoded bytes>" }
```

Sent whenever the Web Serial API's `ReadableStream` produces a chunk. The frontend does **not**
frame messages or split on any delimiter — it forwards whatever bytes arrived.

```json
{ "type": "pong" }
```

Keepalive response.

**Backend → Frontend:**

```json
{ "type": "serial_tx", "data": "<base64-encoded bytes>" }
```

Bytes to write to the serial port (commands to the timer device). The backend may send this at
any time; the frontend must drain these promptly.

```json
{ "type": "configure", "baud_rate": 9600 }
```

Sent immediately after WebSocket connection is established. Tells the frontend what baud rate to
use when opening the serial port. (Port selection is always done by the user via the browser's
permission dialog.)

```json
{ "type": "ping" }
```

Sent periodically by the backend to detect stale connections.

### 5.3 Proxy Connection Flow

```
1. Browser loads RaceControl page, timer type = AUTO_DETECT_PROXY
2. Frontend renders "Connect Timer" button
3. User clicks → navigator.serial.requestPort() → permission dialog
4. User selects port → frontend opens WebSocket to /ws/timer/{track_id}
5. Backend sends { type: "configure", baud_rate: 9600 }
6. Frontend opens serial port at configured baud rate
7. Frontend starts relaying bytes in both directions
8. Backend sends identification probe bytes (via serial_tx)
9. Frontend forwards device response (via serial_rx)
10. Backend identifies device → TimerManager transitions CONNECTED → IDLE
11. timerStatus subscription clients see state update
12. User arms a heat → prepareHeat mutation → backend sends arm commands via serial_tx
13. Race runs; results arrive as serial_rx; backend records and publishes
```

---

## 6. Frontend Design

### 6.1 Refactored `FakeTimerMole`

The component is simplified: it no longer generates race results or manages state. Instead it
reads timer state from the `timerStatus` subscription and calls mutations.

**Props that are removed:**

- `onTriggerFinish` — results now flow through the backend
- `onTriggerStart` — replaced by `fakeTimerStart` mutation
- `activeHeat` — no longer needed; backend knows the lane assignments
- `isRunning` / `isCompleted` — derived from subscription instead

**Props that remain or are added:**

- `isOpen: boolean` — still controls visibility (true when `timerType === 'FAKE'`)
- `heatId: number` — passed to both mutations for validation
- `trackId: number` — needed to scope the timerStatus subscription

**Behaviour:**

- "Start Timer" button calls `fakeTimerStart(heatId)`. Disabled unless `timerState === 'ARMED'`.
- "Finish Heat" button calls `fakeTimerFinish(heatId)`. Disabled unless `timerState === 'RUNNING'`.
- Auto-finish timer (3–5 s) stays in the frontend — it's a UX feature, not business logic.
  After the delay it calls `fakeTimerFinish(heatId)` exactly as the manual button would.
- Status text (`Ready to start` / `Racing...` / `Heat Completed`) is derived from `timerState`
  received via subscription.

**Parent `RaceExecution` changes:**

- Remove `handleMoleFinish` and `handleMoleStart` callbacks.
- The `isRunning` / `isCompleted` state in `RaceExecution` is now derived from the timer state
  subscription rather than local state set by the mole callbacks.

### 6.2 New `TimerStatusBadge` Component

A small status chip rendered in the `RaceExecution` toolbar, visible for **all timer types**
(including FAKE). Uses the `timerStatus` GraphQL subscription. Gives the operator a consistent
view of where the timer state machine is, regardless of timer type.

States displayed:

- Grey dot + "Timer disconnected" — DISCONNECTED or FAULT
- Yellow dot + "Connecting…" — CONNECTED
- Green dot + "Ready" — IDLE
- Blue dot + "Armed" — ARMED or READY
- Pulsing green dot + "Racing…" — RUNNING
- Red dot + "Results overdue" — RESULTS_OVERDUE

### 6.3 New `SerialProxyConnector` Component

Located at `frontend/src/components/race-control/SerialProxyConnector.tsx`. Rendered only when
`timerType === 'AUTO_DETECT_PROXY'`. Invisible when the timer is connected; shows "Connect Timer"
button when disconnected.

**Responsibilities:**

- Call `navigator.serial.requestPort()` on button click
- Open WebSocket to `/ws/timer/{track_id}`
- Receive `{ type: "configure", baud_rate }`, then open the serial port at that baud rate
- Forward `ReadableStream` chunks to backend as `serial_rx` messages
- Receive `serial_tx` messages from backend and write to `WritableStream`
- Handle WebSocket close / serial disconnect; update local state so the button reappears

**WebSerial stream reading:**

```typescript
const reader = port.readable.getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  ws.send(
    JSON.stringify({
      type: "serial_rx",
      data: btoa(String.fromCharCode(...value)),
    }),
  );
}
```

The frontend does not inspect the bytes — no delimiter parsing, no message framing. This keeps
all protocol logic in the backend and makes it trivial to support additional device types later.

**WebSerial feature detection:** Render the component only if `"serial" in navigator`. If not
supported (non-Chrome browser), show a static notice explaining the limitation.

---

## 7. Race Execution Integration

### 7.1 Arming the Timer

When the operator selects the next heat in `RaceExecution`, a "Prepare Heat" button calls
`prepareHeat(heatId)`. This works identically for all timer types:

- Fake: `TimerManager` transitions to ARMED (no serial commands); `FakeTimerMole` "Start Timer"
  button becomes enabled.
- Real: `TimerManager` sends arm commands to the device (via serial or proxy), transitions to
  ARMED, then READY when gate closes.

The operator's view of progress is the `TimerStatusBadge` in all cases.

### 7.2 Receiving Results

When the `TimerManager` records a completed heat result via `crud.record_heat_result`, it also
calls `_publish_race_state(race_id)` so all GraphQL subscribers (RaceExecution, Observation, etc.)
see the updated heat immediately. This is the same code path for both fake and real timers.

### 7.3 Abort / Error Recovery

- `abortHeat(trackId)` sends abort commands to the device (no-op for fake) and transitions to IDLE.
- RESULTS_OVERDUE offers:
  - "Force Results" — sends `RA` command to MicroWizard (not applicable to fake timer).
  - "Skip Heat" — marks the heat with no results and advances; timer returns to IDLE.

---

## 8. Implementation Phases

### Phase 1 — Core Infrastructure + Fake Timer Refactor

1. ✅ Create `backend/timer/` package with `state_machine.py` and `devices/base.py`.
2. ✅ Implement the fake timer in `devices/fake.py`.
3. ✅ Implement the MicroWizard in `devices/microwizard.py` (now a profile record, #89).
4. ✅ Implement `TimerManager` in `manager.py` with byte framing, `inject_event`, state machine
   integration, and result recording. Fake timer managers start in IDLE immediately.
5. ✅ Add `timerStatus` GraphQL query + subscription.
6. ✅ Add `prepareHeat`, `abortHeat`, `fakeTimerStart`, `fakeTimerFinish` mutations.
7. ✅ Refactor `FakeTimerMole.tsx`: removed client-side result generation, calls mutations, reads
   state from `timerStatus` subscription. `FreeRaceExecution.tsx` and `FreeRaceTab.tsx` updated.
8. ✅ Add `TimerStatusBadge.tsx` and render it in `RaceExecution` for all timer types.
9. ✅ Write unit tests for:
   - the MicroWizard's `parse_line` with real sample output strings
   - `TimerManager` byte-framing and state transitions (in-memory byte feed, no hardware)
   - `fakeTimerFinish` result generation (lane count, placement ordering)
   - 26 tests total, all passing
10. ✅ Add `pyserial` to `pyproject.toml`.
11. ✅ Initialize TimerManagers in `main.py` at startup and inject into GraphQL context.

**Phase 1 is now fully complete.**

### Phase 2 — Backend-Direct Mode

1. ✅ Add background task in `main.py` that creates a `TimerManager` in direct-serial mode for each
   Track with `timer_type = AUTO_DETECT_BACKEND` at startup.
2. ✅ Implement `connect_direct` in `TimerManager` using pyserial with async I/O.
3. ✅ Implement connection watchdog and reconnect loop.
4. ✅ Test with a real MicroWizard K1 or a loopback serial connection (verified with mock serial unit tests).

**Phase 2 is now fully complete.**

### Phase 3 — Frontend-Proxy Mode

1. ✅ Add `/ws/timer/{track_id}` WebSocket endpoint to `main.py`.
2. ✅ Implement `SerialProxyConnector.tsx`.
3. ✅ Integrate into `RaceExecution.tsx` (render for `AUTO_DETECT_PROXY`).
4. ✅ Test end-to-end: browser Web Serial → WebSocket → backend → state machine → results.

**Phase 3 is now fully complete.**

### Phase 4 — Polish

1. Implement "Force Results" and "Skip Heat" recovery flows in the UI.
2. Add serial port selector to the Track configuration form in `SystemSettings.tsx` (for
   backend-direct mode; frontend-proxy uses the OS permission dialog).
3. Add `TimerStatusBadge` to the Observation screen.
4. Consider auto-arming on heat selection (vs. explicit "Prepare Heat" button click).

---

## 9. Open Questions / Design Decisions Deferred

- **Auto-arming**: Recommend explicit "Prepare Heat" button initially; easier to recover from
  errors when the operator controls when the timer is armed.
- **Multiple proxy clients**: Backend closes the first connection when a second arrives. A
  warning in the UI would help operators notice this.
- **Result placement calculation** — *settled in issue #88, without the flag.* The first
  implementation went the other way and recomputed every place by sorting the times, discarding
  what the device reported. That loses the answer in the one case it matters: two cars can be
  reported with equal times and still have a detected order at the finish line, and sorting calls
  that a tie. `TimerManager._recalculate_places` now keeps the reported places when every timed
  lane has one, and derives them otherwise. No `reports_placement` class variable: the same
  MicroWizard reports a full set of places in one output format and marks the winner alone in
  another, so the question is about the results in hand rather than about the device.
- **DNF handling**: A lane result with `time = 0.000` means DNF in DerbyNet's convention. Decide
  whether to store `None` or `0.0` in `lane_results` JSON and update scoring logic accordingly.
- **Future devices** — *revisited in issue #89.* Adding a model does require only a new file,
  and that turned out not to be the bar: a subclass identifies its device with arbitrary
  Python, so nothing else can, and a port prober needs to try candidates in turn. A model
  is now a `TimerProfile` record. `TimerManager`, `main.py` and the frontend are still
  untouched by adding one.
