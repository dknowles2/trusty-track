"""Property tests for the master running order interleave.

Same spirit as `test_domain_scheduling.py`: no database, no fixtures, every
group-count against every group-size mix that matters, fast enough to run on
every commit.
"""

import random
from collections.abc import Sequence

import pytest

from backend.domain.running_order import GroupSchedule, HeatEntry, interleave

Handle = tuple[int, int]  # (group_id, index within that group's own order)


def group_disjoint(group_id: int, size: int) -> GroupSchedule[Handle]:
    """A group whose heats each hold one racer, unique to this group.

    Mirrors the ordinary case: a den's racers are its own, so no two groups
    ever share a car. Every heat's handle is ``(group_id, index)``, which is
    enough for a test to recover both which group an entry in the master
    order came from and where it sat in that group's own schedule.
    """
    return GroupSchedule(
        group_id=group_id,
        heats=[
            HeatEntry(
                handle=(group_id, i), racer_ids=frozenset({group_id * 10_000 + i})
            )
            for i in range(size)
        ],
    )


def group_repeating(group_id: int, size: int, car_id: int) -> GroupSchedule[Handle]:
    """A group where every heat holds the *same* car — worst case for repeats.

    Used to exercise the "avoid a repeat" rule: within this group, every
    adjacent pair of heats clashes, by construction, exactly as an
    unlucky PPC schedule might for one car. Racer ids are still unique to
    this group's ``car_id`` namespace, so a clash can only ever happen
    *within* the group, never across two different groups.
    """
    return GroupSchedule(
        group_id=group_id,
        heats=[
            HeatEntry(
                handle=(group_id, i), racer_ids=frozenset({group_id * 10_000 + car_id})
            )
            for i in range(size)
        ],
    )


GROUP_COUNTS = range(1, 8)
SEEDS = range(6)


def _sizes(group_count: int, seed: int, low: int = 1, high: int = 20) -> list[int]:
    rng = random.Random(group_count * 1000 + seed)
    return [rng.randint(low, high) for _ in range(group_count)]


def _configurations() -> list[tuple[int, int]]:
    return [(gc, seed) for gc in GROUP_COUNTS for seed in SEEDS]


# ---------------------------------------------------------------------------
# Every heat appears exactly once.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("group_count,seed", _configurations())
def test_every_heat_appears_exactly_once(group_count: int, seed: int) -> None:
    sizes = _sizes(group_count, seed)
    groups = [group_disjoint(gid, size) for gid, size in enumerate(sizes)]
    order = interleave(groups)

    expected = {(gid, i) for gid, size in enumerate(sizes) for i in range(size)}
    assert len(order) == len(expected)
    assert set(order) == expected
    assert len(order) == len(set(order))  # no duplicate


@pytest.mark.parametrize("group_count,seed", _configurations())
def test_a_group_with_no_heats_contributes_nothing(group_count: int, seed: int) -> None:
    sizes = _sizes(group_count, seed)
    groups = [group_disjoint(gid, size) for gid, size in enumerate(sizes)]
    # Add a couple of empty groups into the mix.
    groups = [*groups, GroupSchedule(group_id=1000, heats=[]), GroupSchedule(2000, [])]
    order = interleave(groups)
    expected = {(gid, i) for gid, size in enumerate(sizes) for i in range(size)}
    assert set(order) == expected


def test_no_groups_at_all_is_an_empty_order() -> None:
    assert interleave([]) == []
    assert interleave([GroupSchedule(1, []), GroupSchedule(2, [])]) == []


# ---------------------------------------------------------------------------
# Each group's own order is preserved.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("group_count,seed", _configurations())
def test_group_internal_order_is_preserved(group_count: int, seed: int) -> None:
    sizes = _sizes(group_count, seed)
    groups = [group_disjoint(gid, size) for gid, size in enumerate(sizes)]
    order = interleave(groups)

    for gid, size in enumerate(sizes):
        this_group = [h for h in order if h[0] == gid]
        assert this_group == [(gid, i) for i in range(size)]


# ---------------------------------------------------------------------------
# No car in two consecutive heats, except when it is genuinely unavoidable.
# ---------------------------------------------------------------------------


