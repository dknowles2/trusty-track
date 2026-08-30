"""Tests for the five tiebreak methods, with no database in sight.

Each method's inconclusive case is pinned by name — no timer, never met,
identical values — because a tiebreaker that cannot fail is the one thing
this module must never become (#540). The property tests at the bottom hold
the structural guarantee every method shares regardless of which one is
asked: every racer handed in comes back exactly once, in exactly one group.
"""

import random

import pytest

from backend.domain.lanes import Lane
from backend.domain.scoring import DNF_PENALTY_SECONDS
from backend.domain.tiebreak import (
    ALL_METHODS,
    BEST_TIME,
    COUNTBACK,
    HEAD_TO_HEAD,
    SHARED,
    TOTAL_TIME,
    TiebreakResult,
    tiebreak,
)


def _heat(*entries: tuple[int, object, object]) -> list[Lane]:
    """A heat from (racer_id, time, place) triples, one lane each."""
    return [
        Lane(lane=i + 1, racer_id=racer_id, time=time, place=place)
        for i, (racer_id, time, place) in enumerate(entries)
    ]


# --------------------------------------------------------------------------
# The shape every method promises, independent of which one is asked.
# --------------------------------------------------------------------------


def test_fewer_than_two_racers_needs_no_method():
    assert tiebreak([], [], BEST_TIME).groups == ()
    assert tiebreak([7], [], BEST_TIME).groups == ((7,),)


def test_unknown_method_raises():
    with pytest.raises(ValueError):
        tiebreak([1, 2], [], "COIN_FLIP")


def test_order_flattens_the_groups_best_first():
    result = TiebreakResult(groups=((3,), (1, 2)))
    assert result.order == (3, 1, 2)


def test_still_tied_is_true_only_within_a_group():
    result = TiebreakResult(groups=((3,), (1, 2)))
    assert result.still_tied(1, 2) is True
    assert result.still_tied(3, 1) is False
    # Neither in the same group, and neither is even a value we asked about.
    assert result.still_tied(9, 10) is False


def test_resolved_is_false_for_a_single_group():
    assert TiebreakResult(groups=((1, 2, 3),)).resolved is False
    assert TiebreakResult(groups=((1,), (2, 3))).resolved is True


# --------------------------------------------------------------------------
# SHARED — the default, and a deliberate no-op.
# --------------------------------------------------------------------------


def test_shared_never_resolves_anything():
    heats = [_heat((1, 3.0, 1), (2, 4.0, 2))]
    result = tiebreak([1, 2], heats, SHARED)
    assert result.groups == ((1, 2),)
    assert result.resolved is False


# --------------------------------------------------------------------------
# BEST_TIME
# --------------------------------------------------------------------------


def test_best_time_orders_by_the_fastest_single_heat():
    heats = [
        _heat((1, 5.0, 2), (2, 6.0, 3)),
        _heat((1, 3.0, 1), (2, 3.5, 2)),
    ]
    result = tiebreak([1, 2], heats, BEST_TIME)
    assert result.groups == ((1,), (2,))


def test_best_time_no_timer_is_inconclusive():
    """Neither racer has a recorded time at all — the `POINTS`-on-`NONE` case."""
    heats = [_heat((1, None, 1), (2, None, 2))]
    result = tiebreak([1, 2], heats, BEST_TIME)
    assert result.groups == ((1, 2),)
    assert result.resolved is False


def test_best_time_identical_bests_is_inconclusive():
    heats = [_heat((1, 4.5, 1), (2, 4.5, 2))]
    result = tiebreak([1, 2], heats, BEST_TIME)
    assert result.groups == ((1, 2),)


def test_best_time_excludes_a_dnf_rather_than_treating_it_as_fastest():
    """A DNF is a recorded `0.0` — the lowest number, and not a real run.

    Racer 2 never posts anything above zero, so this must not read as "racer
    2's fastest time is 0.0, therefore racer 2 wins" — it has to read as
    racer 2 having no usable time at all.
    """
    heats = [_heat((1, 6.0, 1), (2, 0.0, 2))]
    result = tiebreak([1, 2], heats, BEST_TIME)
    assert result.groups == ((1, 2),)


def test_best_time_one_racer_with_no_data_is_inconclusive():
    """Racer 1 has a real time; racer 2 has never posted one.

    Comparing "racer 1's best" against "nothing" would either invent a value
    for racer 2 or unfairly demote them — this module does neither.
    """
    heats = [_heat((1, 4.0, 1), (2, None, None))]
    result = tiebreak([1, 2], heats, BEST_TIME)
    assert result.groups == ((1, 2),)


