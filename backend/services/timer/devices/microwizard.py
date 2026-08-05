import logging
import re

from .base import GateClosed, LaneResult, RaceStarted, TimerDevice, TimerEvent

logger = logging.getLogger(__name__)

# Leading characters to strip from result lines
_STRIP_CHARS = b"@>"

# Symbols that indicate placement in the N1 "new-format" results.
_PLACE_SYMBOLS = {
    b"!": 1,
    b'"': 2,
    b"#": 3,
    b"$": 4,
    b"%": 5,
    b"&": 6,
}

# Matches a lane and time pair in the multi-lane format: A=3.001! or B=3.002"
# The symbol after the time indicates the place.
_RESULT_PAIR_RE = re.compile(rb"([A-P])\s*=\s*(\d+(?:\.\d+)?)\s*([!\"#\$%&]?)")

# Matches a result line, like:
# A=3.001! B=3.002 C=3.003 D=3.004 E=3.005 F=3.006
# The ! indicates the winning lane.
_RESULT_RE = re.compile(rb"^\s*(\d+)\s+([\d.!\s]+?)\s+(\d+)\s*$")

# Matches the gate-opened signal. The timer begins counting when '@' is received.
_START_RE = re.compile(rb"^@$")

# Matches the gate-closed signal. Sent when the start gate closes after opening.
# It says nothing about the run that has already begun — timing started on '@' —
# but while the timer is armed it is how we learn the cars are staged behind a
# latched gate, which is the ARMED to READY transition.
_GATE_CLOSED_RE = re.compile(rb"^>$")

# Matches an acknowledgment ('AC') sent after certain commands (e.g. MG).
_ACK_RE = re.compile(rb"^AC$")

# Matches a '*' acknowledgment sent after certain commands (e.g. N2, MA–MF).
_STAR_ACK_RE = re.compile(rb"^\*$")

# Line 1 of the RV response: "Copyright (c) Micro Wizard 2002-2009"
_IDENT_RE = re.compile(rb"micro\s*wizard", re.IGNORECASE)

# Line 2 of the RV response: "K2 Version 2.3A  Serial Number29284"
_VERSION_RE = re.compile(rb"^K\d\s+Version\s+\S+\s+Serial\s*Number\d+$", re.IGNORECASE)


