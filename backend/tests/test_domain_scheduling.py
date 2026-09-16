"""Property tests for the scheduling algorithms (#1090).

The point of extracting the first of these into `backend/domain` was to be
able to write exactly this file: every racer count from 2 to 20 against every
lane count from 2 to 8, many seeds each, with no database, no race, and no
fixtures. The whole module runs in well under a second.

#1090 turned "the scheduler" into a registry of them
(`domain/schedulers/__init__.py`) — PPC (`generate_ppc`, the original, kept
here), ROTATION (`domain.schedulers.rotation.generate_rotation`), and now
PERFECT_N (`domain.schedulers.perfect_n.generate_perfect_n`, part C). Every
*shared* property below — the ones `crud.py` and `services/scoring.py`
actually rely on, not incidental behaviour of one algorithm's implementation
— is parametrized over every registered algorithm, so a third algorithm
cannot be registered without passing every property the app downstream of
`crud.generate_heats_for_round` depends on (CLAUDE.md's domain-layer
paragraph). What is specific to PPC's own history — the augmenting-path
repair, the exact seed that reproduced issue #26 — stays PPC-only; there is
nothing analogous to regress in an algorithm that has never shipped a bug.

PERFECT_N is the first registered algorithm for which `available_for` is a
real refusal rather than a formality — a Perfect-N chart only exists for the
field sizes `domain.schedulers.perfect_n_tables.TABLES` actually has a chart
for (see that module's docstring for why, and for the honest account of
where its data came from). Every sweep below that iterates "every
(algorithm, racers, lane_count)" therefore filters through `available_for`
first (`_all_configurations`) rather than assuming every registered
algorithm can serve every shape the sweep covers; a handful of tests that
use one *fixed* shape rather than the full sweep call
`_skip_unless_available` directly, and are skipped for PERFECT_N wherever
that fixed shape has no table. PERFECT_N's own reason to exist —
"`available_for` returns a reason exactly where no table exists, and where
it does not, every pair of racers meets the chart's own constant number of
times" — is its own section near the bottom, next to ROTATION's.
"""

import itertools
import random
from collections import Counter

import pytest

from backend.domain.schedulers import SCHEDULERS
from backend.domain.schedulers.perfect_n_tables import TABLES as PERFECT_N_TABLES
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
    """Every ``(algorithm, racers, lane_count, seed)`` the shared property
    suite sweeps — filtered through ``available_for`` first (#1090's
    PERFECT_N: unlike PPC and ROTATION, whose ``available_for`` never
    refuses, a shape with no published chart is not something the property
    suite can hold PERFECT_N to, since there is no schedule to check).
    """
    for algorithm in ALGORITHMS:
        for racers in RACER_COUNTS:
            for lane_count in LANE_COUNTS:
                if SCHEDULERS[algorithm].available_for(racers, lane_count) is not None:
                    continue
                for seed in SEEDS:
                    yield algorithm, racers, lane_count, seed


def _schedule(
    algorithm: str, racers: int, lane_count: int, seed: int
) -> list[HeatPlan]:
    return SCHEDULERS[algorithm].generate(
        list(range(1, racers + 1)), lanes_numbered(lane_count), rng=random.Random(seed)
    )


