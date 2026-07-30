"""What a printed check-in code says, and how to read one back.

A pure rule, so the scanner and the printer cannot drift: one function writes
the payload, one reads it, and a round-trip test holds them together.

The payload
-----------
``TT1:<race_id>:<racer_id>`` — a version tag, the race, and the racer.

**Versioned** because these are printed on paper. A pit pass made this morning
is scanned this afternoon by whatever the app is by then; a bare number gives a
future format nothing to recognise, while an unknown prefix can be rejected
with something the operator can act on.

**Race-scoped** because a racer id means nothing without one. Two events on one
machine reuse neither, but a code printed at last year's derby and left in a
scout's box would otherwise resolve to whoever now holds that id — and check-in
is the one screen where scanning the wrong child is expensive.

Not a URL. A URL needs a host, the host is whatever address the operator's
laptop got from the venue's DHCP that morning, and paper printed against it is
wrong the moment the machine moves. Scanning happens inside the app, which
already knows where it is.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Bumped only if the meaning of the fields changes. A reader that does not know
#: a version must refuse the code rather than guess at it.
VERSION = "TT1"

_SEPARATOR = ":"


@dataclass(frozen=True)
class CheckInCode:
    """Who a scanned code points at."""

    race_id: int
    racer_id: int


def encode(race_id: int, racer_id: int) -> str:
    """The payload to print for this racer."""
    return _SEPARATOR.join((VERSION, str(race_id), str(racer_id)))


def decode(payload: str) -> CheckInCode | None:
    """Read a scanned payload, or ``None`` if it is not one of ours.

    ``None`` covers every kind of wrong — a QR code from a cereal box, a code
    from a version we do not know, a truncated scan. The caller's answer to all
    of them is the same: say it is not a Trusty Track code and let the operator
    try again or search by name.
    """
    parts = payload.strip().split(_SEPARATOR)
    if len(parts) != 3:
        return None

    version, race, racer = parts
    if version != VERSION:
        return None

    try:
        return CheckInCode(race_id=int(race), racer_id=int(racer))
    except ValueError:
        return None
