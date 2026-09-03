"""Converting an elapsed heat time into a scale speed (#610).

The single question every scout asks after a heat is "how fast did it go in
*real* miles per hour" — a 3.2 second run down a 40-foot track means nothing
on its own, but multiplied out by how much smaller the car is than the thing
it represents, it is a genuinely fast supercar. The arithmetic is a plain unit
conversion:

    scale MPH = (length_feet / time_seconds) * (3600 / 5280) * scale

``length_feet / time_seconds`` is feet per second; ``3600 / 5280`` converts
that to miles per hour; multiplying by ``scale`` blows the model-sized speed
up to the speed of the full-sized thing it stands in for.

``scale`` is a parameter, not a constant, because it is a fact about the
*vehicle*, and this app's vehicle is configurable (see the Terminology
section on ``vehicle_singular``/``vehicle_plural`` in ``CLAUDE.md``). A
standard BSA Pinewood Derby car is about 7 inches against a roughly 175-inch
real car, which is 1:25 — ``DEFAULT_SCALE`` below. A Space Derby rocket or a
Raingutter Regatta boat is not built to that ratio at all, so a track running
either format needs a different number, or scale speed turned off entirely.
Nothing in this module knows about tracks or races; it takes the ratio as an
argument and lets the caller decide what it should be.

A recorded time of zero (or less) is not a very fast car, it is the DNF
marker ``services/scoring.py`` already uses (see "Scoring" in
``CLAUDE.md``) — so it, and a non-positive length or scale, all resolve to
``None`` rather than to a number nobody should read.
"""

from __future__ import annotations

__all__ = ["DEFAULT_SCALE", "scale_mph"]

#: The standard BSA Pinewood Derby ratio — a ~7-inch car against a ~175-inch
#: real passenger car is 1:25. Stage 2's migration default and stage 3's
#: settings form both import this rather than repeat the number, so there is
#: one place that says why 25 and not some other value.
DEFAULT_SCALE = 25


def scale_mph(
    length_feet: float | None,
    time_seconds: float | None,
    scale: float = DEFAULT_SCALE,
) -> float | None:
    """Return the scale speed in MPH, or ``None`` if it cannot be computed.

    ``None`` covers every input that is not a real, finished run: a missing
    length or time, a non-positive length (an unconfigured track), a
    non-positive time (the DNF marker — a heat that did not finish has no
    speed to report), and a non-positive scale (nothing to scale by).
    """
    if length_feet is None or time_seconds is None:
        return None
    if length_feet <= 0 or time_seconds <= 0 or scale <= 0:
        return None
    return (length_feet / time_seconds) * (3600 / 5280) * scale
