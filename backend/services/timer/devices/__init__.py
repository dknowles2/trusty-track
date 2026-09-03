"""The timer models Trusty Track knows about.

``ALL_PROFILES`` is what a port prober walks (issue #89) and what a "choose
your timer" control would list. The fake timer is deliberately not in it: it
has no protocol to probe for and is chosen explicitly, by setting a track's
``timer_type`` to FAKE.
"""

from .base import TimerProfile
from .derbynet import ADAPTED_FROM_DERBYNET
from .fake import FAKE
from .microwizard import MICROWIZARD
from .no_timer import NO_TIMER

#: Every real device, in the order a prober should try them.
#:
#: The MicroWizard leads because it is the model this project was built around
#: and the one most likely to be on the other end of the cable. The rest are
#: adapted from DerbyNet and none has been run against its hardware — see
#: ``derbynet.py`` and each profile's ``provenance``.
ALL_PROFILES: tuple[TimerProfile, ...] = (MICROWIZARD, *ADAPTED_FROM_DERBYNET)

#: The profile assumed when a track is in an auto-detect mode, until a probe
#: replaces it — and, on either transport, when nothing answers one. Named in
#: one place rather than constructed at the call sites that need it.
DEFAULT_PROFILE: TimerProfile = MICROWIZARD


def by_key(key: str) -> TimerProfile | None:
    """Look up a profile by its stable identifier, including the fake timer."""
    for profile in (*ALL_PROFILES, FAKE):
        if profile.key == key:
            return profile
    return None


__all__ = [
    "ADAPTED_FROM_DERBYNET",
    "ALL_PROFILES",
    "DEFAULT_PROFILE",
    "FAKE",
    "MICROWIZARD",
    "NO_TIMER",
    "TimerProfile",
    "by_key",
]
