import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar


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
class DeviceError:
    message: str


TimerEvent = RaceStarted | LaneResult | GateClosed | DeviceError


class TimerDevice(ABC):
    name: ClassVar[str]

    # Port framing, in pyserial's vocabulary — the same four values the Web
    # Serial API takes, so the backend-direct and browser-proxy paths can both
    # be configured from them. 8-N-1 covers most timers, but not all: the
    # NewBold DT/TURBO/DerbyStick family runs at 1200 baud, 7 data bits and 2
    # stop bits, and opening its port at the defaults yields silent garbage
    # rather than a connection error.
    baud_rate: ClassVar[int] = 9600
    data_bits: ClassVar[int] = 8
    stop_bits: ClassVar[float] = 1
    parity: ClassVar[str] = "N"

    delimiter: ClassVar[bytes] = b"\n"
    gate_state_is_knowable: ClassVar[bool] = False
    requires_serial: ClassVar[bool] = True
    immediate_chars: ClassVar[list[bytes]] = []
    # If set, the manager will transition to RESULTS_OVERDUE if no results are
    # received within this many seconds of the race starting. None means no timeout.
    result_timeout_seconds: ClassVar[float | None] = None
    # How long to wait for a delimiter before treating the buffered bytes as a
    # complete message anyway. Some timers omit the terminator on their final
    # result, which otherwise leaves it in the buffer forever while the manager
    # waits in RUNNING for a lane the device considers already reported.
    # None disables the flush and waits for a delimiter indefinitely.
    line_idle_timeout_seconds: ClassVar[float | None] = 0.2

    def expected_response_for(self, _command: bytes) -> "re.Pattern[bytes] | None":
        """Return the regex pattern that should match the device's response to
        the given command, or None if no acknowledgment is expected.

        The pattern will be matched against the stripped, complete response line.
        """
        return None

    @abstractmethod
    def identification_commands(self) -> list[bytes]:
        """Bytes to send immediately after connecting, to probe identity."""

    @abstractmethod
    def is_identified_by(self, line: bytes) -> bool:
        """Return True if line confirms this is the expected device."""

    @abstractmethod
    def initialization_commands(self) -> list[bytes]:
        """Commands sent once after identification (e.g. set output format)."""

    @abstractmethod
    def prepare_heat_commands(self, lane_mask: int) -> list[bytes]:
        """Commands to arm the timer for a heat (reset + lane mask)."""

    @abstractmethod
    def abort_commands(self) -> list[bytes]:
        """Commands sent to put the device back into an idle/reset state."""

    def force_results_commands(self) -> list[bytes]:
        """Commands to demand result reporting from the device.

        Sent when the operator triggers 'Force Results' (e.g. in RESULTS_OVERDUE).
        Returns an empty list for devices that do not support this command.
        """
        return []

    @abstractmethod
    def parse_line(self, line: bytes) -> "TimerEvent | list[TimerEvent] | None":
        """Parse a complete message. Return a TimerEvent, a list of events, or None."""
