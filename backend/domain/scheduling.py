"""Heat scheduling: the Partial Perfect Chart (PPC) algorithm.

Pure combinatorics over racer ids. It previously lived in ``crud._generate_ppc``
and took a ``Session`` it used only for ``db.add()`` at the very end, so testing
"does every racer race in every lane exactly once" meant standing up a race, a
track, and a set of racers first. Now it takes a list of ints.

See ``docs/scheduling-algorithms.md`` for the algorithm's intent.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class HeatPlan:
    """One scheduled heat: which racer is in which lane.

    ``lanes`` is indexed by *position within this schedule*, and
    ``lane_numbers`` says which lane each position is. On an undamaged track
    those are the same thing — position 0 is lane 1 — which is why the
    distinction did not exist until a lane could be out of service (#171).

    Consume :attr:`assignments` rather than pairing ``lanes`` with its index.
    That was `crud._generate_ppc`'s ``index + 1``, and with lane 3 unusable it
    quietly writes the lane 4 racer into lane 3.

    ``None`` means the lane is unused in this heat, which happens when there are
    fewer racers than usable lanes.
    """

    heat_number: int
    lanes: tuple[int | None, ...]
    lane_numbers: tuple[int, ...]

    @property
    def assignments(self) -> list[tuple[int, int | None]]:
        """``(lane number, racer id)``, which is what a caller wants to store."""
        # `strict` on purpose: the two tuples are built together and a mismatch
        # means positions and lane numbers have come apart, which is exactly the
        # silent off-by-one this field exists to prevent.
        return list(zip(self.lane_numbers, self.lanes, strict=True))

    @property
    def racer_ids(self) -> list[int]:
        return [rid for rid in self.lanes if rid is not None]


def generate_ppc(
    racer_ids: list[int],
    usable_lanes: Sequence[int],
    start_heat_number: int = 1,
    rng: random.Random | None = None,
) -> list[HeatPlan]:
    """Build a PPC schedule: one heat per racer, each racer once per lane.

    The **first usable lane** is seeded with every racer, which is what fixes the
    heat count at ``len(racer_ids)``. Each remaining usable lane is then filled
    by :func:`_fill_lane`, which places every racer exactly once and prefers, for
    each heat, whoever has faced that heat's current occupants least often.

    Guarantees, all stated over the *usable* lanes:

    * no racer appears twice in a heat
    * no racer appears twice in a lane
    * every heat is full — ``min(len(racer_ids), len(usable_lanes))`` racers

    The last one only became true with the fix for issue #26. Opponent variety
    remains a heuristic: this is a *partial* perfect chart, not an optimal one,
    though for the sizes a pack race runs it lands close.

    A heat is short only when the field itself is smaller than the track is
    wide; three racers cannot fill four lanes.

    ``usable_lanes`` is which lanes, not how many (#171). On an undamaged track
    that is ``range(1, lane_count + 1)`` and nothing has changed; when lane 3's
    sensor has failed it is ``[1, 2, 4]``, and the resulting heats name lanes 1,
    2 and 4 rather than 1, 2 and 3. Duplicates and order are the caller's
    problem — this sorts and de-duplicates, because a schedule listing lane 4
    before lane 2 would be read out in that order at the track.

    ``rng`` is injectable so tests can pin the shuffle; production passes
    nothing and gets a fresh generator. A fresh one rather than the module-level
    functions: `random.shuffle` is a bound method of a hidden shared instance,
    which is not a `Random` as far as a type checker is concerned, and nothing
    here wants the global seed anyway.
    """
    lane_numbers = tuple(sorted(set(usable_lanes)))
    lane_count = len(lane_numbers)
    if lane_count == 0:
        # A track with no usable lane cannot run a heat. Returning no schedule
        # says so; the alternative is heats of nothing but empty lanes, which
        # the operator screen would happily offer to run.
        return []

    shuffle = (rng or random.Random()).shuffle

    # Copy: the caller's list must not be reordered under them.
    p_ids = list(racer_ids)
    shuffle(p_ids)
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

    for j in range(1, lane_count):
        available_racers = list(p_ids)
        shuffle(available_racers)
        _fill_lane(heat_matrix, j, available_racers, matchups)

    return [
        HeatPlan(
            heat_number=start_heat_number + i,
            lanes=tuple(heat_matrix[i]),
            lane_numbers=lane_numbers,
        )
        for i in range(p_count)
    ]


def _fill_lane(
    heat_matrix: list[list[int | None]],
    lane_index: int,
    available_racers: list[int],
    matchups: dict[int, dict[int, int]],
) -> None:
    """Assign one racer to ``lane_index`` in each heat, and record who met whom.

    This is a bipartite matching between heats and racers: racer ``r`` may take
    heat ``i``'s slot only if ``r`` is not already racing in heat ``i``. Every
    racer is available for exactly one slot in this lane.

    Greedy alone finds a *maximal* matching, not a *maximum* one — it can strand
    the last heat, whose only remaining candidate is a racer already in it. That
    left a lane empty and gave one racer a heat fewer than everyone else, which
    under POINTS scoring made their score better (issue #26). So the greedy pass
    runs first, for its opponent-variety heuristic, and then augmenting paths
    repair whatever it stranded.
    """
    heat_count = len(heat_matrix)

    def occupants(heat_index: int) -> list[int]:
        return [
            racer_id
            for k in range(lane_index)
            if (racer_id := heat_matrix[heat_index][k]) is not None
        ]

    heat_occupants = [occupants(i) for i in range(heat_count)]

    def record(racer: int, heat_index: int, sign: int) -> None:
        for other in heat_occupants[heat_index]:
            matchups[racer][other] += sign
            matchups[other][racer] += sign

    # Greedy: for each heat in turn, take whoever has met its occupants least.
    # Matchups are updated as we go, not at the end of the lane — a racer placed
    # in heat 1 must look less attractive for heat 2 if they would meet the same
    # opponents again. Deferring the update measurably worsens variety.
    racer_of_heat: dict[int, int] = {}
    heat_of_racer: dict[int, int] = {}
    unclaimed = list(available_racers)

    for i in range(heat_count):
        present = heat_occupants[i]
        best_racer = None
        min_score = float("inf")
        for r in unclaimed:
            if r in present:
                continue
            score = sum(matchups[r][other] for other in present)
            if score < min_score:
                min_score = score
                best_racer = r

        if best_racer is None:
            continue

        racer_of_heat[i] = best_racer
        heat_of_racer[best_racer] = i
        unclaimed.remove(best_racer)
        record(best_racer, i, +1)

    # Repair: hand any stranded heat a racer by displacing an earlier
    # assignment down a chain that ends at someone still unclaimed.
    stranded = [i for i in range(heat_count) if i not in racer_of_heat]
    if stranded:
        before = dict(racer_of_heat)
        try:
            for i in stranded:
                _augment(
                    i, heat_occupants, matchups, racer_of_heat, heat_of_racer, set()
                )
        except RecursionError:
            # An augmenting chain is at most one link per heat, so this needs a
            # field in the high hundreds — far past any pack race. If it ever
            # does happen, a short heat is a much better outcome than heat
            # generation dying in the middle of an event, so keep whatever the
            # greedy pass managed and carry on.
            racer_of_heat = {
                heat_index: racer
                for heat_index, racer in racer_of_heat.items()
                if heat_of_racer.get(racer) == heat_index
            }

        # Re-book the meetings the repair moved around.
        for heat_index, racer in before.items():
            if racer_of_heat.get(heat_index) != racer:
                record(racer, heat_index, -1)
        for heat_index, racer in racer_of_heat.items():
            if before.get(heat_index) != racer:
                record(racer, heat_index, +1)

    for i, racer in racer_of_heat.items():
        heat_matrix[i][lane_index] = racer


def _augment(
    heat_index: int,
    heat_occupants: list[list[int]],
    matchups: dict[int, dict[int, int]],
    racer_of_heat: dict[int, int],
    heat_of_racer: dict[int, int],
    tried: set[int],
) -> bool:
    """Kuhn's augmenting path: find this heat a racer, displacing others if need be.

    Candidates are visited in the same order the greedy pass prefers — fewest
    prior meetings first — so a repair does not undo the variety heuristic any
    more than it has to.
    """
    present = heat_occupants[heat_index]
    candidates = sorted(
        (r for r in matchups if r not in present and r not in tried),
        key=lambda r: (sum(matchups[r][other] for other in present), r),
    )

    for racer in candidates:
        tried.add(racer)
        holder = heat_of_racer.get(racer)
        # If someone holds this racer, the recursive call re-matches *them* to a
        # different racer first — which is what frees this one up. It also
        # rewrites racer_of_heat[holder] on the way out, so there is nothing to
        # unassign here.
        if holder is None or _augment(
            holder, heat_occupants, matchups, racer_of_heat, heat_of_racer, tried
        ):
            racer_of_heat[heat_index] = racer
            heat_of_racer[racer] = heat_index
            return True
    return False


def placeholder_ids(count: int) -> list[int]:
    """The negative ids standing in for racers who have not advanced yet.

    Slot 1 is ``-1``, slot 2 is ``-2``, and so on;
    :func:`backend.domain.lanes.resolve_placeholders` reverses the mapping.
    """
    return [-(i + 1) for i in range(count)]