# --------------------------------------------------------------------------
# TOTAL_TIME
# --------------------------------------------------------------------------


def test_total_time_orders_by_the_lower_sum():
    heats = [
        _heat((1, 4.0, 1), (2, 4.5, 2)),
        _heat((1, 4.5, 2), (2, 4.0, 1)),
        _heat((1, 4.0, 1), (2, 5.0, 2)),
    ]
    # Racer 1: 12.5, racer 2: 13.5.
    result = tiebreak([1, 2], heats, TOTAL_TIME)
    assert result.groups == ((1,), (2,))


def test_total_time_penalises_a_dnf_rather_than_rewarding_it():
    """A naive sum would let racer 2's `0.0` shrink their total.

    Racer 2 DNFs once; the penalty makes their total the worse of the two
    despite the raw numbers otherwise favouring them.
    """
    heats = [
        _heat((1, 5.0, 1), (2, 5.0, 2)),
        _heat((1, 5.0, 1), (2, 0.0, 2)),
    ]
    result = tiebreak([1, 2], heats, TOTAL_TIME)
    assert result.groups == ((1,), (2,))
    # Pin the actual arithmetic, not just the ordering.
    assert 10.0 < 5.0 + DNF_PENALTY_SECONDS


def test_total_time_no_recorded_times_is_inconclusive():
    heats = [_heat((1, None, 1), (2, None, 2))]
    result = tiebreak([1, 2], heats, TOTAL_TIME)
    assert result.groups == ((1, 2),)


def test_total_time_identical_totals_is_inconclusive():
    heats = [
        _heat((1, 4.0, 1), (2, 2.0, 2)),
        _heat((1, 2.0, 2), (2, 4.0, 1)),
    ]
    result = tiebreak([1, 2], heats, TOTAL_TIME)
    assert result.groups == ((1, 2),)


# --------------------------------------------------------------------------
# COUNTBACK
# --------------------------------------------------------------------------


def test_countback_orders_by_most_first_places():
    heats = [
        _heat((1, None, 1), (2, None, 2)),
        _heat((1, None, 2), (2, None, 1)),
        _heat((1, None, 1), (2, None, 3)),
    ]
    # Racer 1: two 1sts, one 2nd. Racer 2: one 1st, one 2nd, one 3rd.
    result = tiebreak([1, 2], heats, COUNTBACK)
    assert result.groups == ((1,), (2,))


def test_countback_falls_through_to_second_place_on_a_tie_in_firsts():
    heats = [
        _heat((1, None, 1), (2, None, 2)),
        _heat((1, None, 2), (2, None, 1)),
        _heat((1, None, 3), (2, None, 2)),
    ]
    # Both have exactly one 1st. Racer 2 has two 2nds to racer 1's one.
    result = tiebreak([1, 2], heats, COUNTBACK)
    assert result.groups == ((2,), (1,))


def test_countback_identical_records_is_inconclusive():
    heats = [
        _heat((1, None, 1), (2, None, 2)),
        _heat((1, None, 2), (2, None, 1)),
    ]
    result = tiebreak([1, 2], heats, COUNTBACK)
    assert result.groups == ((1, 2),)


def test_countback_no_recorded_places_is_inconclusive():
    heats = [_heat((1, 4.0, None), (2, 4.0, None))]
    result = tiebreak([1, 2], heats, COUNTBACK)
    assert result.groups == ((1, 2),)


# --------------------------------------------------------------------------
# HEAD_TO_HEAD
# --------------------------------------------------------------------------


def test_head_to_head_orders_by_wins_over_the_other_car():
    heats = [
        _heat((1, None, 1), (2, None, 2), (3, None, 3)),
        _heat((1, None, 1), (2, None, 2)),
    ]
    result = tiebreak([1, 2], heats, HEAD_TO_HEAD)
    assert result.groups == ((1,), (2,))


def test_head_to_head_never_met_is_inconclusive():
    """Two tied cars that never shared a heat — `HEAD_TO_HEAD` answers nothing."""
    heats = [
        _heat((1, None, 1), (3, None, 2)),
        _heat((2, None, 1), (3, None, 2)),
    ]
    result = tiebreak([1, 2], heats, HEAD_TO_HEAD)
    assert result.groups == ((1, 2),)