def _skip_unless_available(algorithm: str, racers: int, lane_count: int) -> None:
    """Skip a fixed-shape test for an algorithm whose ``available_for``
    refuses that exact shape, rather than letting it call ``generate`` on a
    shape the algorithm was never able to serve (PERFECT_N raises for one;
    see `domain/schedulers/perfect_n.py`). PPC and ROTATION never refuse
    anything the module-level sweeps cover, so this is a no-op for them.
    """
    reason = SCHEDULERS[algorithm].available_for(racers, lane_count)
    if reason is not None:
        pytest.skip(reason)


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
    _skip_unless_available(algorithm, 4, 4)
    racer_ids = [5, 3, 9, 1]
    original = list(racer_ids)
    SCHEDULERS[algorithm].generate(
        racer_ids, lanes_numbered(4), rng=random.Random(seed)
    )
    assert racer_ids == original


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_start_heat_number_offsets_the_numbering(algorithm):
    """Used when stacking a round's heats after existing ones."""
    _skip_unless_available(algorithm, 3, 2)
    plans = SCHEDULERS[algorithm].generate(
        [1, 2, 3], lanes_numbered(2), start_heat_number=7, rng=random.Random(0)
    )
    assert [p.heat_number for p in plans] == [7, 8, 9]


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_empty_field_produces_no_heats(algorithm):
    assert SCHEDULERS[algorithm].generate([], lanes_numbered(4)) == []


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_single_racer_gets_one_heat(algorithm):
    _skip_unless_available(algorithm, 1, 4)
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
    _skip_unless_available(algorithm, 3, 5)
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
    _skip_unless_available(algorithm, racers, lane_count)
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
    _skip_unless_available(algorithm, 5, 4)
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
    _skip_unless_available(algorithm, racers, len(usable))
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
    _skip_unless_available(algorithm, 6, 3)
    plans = SCHEDULERS[algorithm].generate(
        [1, 2, 3, 4, 5, 6], [1, 2, 4], rng=random.Random(0)
    )
    scheduled = {lane for plan in plans for lane, _ in plan.assignments}
    assert 3 not in scheduled


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_assignments_pair_a_racer_with_the_lane_they_are_actually_in(algorithm):
    # The whole reason `lane_numbers` exists. Pairing `plan.lanes` with its
    # index — which is what the code did before — puts lane 4's racer in lane 3.
    _skip_unless_available(algorithm, 3, 3)
    plans = SCHEDULERS[algorithm].generate([1, 2, 3], [1, 2, 4], rng=random.Random(0))
    for plan in plans:
        assert [lane for lane, _ in plan.assignments] == [1, 2, 4]
        assert [racer for _, racer in plan.assignments] == list(plan.lanes)


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_lane_numbers_are_sorted_and_deduplicated(algorithm):
    # A schedule listing lane 4 before lane 2 gets read out in that order at the
    # track, and a repeated lane would be two racers in one lane.
    _skip_unless_available(algorithm, 3, 3)
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
    _skip_unless_available(algorithm, 3, 1)
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


# --------------------------------------------------------------------------- #
# PERFECT_N's own properties (#1090, part C)                                  #
# --------------------------------------------------------------------------- #
#
# The reason to pick PERFECT_N over PPC: not just every car every lane once
# (PPC already gives that), but every *pair* of cars meeting the same number
# of times — a property PPC only approximates (opponent-variety heuristic)
# and PERFECT_N holds exactly, for the field sizes it has a published chart
# for. `available_for` is this algorithm's real gate (see
# `domain/schedulers/perfect_n.py`'s module docstring) — these two tests are
# what make that gate trustworthy: the first, that it draws its line exactly
# at the table's edge; the second, that everything inside that line actually
# delivers the constant-meetings guarantee the chart exists for.


@pytest.mark.parametrize("lane_count", LANE_COUNTS)
@pytest.mark.parametrize("racers", RACER_COUNTS)
def test_perfect_n_available_for_matches_table_coverage(racers, lane_count):
    """``available_for`` says yes exactly where a table exists, and refuses
    with a reason everywhere else — the property `test_scheduler_registry.py`
    checks generically, pinned here against the table module directly so a
    future table addition/removal that forgets to keep the two in step is
    caught without needing to regenerate a schedule to notice.
    """
    reason = SCHEDULERS["PERFECT_N"].available_for(racers, lane_count)
    if (lane_count, racers) in PERFECT_N_TABLES:
        assert reason is None, (
            f"table exists for {racers} racers / {lane_count} lanes but "
            f"available_for refused it: {reason}"
        )
    else:
        assert reason is not None, (
            f"no table for {racers} racers / {lane_count} lanes but "
            "available_for claimed it anyway"
        )


@pytest.mark.parametrize("lanes,n", sorted(PERFECT_N_TABLES))
@pytest.mark.parametrize("seed", SEEDS)
def test_perfect_n_every_pair_meets_the_same_number_of_times(lanes, n, seed):
    """The property the chart exists for. Every table PERFECT_N ships is a
    *true* Perfect-N chart (`perfect_n_tables.TRUE_PERFECT`), not merely
    lane-perfect, so this must hold exactly — a single constant `k` — for
    every one of them, over the real (shuffled, id-mapped) schedule
    `generate_perfect_n` hands back, not just the raw chart.
    """
    plans = _schedule("PERFECT_N", n, lanes, seed)
    meetings: dict[tuple[int, int], int] = {}
    for plan in plans:
        present = plan.racer_ids
        for a, b in itertools.combinations(sorted(present), 2):
            meetings[(a, b)] = meetings.get((a, b), 0) + 1

    total_pairs = n * (n - 1) // 2
    assert len(meetings) == total_pairs, (
        f"({lanes}, {n}): {len(meetings)} distinct pairs met, expected {total_pairs}"
    )
    kvals = set(meetings.values())
    assert len(kvals) == 1, (
        f"({lanes}, {n}) is not perfect: pairwise meeting counts vary: {sorted(kvals)}"
    )
