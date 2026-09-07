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

#: How many decimal places a generated time carries -- matching what every
#: real timer profile reports (#763). Unrounded, `source.random()` produces
#: fifteen-digit float noise (``3.41412257608823``), which used to reach the
#: Edit modal's inputs and a CSV export digit for digit.
_TIME_DECIMALS = 3


def _rounded_time(raw: float) -> float:
    """Round to `_TIME_DECIMALS` places without letting a value at the very
    top of the window round up to (or past) ``SLOWEST_SECONDS``.

    ``source.random()`` is exclusive of 1.0, so ``raw`` is always strictly
    below ``SLOWEST_SECONDS`` -- but rounding is not exclusive, and a value
    within half a thousandth of the ceiling (e.g. ``3.99961``) rounds *to*
    it. `test_they_land_in_the_window` (and the scoring/display rules that
    read the window's own bound) say that never happens, so this clamps
    rather than letting a one-in-a-thousand-ish draw violate it.
    """
    rounded = round(raw, _TIME_DECIMALS)
    ceiling = SLOWEST_SECONDS - (10**-_TIME_DECIMALS)
    return min(rounded, ceiling)


def lane_times(lanes: Sequence[int], *, key: str) -> list[tuple[int, float]]:
    """A time for each lane, fastest first.

    ``key`` identifies the heat — the race's name and its heat number, rather
    than its id, which depends on how many races were created before it. See
    `backend.demo_seed` for why this is keyed at all.
    """
    source = demo_seed.generator(key)
    span = SLOWEST_SECONDS - FASTEST_SECONDS
    timed = [
        (lane, _rounded_time(FASTEST_SECONDS + source.random() * span))
        for lane in lanes
    ]
    timed.sort(key=lambda pair: pair[1])
    return timed
