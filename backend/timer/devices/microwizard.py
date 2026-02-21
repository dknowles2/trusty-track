import re
from typing import List, Optional

from .base import TimerDevice, TimerEvent, LaneResult


# Leading characters to strip from result lines
_STRIP_CHARS = b'@>'

# Matches a result line: lane  time  place (e.g. "  1    3.452  1")
_RESULT_RE = re.compile(rb'^\s*(\d+)\s+([\d.]+)\s+(\d+)\s*$')

# Matches an identification response (the device echoes N1 or sends a banner)
_IDENT_RE = re.compile(rb'N1', re.IGNORECASE)


class MicroWizardDevice(TimerDevice):
    name = "MicroWizard K1"
    baud_rate = 9600
    delimiter = b'\n'
    gate_state_is_knowable = False
    requires_serial = True

    def identification_commands(self) -> List[bytes]:
        return [b'N1\n']

    def is_identified_by(self, line: bytes) -> bool:
        return bool(_IDENT_RE.search(line))

    def initialization_commands(self) -> List[bytes]:
        # N1 selects "new format" output; already sent as identification probe
        return []

    def prepare_heat_commands(self, lane_mask: int) -> List[bytes]:
        # Send lane mask then reset/arm
        mask_hex = format(lane_mask, 'X')
        return [
            f'M{mask_hex}\n'.encode(),
            b'LR\n',
        ]

    def abort_commands(self) -> List[bytes]:
        return [b'LR\n']

    def force_results_commands(self) -> List[bytes]:
        # RA forces the device to report results for all lanes immediately
        return [b'RA\n']

    def parse_line(self, line: bytes) -> Optional[TimerEvent]:
        # Strip leading @ and > characters
        line = line.lstrip(_STRIP_CHARS).strip()

        m = _RESULT_RE.match(line)
        if m:
            lane = int(m.group(1))
            time_seconds = float(m.group(2))
            place = int(m.group(3))
            return LaneResult(lane=lane, time_seconds=time_seconds, place=place)

        return None
