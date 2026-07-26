from .base import TimerDevice, TimerEvent


class FakeTimerDevice(TimerDevice):
    """A device that is never on the other end of a serial port.

    Every method here is a stub honouring :class:`TimerDevice`, so the
    parameters are part of the interface rather than of any implementation —
    hence the ``ARG002`` suppressions. Results come from ``fakeTimerStart`` /
    ``fakeTimerFinish`` driving the manager directly, not from parsed bytes.
    """

    name = "Fake Timer"
    baud_rate = 0
    delimiter = b"\n"
    gate_state_is_knowable = False
    requires_serial = False  # TimerManager skips connection; starts in IDLE

    def identification_commands(self) -> list[bytes]:
        return []

    def is_identified_by(self, line: bytes) -> bool:  # noqa: ARG002
        return False

    def initialization_commands(self) -> list[bytes]:
        return []

    def prepare_heat_commands(self, lane_mask: int) -> list[bytes]:  # noqa: ARG002
        return []

    def abort_commands(self) -> list[bytes]:
        return []

    def parse_line(self, line: bytes) -> "TimerEvent | None":  # noqa: ARG002
        return None
