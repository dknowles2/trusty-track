"""A timer that is never on the other end of a serial port.

Every field is left at its default, because there is no protocol: results come
from the ``fakeTimerStart`` and ``fakeTimerFinish`` mutations driving the
manager directly, not from parsed bytes. ``requires_serial=False`` is what
makes ``TimerManager`` skip connection and identification and start in IDLE.
"""

from .base import TimerProfile

FAKE = TimerProfile(
    name="Fake Timer",
    key="fake",
    baud_rate=0,
    requires_serial=False,
)
