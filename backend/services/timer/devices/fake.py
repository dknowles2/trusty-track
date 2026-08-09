"""A timer that is never on the other end of a serial port.

Every field is left at its default, because there is no protocol: results come
from the ``fakeTimerStart`` and ``fakeTimerFinish`` mutations driving the
manager directly, not from parsed bytes. ``requires_serial=False`` is what
makes ``TimerManager`` skip connection and identification and start in IDLE.
"""

from collections.abc import Sequence

from backend import demo_seed

from .base import TimerProfile

FAKE = TimerProfile(
    name="Fake Timer",
    key="fake",
    baud_rate=0,
    requires_serial=False,
)

#: The window a fake car finishes in, in seconds.
FASTEST_SECONDS = 3.0
SLOWEST_SECONDS = 4.0


def lane_times(lanes: Sequence[int], *, key: str) -> list[tuple[int, float]]:
    """A time for each lane, fastest first.

    ``key`` identifies the heat — the race's name and its heat number, rather
    than its id, which depends on how many races were created before it. See
    `backend.demo_seed` for why this is keyed at all.
    """
    source = demo_seed.generator(key)
    span = SLOWEST_SECONDS - FASTEST_SECONDS
    timed = [(lane, FASTEST_SECONDS + source.random() * span) for lane in lanes]
    timed.sort(key=lambda pair: pair[1])
    return timed
