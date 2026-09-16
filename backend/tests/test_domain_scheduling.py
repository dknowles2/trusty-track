"""Property tests for the scheduling algorithms (#1090).

The point of extracting the first of these into `backend/domain` was to be
able to write exactly this file: every racer count from 2 to 20 against every
lane count from 2 to 8, many seeds each, with no database, no race, and no
fixtures. The whole module runs in well under a second.

#1090 turned "the scheduler" into a registry of them
(`domain/schedulers/__init__.py`) — PPC (`generate_ppc`, the original, kept
here) and ROTATION (`domain.schedulers.rotation.generate_rotation`) so far.
Every *shared* property below — the ones `crud.py` and `services/scoring.py`
actually rely on, not incidental behaviour of one algorithm's implementation
— is parametrized over every registered algorithm, so a third algorithm
cannot be registered without passing every property the app downstream of
`crud.generate_heats_for_round` depends on (CLAUDE.md's domain-layer
paragraph). What is specific to PPC's own history — the augmenting-path
repair, the exact seed that reproduced issue #26 — stays PPC-only; there is
nothing analogous to regress in an algorithm that has never shipped a bug.
"""

import random
from collections import Counter

import pytest

from backend.domain.schedulers import SCHEDULERS
from backend.domain.scheduling import HeatPlan, generate_ppc, placeholder_ids

ALGORITHMS = sorted(SCHEDULERS)


def lanes_numbered(count: int) -> list[int]:
    """The lanes of an undamaged track: 1..count.

    The algorithm takes *which* lanes rather than how many (#171); an intact
    track is the special case, and saying so here keeps the existing properties
    reading the way they did.
    """
    return list(range(1, count + 1))


RACER_COUNTS = range(2, 21)
LANE_COUNTS = range(2, 9)
SEEDS = range(8)


def _all_configurations():
    for algorithm in ALGORITHMS:
        for racers in RACER_COUNTS:
            for lane_count in LANE_COUNTS:
                for seed in SEEDS:
                    yield algorithm, racers, lane_count, seed


def _schedule(
    algorithm: str, racers: int, lane_count: int, seed: int
) -> list[HeatPlan]:
    return SCHEDULERS[algorithm].generate(
        list(range(1, racers + 1)), lanes_numbered(lane_count), rng=random.Random(seed)
    )


@pytest.mark.parametrize(
    "algorithm,racers,lane_count,seed", list(_all_configurations())
)
def test_schedule_is_valid(algorithm, racers, lane_count, seed):
    """The invariants that must hold for any schedule we would actually run."""
    plans = _schedule(algorithm, racers, lane_count, seed)
    racer_ids = set(range(1, racers + 1))

    # One heat per racer, numbered consecutively from 1.
    assert len(plans) == racers
    assert [p.heat_number for p in plans] == list(range(1, racers + 1))

    for plan in plans:
        assert len(plan.lanes) == lane_count
        # Nobody races themselves.
        assigned = plan.racer_ids
        assert len(assigned) == len(set(assigned)), f"double-booked in {plan}"
        assert set(assigned) <= racer_ids

    # Nobody races the same lane twice.
    for lane_index in range(lane_count):
        in_lane = [
            p.lanes[lane_index] for p in plans if p.lanes[lane_index] is not None
        ]
        assert len(in_lane) == len(set(in_lane)), (
            f"lane {lane_index + 1} repeats a racer"
        )


@pytest.mark.parametrize(
    "algorithm,racers,lane_count,seed", list(_all_configurations())
)
def test_lane_one_is_a_permutation_of_the_field(algorithm, racers, lane_count, seed):
    """Lane 1 is seeded with everyone — this is what fixes the heat count."""
    plans = _schedule(algorithm, racers, lane_count, seed)
    assert sorted(p.lanes[0] for p in plans) == list(range(1, racers + 1))


