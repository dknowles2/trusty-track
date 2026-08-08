"""The rules for who wins what (#170).

Pure, so these run without a database — the point of `domain/`. The wiring is
covered in `test_awards.py`.
"""

import pytest

from backend.domain.advancement import Standing
from backend.domain.awards import PACK, SpeedRule, recipient_of, sources_for


def standings(*pairs: tuple[int, int | None]) -> list[Standing]:
    """Standings best-first, as ``(racer_id, den_id)`` pairs."""
    return [Standing(racer_id=racer_id, den_id=den_id) for racer_id, den_id in pairs]


class TestPlace:
    def test_first_place_is_the_top_of_the_standings(self) -> None:
        rule = SpeedRule(source=PACK, place=1)
        assert recipient_of(rule, standings((7, None), (8, None))) == 7

    def test_place_is_one_based(self) -> None:
        # The obvious off-by-one, and an expensive one: it hands second place's
        # trophy to the winner.
        rule = SpeedRule(source=PACK, place=2)
        assert recipient_of(rule, standings((7, None), (8, None), (9, None))) == 8

    def test_a_place_nobody_has_reached_has_no_recipient(self) -> None:
        # The ordinary state for most of an event, not an error.
        rule = SpeedRule(source=PACK, place=3)
        assert recipient_of(rule, standings((7, None), (8, None))) is None

    def test_empty_standings_have_no_recipient(self) -> None:
        assert recipient_of(SpeedRule(source=PACK, place=1), []) is None

    def test_a_place_below_one_is_refused_when_the_rule_is_built(self) -> None:
        # `standings[place - 1]` with a place of 0 indexes from the end and
        # hands the trophy to the *slowest* car, so this is caught at
        # construction rather than at resolution.
        with pytest.raises(ValueError, match="1-based"):
            SpeedRule(source=PACK, place=0)
        with pytest.raises(ValueError, match="1-based"):
            SpeedRule(source=PACK, place=-1)


class TestDenScope:
    def test_a_den_award_reads_the_standings_narrowed_to_that_den(self) -> None:
        # "Fastest Wolf" is the ordinary standings filtered, which is why DEN is
        # not a source here the way it is for advancement.
        rule = SpeedRule(source=PACK, place=1, den_id=2)
        assert recipient_of(rule, standings((7, 1), (8, 2), (9, 2))) == 8

    def test_place_counts_within_the_den_not_the_pack(self) -> None:
        rule = SpeedRule(source=PACK, place=2, den_id=2)
        assert recipient_of(rule, standings((7, 1), (8, 2), (9, 1), (10, 2))) == 10

    def test_a_den_nobody_has_raced_in_has_no_recipient(self) -> None:
        rule = SpeedRule(source=PACK, place=1, den_id=99)
        assert recipient_of(rule, standings((7, 1), (8, 2))) is None

    def test_racers_with_no_den_are_not_in_a_den_award(self) -> None:
        rule = SpeedRule(source=PACK, place=1, den_id=1)
        assert recipient_of(rule, standings((7, None), (8, 1))) == 8


class TestSource:
    def test_pack_is_not_round_scoped(self) -> None:
        rule = SpeedRule(source=PACK, place=1)
        assert not rule.is_round_scoped
        assert rule.source_round_id is None

    def test_a_round_source_names_its_round(self) -> None:
        rule = SpeedRule(source="ROUND:4", place=1)
        assert rule.is_round_scoped
        assert rule.source_round_id == 4

    def test_a_malformed_round_source_names_no_round(self) -> None:
        # Same rule advancement follows: a typo should not take down the race.
        assert SpeedRule(source="ROUND:", place=1).source_round_id is None
        assert SpeedRule(source="ROUND:abc", place=1).source_round_id is None

    def test_the_offerable_sources_are_the_pack_and_every_round(self) -> None:
        assert sources_for([4, 5]) == [PACK, "ROUND:4", "ROUND:5"]

    def test_a_race_with_no_rounds_can_still_offer_the_pack(self) -> None:
        assert sources_for([]) == [PACK]
