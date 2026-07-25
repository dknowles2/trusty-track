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

RACER_COUNTS = range(2, 21)
LANE_COUNTS = range(2, 9)
SEEDS = range(8)


def _all_configurations():
    for racers in RACER_COUNTS:
        for lane_count in LANE_COUNTS:
            for seed in SEEDS:
                yield racers, lane_count, seed


def _schedule(racers: int, lane_count: int, seed: int) -> list[HeatPlan]:
    return generate_ppc(list(range(1, racers + 1)), lane_count, rng=random.Random(seed))


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
    generate_ppc(racer_ids, 4, rng=random.Random(seed))
    assert racer_ids == original


def test_start_heat_number_offsets_the_numbering():
    """Used when stacking a round's heats after existing ones."""
    plans = generate_ppc([1, 2, 3], 2, start_heat_number=7, rng=random.Random(0))
    assert [p.heat_number for p in plans] == [7, 8, 9]


def test_empty_field_produces_no_heats():
    assert generate_ppc([], 4) == []


def test_single_racer_gets_one_heat():
    plans = generate_ppc([42], 4, rng=random.Random(0))
    assert len(plans) == 1
    assert plans[0].lanes[0] == 42
    # The other three lanes have nobody left to fill them.
    assert plans[0].racer_ids == [42]


def test_more_lanes_than_racers_leaves_lanes_empty():
    """Not a defect: four lanes cannot hold three racers."""
    plans = generate_ppc([1, 2, 3], 5, rng=random.Random(0))
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
    first = generate_ppc([1, 2, 3, 4, 5], 4, rng=random.Random(seed))
    second = generate_ppc([1, 2, 3, 4, 5], 4, rng=random.Random(seed))
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
    plans = generate_ppc([1, 2, 3, 4, 5, 6, 7, 8], 4, rng=random.Random(1))

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
    plans = generate_ppc([1, 2, 3, 4, 5, 6, 7, 8], 4, rng=random.Random(1))
    last = plans[-1]
    assert None not in last.lanes, f"lane still stranded: {last.lanes}"
    assert len(last.racer_ids) == 4
