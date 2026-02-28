from typing import List

from .base import TimerDevice, TimerEvent


class FakeTimerDevice(TimerDevice):
    name = "Fake Timer"
    baud_rate = 0
    delimiter = b"\n"
    gate_state_is_knowable = False
    requires_serial = False  # TimerManager skips connection; starts in IDLE

    def identification_commands(self) -> List[bytes]:
        return []

    def is_identified_by(self, line: bytes) -> bool:
        return False

    def initialization_commands(self) -> List[bytes]:
        return []

    def prepare_heat_commands(self, lane_mask: int) -> List[bytes]:
        return []

    def abort_commands(self) -> List[bytes]:
        return []

    def parse_line(self, line: bytes) -> "TimerEvent | None":
        return None
