"""Heat scheduling: lane rotation ("chaotic rotation", #1090).

The chart many packs ran by hand before software: line the field up, run a
heat of the first `lane_count` cars, then rotate — each car's next heat puts
it one lane further along than the last. It has none of PPC's opponent-variety
heuristic (#26) and does not try to — its appeal is that it is the simplest
schedule to explain off a printed sheet, and what a pack asking for "rotation"
by name usually means.

``generate_rotation`` has :func:`backend.domain.scheduling.generate_ppc`'s
exact signature and the same *shared* guarantees (see
``domain/schedulers/__init__.py``'s registry and ``test_domain_scheduling.py``,
which runs both against the same property suite): no racer appears twice in a
heat, no racer appears twice in a lane, every heat is as full as the field
allows, every racer gets the same number of runs, and the schedule is
deterministic given a seed.

**The design, and why it needs no special case for an uneven field.** Shuffle
the roster once, then read it as a circle of ``len(racer_ids)`` positions —
position ``i`` for ``i`` in ``0..N-1``, wrapping back to ``0`` after ``N-1``.
Heat ``i`` is the window of ``min(N, L)`` consecutive positions ending at
``i`` (``i``, ``i-1``, ``i-2``, ...), assigned to the usable lanes in order —
the window's leading position takes the first usable lane, and each position
behind it takes the next. A car at position ``c`` therefore appears in
exactly ``min(N, L)`` consecutive heats — ``c``, ``c+1``, ..., ``c +
min(N,L) - 1`` (mod ``N``) — and for any two heats numbered ``h`` and ``h+1``
it appears in, its lane position moves one further along the usable-lane list
between them, wrapping from the last lane back to the first exactly where its
own run of heats wraps from heat ``N-1`` back to heat ``0``. That is "a car's
next heat is its previous lane plus one," stated as arithmetic mod the
window rather than a plain increment, because a car whose run of heats
straddles the ``N-1``/``0`` boundary is not a special case either — the wrap
in its lane sequence lands exactly on the wrap in its heat sequence.

Reading the schedule as a *circle* rather than chopping the roster into
disjoint groups of ``lane_count`` is what keeps every heat full without a
special case for ``N % lane_count != 0``: a literal chunking (cars 1-4, cars
5-8, ...) leaves a short last group whenever the field is not an exact
multiple of the lane count, and a short group's own heats would be short too
even though the *field* is bigger than the track is wide — exactly the #26
failure shape this module exists not to reintroduce. The circle has no
leftover: heat ``N-1`` wraps around and borrows from the front of the roster,
so every one of the ``N`` heats is full at ``min(N, L)`` racers, the same
figure PPC guarantees for the same field.

``N < L`` (a field smaller than the track) is not a special case either: the
window is ``min(N, L)`` wide, so every heat holds all ``N`` racers and the
remaining lanes are simply unused (``None``) in every heat — three racers
cannot fill four lanes here any more than they can under PPC.
"""

from __future__ import annotations

import random
from collections.abc import Sequence

from backend.domain.scheduling import HeatPlan


def generate_rotation(
    racer_ids: list[int],
    usable_lanes: Sequence[int],
    start_heat_number: int = 1,
    rng: random.Random | None = None,
) -> list[HeatPlan]:
    """Build a lane-rotation schedule. See the module docstring for the shape.

    ``usable_lanes`` is which lanes, not how many (#171) — sorted and
    de-duplicated, exactly as :func:`backend.domain.scheduling.generate_ppc`
    does, so a gapped track (lane 3 out of service) is handled identically:
    the rotation still visits every *usable* lane once per car, naming the
    lanes that exist.

    ``rng`` is injectable so tests can pin the shuffle; production passes
    nothing and gets a fresh generator, the same convention `generate_ppc`
    uses and for the same reason.
    """
    lane_numbers = tuple(sorted(set(usable_lanes)))
    lane_count = len(lane_numbers)
    if lane_count == 0:
        return []

    p_ids = list(racer_ids)
    p_count = len(p_ids)
    if p_count == 0:
        return []

    (rng or random.Random()).shuffle(p_ids)

    window = min(p_count, lane_count)

    plans: list[HeatPlan] = []
    for i in range(p_count):
        heat_lanes: list[int | None] = [None] * lane_count
        for offset in range(window):
            racer_index = (i - offset) % p_count
            heat_lanes[offset] = p_ids[racer_index]
        plans.append(
            HeatPlan(
                heat_number=start_heat_number + i,
                lanes=tuple(heat_lanes),
                lane_numbers=lane_numbers,
            )
        )
    return plans
