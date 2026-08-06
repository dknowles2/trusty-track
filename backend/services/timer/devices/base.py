"""A timer is described, not programmed.

Every serial timer does the same handful of things: it identifies itself, it
takes a few setup commands, it is told which lanes are in play, it says the
gate moved, and it reports a lane's time. What differs between models is the
bytes, not the shape — so a model is a :class:`TimerProfile` record rather than
a subclass with its own parsing code.

That matters for three reasons, all of them issue #89:

* A prober can walk a list of profiles and try each one. It cannot walk a list
  of classes whose identification logic is arbitrary Python.
* Adding a model is adding data, which can be reviewed against a protocol
  document. The MicroWizard driver it replaced was 208 lines of imperative
  parsing for a device that this file expresses in about forty.
* The differences that a class hierarchy hides — that one timer is 1200 baud
  and 7 data bits, that another reports milliseconds — become fields, and a
  field that no profile sets is visibly missing rather than silently defaulted.

The browser-proxy path does *not* get a copy of this, even though it probes.
The backend owns all protocol state and the browser is a wire: it needs the port
parameters to open the port, which the WebSocket ``configure`` message carries,
and nothing else. Probing there is the backend walking these records and asking
for the port to be reopened as it goes — see ``services/timer/proxy.py``.
"""

import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# What a parsed message turns into
# ---------------------------------------------------------------------------


@dataclass
class RaceStarted:
    pass


@dataclass
class LaneResult:
    lane: int
    time_seconds: float
    place: int


@dataclass
class GateClosed:
    pass


@dataclass
class GateOpen:
    """The start gate is not latched.

    Distinct from :class:`RaceStarted`. A gate that is merely open means cars
    are not staged; a race has started when the *timer* says it is counting.
    On a device that reports both, conflating them starts a heat every time
    somebody lifts the gate to reload.
    """

    pass


@dataclass
class GateWatcherUnsupported:
    """The device answered its gate query with "that option is off".

    A profile can carry a gate watcher the hardware has switched off — the
    FastTrack answers `X` when the feature is disabled — so this is how polling
    turns itself off rather than asking forever.
    """

    pass


@dataclass
class LaneCount:
    """The device says how many lanes it has.

    Worth capturing even though nothing depends on it: a timer reporting six
    lanes on a track configured for four is a real misconfiguration, and it is
    silent otherwise — the heats are built from the track, and the extra lanes
    simply never report.
    """

    lanes: int


@dataclass
class DeviceError:
    message: str


TimerEvent = (
    RaceStarted
    | LaneResult
    | LaneCount
    | GateClosed
    | GateOpen
    | GateWatcherUnsupported
    | DeviceError
)


class Event(str, Enum):
    """What a matcher produces when its pattern matches."""

    RACE_STARTED = "RACE_STARTED"
    GATE_CLOSED = "GATE_CLOSED"
    GATE_OPEN = "GATE_OPEN"
    #: The device says its gate-reporting option is switched off.
    GATE_UNSUPPORTED = "GATE_UNSUPPORTED"
    LANE_RESULT = "LANE_RESULT"
    #: The device announcing its own lane count, usually during setup.
    LANE_COUNT = "LANE_COUNT"
    #: Not produced by any matcher — a trigger for ``on_event`` only. Several
    #: timers have to be told to give up and report what they have.
    RESULTS_OVERDUE = "RESULTS_OVERDUE"
    #: Recognised, and deliberately nothing. Identification banners and command
    #: acknowledgements are traffic we understand and have no event for.
    IGNORE = "IGNORE"
    #: Recognised, and should not have arrived — an acknowledgement nobody was
    #: waiting for. Same absence of an event, but worth a warning.
    UNEXPECTED = "UNEXPECTED"


# ---------------------------------------------------------------------------
# Reading a captured group
# ---------------------------------------------------------------------------

#: Symbols the MicroWizard uses for places 1 to 6 in its "new format" output.
PLACE_SYMBOLS: dict[bytes, int] = {
    b"!": 1,
    b'"': 2,
    b"#": 3,
    b"$": 4,
    b"%": 5,
    b"&": 6,
}


def lane_letter(raw: bytes) -> int:
    """``A`` is lane 1. Used by timers that name lanes rather than number them."""
    return raw.upper()[0] - ord("A") + 1