def _active_groups_before(
    order: Sequence[Handle], totals: dict[int, int], upto: int
) -> set[int]:
    """Which groups still have an unconsumed heat, using only ``order[:upto]``."""
    consumed: dict[int, int] = {}
    for gid, _i in order[:upto]:
        consumed[gid] = consumed.get(gid, 0) + 1
    return {gid for gid, total in totals.items() if consumed.get(gid, 0) < total}


@pytest.mark.parametrize("group_count,seed", _configurations())
def test_no_consecutive_repeat_unless_only_one_group_was_left(
    group_count: int, seed: int
) -> None:
    """A repeated car between two adjacent heats is only legitimate when, at
    that exact point, every other group had already been fully consumed —
    checked against the actual racer ids the entries carry, not assumed from
    which group an entry came from.

    Every group's every heat holds the same one car here (unique to that
    group), so an unlucky within-group repeat — the kind PPC's own output
    does not rule out either — is the norm rather than an edge case, which is
    what exercises the repair.
    """
    sizes = _sizes(group_count, seed, low=1, high=10)
    groups = [group_repeating(gid, size, car_id=0) for gid, size in enumerate(sizes)]
    totals = dict(enumerate(sizes))
    racers_of = {
        entry.handle: entry.racer_ids for group in groups for entry in group.heats
    }
    order = interleave(groups)

    for idx in range(1, len(order)):
        if not (racers_of[order[idx - 1]] & racers_of[order[idx]]):
            continue  # the ordinary case: no shared car, nothing to justify
        cur_gid, _ = order[idx]
        active = _active_groups_before(order, totals, idx)
        assert active == {cur_gid}, (
            f"heat {idx} repeated a car while {active - {cur_gid}} groups "
            f"still had heats left to interleave with"
        )


def test_a_single_group_passes_through_unchanged() -> None:
    """With nothing to interleave against, a group's own order — repeats and
    all — is exactly what comes out. This is the "impossible to improve on
    its own order" case the module docstring names.
    """
    group = group_repeating(0, 5, car_id=7)
    order = interleave([group])
    assert order == [(0, i) for i in range(5)]


@pytest.mark.parametrize("group_count,seed", _configurations())
def test_disjoint_groups_never_clash_across_a_boundary(
    group_count: int, seed: int
) -> None:
    """A car belongs to one group; two different groups' heats can never
    repeat a car between them, whatever the credits decide. This is the
    "trivially satisfiable" case the docstring names — checked directly
    against the racer ids, not assumed from group membership.
    """
    sizes = _sizes(group_count, seed)
    groups = [group_disjoint(gid, size) for gid, size in enumerate(sizes)]
    racers_of = {
        entry.handle: entry.racer_ids for group in groups for entry in group.heats
    }
    order = interleave(groups)
    for idx in range(1, len(order)):
        prev_gid, _ = order[idx - 1]
        cur_gid, _ = order[idx]
        if prev_gid != cur_gid:
            assert not (racers_of[order[idx - 1]] & racers_of[order[idx]])


# ---------------------------------------------------------------------------
# Groups finish proportionally.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("group_count,seed", _configurations())
def test_pacing_never_drifts_more_than_a_group_s_own_size(
    group_count: int, seed: int
) -> None:
    """At every point in the master order, a group's actual share of the
    heats run so far is within one group-size of its ideal proportional
    share. This is what rules out block scheduling (a group fully raced,
    then another, has a share of 0.0 or 1.0 throughout most of the order —
    an enormous deviation) while allowing the ordinary rounding slack any
    integer interleave of unequal-sized groups must have.

    The bound itself (strictly less than the largest group's size) is a
    property of the smooth-weighted-round-robin scheme `interleave` uses,
    not an arbitrary tolerance — the same scheme nginx uses for proportional
    upstream selection, chosen exactly because deviation stays bounded no
    matter how the group sizes are skewed.
    """
    sizes = _sizes(group_count, seed)
    groups = [group_disjoint(gid, size) for gid, size in enumerate(sizes)]
    order = interleave(groups)
    total = sum(sizes)
    max_size = max(sizes)

    consumed = dict.fromkeys(range(group_count), 0)
    for position, (gid, _i) in enumerate(order, start=1):
        consumed[gid] += 1
        for other_gid, size in enumerate(sizes):
            ideal = position * size / total
            deviation = abs(consumed[other_gid] - ideal)
            assert deviation < max_size + 1e-9, (
                f"group {other_gid} (size {size}) drifted {deviation:.2f} "
                f"heats from its ideal pace at position {position} of {total} "
                f"(sizes={sizes})"
            )


