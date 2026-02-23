import re
import logging
from typing import List, Optional

from .base import TimerDevice, TimerEvent, LaneResult, RaceStarted

logger = logging.getLogger(__name__)

# Leading characters to strip from result lines
_STRIP_CHARS = b'@>'

# Matches a lane and time pair in the old-style format: A=3.001! or B=3.002
# The exclamation point indicates the winner.
_OLD_RESULT_PAIR_RE = re.compile(rb'([A-P])=(\d+\.\d+)(!?)', re.IGNORECASE)

# Matches a result line, like:
# A=3.001! B=3.002 C=3.003 D=3.004 E=3.005 F=3.006
# The ! indicates the winning lane.
_RESULT_RE = re.compile(rb'^\s*(\d+)\s+([\d.!\s]+?)\s+(\d+)\s*$')

# Matches a start signal (usually 'B' or '@' for MicroWizard)
_START_RE = re.compile(rb'^@$', re.IGNORECASE)

# Matches an identification response (the device echoes N1 or sends a banner)
_IDENT_RE = re.compile(rb'micro\s*wizard|copyright|k\d|serial\s*number', re.IGNORECASE)


class MicroWizardDevice(TimerDevice):
    name = "MicroWizard K1"
    baud_rate = 9600
    delimiter = b'\r\n'
    gate_state_is_knowable = False
    requires_serial = True
    immediate_chars = [b'@']

    def identification_commands(self) -> List[bytes]:
        # 'RV' requests the version string (e.g., "Copyright (c) Micro Wizard 2001-2009...")
        return [b'RV\n']

    def is_identified_by(self, line: bytes) -> bool:
        return bool(_IDENT_RE.search(line))

    def initialization_commands(self) -> List[bytes]:
        return []

    def prepare_heat_commands(self, lane_mask: int) -> List[bytes]:
        # Send lane mask then reset/arm
        mask_hex = format(lane_mask, 'X')
        return [
            f'M{mask_hex}\n'.encode(),
            b'LR\n',
        ]

    def abort_commands(self) -> List[bytes]:
        # LR will reset / arm / abort depending on context
        return [b'LR\n']

    def force_results_commands(self) -> List[bytes]:
        # RA forces the device to report results for all lanes immediately
        return [b'RA\n']

    def parse_line(self, line: bytes) -> "TimerEvent | List[TimerEvent] | None":
        # Check for start signal before stripping leading markers
        # because '@' is often one of the markers but can also be the signal itself.
        cleaned = line.strip()
        if not cleaned:
            return None

        if _START_RE.match(cleaned):
            logger.info("MicroWizard: matched start signal: %r", cleaned)
            return RaceStarted()

        # Try parsing the old-style multi-lane format: A=3.001! B=3.002 C=3.003
        results: List[TimerEvent] = []
        for match in _OLD_RESULT_PAIR_RE.finditer(cleaned):
            lane_letter = match.group(1).upper()
            lane = ord(lane_letter) - ord(b'A') + 1
            time_seconds = float(match.group(2))
            is_winner = bool(match.group(3))
            
            # Since the old format only notes the winner (place=1), we leave other places as 0
            # for the caller or frontend to sort out based on relative times.
            place = 1 if is_winner else 0
            
            logger.info("MicroWizard: matched old-style multi-lane result: lane=%d (%r), time=%f, winner=%s", 
                        lane, lane_letter, time_seconds, is_winner)
            results.append(LaneResult(lane=lane, time_seconds=time_seconds, place=place))
        
        if results:
            return results

        # Fall back to old-style single result format
        # For old results, strip leading @ or > markers
        line = cleaned.lstrip(_STRIP_CHARS).strip()
        if not line:
            return None

        # Check for result line
        m = _RESULT_RE.match(line)
        if m:
            lane = int(m.group(1))
            # Strip any markers like '!' from the time string
            time_str = m.group(2).strip(b'!')
            time_seconds = float(time_str)
            place = int(m.group(3))
            logger.info("MicroWizard: matched old-style result: lane=%d, time=%f, place=%d", lane, time_seconds, place)
            return LaneResult(lane=lane, time_seconds=time_seconds, place=place)

        logger.debug("MicroWizard: failed to parse line: %r", cleaned)
        return None