@pytest.mark.parametrize("algorithm", ALGORITHMS)
@pytest.mark.parametrize("seed", SEEDS)
def test_the_caller_s_list_is_not_reordered(algorithm, seed):
    """The scheduler shuffles internally; it must not shuffle the input."""
    racer_ids = [5, 3, 9, 1]
    original = list(racer_ids)
    SCHEDULERS[algorithm].generate(
        racer_ids, lanes_numbered(4), rng=random.Random(seed)
    )
    assert racer_ids == original


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_start_heat_number_offsets_the_numbering(algorithm):
    """Used when stacking a round's heats after existing ones."""
    plans = SCHEDULERS[algorithm].generate(
        [1, 2, 3], lanes_numbered(2), start_heat_number=7, rng=random.Random(0)
    )
    assert [p.heat_number for p in plans] == [7, 8, 9]


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_empty_field_produces_no_heats(algorithm):
    assert SCHEDULERS[algorithm].generate([], lanes_numbered(4)) == []


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_single_racer_gets_one_heat(algorithm):
    plans = SCHEDULERS[algorithm].generate(
        [42], lanes_numbered(4), rng=random.Random(0)
    )
    assert len(plans) == 1
    assert plans[0].lanes[0] == 42
    # The other three lanes have nobody left to fill them.
    assert plans[0].racer_ids == [42]


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_more_lanes_than_racers_leaves_lanes_empty(algorithm):
    """Not a defect: four lanes cannot hold three racers."""
    plans = SCHEDULERS[algorithm].generate(
        [1, 2, 3], lanes_numbered(5), rng=random.Random(0)
    )
    for plan in plans:
        assert len(plan.racer_ids) == 3


@pytest.mark.parametrize("count", [0, 1, 4])
def test_placeholder_ids_count_down_from_minus_one(count):
    assert placeholder_ids(count) == [-(i + 1) for i in range(count)]


@pytest.mark.parametrize(
    "algorithm,racers,lane_count,seed", list(_all_configurations())
)
def test_no_heat_is_short(algorithm, racers, lane_count, seed):
    """Every heat is as full as the field allows — this is issue #26.

    A short heat is not cosmetic. Under POINTS scoring a racer's score is the
    *sum* of their finishing places, so running one heat fewer than everyone
    else lowers their total and moves them *up* the standings. Before the fix,
    roughly 1 in 4 four-lane PPC schedules had one — and it is exactly the
    property a new algorithm is registered to keep, not just PPC's own.

    The only legitimate shortfall is a field smaller than the track is wide.
    """
    expected = min(racers, lane_count)
    for plan in _schedule(algorithm, racers, lane_count, seed):
        assert len(plan.racer_ids) == expected, (
            f"heat {plan.heat_number} has {len(plan.racer_ids)} racers, "
            f"expected {expected}"
        )


@pytest.mark.parametrize("algorithm", ALGORITHMS)
@pytest.mark.parametrize("racers,lane_count", [(8, 4), (12, 4), (20, 4), (20, 6)])
def test_no_heat_is_short_over_many_seeds(algorithm, racers, lane_count):
    """The PPC gap was intermittent — ~1 seed in 4 — so sample deeply, not widely.

    A handful of seeds per configuration would have missed it. Run over every
    registered algorithm, not just the one it was found in.
    """
    expected = min(racers, lane_count)
    for seed in range(300):
        for plan in _schedule(algorithm, racers, lane_count, seed):
            assert len(plan.racer_ids) == expected, (
                f"seed {seed}: heat {plan.heat_number} is short"
            )


@pytest.mark.parametrize(
    "algorithm,racers,lane_count,seed", list(_all_configurations())
)
def test_every_racer_gets_the_same_number_of_runs(algorithm, racers, lane_count, seed):
    """The fairness property underneath issue #26.

    Equal run counts are what make averaged times and summed placements
    comparable between racers in the first place.
    """
    plans = _schedule(algorithm, racers, lane_count, seed)
    runs = Counter(rid for plan in plans for rid in plan.racer_ids)
    assert set(runs.values()) == {min(racers, lane_count)}


@pytest.mark.parametrize("algorithm", ALGORITHMS)
@pytest.mark.parametrize("seed", SEEDS)
def test_the_same_seed_gives_the_same_schedule(algorithm, seed):
    """Regenerating a round must not silently reshuffle the field."""
    first = SCHEDULERS[algorithm].generate(
        [1, 2, 3, 4, 5], lanes_numbered(4), rng=random.Random(seed)
    )
    second = SCHEDULERS[algorithm].generate(
        [1, 2, 3, 4, 5], lanes_numbered(4), rng=random.Random(seed)
    )
    assert first == second