def lane_number(raw: bytes) -> int:
    return int(raw)


def seconds(raw: bytes) -> float:
    """A time already in seconds.

    The strip handles the winner-marking ``!`` landing inside the captured
    time in the older single-lane format, where the place symbol is not
    separated from the digits.
    """
    return float(raw.strip(b"!").strip())


def milliseconds(raw: bytes) -> float:
    """A time reported as a whole number of milliseconds."""
    return int(raw) / 1000.0


def place_symbol(raw: bytes) -> int:
    """A place written as one of ``!"#$%&``. Absent means unreported."""
    return PLACE_SYMBOLS.get(raw, 0)


def place_number(raw: bytes) -> int:
    return int(raw)


@dataclass(frozen=True)
class Group:
    """One captured group, and how to read it."""

    index: int
    read: Callable[[bytes], float]


@dataclass(frozen=True)
class Matcher:
    """A pattern, the event it means, and where the event's values are.

    Patterns are applied with :meth:`re.Pattern.search`, so an anchored pattern
    behaves as a full-line match and an unanchored one finds its subject
    anywhere in the line.
    """

    pattern: re.Pattern[bytes]
    event: Event
    lane: Group | None = None
    time: Group | None = None
    place: Group | None = None
    #: Apply across the whole line rather than once, producing one event per
    #: match. This is how a timer that reports every lane on a single line is
    #: read: ``A=3.001! B=3.002" C=3.003#`` is three results, not one.
    repeat: bool = False


@dataclass(frozen=True)
class Ack:
    """The response a command is expected to draw.

    Matched against the command as sent, so one entry can cover a family —
    the MicroWizard's per-lane mask commands are ``MA`` through ``MP``.
    """

    command: re.Pattern[bytes]
    response: re.Pattern[bytes]


@dataclass(frozen=True)
class GateWatcher:
    """How to ask the device whether the start gate is closed.

    Some timers report both edges unprompted; others only answer when asked.
    Both exist in the wild and a profile may carry both — the Bert Drake
    reports gate-open on its own *and* answers a `C` query.

    ``matchers`` are deliberately **not** part of the profile's general matcher
    list. The answers are as short as `0`, `U` or `.`, which would claim
    unrelated traffic if they were tried against every line; they are applied
    only inside the window that follows a poll. That scoping is the whole
    reason this is a separate field rather than three more matchers.
    """

    command: bytes
    matchers: tuple["Matcher", ...]


@dataclass(frozen=True)
class HeatPrep:
    """How to tell the timer which lanes are in play, and to arm.

    ``unmask`` re-enables every lane; a ``mask`` command is then sent for each
    lane that is *not* racing, named by offsetting ``first_lane``; ``arm`` puts
    the timer in its ready state. Any of them may be empty for a timer that
    does not support that step.
    """

    unmask: bytes = b""
    mask: bytes = b""
    first_lane: bytes = b"A"
    arm: bytes = b""


