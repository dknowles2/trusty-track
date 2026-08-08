"""Property tests for the PPC scheduler.

The point of extracting this into `backend/domain` was to be able to write
exactly this file: every racer count from 2 to 20 against every lane count from
2 to 8, many seeds each, with no database, no race, and no fixtures. The whole
module runs in well under a second.
"""

import random
from collections import Counter

import pytest

from backend.domain.scheduling import HeatPlan, generate_ppc, placeholder_ids


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
    for racers in RACER_COUNTS:
        for lane_count in LANE_COUNTS:
            for seed in SEEDS:
                yield racers, lane_count, seed


def _schedule(racers: int, lane_count: int, seed: int) -> list[HeatPlan]:
    return generate_ppc(
        list(range(1, racers + 1)), lanes_numbered(lane_count), rng=random.Random(seed)
    )


@pytest.mark.parametrize("racers,lane_count,seed", list(_all_configurations()))
def test_schedule_is_valid(racers, lane_count, seed):
    """The invariants that must hold for any schedule we would actually run."""
    plans = _schedule(racers, lane_count, seed)
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


@pytest.mark.parametrize("racers,lane_count,seed", list(_all_configurations()))
def test_lane_one_is_a_permutation_of_the_field(racers, lane_count, seed):
    """Lane 1 is seeded with everyone — this is what fixes the heat count."""
    plans = _schedule(racers, lane_count, seed)
    assert sorted(p.lanes[0] for p in plans) == list(range(1, racers + 1))


@pytest.mark.parametrize("seed", SEEDS)
def test_the_caller_s_list_is_not_reordered(seed):
    """The scheduler shuffles internally; it must not shuffle the input."""
    racer_ids = [5, 3, 9, 1]
    original = list(racer_ids)
    generate_ppc(racer_ids, lanes_numbered(4), rng=random.Random(seed))
    assert racer_ids == original


def test_start_heat_number_offsets_the_numbering():
    """Used when stacking a round's heats after existing ones."""
    plans = generate_ppc(
        [1, 2, 3], lanes_numbered(2), start_heat_number=7, rng=random.Random(0)
    )
    assert [p.heat_number for p in plans] == [7, 8, 9]


def test_empty_field_produces_no_heats():
    assert generate_ppc([], lanes_numbered(4)) == []


def test_single_racer_gets_one_heat():
    plans = generate_ppc([42], lanes_numbered(4), rng=random.Random(0))
    assert len(plans) == 1
    assert plans[0].lanes[0] == 42
    # The other three lanes have nobody left to fill them.
    assert plans[0].racer_ids == [42]


def test_more_lanes_than_racers_leaves_lanes_empty():
    """Not a defect: four lanes cannot hold three racers."""
    plans = generate_ppc([1, 2, 3], lanes_numbered(5), rng=random.Random(0))
    for plan in plans:
        assert len(plan.racer_ids) == 3


@pytest.mark.parametrize("count", [0, 1, 4])
def test_placeholder_ids_count_down_from_minus_one(count):
    assert placeholder_ids(count) == [-(i + 1) for i in range(count)]


@pytest.mark.parametrize("racers,lane_count,seed", list(_all_configurations()))
def test_no_heat_is_short(racers, lane_count, seed):
    """Every heat is as full as the field allows — this is issue #26.

    A short heat is not cosmetic. Under POINTS scoring a racer's score is the
    *sum* of their finishing places, so running one heat fewer than everyone
    else lowers their total and moves them *up* the standings. Before the fix,
    roughly 1 in 4 four-lane schedules had one.

    The only legitimate shortfall is a field smaller than the track is wide.
    """
    expected = min(racers, lane_count)
    for plan in _schedule(racers, lane_count, seed):
        assert len(plan.racer_ids) == expected, (
            f"heat {plan.heat_number} has {len(plan.racer_ids)} racers, "
            f"expected {expected}"
        )


