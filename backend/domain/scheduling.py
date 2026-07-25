"""Heat scheduling: the Partial Perfect Chart (PPC) algorithm.

Pure combinatorics over racer ids. It previously lived in ``crud._generate_ppc``
and took a ``Session`` it used only for ``db.add()`` at the very end, so testing
"does every racer race in every lane exactly once" meant standing up a race, a
track, and a set of racers first. Now it takes a list of ints.

See ``docs/scheduling-algorithms.md`` for the algorithm's intent.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class HeatPlan:
    """One scheduled heat: which racer is in which lane.

    ``lanes`` is indexed by lane position, so ``lanes[0]`` is lane 1. ``None``
    means the lane is unused, which happens when there are fewer racers than
    lanes.
    """

    heat_number: int
    lanes: tuple[int | None, ...]

    @property
    def racer_ids(self) -> list[int]:
        return [rid for rid in self.lanes if rid is not None]


def generate_ppc(
    racer_ids: list[int],
    lane_count: int,
    start_heat_number: int = 1,
    rng: random.Random | None = None,
) -> list[HeatPlan]:
    """Build a PPC schedule: one heat per racer, each racer once per lane.

    Lane 1 is seeded with every racer, which is what fixes the heat count at
    ``len(racer_ids)``. Each remaining lane is then filled greedily, preferring
    a racer who has not yet raced in that lane and choosing among those the one
    who has faced the current heat's occupants least often. The result is not
    guaranteed optimal — it is a *partial* perfect chart — but for the sizes a
    pack race actually runs it lands very close.

    Where the constraint cannot be met (fewer racers than lanes, or the greedy
    choice painting itself into a corner) the algorithm relaxes to "just not
    already in this heat", and failing even that leaves the lane empty rather
    than double-booking a racer.

    ``rng`` is injectable so tests can pin the shuffle; production passes
    nothing and gets the module-level generator.
    """
    rng = rng or random

    # Copy: the caller's list must not be reordered under them.
    p_ids = list(racer_ids)
    rng.shuffle(p_ids)
    p_count = len(p_ids)

    # How many times each pair of racers has already met.
    matchups: dict[int, dict[int, int]] = {p1: dict.fromkeys(p_ids, 0) for p1 in p_ids}

    # heat_matrix[heat_index][lane_index] = racer_id
    heat_matrix: list[list[int | None]] = [
        [None for _ in range(lane_count)] for _ in range(p_count)
    ]

    # Lane 1 gets everybody, one racer per heat.
    for i in range(p_count):
        heat_matrix[i][0] = p_ids[i]

    # Which lanes each racer has been assigned so far.
    occupied_lanes: dict[int, set[int]] = {p_id: {0} for p_id in p_ids}

    for j in range(1, lane_count):
        available_racers = list(p_ids)
        rng.shuffle(available_racers)

        for i in range(p_count):
            current_heat_racers = [
                heat_matrix[i][k] for k in range(j) if heat_matrix[i][k] is not None
            ]

            # Preferred: hasn't raced this lane, isn't already in this heat.
            candidates = [
                r
                for r in available_racers
                if j not in occupied_lanes[r] and r not in current_heat_racers
            ]
            if not candidates:
                # Relaxed: allow a lane repeat rather than leaving a gap.
                candidates = [
                    r for r in available_racers if r not in current_heat_racers
                ]

            best_racer = None
            min_score = float("inf")
            for r in candidates:
                # Prefer the racer who has met these opponents fewest times.
                score = sum(matchups[r][other] for other in current_heat_racers)
                if score < min_score:
                    min_score = score
                    best_racer = r

            if best_racer is None:
                continue

            heat_matrix[i][j] = best_racer
            available_racers.remove(best_racer)
            occupied_lanes[best_racer].add(j)
            for other in current_heat_racers:
                matchups[best_racer][other] += 1
                matchups[other][best_racer] += 1

    return [
        HeatPlan(heat_number=start_heat_number + i, lanes=tuple(heat_matrix[i]))
        for i in range(p_count)
    ]


def placeholder_ids(count: int) -> list[int]:
    """The negative ids standing in for racers who have not advanced yet.

    Slot 1 is ``-1``, slot 2 is ``-2``, and so on;
    :func:`backend.domain.lanes.resolve_placeholders` reverses the mapping.
    """
    return [-(i + 1) for i in range(count)]
