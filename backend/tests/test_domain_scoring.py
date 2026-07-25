"""Tests for the scoring rules, with no database in sight."""

import pytest

from backend.domain.lanes import Lane
from backend.domain.scoring import (
    DNF_PENALTY_SECONDS,
    POINTS,
    TIMED,
    rank_key,
    score_heats,
)


def _heat(*pairs):
    """A heat from (racer_id, time, place) triples."""
    return [
        Lane(lane=i + 1, racer_id=rid, time=time, place=place)
        for i, (rid, time, place) in enumerate(pairs)
    ]


def test_timed_scores_the_average():
    scores = score_heats(
        [_heat((1, 3.0, 1), (2, 4.0, 2)), _heat((1, 5.0, 2), (2, 4.0, 1))], TIMED
    )
    assert scores[1].score == 4.0
    assert scores[1].heats_completed == 2
    assert scores[2].score == 4.0


def test_points_sums_the_places():
    scores = score_heats(
        [_heat((1, 3.0, 1), (2, 4.0, 2)), _heat((1, 5.0, 3), (2, 4.0, 1))], POINTS
    )
    assert scores[1].score == 4
    assert scores[2].score == 3


@pytest.mark.parametrize("dnf_time", [0.0, -1.0])
def test_a_zero_time_is_scored_as_a_dnf_penalty(dnf_time):
    """Timers report 0.0 when a car starts but never crosses the finish."""
    scores = score_heats([_heat((1, dnf_time, None))], TIMED)
    assert scores[1].score == DNF_PENALTY_SECONDS


def test_the_dnf_penalty_is_finite_so_ranking_stays_a_total_order():
    """One bad run should hurt, not erase the racer from the standings."""
    scores = score_heats([_heat((1, 0.0, None)), _heat((1, 3.0, 1))], TIMED)
    assert scores[1].score == pytest.approx((DNF_PENALTY_SECONDS + 3.0) / 2)


def test_a_scheduled_racer_appears_before_racing():
    """The leaderboard lists them as unranked rather than omitting them."""
    scores = score_heats([_heat((1, None, None))], TIMED)
    assert scores[1].heats_completed == 0
    assert scores[1].score == 0.0


def test_unparseable_times_are_ignored_not_counted():
    scores = score_heats([_heat((1, "not a time", None)), _heat((1, 3.0, 1))], TIMED)
    assert scores[1].heats_completed == 1
    assert scores[1].score == 3.0


def test_string_times_are_scored():
    scores = score_heats([_heat((1, "3.5", 1))], TIMED)
    assert scores[1].score == 3.5


def test_empty_lanes_are_skipped():
    scores = score_heats([_heat((None, None, None), (1, 3.0, 1))], TIMED)
    assert list(scores) == [1]


def test_points_ignores_a_missing_place():
    scores = score_heats([_heat((1, 3.0, None)), _heat((1, 3.0, 2))], POINTS)
    assert scores[1].heats_completed == 1
    assert scores[1].score == 2


def test_rank_key_sorts_lower_scores_first():
    assert rank_key(3.0, 2, 1) < rank_key(4.0, 2, 1)


def test_rank_key_puts_racers_who_have_not_raced_last():
    assert rank_key(0.0, 0, 1) > rank_key(9.999, 1, 2)


def test_rank_key_breaks_ties_by_racer_id():
    """Otherwise ordering would depend on dict iteration and could shift."""
    assert rank_key(3.0, 1, 5) < rank_key(3.0, 1, 6)
