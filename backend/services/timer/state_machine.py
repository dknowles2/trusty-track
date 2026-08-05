from dataclasses import dataclass
from enum import Enum


class TimerState(Enum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTED = "CONNECTED"
    IDLE = "IDLE"
    ARMED = "ARMED"
    READY = "READY"
    RUNNING = "RUNNING"
    RESULTS_OVERDUE = "RESULTS_OVERDUE"
    FAULT = "FAULT"


#: How long a polled gate state must persist before it is believed.
#:
#: DerbyNet's default, from their issue #35: staging cars against a start gate,
#: and latching it, produce brief readings that are real at the instant they
#: are taken and meaningless a moment later.
MIN_GATE_SECONDS = 0.5


@dataclass
class GateBelief:
    """What the start gate is doing, resisting a bouncing switch.

    **For polled gate state only.** A device that *reports* an edge has already
    done its own debouncing and says so once; requiring a second confirming
    observation would mean the change is never believed at all. A poll is a
    sample rather than an announcement, and the next one re-observes whatever
    is true — which is what makes waiting for persistence work here and only
    here.

    The rule, from DerbyNet: an observation that agrees with what we already
    believe cancels any pending change. One that disagrees starts a clock, and
    the belief moves only once the disagreement has lasted
    ``min_change_seconds``.
    """

    min_change_seconds: float = MIN_GATE_SECONDS
    closed: bool = False
    #: When the current run of disagreeing observations began.
    changing_since: float | None = None

    def observe(self, closed: bool, now: float) -> bool:
        """Record one sample. Returns whether the believed state just changed."""
        if closed == self.closed:
            self.changing_since = None
            return False

        if self.changing_since is None:
            self.changing_since = now

        # Compared on the same pass that starts the clock, so a
        # ``min_change_seconds`` of zero means what it says — no debounce, the
        # first sample is believed. Testing it only on later samples would make
        # zero mean "two samples", which is a trap for anyone switching the
        # rule off.
        if now - self.changing_since >= self.min_change_seconds:
            self.closed = closed
            self.changing_since = None
            return True

        return False

    def reset(self, closed: bool = False) -> None:
        """Forget everything, as when a heat is armed or a device reconnects."""
        self.closed = closed
        self.changing_since = None
