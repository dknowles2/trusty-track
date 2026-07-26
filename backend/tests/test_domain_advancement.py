"""Tests for the advancement and invalidation rules.

These rules were previously spread across three functions and pinned only by an
end-to-end test that drove them through GraphQL. Stated directly here.
"""

from dataclasses import dataclass

import pytest

from backend.domain.advancement import (
    AdvancementRule,
    Standing,
    advancing_racer_ids,
    field_is_short,
    is_round_complete,
    may_rebuild,
    placeholder_slots,
    rounds_to_invalidate,
    should_populate,
)
from backend.domain.lanes import Lane


@dataclass
class FakeRound:
    """Just the two attributes `rounds_to_invalidate` reads."""

    round_number: int
    advancement_source: str | None = None


def _standings(*pairs) -> list[Standing]:
    return [Standing(racer_id=rid, den_id=den) for rid, den in pairs]


# --------------------------------------------------------------------------- #
# Parsing the source string                                                    #
# --------------------------------------------------------------------------- #


def test_round_scoped_rule_exposes_its_round_id():
    rule = AdvancementRule(source="ROUND:12", num_racers=4)
    assert rule.is_round_scoped
    assert rule.source_round_id == 12


@pytest.mark.parametrize("source", ["ROUND:", "ROUND:abc", "ROUND:1.5"])
def test_a_malformed_round_source_advances_nobody(source):
    """A typo in a rule should not raise mid-race."""
    rule = AdvancementRule(source=source, num_racers=4)
    assert rule.source_round_id is None
    assert advancing_racer_ids(rule, _standings((1, None), (2, None))) == []


def test_pack_and_den_are_not_round_scoped():
    assert not AdvancementRule("PACK", 2).is_round_scoped
    assert AdvancementRule("DEN", 2).source_round_id is None


# --------------------------------------------------------------------------- #
# Who advances                                                                 #
# --------------------------------------------------------------------------- #


def test_pack_takes_the_top_n_overall():
    standings = _standings((10, 1), (11, 2), (12, 1), (13, 2))
    assert advancing_racer_ids(AdvancementRule("PACK", 2), standings) == [10, 11]


def test_den_takes_the_top_n_from_each_den():
    standings = _standings((10, 1), (11, 2), (12, 1), (13, 2))
    assert advancing_racer_ids(AdvancementRule("DEN", 1), standings, [1, 2]) == [10, 11]


def test_den_visits_dens_in_the_order_given():
    """That order decides which placeholder slot each racer lands in."""
    standings = _standings((10, 1), (11, 2))
    assert advancing_racer_ids(AdvancementRule("DEN", 1), standings, [2, 1]) == [11, 10]


def test_den_excludes_racers_with_no_den():
    standings = _standings((10, None), (11, 1))
    assert advancing_racer_ids(AdvancementRule("DEN", 5), standings, [1]) == [11]


def test_asking_for_more_than_the_field_returns_the_field():
    standings = _standings((10, 1), (11, 1))
    assert advancing_racer_ids(AdvancementRule("PACK", 10), standings) == [10, 11]


def test_zero_racers_advances_nobody():
    assert advancing_racer_ids(AdvancementRule("PACK", 0), _standings((1, None))) == []


def test_no_racer_count_means_no_limit():
    """Preserved from the previous implementation; see the docstring's note."""
    standings = _standings((10, 1), (11, 1))
    assert advancing_racer_ids(AdvancementRule("PACK", None), standings) == [10, 11]


def test_an_unrecognised_source_advances_nobody():
    assert (
        advancing_racer_ids(AdvancementRule("SOMETHING", 2), _standings((1, 1))) == []
    )


# --------------------------------------------------------------------------- #
# When a round gets filled in                                                  #
# --------------------------------------------------------------------------- #


def test_a_round_scoped_rule_fires_when_its_source_round_finishes():
    rule = AdvancementRule("ROUND:7", 4)
    assert should_populate(rule, completed_round_id=7, prior_rounds_complete=_never)
    assert not should_populate(rule, completed_round_id=8, prior_rounds_complete=_never)