def test_head_to_head_splitting_the_duels_is_inconclusive():
    heats = [
        _heat((1, None, 1), (2, None, 2)),
        _heat((1, None, 2), (2, None, 1)),
    ]
    result = tiebreak([1, 2], heats, HEAD_TO_HEAD)
    assert result.groups == ((1, 2),)


def test_head_to_head_a_third_racer_who_never_met_anyone_taints_the_group():
    """Met is a precondition to being ranked, not a win count of zero.

    Racers 1 and 2 have a decisive result between them, but racer 3 never
    shares a comparable heat with anyone — so there is no fair way to place
    racer 3 relative to the other two, and the whole tied group stays tied.
    """
    heats = [_heat((1, None, 1), (2, None, 2))]
    result = tiebreak([1, 2, 3], heats, HEAD_TO_HEAD)
    assert result.groups == ((1, 2, 3),)


def test_head_to_head_uses_place_over_time_when_both_are_present():
    """Place is strategy-agnostic; a mismatched time must not override it."""
    heats = [_heat((1, 9.0, 1), (2, 1.0, 2))]
    result = tiebreak([1, 2], heats, HEAD_TO_HEAD)
    assert result.groups == ((1,), (2,))


def test_head_to_head_falls_back_to_time_with_no_place_recorded():
    heats = [_heat((1, 3.0, None), (2, 4.0, None))]
    result = tiebreak([1, 2], heats, HEAD_TO_HEAD)
    assert result.groups == ((1,), (2,))


def test_head_to_head_scores_a_dnf_as_a_loss_not_the_fastest_lap():
    heats = [_heat((1, 5.0, None), (2, 0.0, None))]
    result = tiebreak([1, 2], heats, HEAD_TO_HEAD)
    assert result.groups == ((1,), (2,))


# --------------------------------------------------------------------------
# Property tests: whatever the method and whatever the heats, the result is
# a partition of the input, in the spirit of `test_domain_scheduling.py`.
# --------------------------------------------------------------------------

RACER_COUNTS = range(2, 6)
SEEDS = range(20)


def _random_heats(rng: random.Random, racer_ids: list[int]) -> list[list[Lane]]:
    heats = []
    for _ in range(rng.randint(0, 4)):
        entries = []
        for racer_id in racer_ids:
            if rng.random() < 0.3:
                continue  # this racer sat out this heat
            time = rng.choice([None, 0.0, round(rng.uniform(3.0, 6.0), 3)])
            place = rng.choice([None, rng.randint(1, len(racer_ids))])
            entries.append((racer_id, time, place))
        rng.shuffle(entries)
        if entries:
            heats.append(_heat(*entries))
    return heats


@pytest.mark.parametrize("method", ALL_METHODS)
@pytest.mark.parametrize("racer_count", RACER_COUNTS)
@pytest.mark.parametrize("seed", SEEDS)
def test_every_racer_appears_exactly_once(method, racer_count, seed):
    rng = random.Random(f"{method}-{racer_count}-{seed}")
    racer_ids = list(range(1, racer_count + 1))
    heats = _random_heats(rng, racer_ids)

    result = tiebreak(racer_ids, heats, method)

    # A partition: every input id shows up, none twice, nothing invented.
    seen: list[int] = [racer_id for group in result.groups for racer_id in group]
    assert sorted(seen) == sorted(racer_ids)
    assert sorted(result.order) == sorted(racer_ids)


@pytest.mark.parametrize("method", ALL_METHODS)
@pytest.mark.parametrize("racer_count", RACER_COUNTS)
@pytest.mark.parametrize("seed", SEEDS)
def test_the_same_input_resolves_the_same_way_twice(method, racer_count, seed):
    """Computed on every read (#540, following #17) — never a coin flip."""
    rng = random.Random(f"{method}-{racer_count}-{seed}")
    racer_ids = list(range(1, racer_count + 1))
    heats = _random_heats(rng, racer_ids)

    first = tiebreak(racer_ids, heats, method)
    second = tiebreak(racer_ids, heats, method)
    assert first == second


def test_shared_never_resolves_regardless_of_data():
    """Property check that SHARED really is a no-op over random heats too."""
    rng = random.Random(0)
    for _ in range(50):
        racer_ids = list(range(1, rng.randint(2, 6) + 1))
        heats = _random_heats(rng, racer_ids)
        result = tiebreak(racer_ids, heats, SHARED)
        assert result.resolved is False
