from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar, List, Union


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


TimerEvent = Union[RaceStarted, LaneResult, GateClosed, DeviceError]


class TimerDevice(ABC):
    name: ClassVar[str]
    baud_rate: ClassVar[int] = 9600
    delimiter: ClassVar[bytes] = b'\n'
    gate_state_is_knowable: ClassVar[bool] = False
    requires_serial: ClassVar[bool] = True

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

    def force_results_commands(self) -> List[bytes]:
        """Commands to demand result reporting from the device.

        Sent when the operator triggers 'Force Results' (e.g. in RESULTS_OVERDUE).
        Returns an empty list for devices that do not support this command.
        """
        return []

    @abstractmethod
    def parse_line(self, line: bytes) -> "TimerEvent | None":
        """Parse a complete message. Return a TimerEvent or None."""