class MicroWizardDevice(TimerDevice):
    name = "MicroWizard K1/K2/K3"
    baud_rate = 9600
    delimiter = b"\r"
    # The N2 command we send during initialization turns on real-time gate
    # feedback, so the device reports both edges: '@' when the gate opens and
    # '>' when it closes. The closing edge is the one that carries news — while
    # the timer is armed it means the cars are staged and the gate is latched,
    # which is what separates READY from ARMED on the operator's screen.
    gate_state_is_knowable = True
    requires_serial = True
    immediate_chars = [b"@", b">"]
    # The MicroWizard silently discards results and resets if no finish is detected
    # within 10 seconds of the gate opening. It sends no notification when this happens.
    result_timeout_seconds = 10.0

    def __init__(self) -> None:
        # Tracks whether we have seen the first RV line (copyright) and are
        # waiting for the second (version) to complete identification.
        self._pending_ident = False

    def identification_commands(self) -> list[bytes]:
        # We no longer proactively send 'RV'. We rely on unsolicited
        # identification (on reboot) or manual identification.
        return []

    def is_identified_by(self, line: bytes) -> bool:
        # We return True as soon as we see the Micro Wizard copyright string.
        # This triggers the manager to move from DISCONNECTED/CONNECTED to
        # IDLE/ARMED. We don't need the second version line for state
        # transitions, and treating it as a second identification event
        # could trigger an unwanted re-initialization loop.
        return bool(_IDENT_RE.search(line))

    # Commands that expect a '*' ack, and MG which expects 'AC'.
    # Lane-mask commands MA–MF are matched dynamically below.
    _STAR_ACK_CMDS: frozenset[bytes] = frozenset([b"N1", b"N2", b"LR"])

    def expected_response_for(self, command: bytes) -> "re.Pattern[bytes] | None":
        cmd = command.strip().upper()
        if cmd == b"MG":
            return _ACK_RE
        if cmd in self._STAR_ACK_CMDS:
            return _STAR_ACK_RE
        # Lane-mask commands MA–MF (and up to MP for up to 16 lanes)
        if len(cmd) == 2 and cmd[:1] == b"M" and b"A" <= cmd[1:2] <= b"P":
            return _STAR_ACK_RE
        return None

    def initialization_commands(self) -> list[bytes]:
        # N1 enables "new format" results (lane results on one line with placement).
        # N2 enables real-time gate feedback. The timer responds with '\r\n*\r\n'
        # to acknowledge, then sends '@' when the start gate opens (timer begins
        # counting) and '>' when the gate closes (which is what makes READY
        # reachable — see `gate_state_is_knowable` above).
        return [b"N1", b"N2"]

    NUM_LANES = 6

    def prepare_heat_commands(self, lane_mask: int) -> list[bytes]:
        # MG clears all lane masks (resets to all lanes active), then send one
        # M<letter> command for each masked-out (inactive) lane, then arm.
        # Lane 1 = 'A', lane 2 = 'B', ..., lane 6 = 'F'.
        # MG responds with '\r\nAC' to acknowledge.
        commands = [b"MG"]
        # Each individual mask command (MA–MF) responds with '\r\n*\r\n'.
        commands += [
            f"M{chr(ord('A') + lane - 1)}".encode()
            for lane in range(1, self.NUM_LANES + 1)
            if not (lane_mask & (1 << (lane - 1)))
        ]
        # LR arms the timer and responds with '\r\n*\r\n'.
        commands.append(b"LR")
        return commands

    def abort_commands(self) -> list[bytes]:
        # LR will reset / arm / abort depending on context; responds with '\r\n*\r\n'.
        return [b"LR"]

    def force_results_commands(self) -> list[bytes]:
        # RA forces the device to report results for all lanes immediately
        return [b"RA"]

    def parse_line(self, line: bytes) -> "TimerEvent | list[TimerEvent] | None":
        # Check for start signal before stripping leading markers
        # because '@' is often one of the markers but can also be the signal itself.
        cleaned = line.strip()
        if not cleaned:
            return None

        if _START_RE.match(cleaned):
            logger.info("MicroWizard: gate opened, timer started")
            return RaceStarted()

        if _GATE_CLOSED_RE.match(cleaned):
            logger.info("MicroWizard: gate closed")
            return GateClosed()

        if _IDENT_RE.search(cleaned):
            logger.debug("MicroWizard: RV identification line received: %r", cleaned)
            return []

        if _VERSION_RE.match(cleaned):
            logger.debug("MicroWizard: RV version line received: %r", cleaned)
            return []

        # AC and * are command acknowledgments. In normal operation they are
        # consumed by the manager's pending-ack queue before reaching parse_line.
        # If they arrive here it means they were unsolicited or unexpected.
        if _ACK_RE.match(cleaned):
            logger.warning("MicroWizard: unexpected AC acknowledgment: %r", cleaned)
            return []

        if _STAR_ACK_RE.match(cleaned):
            logger.warning("MicroWizard: unexpected * acknowledgment: %r", cleaned)
            return []

        # Try parsing the multi-lane format: A=3.001! B=3.002" C=3.003#
        results: list[TimerEvent] = []
        for match in _RESULT_PAIR_RE.finditer(cleaned):
            lane_letter = match.group(1).upper()
            lane = ord(lane_letter) - ord(b"A") + 1
            time_seconds = float(match.group(2))
            symbol = match.group(3)

            place = _PLACE_SYMBOLS.get(symbol, 0)
            logger.info(
                "MicroWizard: multi-lane: lane=%d (%r), time=%f, symbol=%r, place=%d",
                lane,
                lane_letter,
                time_seconds,
                symbol,
                place,
            )
            results.append(
                LaneResult(lane=lane, time_seconds=time_seconds, place=place)
            )

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
            time_str = m.group(2).strip(b"!")
            time_seconds = float(time_str)
            place = int(m.group(3))
            logger.info(
                "MicroWizard: old-style result: lane=%d, time=%f, place=%d",
                lane,
                time_seconds,
                place,
            )
            return LaneResult(lane=lane, time_seconds=time_seconds, place=place)

        logger.debug("MicroWizard: failed to parse line: %r", cleaned)
        return None