def test_a_failed_repair_still_yields_a_valid_schedule(monkeypatch):
    """If the augmenting pass blows the stack, degrade — do not crash.

    PPC-specific: only PPC has an augmenting-path repair to fail. An
    algorithm with no analogous internal step has nothing here to test.

    An augmenting chain is one link per heat, so this needs a field in the high
    hundreds and no pack race will see it. But heat generation dying in the
    middle of an event is a far worse outcome than a short heat, so the fallback
    keeps the greedy result. That is exactly the pre-fix behaviour.
    """

    def boom(*_args, **_kwargs):
        raise RecursionError("forced")

    monkeypatch.setattr("backend.domain.scheduling._augment", boom)
    plans = generate_ppc(
        [1, 2, 3, 4, 5, 6, 7, 8], lanes_numbered(4), rng=random.Random(1)
    )

    assert len(plans) == 8
    for plan in plans:
        assigned = plan.racer_ids
        assert len(assigned) == len(set(assigned)), f"double-booked in {plan}"
    for lane_index in range(4):
        in_lane = [
            p.lanes[lane_index] for p in plans if p.lanes[lane_index] is not None
        ]
        assert len(in_lane) == len(set(in_lane))


def test_the_original_issue_26_reproduction():
    """The exact case that surfaced the bug, pinned. PPC-specific.

    Eight racers on a four-lane track, seed 1: the greedy fill reached the last
    heat with only one racer left unplaced for lane 2, and that racer was
    already in the heat — so it produced ``(3, None, 5, 7)`` and racer 3, 5 and
    7 each ran a heat that was a car short.
    """
    plans = generate_ppc(
        [1, 2, 3, 4, 5, 6, 7, 8], lanes_numbered(4), rng=random.Random(1)
    )
    last = plans[-1]
    assert None not in last.lanes, f"lane still stranded: {last.lanes}"
    assert len(last.racer_ids) == 4


# --------------------------------------------------------------------------- #
# A lane out of service (#171)                                                 #
# --------------------------------------------------------------------------- #
#
# The properties above, restated over a track with a gap in it. They are the
# ones that matter: a schedule that quietly renumbers lanes, or gives one racer
# a heat fewer, is #26 arriving from the other direction — under POINTS scoring
# a racer with fewer heats scores *better*. Parametrized over every registered
# algorithm for the same reason as the properties above.

GAPPED_LANES = [
    # The failure that started this: one lane of four stops working.
    [1, 2, 4],
    [2, 3, 4],
    [1, 3, 4],
    # Lane 1 itself, which is the one PPC seeds from.
    [2, 3, 4, 5, 6],
    # Two gone, on a six-lane track.
    [1, 3, 5],
]


