"""A track that has no timer at all (#490).

Not every pack owns one, and a track configured this way says so rather than
being coerced into ``FAKE`` — which invents times a few seconds after Start,
the opposite of what hand entry needs, and produces a result indistinguishable
from a real one.

Every field is left at its default, the same as :data:`fake.FAKE`: there is no
protocol to speak, and no port to open. ``requires_serial=False`` is what keeps
``TimerManager`` out of ``DISCONNECTED`` — this is not a device waiting to be
found, and reporting it as disconnected would be a false alarm on every page
load. What is different from the fake timer is not the wiring, it is the
policy around it: ``prepareHeat`` and ``startTimerTest`` both refuse to arm a
track running this profile (see ``_device_for`` and the two resolvers in
``api/schema.py``), because there is nothing for the operator to release a
gate on and no results are ever going to arrive on their own.

Deliberately not in ``ALL_PROFILES`` or reachable through ``by_key``, the same
as ``FAKE`` — it is chosen by setting a track's ``timer_type`` to ``NONE``, not
by naming a model, and offering it in the model picker would let a track ask
for "no timer" over a real serial port.
"""

from .base import TimerProfile

NO_TIMER = TimerProfile(
    name="No Timer",
    key="none",
    baud_rate=0,
    requires_serial=False,
)