@pytest.mark.parametrize("racers,lane_count", [(8, 4), (12, 4), (20, 4), (20, 6)])
def test_no_heat_is_short_over_many_seeds(racers, lane_count):
    """The gap was intermittent — ~1 seed in 4 — so sample deeply, not widely.

    A handful of seeds per configuration would have missed it.
    """
    expected = min(racers, lane_count)
    for seed in range(300):
        for plan in _schedule(racers, lane_count, seed):
            assert len(plan.racer_ids) == expected, (
                f"seed {seed}: heat {plan.heat_number} is short"
            )


@pytest.mark.parametrize("racers,lane_count,seed", list(_all_configurations()))
def test_every_racer_gets_the_same_number_of_runs(racers, lane_count, seed):
    """The fairness property underneath issue #26.

    Equal run counts are what make averaged times and summed placements
    comparable between racers in the first place.
    """
    plans = _schedule(racers, lane_count, seed)
    runs = Counter(rid for plan in plans for rid in plan.racer_ids)
    assert set(runs.values()) == {min(racers, lane_count)}


@pytest.mark.parametrize("seed", SEEDS)
def test_the_same_seed_gives_the_same_schedule(seed):
    """Regenerating a round must not silently reshuffle the field."""
    first = generate_ppc([1, 2, 3, 4, 5], lanes_numbered(4), rng=random.Random(seed))
    second = generate_ppc([1, 2, 3, 4, 5], lanes_numbered(4), rng=random.Random(seed))
    assert first == second


def test_a_failed_repair_still_yields_a_valid_schedule(monkeypatch):
    """If the augmenting pass blows the stack, degrade — do not crash.

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
    """The exact case that surfaced the bug, pinned.

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
# a racer with fewer heats scores *better*.

GAPPED_LANES = [
    # The failure that started this: one lane of four stops working.
    [1, 2, 4],
    [2, 3, 4],
    [1, 3, 4],
    # Lane 1 itself, which is the one the algorithm seeds from.
    [2, 3, 4, 5, 6],
    # Two gone, on a six-lane track.
    [1, 3, 5],
]


@pytest.mark.parametrize("usable", GAPPED_LANES)
@pytest.mark.parametrize("racers", [2, 3, 5, 8, 13])
@pytest.mark.parametrize("seed", [0, 1, 2])
def test_a_gapped_track_keeps_every_property(usable, racers, seed):
    plans = generate_ppc(list(range(1, racers + 1)), usable, rng=random.Random(seed))
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


def test_the_dead_lane_is_never_scheduled():
    plans = generate_ppc([1, 2, 3, 4, 5, 6], [1, 2, 4], rng=random.Random(0))
    scheduled = {lane for plan in plans for lane, _ in plan.assignments}
    assert 3 not in scheduled


def test_assignments_pair_a_racer_with_the_lane_they_are_actually_in():
    # The whole reason `lane_numbers` exists. Pairing `plan.lanes` with its
    # index — which is what the code did before — puts lane 4's racer in lane 3.
    plans = generate_ppc([1, 2, 3], [1, 2, 4], rng=random.Random(0))
    for plan in plans:
        assert [lane for lane, _ in plan.assignments] == [1, 2, 4]
        assert [racer for _, racer in plan.assignments] == list(plan.lanes)


def test_lane_numbers_are_sorted_and_deduplicated():
    # A schedule listing lane 4 before lane 2 gets read out in that order at the
    # track, and a repeated lane would be two racers in one lane.
    plans = generate_ppc([1, 2, 3], [4, 2, 2, 1], rng=random.Random(0))
    assert plans[0].lane_numbers == (1, 2, 4)


def test_a_track_with_no_usable_lane_schedules_nothing():
    # Rather than heats of nothing but empty lanes, which the operator screen
    # would offer to run.
    assert generate_ppc([1, 2, 3], []) == []


def test_one_usable_lane_still_gives_everyone_a_heat():
    # Degenerate but not absurd: a three-lane track down to its last lane is a
    # very slow event rather than an impossible one.
    plans = generate_ppc([1, 2, 3], [2], rng=random.Random(0))
    assert len(plans) == 3
    assert sorted(racer for plan in plans for racer in plan.racer_ids) == [1, 2, 3]
    assert all(plan.lane_numbers == (2,) for plan in plans)
