"""Tests for the scoring rules, with no database in sight."""

import pytest

from backend.domain.lanes import Lane
from backend.domain.scoring import (
    DNF_PENALTY_SECONDS,
    POINTS,
    TIMED,
    rank_key,
    score_heats,
    standings_ranks,
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
    """A finished lane (a real time) that nobody assigned a place: uncounted.

    Not a DNF and not a skip — those are penalised below. This is an entry
    half-done by hand, and inventing a placement for it would be guessing.
    """
    scores = score_heats([_heat((1, 3.0, None)), _heat((1, 3.0, 2))], POINTS)
    assert scores[1].heats_completed == 1
    assert scores[1].score == 2


class TestPointsPenalisesAMissingPlacement:
    """#225. POINTS sums placements, so a missing one used to be a *reward* —
    the failure `counts_a_disrupted_round` guards, arriving by two more routes
    it did not cover."""

    def test_a_skipped_heat_scores_last_place(self):
        # Racer 1 raced everything and won a heat outright: 2 + 1 = 3.
        # Racer 2 won their only raced heat and had the other skipped.
        # Before: racer 2 summed 1 point and ranked ABOVE racer 1.
        heats = [
            _heat((1, 3.0, 2), (2, 2.9, 1)),
            _heat((1, 3.0, 1)),
            [
                Lane(lane=1, racer_id=2, skipped=True),
                Lane(lane=2, racer_id=3, skipped=True),
            ],
        ]
        scores = score_heats(heats, POINTS)
        assert scores[2].score == 1 + 2  # won one, scratched last of two
        assert scores[2].score > scores[1].score or scores[2].score == 3
        assert scores[2].heats_completed == 2

    def test_a_dnf_scores_last_place(self):
        # Racer 2 never finished heat 2: time 0.0 recorded, no place — which
        # is what `_recalculate_places` produces for a time <= 0. Before, the
        # DNF added nothing and racer 2 tied a racer who won everything.
        heats = [
            _heat((1, 3.0, 1), (2, 3.1, 2)),
            _heat((1, 3.0, 1), (2, 0.0, None)),
        ]
        scores = score_heats(heats, POINTS)
        assert scores[2].score == 2 + 2  # second, then classified last of two
        assert scores[1].score == 2
        assert scores[2].heats_completed == 2

    def test_last_place_is_the_field_not_the_lane_count(self):
        # Three cars in a heat on lanes 1, 2 and 5: a scratch is 3rd, not 5th.
        heats = [
            [
                Lane(lane=1, racer_id=1, time=3.0, place=1),
                Lane(lane=2, racer_id=2, time=3.1, place=2),
                Lane(lane=5, racer_id=3, skipped=True),
            ]
        ]
        assert score_heats(heats, POINTS)[3].score == 3

    def test_timed_still_treats_a_skip_as_no_evidence(self):
        # An average is scale-free, so TIMED needs no penalty for a skip: the
        # heat that never ran simply is not in it. Only the DNF — a run that
        # started and never finished — is penalised there.
        heats = [
            _heat((1, 3.0, 1)),
            [Lane(lane=1, racer_id=1, skipped=True)],
        ]
        scores = score_heats(heats, TIMED)
        assert scores[1].score == 3.0
        assert scores[1].heats_completed == 1

    def test_a_recorded_place_wins_over_the_skip_flag(self):
        # A lane holding both is a re-run that never cleared its flag; the
        # result on it is real and counts as itself.
        heats = [[Lane(lane=1, racer_id=1, time=3.0, place=1, skipped=True)]]
        assert score_heats(heats, POINTS)[1].score == 1


def test_rank_key_sorts_lower_scores_first():
    assert rank_key(3.0, 2, 1) < rank_key(4.0, 2, 1)


def test_rank_key_puts_racers_who_have_not_raced_last():
    assert rank_key(0.0, 0, 1) > rank_key(9.999, 1, 2)


def test_rank_key_breaks_ties_by_racer_id():
    """Otherwise ordering would depend on dict iteration and could shift.

    The *order* only — the stamped rank shares on a tie, which is what stops
    the tiebreak from silently deciding a trophy. See `standings_ranks`.
    """
    assert rank_key(3.0, 1, 5) < rank_key(3.0, 1, 6)


class TestStandingsRanks:
    """#226. Equal scores share a rank, so a tie is visible."""

    def test_a_tie_shares_a_rank_and_the_next_rank_skips(self):
        assert standings_ranks([(3.0, 2), (3.0, 2), (3.5, 2)]) == [1, 1, 3]

    def test_distinct_scores_rank_in_order(self):
        assert standings_ranks([(3.0, 2), (3.1, 2), (3.5, 2)]) == [1, 2, 3]

    def test_a_three_way_tie(self):
        assert standings_ranks([(4, 1), (4, 1), (4, 1), (5, 1)]) == [1, 1, 1, 4]

    def test_unraced_racers_do_not_tie_with_each_other(self):
        # Their scores are all equally meaningless; a pre-race leaderboard
        # where the whole roster shares rank 1 would be a wall of gold medals.
        assert standings_ranks([(0.0, 0), (0.0, 0), (0.0, 0)]) == [1, 2, 3]

    def test_a_raced_racer_never_ties_an_unraced_one(self):
        # A raced 0.0 and an unraced 0.0 are different claims entirely.
        assert standings_ranks([(0.0, 1), (0.0, 0)]) == [1, 2]

    def test_nothing_ranks_nothing(self):
        assert standings_ranks([]) == []

    def test_separated_stops_sharing_a_rank_despite_equal_scores(self):
        # #540: a tiebreaker told these two apart, so the next rank does not
        # skip a place for them the way an unresolved tie does.
        scored = [(3.0, 2), (3.0, 2), (3.5, 2)]
        assert standings_ranks(scored, separated=[False, True, False]) == [1, 2, 3]

    def test_a_three_way_tie_partially_separated(self):
        # One racer is told apart from the other two, who remain tied with
        # each other — the rank they share is the next one after the leader,
        # not the position their index would otherwise imply.
        scored = [(4, 1), (4, 1), (4, 1), (5, 1)]
        assert standings_ranks(scored, separated=[False, True, False, False]) == [
            1,
            2,
            2,
            4,
        ]

    def test_no_separated_argument_reproduces_the_old_behaviour(self):
        # The default must be a no-op for every existing caller.
        scored = [(3.0, 2), (3.0, 2), (3.5, 2)]
        assert standings_ranks(scored) == standings_ranks(scored, separated=None)