def test_pack_waits_for_every_earlier_round():
    """Otherwise the field is picked from a partial leaderboard and then moves."""
    rule = AdvancementRule("PACK", 4)
    assert not should_populate(rule, 1, prior_rounds_complete=lambda: False)
    assert should_populate(rule, 1, prior_rounds_complete=lambda: True)


def test_a_round_scoped_rule_never_asks_about_earlier_rounds():
    """It costs a query per round and runs on every recorded result."""
    calls = []

    def counted():
        calls.append(1)
        return True

    should_populate(AdvancementRule("ROUND:3", 2), 3, prior_rounds_complete=counted)
    assert calls == []


def _never() -> bool:
    return False


# --------------------------------------------------------------------------- #
# Round completeness                                                           #
# --------------------------------------------------------------------------- #


def test_a_round_is_complete_when_all_its_heats_are():
    heats = [
        [Lane(lane=1, racer_id=1, time=3.0)],
        [Lane(lane=1, racer_id=2, time=3.1)],
    ]
    assert is_round_complete(heats)


def test_one_unfinished_heat_blocks_the_round():
    heats = [
        [Lane(lane=1, racer_id=1, time=3.0)],
        [Lane(lane=1, racer_id=2, time=None)],
    ]
    assert not is_round_complete(heats)


def test_a_round_with_no_heats_has_not_started():
    assert not is_round_complete([])


# --------------------------------------------------------------------------- #
# Invalidation                                                                 #
# --------------------------------------------------------------------------- #


def test_only_later_championship_rounds_are_invalidated():
    """A general round's field is the roster, which a result does not change."""
    rounds = [
        FakeRound(1),
        FakeRound(2, "PACK"),
        FakeRound(3),
        FakeRound(4, "DEN"),
    ]
    affected = rounds_to_invalidate(rounds, changed_round_number=1)
    assert [r.round_number for r in affected] == [2, 4]


def test_the_changed_round_invalidates_nothing_at_or_before_itself():
    rounds = [FakeRound(1, "PACK"), FakeRound(2, "PACK")]
    assert rounds_to_invalidate(rounds, changed_round_number=2) == []


def test_a_round_that_has_been_raced_may_not_be_rebuilt():
    """Wiping heats people actually ran, unasked, is worse than a stale field."""
    assert not may_rebuild([[Lane(lane=1, racer_id=1, time=3.0)]])


def test_an_unraced_round_may_be_rebuilt():
    assert may_rebuild([[Lane(lane=1, racer_id=-1, time=None)]])


def test_a_round_with_no_heats_may_be_rebuilt():
    assert may_rebuild([])


def _placeholder_round(slots: int, lanes_per_heat: int = 4) -> list[list[Lane]]:
    """A championship round as generated: one heat per slot, all placeholders.

    Every heat holds every slot, in a rotation, which is what PPC produces —
    so a slot nobody qualifies for is missing from *every* heat, not one.
    """
    ids = [-(i + 1) for i in range(slots)]
    return [
        [
            Lane(lane=lane + 1, racer_id=ids[(heat + lane) % slots])
            for lane in range(min(lanes_per_heat, slots))
        ]
        for heat in range(slots)
    ]


def test_every_open_slot_is_counted_once():
    """Across heats, not per heat — the same slot appears in all of them."""
    assert placeholder_slots(_placeholder_round(4)) == {-1, -2, -3, -4}


def test_real_racers_are_not_slots():
    heat = [[Lane(lane=1, racer_id=7), Lane(lane=2, racer_id=-1)]]
    assert placeholder_slots(heat) == {-1}


def test_an_empty_lane_is_not_a_slot():
    """An unfilled lane and an undecided one are different things."""
    assert placeholder_slots([[Lane(lane=1, racer_id=None)]]) == set()


def test_a_field_matching_the_slots_is_not_short():
    assert not field_is_short(_placeholder_round(4), advancing_count=4)


def test_a_field_smaller_than_the_slots_is_short():
    """Issue #48: a den of three cannot supply a top four."""
    assert field_is_short(_placeholder_round(4), advancing_count=3)


def test_one_qualifier_is_still_short():
    assert field_is_short(_placeholder_round(4), advancing_count=1)


def test_a_round_holding_no_slots_is_never_short():
    """An already-resolved round has nothing left to strand."""
    assert not field_is_short([[Lane(lane=1, racer_id=7)]], advancing_count=1)
