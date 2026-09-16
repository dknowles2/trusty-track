"""Heat scheduling: the Perfect-N chart (#1090, part C).

PPC (`domain/scheduling.py`) gives every car every lane once and treats
opponent variety as a best-effort heuristic — a *partial* perfect chart.
Perfect-N is the stronger, rarer guarantee it is named against: every car
every lane the same number of times, **and** every pair of cars meets the
same number of times. That second property only holds for the field sizes
Stan Pope's published directory (`perfect_n_tables.py`) actually has a chart
for — there is no way to build one for an arbitrary `(lanes, n)` the way
PPC's heuristic degrades gracefully for any shape, so `available_for` is not
the formality it is for PPC and ROTATION
(`domain/schedulers/__init__.py`'s `_always_available`): it is the real
answer, checked by the property suite (`test_domain_scheduling.py`) and, in
production, by the wizard (part D) before this module is ever called for a
shape it cannot serve.

**A chart's heat count is not always the racer count.** Pope's directory
lists, for a given `(lanes, cars)`, one or more charts of different heat
counts — sometimes exactly `cars` (one run per lane), often a multiple of
it (several runs per lane, still perfect). `default_chart` picks the
fewest-heats *plain* ("P", not "CP") chart, so `generate_perfect_n`'s output
size varies by shape; a caller must not assume `len(plans) == len(racer_ids)`
the way it safely can for PPC and ROTATION. See `perfect_n_tables.Chart`.

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

from backend.domain.schedulers.perfect_n_tables import CHARTS, Chart
from backend.domain.scheduling import HeatPlan


def build_grid(chart: Chart) -> list[tuple[int, ...]]:
    """Expand a :class:`Chart` into its full grid of chart-relative car
    numbers — one tuple of ``chart.lanes`` car numbers (``1..chart.cars``)
    per heat, ``chart.heats`` heats total.

    This is Stan Pope's own "Chart Generation: Steps" (`grdir.html`),
    computed directly rather than simulated table-cell-by-table-cell: for
    each generator block, and each car ``c`` from 1 to ``cars`` in turn,
    lane 1 holds ``c`` and lane ``i + 1`` holds lane ``i``'s value plus the
    generator's ``i``-th element, wrapping into ``1..cars`` whenever the sum
    exceeds it. Verified against the step-by-step worked example in
    `grdirex.html` (a CP7-3(2) chart) during this module's transcription,
    and identical to the formula `jeffpiazza/derbynet`'s own generator
    engine uses (`scripts/compare_perfect_n_with_derbynet.py`) — two
    independent implementations of the same construction.
    """
    grid: list[tuple[int, ...]] = []
    for generator in chart.generators:
        for car in range(1, chart.cars + 1):
            row = [car]
            current = car
            for step in generator:
                current += step
                if current > chart.cars:
                    current -= chart.cars
                row.append(current)
            grid.append(tuple(row))
    return grid


def default_chart(n_racers: int, n_lanes: int) -> Chart | None:
    """The chart :func:`generate_perfect_n` uses for this shape, or
    ``None`` if the directory has none.

    The fewest-heats **plain** ("P") chart among ``CHARTS[(n_lanes,
    n_racers)]`` — never a "CP" one, even when it has fewer heats than
    every "P" alternative (the directory always lists a "CP" chart's own
    "P" base alongside it, so this never has to choose a "CP" for lack of a
    "P"). "CP"'s extra lane-reversal guarantee is worth the doubled heat
    count as an option — part D's wizard can offer it — but is not owed to
    every round by default the way "fewer heats, still fair" is.
    """
    candidates = [c for c in CHARTS.get((n_lanes, n_racers), []) if not c.complementary]
    if not candidates:
        return None
    return min(candidates, key=lambda c: c.heats)


def chart_heat_count(n_racers: int, n_lanes: int) -> int | None:
    """Heats *one run* of :func:`generate_perfect_n` produces for this exact
    shape — whatever `default_chart` picks — or ``None`` when no chart
    covers it.

    Not always ``n_racers``: see this module's docstring ("A chart's heat
    count is not always the racer count"). The one caller is
    `Query.schedulingAlgorithms` (part D of #1090), so the wizard's own
    heat-count preview can multiply by `runsPerLane` and get the right total
    for Perfect-N the same way it already does for PPC and ROTATION, where
    one run is always exactly `n_racers` heats.
    """
    chart = default_chart(n_racers, n_lanes)
    return chart.heats if chart else None


def available_for(n_racers: int, n_lanes: int) -> str | None:
    """A reason Perfect-N cannot schedule this field, or ``None``.

    ``0`` racers or ``0`` lanes is trivially fine — :func:`generate_perfect_n`
    returns no heats either way, the same degenerate case every registered
    algorithm shares. Otherwise a chart must exist in Pope's directory
    exactly: no published chart exists for fewer cars than the track is
    wide (a Perfect-N chart is not a heuristic that degrades for a field
    smaller than the lane count, unlike PPC), so `default_chart` finding
    nothing means refusing, named with the nearest field sizes the
    directory *does* cover for this lane count — so a refusal reads as
    "try 5 or 7" rather than a bare no.
    """
    if n_racers == 0 or n_lanes == 0:
        return None
    if default_chart(n_racers, n_lanes) is not None:
        return None

    covered = sorted({cars for (lanes, cars) in CHARTS if lanes == n_lanes})
    if not covered:
        lane_counts = sorted({lanes for (lanes, _cars) in CHARTS})
        return (
            f"No Perfect-N chart is published for {n_lanes} lanes; "
            f"lane counts covered: {', '.join(str(x) for x in lane_counts)}. "
            "Use the Partial Perfect Chart."
        )
    below = max((c for c in covered if c < n_racers), default=None)
    above = min((c for c in covered if c > n_racers), default=None)
    if below is not None and above is not None:
        nearest = f"the nearest are {below} and {above} cars"
    elif below is not None:
        nearest = f"the largest published is {below} cars"
    else:
        nearest = f"the smallest published is {above} cars"
    return (
        f"No Perfect-N chart is published for {n_racers} cars on {n_lanes} "
        f"lanes; {nearest}. Use the Partial Perfect Chart."
    )


def generate_perfect_n(
    racer_ids: list[int],
    usable_lanes: Sequence[int],
    start_heat_number: int = 1,
    rng: random.Random | None = None,
) -> list[HeatPlan]:
    """Build a Perfect-N schedule from Pope's directory chart for this exact
    shape — see :func:`default_chart` for which one.

    Raises ``ValueError`` (naming the same reason :func:`available_for`
    would have given) if no chart covers ``(len(usable_lanes),
    len(racer_ids))`` — callers are expected to check ``available_for``
    first (the wizard, part D, and the latecomer path both do); this is a
    backstop against a round created directly through the GraphQL API with
    an algorithm/field-size combination nothing has vetted, not the normal
    path to a refusal.

    ``rng`` seeds which racer id lands on which chart position — the chart
    itself is fixed, but *who* is "car 1" is reshuffled every time, the same
    convention `generate_ppc` and `generate_rotation` use so a regenerated
    round with the same seed reproduces the same schedule. The resulting
    heat count is the chart's own ``heats`` — not always
    ``len(racer_ids)``; see this module's docstring.
    """
    lane_numbers = tuple(sorted(set(usable_lanes)))
    lane_count = len(lane_numbers)
    if lane_count == 0:
        return []

    p_ids = list(racer_ids)
    p_count = len(p_ids)
    if p_count == 0:
        return []

    chart = default_chart(p_count, lane_count)
    if chart is None:
        reason = available_for(p_count, lane_count)
        raise ValueError(reason)

    shuffled = list(p_ids)
    (rng or random.Random()).shuffle(shuffled)

    plans: list[HeatPlan] = []
    for i, row in enumerate(build_grid(chart)):
        heat_lanes = tuple(shuffled[position - 1] for position in row)
        plans.append(
            HeatPlan(
                heat_number=start_heat_number + i,
                lanes=heat_lanes,
                lane_numbers=lane_numbers,
            )
        )
    return plans
