"""Heat scheduling: the Perfect-N chart (#1090, part C).

PPC (`domain/scheduling.py`) gives every car every lane once and treats
opponent variety as a best-effort heuristic — a *partial* perfect chart.
Perfect-N is the stronger, rarer guarantee it is named against: every car
every lane once, **and** every pair of cars meets the same number of times.
That second property only holds for field sizes a published chart actually
covers (`perfect_n_tables.TABLES`) — there is no way to build one for an
arbitrary `(lanes, n)` the way PPC's heuristic degrades gracefully for any
shape, so `available_for` is not the formality it is for PPC and ROTATION
(`domain/schedulers/__init__.py`'s `_always_available`): it is the real
answer, checked by the property suite (`test_domain_scheduling.py`) and, in
production, by the wizard (part D) before this module is ever called for a
shape it cannot serve.

``generate_perfect_n`` has :func:`backend.domain.scheduling.generate_ppc`'s
exact signature. Chart data is in car *positions* ``1..n`` and lane
*positions* ``1..lanes``, relative to nothing but the chart itself; this
function is the only place those get mapped onto real racer ids and real
lane numbers — a seeded shuffle of ``racer_ids`` supplies the determinism
`generate_ppc` gets from shuffling before assigning, and ``usable_lanes``
(sorted, de-duplicated, exactly as `generate_ppc` and `generate_rotation` do
— see #171) supplies the lane numbers in chart order.
"""

from __future__ import annotations

import random
from collections.abc import Sequence

from backend.domain.schedulers.perfect_n_tables import TABLES
from backend.domain.scheduling import HeatPlan


def available_for(n_racers: int, n_lanes: int) -> str | None:
    """A reason Perfect-N cannot schedule this field, or ``None``.

    ``0`` racers or ``0`` lanes is trivially fine — :func:`generate_perfect_n`
    returns no heats either way, the same degenerate case every registered
    algorithm shares, and there is nothing a chart could refuse about it.
    Otherwise the table must exist exactly: a Perfect-N chart is not a
    heuristic that degrades for a field the table does not cover, unlike
    PPC, so a field smaller than the lane count (which PPC and ROTATION
    both schedule by leaving lanes empty) has no table here either — no
    published chart exists for fewer cars than the track is wide.
    """
    if n_racers == 0 or n_lanes == 0:
        return None
    if (n_lanes, n_racers) in TABLES:
        return None
    return (
        f"No Perfect-N chart is published for {n_racers} cars on {n_lanes} "
        "lanes; use the Partial Perfect Chart."
    )


def generate_perfect_n(
    racer_ids: list[int],
    usable_lanes: Sequence[int],
    start_heat_number: int = 1,
    rng: random.Random | None = None,
) -> list[HeatPlan]:
    """Build a Perfect-N schedule from the table for this exact shape.

    Raises ``ValueError`` (naming the same reason :func:`available_for`
    would have given) if no table covers ``(len(usable_lanes),
    len(racer_ids))`` — callers are expected to check ``available_for``
    first (the wizard, part D, and the latecomer path both do); this is a
    backstop against a round created directly through the GraphQL API with
    an algorithm/field-size combination nothing has vetted, not the normal
    path to a refusal.

    ``rng`` seeds which racer id lands on which chart position — the chart
    itself is fixed, but *who* is "car 1" is reshuffled every time, the same
    convention `generate_ppc` and `generate_rotation` use so a regenerated
    round with the same seed reproduces the same schedule.
    """
    lane_numbers = tuple(sorted(set(usable_lanes)))
    lane_count = len(lane_numbers)
    if lane_count == 0:
        return []

    p_ids = list(racer_ids)
    p_count = len(p_ids)
    if p_count == 0:
        return []

    reason = available_for(p_count, lane_count)
    if reason is not None:
        raise ValueError(reason)

    chart = TABLES[(lane_count, p_count)]

    shuffled = list(p_ids)
    (rng or random.Random()).shuffle(shuffled)

    plans: list[HeatPlan] = []
    for i, row in enumerate(chart):
        heat_lanes = tuple(shuffled[position - 1] for position in row)
        plans.append(
            HeatPlan(
                heat_number=start_heat_number + i,
                lanes=heat_lanes,
                lane_numbers=lane_numbers,
            )
        )
    return plans
