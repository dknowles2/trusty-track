"""The timer models Trusty Track knows about.

``ALL_PROFILES`` is what a port prober walks (issue #89) and what a "choose
your timer" control would list. The fake timer is deliberately not in it: it
has no protocol to probe for and is chosen explicitly, by setting a track's
``timer_type`` to FAKE.
"""

from .base import TimerProfile
from .fake import FAKE
from .microwizard import MICROWIZARD

#: Every real device, in the order a prober should try them.
ALL_PROFILES: tuple[TimerProfile, ...] = (MICROWIZARD,)

#: The profile assumed when a track is in an auto-detect mode. There is nothing
#: automatic about it yet — probing is the other half of issue #89 — so this is
#: the one device we support, named in one place rather than constructed at the
#: call sites that need it.
DEFAULT_PROFILE: TimerProfile = MICROWIZARD


def by_key(key: str) -> TimerProfile | None:
    """Look up a profile by its stable identifier, including the fake timer."""
    for profile in (*ALL_PROFILES, FAKE):
        if profile.key == key:
            return profile
    return None


__all__ = [
    "ALL_PROFILES",
    "DEFAULT_PROFILE",
    "FAKE",
    "MICROWIZARD",
    "TimerProfile",
    "by_key",
]
