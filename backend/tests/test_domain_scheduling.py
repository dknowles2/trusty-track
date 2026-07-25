"""Property tests for the PPC scheduler.

The point of extracting this into `backend/domain` was to be able to write
exactly this file: every racer count from 2 to 20 against every lane count from
2 to 8, many seeds each, with no database, no race, and no fixtures. The whole
module runs in well under a second.
"""

import random

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


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Known defect, issue #26: the greedy fill can strand a lane even when "
        "there are enough racers to fill it, so one racer runs one heat fewer "
        "than the rest. Roughly 1 in 4 schedules on a 4-lane track. Remove this "
        "marker when the scheduler repairs its own gaps."
    ),
)
@pytest.mark.parametrize("racers,lane_count", [(8, 4), (12, 4), (20, 6)])
def test_every_lane_is_filled_when_there_are_enough_racers(racers, lane_count):
    """With at least as many racers as lanes, no heat should be short.

    A short heat is not cosmetic. Under POINTS scoring a racer's score is the
    *sum* of their finishing places, so running one heat fewer than everyone
    else lowers their total and moves them up the standings.
    """
    for seed in range(200):
        plans = _schedule(racers, lane_count, seed)
        for plan in plans:
            assert len(plan.racer_ids) == lane_count, (
                f"seed {seed}: heat {plan.heat_number} has "
                f"{len(plan.racer_ids)} racers in {lane_count} lanes"
            )