@pytest.mark.parametrize("algorithm", ALGORITHMS)
@pytest.mark.parametrize("usable", GAPPED_LANES)
@pytest.mark.parametrize("racers", [2, 3, 5, 8, 13])
@pytest.mark.parametrize("seed", [0, 1, 2])
def test_a_gapped_track_keeps_every_property(algorithm, usable, racers, seed):
    plans = SCHEDULERS[algorithm].generate(
        list(range(1, racers + 1)), usable, rng=random.Random(seed)
    )
    racer_ids = set(range(1, racers + 1))

    assert len(plans) == racers

    for plan in plans:
        # The heat names the lanes that exist, not positions 1..n.
        assert plan.lane_numbers == tuple(usable)
        assigned = plan.racer_ids
        assert len(assigned) == len(set(assigned)), f"double-booked in {plan}"
        assert set(assigned) <= racer_ids
        # Every heat is full — the property that regressed silently in #26.
        assert len(assigned) == min(racers, len(usable)), (
            f"short heat on a gapped track: {plan}"
        )

    # Nobody races the same lane twice, counted by lane *number*.
    for lane_number in usable:
        in_lane = [
            racer
            for plan in plans
            for lane, racer in plan.assignments
            if lane == lane_number and racer is not None
        ]
        assert len(in_lane) == len(set(in_lane)), f"lane {lane_number} repeats a racer"

    # Everyone races the same number of times. Under POINTS a racer with fewer
    # heats scores better, so this is a fairness property, not a tidiness one.
    appearances = dict.fromkeys(racer_ids, 0)
    for plan in plans:
        for racer_id in plan.racer_ids:
            appearances[racer_id] += 1
    assert len(set(appearances.values())) == 1, (
        f"unequal heat counts on a gapped track: {appearances}"
    )


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_the_dead_lane_is_never_scheduled(algorithm):
    plans = SCHEDULERS[algorithm].generate(
        [1, 2, 3, 4, 5, 6], [1, 2, 4], rng=random.Random(0)
    )
    scheduled = {lane for plan in plans for lane, _ in plan.assignments}
    assert 3 not in scheduled


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_assignments_pair_a_racer_with_the_lane_they_are_actually_in(algorithm):
    # The whole reason `lane_numbers` exists. Pairing `plan.lanes` with its
    # index — which is what the code did before — puts lane 4's racer in lane 3.
    plans = SCHEDULERS[algorithm].generate([1, 2, 3], [1, 2, 4], rng=random.Random(0))
    for plan in plans:
        assert [lane for lane, _ in plan.assignments] == [1, 2, 4]
        assert [racer for _, racer in plan.assignments] == list(plan.lanes)


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_lane_numbers_are_sorted_and_deduplicated(algorithm):
    # A schedule listing lane 4 before lane 2 gets read out in that order at the
    # track, and a repeated lane would be two racers in one lane.
    plans = SCHEDULERS[algorithm].generate(
        [1, 2, 3], [4, 2, 2, 1], rng=random.Random(0)
    )
    assert plans[0].lane_numbers == (1, 2, 4)


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_a_track_with_no_usable_lane_schedules_nothing(algorithm):
    # Rather than heats of nothing but empty lanes, which the operator screen
    # would offer to run.
    assert SCHEDULERS[algorithm].generate([1, 2, 3], []) == []


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_one_usable_lane_still_gives_everyone_a_heat(algorithm):
    # Degenerate but not absurd: a three-lane track down to its last lane is a
    # very slow event rather than an impossible one.
    plans = SCHEDULERS[algorithm].generate([1, 2, 3], [2], rng=random.Random(0))
    assert len(plans) == 3
    assert sorted(racer for plan in plans for racer in plan.racer_ids) == [1, 2, 3]
    assert all(plan.lane_numbers == (2,) for plan in plans)


# --------------------------------------------------------------------------- #
# ROTATION's own property (#1090)                                             #
# --------------------------------------------------------------------------- #
#
# The reason to pick ROTATION over PPC: a car's lane moves forward by exactly
# one position each time it races again, rather than PPC's opponent-variety
# heuristic. Stated mod the window width rather than as a plain +1, because a
# car whose run of heats straddles the wrap from the last heat number back to
# the first is not a special case (see `schedulers/rotation.py`'s module
# docstring) — the wrap in its lane sequence lands exactly on the wrap in its
# heat sequence.


@pytest.mark.parametrize(
    "racers,lane_count,seed",
    [(r, lc, s) for r in RACER_COUNTS for lc in LANE_COUNTS for s in SEEDS],
)
def test_rotation_lane_advances_by_one_for_the_next_heat_a_car_is_in(
    racers, lane_count, seed
):
    plans = _schedule("ROTATION", racers, lane_count, seed)
    window = min(racers, lane_count)

    # heat_number -> {racer_id: lane_index}
    lane_index_by_heat: dict[int, dict[int, int]] = {}
    for plan in plans:
        lane_index_by_heat[plan.heat_number] = {
            racer_id: lane_index
            for lane_index, racer_id in enumerate(plan.lanes)
            if racer_id is not None
        }

    per_racer: dict[int, dict[int, int]] = {}
    for heat_number, by_racer in lane_index_by_heat.items():
        for racer_id, lane_index in by_racer.items():
            per_racer.setdefault(racer_id, {})[heat_number] = lane_index

    for racer_id, by_heat in per_racer.items():
        for heat_number, lane_index in by_heat.items():
            next_heat = heat_number + 1
            if next_heat in by_heat:
                assert by_heat[next_heat] == (lane_index + 1) % window, (
                    f"racer {racer_id}: heat {heat_number} lane index "
                    f"{lane_index}, heat {next_heat} lane index "
                    f"{by_heat[next_heat]}, window {window}"
                )