def test_a_small_den_does_not_finish_long_before_a_large_one() -> None:
    """The example from the issue: a den of four alongside a den of twelve
    must not be scheduled as two blocks — the four should still be running
    heats deep into the twelve's schedule, not done a quarter of the way in.
    """
    groups = [group_disjoint(0, 4), group_disjoint(1, 12)]
    order = interleave(groups)
    assert len(order) == 16

    last_four_position = max(i for i, (gid, _) in enumerate(order) if gid == 0)
    # A plain "run group 0 first, then group 1" block schedule finishes
    # group 0 at position 3 (0-indexed) of 15 — a quarter of the way in.
    # Interleaved, it should still be running heats well past the midpoint.
    assert last_four_position >= 8, (
        f"the four-den finished at position {last_four_position} of "
        f"{len(order) - 1}, too close to a block schedule"
    )

    # And it is genuinely interleaved, not just moved to a different block:
    # both groups appear in the first half and the second half.
    first_half_groups = {gid for gid, _ in order[:8]}
    second_half_groups = {gid for gid, _ in order[8:]}
    assert first_half_groups == {0, 1}
    assert second_half_groups == {0, 1}


# ---------------------------------------------------------------------------
# Reading the order back out: `execution_sort_key`.
# ---------------------------------------------------------------------------

# (round_number, heat_number, is_championship) — two general rounds whose
# pending heats carry interleaved (globally unique) numbers, one championship
# round numbered 1..2 by its own generator, and two recorded heats keeping the
# per-round numbers they were announced under.
_HEATS = [
    (1, 1, False),  # round 1, recorded before the interleave
    (2, 1, False),  # round 2, recorded before the interleave
    (1, 5, False),  # interleaved pending heats: 5, 6, 7 across rounds 1 and 2
    (2, 6, False),
    (1, 7, False),
    (3, 1, True),  # the final, numbered 1..2 by its own generator
    (3, 2, True),
]


def _sorted_heats(master_order: bool) -> list[tuple[int, int, bool]]:
    from backend.domain.running_order import execution_sort_key

    return sorted(
        _HEATS,
        key=lambda h: execution_sort_key(
            round_number=h[0],
            heat_number=h[1],
            is_championship=h[2],
            master_order=master_order,
        ),
    )


def test_default_order_is_round_then_heat() -> None:
    """With the flag off — every race that predates it — nothing changes:
    one round's block, then the next round's, championship included.
    """
    assert _sorted_heats(master_order=False) == sorted(
        _HEATS, key=lambda h: (h[0], h[1])
    )


def test_master_order_follows_heat_number_across_general_rounds() -> None:
    """With the flag on, the general rounds' heats run in `heat_number` order
    regardless of which round each belongs to — that is where the interleave
    lives — while a recorded heat's old per-round number keeps it ahead of
    every interleaved pending heat (apply numbers past the race-wide max).
    """
    ordered = _sorted_heats(master_order=True)
    general = [h for h in ordered if not h[2]]
    assert general == [
        (1, 1, False),
        (2, 1, False),
        (1, 5, False),
        (2, 6, False),
        (1, 7, False),
    ]


def test_championship_rounds_run_after_every_general_round() -> None:
    """A championship round is exempt from the interleave — its field comes
    from the general rounds' standings, and the advancement cascade renumbers
    its heats 1..N on every rebuild — so its low numbers must not put it at
    the head of the master order.
    """
    ordered = _sorted_heats(master_order=True)
    assert ordered[-2:] == [(3, 1, True), (3, 2, True)]


def test_colliding_numbers_zip_deterministically() -> None:
    """A round the interleave has not renumbered yet (generated after the
    last apply) still counts 1..N. Its numbers collide with other rounds'
    and the tiebreak is `round_number`, so the order stays deterministic —
    a zip, not a jumble — until the operator re-applies.
    """
    from backend.domain.running_order import execution_sort_key

    heats = [(1, 1, False), (2, 1, False), (1, 2, False), (2, 2, False)]
    ordered = sorted(
        heats,
        key=lambda h: execution_sort_key(
            round_number=h[0],
            heat_number=h[1],
            is_championship=h[2],
            master_order=True,
        ),
    )
    assert ordered == [(1, 1, False), (2, 1, False), (1, 2, False), (2, 2, False)]