# ---------------------------------------------------------------------------
# The profile
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TimerProfile:
    """One timer model, described.

    The methods are the interface ``TimerManager`` uses; they hold no
    model-specific knowledge, only the rules for reading these fields.
    """

    name: str
    #: Stable identifier, for storing a chosen profile and naming it in logs.
    key: str
    #: Where this description came from and what has been done to check it.
    #:
    #: Shown to the operator, because "we have a profile for your timer" and
    #: "your timer is known to work" are different claims and only one of them
    #: is true for most of these. A profile transcribed from someone else's
    #: protocol notes is a good starting point, not evidence.
    provenance: str = ""

    # Port framing, in pyserial's vocabulary — the same four values the Web
    # Serial API takes, so the backend-direct and browser-proxy paths can both
    # be configured from them. 8-N-1 covers most timers, but not all: the
    # NewBold DT/TURBO/DerbyStick family runs at 1200 baud, 7 data bits and 2
    # stop bits, and opening its port at the defaults yields silent garbage
    # rather than a connection error.
    baud_rate: int = 9600
    data_bits: int = 8
    stop_bits: float = 1
    parity: str = "N"

    #: Bytes that terminate a message *from* the device.
    delimiter: bytes = b"\n"
    #: Bytes appended to every command sent *to* the device. Several timers
    #: ignore a command without it — the Champ, The Judge and the SuperTimer all
    #: want a carriage return — and the failure is silence rather than an error.
    command_eol: bytes = b""
    #: Bytes that are a whole message on their own, wherever they appear. A
    #: gate signal arrives without waiting for a terminator, because the
    #: information is worthless late.
    immediate_chars: tuple[bytes, ...] = ()
    #: False when the timer cannot say whether the start gate is closed, which
    #: makes READY unreachable for it — see ``TimerManager._handle_event``.
    gate_state_is_knowable: bool = False
    #: False for the fake timer, which has no port to open.
    requires_serial: bool = True
    #: How lanes are numbered by the mask commands, when the real lane count is
    #: not known.
    max_lanes: int = 6

    #: Transition to RESULTS_OVERDUE if no results arrive within this many
    #: seconds of the race starting. None means wait indefinitely.
    result_timeout_seconds: float | None = None
    #: Treat buffered bytes as a complete message after this long without a
    #: delimiter. Some timers omit the terminator on their final result, which
    #: otherwise strands it in the buffer while the manager waits in RUNNING
    #: for a lane the device considers already reported. None waits forever.
    line_idle_timeout_seconds: float | None = 0.2

    #: Sent before ``probe``, to settle a device that will not answer until it
    #: has been reset or woken. The prober pauses afterwards. Several timers
    #: need it and it is harmless where they do not.
    pre_probe: tuple[bytes, ...] = ()
    #: Sent by the port prober to draw the identification banner out of a
    #: device, when nothing is connected and no heat is in progress. Empty
    #: means the model cannot be probed for and will never be auto-detected.
    probe: tuple[bytes, ...] = ()
    #: Sent every time a connection opens, before ``setup``. Deliberately
    #: separate from ``probe``: this fires on every reconnect, including one
    #: that happens mid-event, where interrogating a timer is a good way to
    #: confuse it. Most profiles leave it empty and wait for the device to say
    #: something.
    on_connect: tuple[bytes, ...] = ()
    #: Patterns that confirm this is the model in question, in the order the
    #: device sends them. A prober matches the whole sequence, which is what
    #: makes a two-line banner discriminating; a live connection watches only
    #: for the first, since that is the line that says a device has appeared.
    #: So the first pattern must be one no other model produces.
    identification: tuple[re.Pattern[bytes], ...] = ()
    #: Sent once after identification, to put the device into a known output
    #: format.
    setup: tuple[bytes, ...] = ()

    heat_prep: HeatPrep = field(default_factory=HeatPrep)
    #: Return the device to an idle state, abandoning an armed heat.
    abort: tuple[bytes, ...] = ()
    #: Demand results now, for a run whose finish was never detected.
    force_results: tuple[bytes, ...] = ()

    acks: tuple[Ack, ...] = ()
    #: Tried in order, so a specific pattern must precede a general one.
    matchers: tuple[Matcher, ...] = ()
    #: Commands to send when something happens, keyed by our own timer events.
    #:
    #: This is how a timer that has to be *told* to report is driven. Most of
    #: them want a command when results are overdue — "force the end of the
    #: race and send what you have" — and a couple want one the moment the race
    #: starts, or once the gate is closed and the timer can safely be reset.
    on_event: "Mapping[Event, tuple[bytes, ...]]" = field(default_factory=dict)
    #: Present when the gate state has to be asked for rather than waited for.
    #: Ignored entirely unless ``gate_state_is_knowable`` — a profile may name a
    #: query the hardware does not really answer.
    gate_watcher: GateWatcher | None = None

    # -- The interface TimerManager uses ------------------------------------

    def expected_response_for(self, command: bytes) -> "re.Pattern[bytes] | None":
        """The pattern this command's acknowledgement should match, if any."""
        stripped = command.strip()
        for ack in self.acks:
            if ack.command.search(stripped):
                return ack.response
        return None

    def identification_commands(self) -> list[bytes]:
        return list(self.on_connect)

    def commands_for(self, event: Event) -> list[bytes]:
        """What to send when ``event`` happens. Usually nothing."""
        return list(self.on_event.get(event, ()))

    def wire(self, command: bytes) -> bytes:
        """A command as it goes onto the wire, terminator included."""
        return command + self.command_eol

    def is_identified_by(self, line: bytes) -> bool:
        """Whether this one line announces the device.

        Only the first identification pattern, not the whole sequence. The
        later ones are informational — a MicroWizard's version and serial
        number arrive on a second line, and treating that as an identification
        in its own right would have the manager re-initialise a device that
        was only finishing its banner.
        """
        if not self.identification:
            return False
        return self.identification[0].search(line) is not None

    def initialization_commands(self) -> list[bytes]:
        return list(self.setup)

    def prepare_heat_commands(self, lane_mask: int) -> list[bytes]:
        """Unmask every lane, mask out the ones not racing, then arm."""
        prep = self.heat_prep
        commands: list[bytes] = []
        if prep.unmask:
            commands.append(prep.unmask)
        if prep.mask:
            first = prep.first_lane[0]
            commands += [
                prep.mask + bytes([first + lane - 1])
                for lane in range(1, self.max_lanes + 1)
                if not lane_mask & (1 << (lane - 1))
            ]
        if prep.arm:
            commands.append(prep.arm)
        return commands

    def abort_commands(self) -> list[bytes]:
        return list(self.abort)

    def force_results_commands(self) -> list[bytes]:
        return list(self.force_results)

    def polls_the_gate(self) -> bool:
        """Whether asking about the gate is worth doing for this model."""
        return self.gate_watcher is not None and self.gate_state_is_knowable

    def read_gate(self, line: bytes) -> "TimerEvent | None":
        """Read a line as an answer to the gate query, or ``None``.

        Only ever called on lines received inside a poll's response window.
        """
        if self.gate_watcher is None:
            return None
        cleaned = line.strip()
        if not cleaned:
            return None
        for matcher in self.gate_watcher.matchers:
            match = matcher.pattern.search(cleaned)
            if match is not None:
                return self._event_from(matcher, match)
        return None

    def parse_line(self, line: bytes) -> "TimerEvent | list[TimerEvent] | None":
        """Read one complete message.

        Returns the events it means, an empty list for traffic that is
        recognised but carries no event, or ``None`` for a line no matcher
        claims — a distinction ``TimerManager`` uses to tell an unidentified
        device from a quiet one.
        """
        cleaned = line.strip()
        if not cleaned:
            return None

        for matcher in self.matchers:
            if matcher.repeat:
                events = [
                    self._event_from(matcher, match)
                    for match in matcher.pattern.finditer(cleaned)
                ]
                found = [event for event in events if event is not None]
                if found:
                    return found
                continue

            match = matcher.pattern.search(cleaned)
            if match is None:
                continue
            if matcher.event is Event.UNEXPECTED:
                # In normal operation the manager's pending-ack queue consumes
                # these before they reach here, so arriving means the device
                # answered something nobody asked.
                logger.warning("%s: unsolicited %r", self.name, cleaned)
            event = self._event_from(matcher, match)
            return [] if event is None else event

        return None

    def _event_from(
        self, matcher: Matcher, match: "re.Match[bytes]"
    ) -> "TimerEvent | None":
        """Build the event a match means, or ``None`` for the silent ones."""
        if matcher.event is Event.RACE_STARTED:
            return RaceStarted()
        if matcher.event is Event.GATE_CLOSED:
            return GateClosed()
        if matcher.event is Event.GATE_OPEN:
            return GateOpen()
        if matcher.event is Event.GATE_UNSUPPORTED:
            return GateWatcherUnsupported()
        if matcher.event is Event.LANE_COUNT:
            return LaneCount(lanes=int(_read(matcher.lane, match, 0)))
        if matcher.event is Event.LANE_RESULT:
            return LaneResult(
                lane=int(_read(matcher.lane, match, 0)),
                time_seconds=_read(matcher.time, match, 0.0),
                place=int(_read(matcher.place, match, 0)),
            )
        return None


def _read(group: Group | None, match: "re.Match[bytes]", default: float) -> float:
    """Read a captured group, or fall back when the profile does not name one."""
    if group is None:
        return default
    raw = match.group(group.index)
    if not raw:
        return default
    return group.read(raw)
