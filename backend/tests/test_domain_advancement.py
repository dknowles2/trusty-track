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
    cut_is_contested,
    field_is_short,
    field_is_stale,
    field_size,
    is_round_complete,
    may_rebuild,
    placeholder_slots,
    rounds_to_invalidate,
    scheduled_participant_count,
    should_populate,
)
from backend.domain.lanes import Lane


@dataclass
class FakeRound:
    """Just the two attributes `rounds_to_invalidate` reads."""

    round_number: int
    advancement_source: str | None = None


def _standings(*pairs) -> list[Standing]:
    return [
        Standing(racer_id=rid, racing_group_id=racing_group)
        for rid, racing_group in pairs
    ]


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
    assert not AdvancementRule("ALL", 2).is_round_scoped
    assert AdvancementRule("EACH_GROUP", 2).source_round_id is None


# --------------------------------------------------------------------------- #
# Who advances                                                                 #
# --------------------------------------------------------------------------- #


def test_pack_takes_the_top_n_overall():
    standings = _standings((10, 1), (11, 2), (12, 1), (13, 2))
    assert advancing_racer_ids(AdvancementRule("ALL", 2), standings) == [10, 11]


def test_den_takes_the_top_n_from_each_den():
    standings = _standings((10, 1), (11, 2), (12, 1), (13, 2))
    assert advancing_racer_ids(AdvancementRule("EACH_GROUP", 1), standings, [1, 2]) == [
        10,
        11,
    ]


def test_den_visits_dens_in_the_order_given():
    """That order decides which placeholder slot each racer lands in."""
    standings = _standings((10, 1), (11, 2))
    assert advancing_racer_ids(AdvancementRule("EACH_GROUP", 1), standings, [2, 1]) == [
        11,
        10,
    ]


def test_den_excludes_racers_with_no_den():
    standings = _standings((10, None), (11, 1))
    assert advancing_racer_ids(AdvancementRule("EACH_GROUP", 5), standings, [1]) == [11]


def test_asking_for_more_than_the_field_returns_the_field():
    standings = _standings((10, 1), (11, 1))
    assert advancing_racer_ids(AdvancementRule("ALL", 10), standings) == [10, 11]


def test_zero_racers_advances_nobody():
    assert advancing_racer_ids(AdvancementRule("ALL", 0), _standings((1, None))) == []


def test_no_racer_count_means_no_limit():
    """Preserved from the previous implementation; see the docstring's note."""
    standings = _standings((10, 1), (11, 1))
    assert advancing_racer_ids(AdvancementRule("ALL", None), standings) == [10, 11]


def test_an_unrecognised_source_advances_nobody():
    assert (
        advancing_racer_ids(AdvancementRule("SOMETHING", 2), _standings((1, 1))) == []
    )


# --------------------------------------------------------------------------- #
# When a round gets filled in                                                  #
# --------------------------------------------------------------------------- #


def test_a_round_scoped_rule_fires_while_its_source_round_is_complete():
    """The question is about the state of the race now, not about which round
    just finished — a rule that only fired on its source's completion event
    stranded a final whose field was reset after that event had passed (#248).
    """
    rule = AdvancementRule("ROUND:7", 4)
    assert should_populate(
        rule, source_round_complete=lambda rid: rid == 7, prior_rounds_complete=_never
    )
    assert not should_populate(
        rule, source_round_complete=lambda _rid: False, prior_rounds_complete=_never
    )


def test_a_malformed_round_source_fires_nothing():
    calls = []
    assert not should_populate(
        AdvancementRule("ROUND:", 4),
        source_round_complete=lambda rid: calls.append(rid) or True,
        prior_rounds_complete=_never,
    )
    assert calls == []


def test_pack_waits_for_every_earlier_round():
    """Otherwise the field is picked from a partial leaderboard and then moves."""
    rule = AdvancementRule("ALL", 4)
    assert not should_populate(
        rule, source_round_complete=_never_id, prior_rounds_complete=lambda: False
    )
    assert should_populate(
        rule, source_round_complete=_never_id, prior_rounds_complete=lambda: True
    )


def test_a_round_scoped_rule_never_asks_about_earlier_rounds():
    """It costs a query per round and runs on every recorded result."""
    calls = []

    def counted():
        calls.append(1)
        return True

    should_populate(
        AdvancementRule("ROUND:3", 2),
        source_round_complete=lambda _rid: True,
        prior_rounds_complete=counted,
    )
    assert calls == []


def _never() -> bool:
    return False


def _never_id(_round_id: int) -> bool:
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


def test_a_skipped_heat_does_not_block_the_round():
    """#224. A skip used to leave its round incomplete forever, so one skipped
    heat silently stopped every later championship round from ever filling —
    the operator saw a final that never became ready, with no explanation. An
    operator who skipped a heat is not coming back to it; the round is as
    decided as it will ever be."""
    heats = [
        [Lane(lane=1, racer_id=1, time=3.0)],
        [Lane(lane=1, racer_id=2, skipped=True)],
    ]
    assert is_round_complete(heats)


def test_a_place_without_a_time_counts_as_settled():
    """How a POINTS race is entered by hand. `advancementStatus` had a private
    copy of this rule that accepted it while this one refused it, so the
    screen said ready while the trigger never fired (#224)."""
    heats = [[Lane(lane=1, racer_id=1, time=None, place=1)]]
    assert is_round_complete(heats)


def test_an_undecided_slot_still_blocks_the_round():
    """The trap #164 documents: a placeholder must never read as settled,
    however the rule above is loosened."""
    heats = [[Lane(lane=1, racer_id=None, placeholder_slot=1)]]
    assert not is_round_complete(heats)


# --------------------------------------------------------------------------- #
# Invalidation                                                                 #
# --------------------------------------------------------------------------- #


def test_only_later_championship_rounds_are_invalidated():
    """A general round's field is the roster, which a result does not change."""
    rounds = [
        FakeRound(1),
        FakeRound(2, "ALL"),
        FakeRound(3),
        FakeRound(4, "EACH_GROUP"),
    ]
    affected = rounds_to_invalidate(rounds, changed_round_number=1)
    assert [r.round_number for r in affected] == [2, 4]


def test_the_changed_round_invalidates_nothing_at_or_before_itself():
    rounds = [FakeRound(1, "ALL"), FakeRound(2, "ALL")]
    assert rounds_to_invalidate(rounds, changed_round_number=2) == []


def test_a_round_that_has_been_raced_may_not_be_rebuilt():
    """Wiping heats people actually ran, unasked, is worse than a stale field."""
    assert not may_rebuild([[Lane(lane=1, racer_id=1, time=3.0)]])


def test_an_unraced_round_may_be_rebuilt():
    assert may_rebuild([[Lane(lane=1, placeholder_slot=1, time=None)]])


def test_a_round_with_no_heats_may_be_rebuilt():
    assert may_rebuild([])


def _placeholder_round(slots: int, lanes_per_heat: int = 4) -> list[list[Lane]]:
    """A championship round as generated: one heat per slot, all placeholders.

    Every heat holds every slot, in a rotation, which is what PPC produces —
    so a slot nobody qualifies for is missing from *every* heat, not one.
    """
    return [
        [
            Lane(lane=lane + 1, placeholder_slot=((heat + lane) % slots) + 1)
            for lane in range(min(lanes_per_heat, slots))
        ]
        for heat in range(slots)
    ]


def test_every_open_slot_is_counted_once():
    """Across heats, not per heat — the same slot appears in all of them."""
    assert placeholder_slots(_placeholder_round(4)) == {1, 2, 3, 4}


def test_real_racers_are_not_slots():
    heat = [[Lane(lane=1, racer_id=7), Lane(lane=2, placeholder_slot=1)]]
    assert placeholder_slots(heat) == {1}


def test_an_empty_lane_is_not_a_slot():
    """An unfilled lane and an undecided one are different things."""
    assert placeholder_slots([[Lane(lane=1, racer_id=None)]]) == set()


def test_a_field_matching_the_slots_is_not_short():
    assert not field_is_short(_placeholder_round(4), advancing_count=4)


def test_a_field_smaller_than_the_slots_is_short():
    """Issue #48: a racing group of three cannot supply a top four."""
    assert field_is_short(_placeholder_round(4), advancing_count=3)


def test_one_qualifier_is_still_short():
    assert field_is_short(_placeholder_round(4), advancing_count=1)


def test_a_round_holding_no_slots_is_never_short():
    """An already-resolved round has nothing left to strand."""
    assert not field_is_short([[Lane(lane=1, racer_id=7)]], advancing_count=1)


def test_scheduled_participant_count_counts_slots_once_per_run():
    """One heat per participant per run (#26): a two-run round of four slots
    holds each slot across eight heats, not eight distinct participants."""
    assert scheduled_participant_count(_placeholder_round(4) * 2) == 4


def test_scheduled_participant_count_counts_real_racers():
    heats = [[Lane(lane=1, racer_id=racer_id)] for racer_id in (1, 2, 3)]
    assert scheduled_participant_count(heats) == 3


def test_scheduled_participant_count_keeps_racers_and_slots_apart():
    """A real racer id and a placeholder slot are different identity spaces,
    even when the numbers happen to match."""
    heats = [[Lane(lane=1, racer_id=1), Lane(lane=2, placeholder_slot=1)]]
    assert scheduled_participant_count(heats) == 2


def test_scheduled_participant_count_ignores_empty_lanes():
    assert scheduled_participant_count([[Lane(lane=1, racer_id=None)]]) == 0


# --------------------------------------------------------------------------- #
# `field_is_stale` — the "Line-up out of date" rule (#229, extracted #433)     #
# --------------------------------------------------------------------------- #


def test_an_unraced_round_is_never_stale():
    """An unraced round is re-fielded by invalidation the moment the
    standings move, so a mismatch here is a bug, not a state to report."""
    heats = [[Lane(lane=1, racer_id=1, time=None), Lane(lane=2, racer_id=2)]]
    assert not field_is_stale(heats, winner_ids={7, 8})


def test_a_raced_round_matching_the_standings_is_not_stale():
    heats = [[Lane(lane=1, racer_id=1, time=12.3), Lane(lane=2, racer_id=2, time=13.1)]]
    assert not field_is_stale(heats, winner_ids={1, 2})


def test_a_raced_round_whose_field_has_drifted_is_stale():
    """A prelim correction moved who qualifies; the final still holds the old
    field."""
    heats = [[Lane(lane=1, racer_id=1, time=12.3), Lane(lane=2, racer_id=2, time=13.1)]]
    assert field_is_stale(heats, winner_ids={1, 3})


def test_comparison_is_by_set_not_by_order():
    """Lane order is the scheduler's business, not part of what "the same
    field" means."""
    heats = [[Lane(lane=1, racer_id=2, time=13.1), Lane(lane=2, racer_id=1, time=12.3)]]
    assert not field_is_stale(heats, winner_ids={1, 2})


def test_a_round_still_holding_only_placeholders_is_not_stale():
    """No real racer has been placed yet, so there is no field to have
    drifted from — even if some lane already carries a time."""
    heats = [[Lane(lane=1, placeholder_slot=1, time=9.999)]]
    assert not field_is_stale(heats, winner_ids={1, 2})


def test_a_round_with_no_heats_is_not_stale():
    assert not field_is_stale([], winner_ids={1, 2})


def test_a_pack_field_is_the_number_asked_for():
    rule = AdvancementRule(source="ALL", num_racers=4)
    assert field_size(rule, racing_group_count=3) == 4


def test_a_den_field_is_that_many_per_den():
    """#52: the detail that was copied correctly once and wrong twice."""
    rule = AdvancementRule(source="EACH_GROUP", num_racers=2)
    assert field_size(rule, racing_group_count=3) == 6


def test_a_round_scoped_field_is_the_number_asked_for():
    rule = AdvancementRule(source="ROUND:7", num_racers=3)
    assert field_size(rule, racing_group_count=5) == 3


def test_a_den_field_with_no_dens_is_empty():
    """Not a crash, and not the unmultiplied count either."""
    assert (
        field_size(
            AdvancementRule(source="EACH_GROUP", num_racers=2), racing_group_count=0
        )
        == 0
    )


def test_no_racer_count_means_no_slots():
    assert field_size(AdvancementRule(source="ALL", num_racers=None), 0) == 0
    assert field_size(AdvancementRule(source="EACH_GROUP", num_racers=None), 3) == 0


# --------------------------------------------------------------------------- #
# `cut_is_contested` — the last-slot tie flag (#540)                          #
# --------------------------------------------------------------------------- #


def test_a_clean_cut_is_not_contested():
    """No two adjacent ranks straddling the boundary share a value."""
    rule = AdvancementRule(source="ALL", num_racers=2)
    standings = [
        Standing(racer_id=1, rank=1),
        Standing(racer_id=2, rank=2),
        Standing(racer_id=3, rank=3),
    ]
    assert not cut_is_contested(rule, standings)


def test_a_tie_straddling_the_cut_is_contested():
    """Two racers share the rank that would be the last qualifying slot."""
    rule = AdvancementRule(source="ALL", num_racers=2)
    standings = [
        Standing(racer_id=1, rank=1),
        Standing(racer_id=2, rank=2),
        Standing(racer_id=3, rank=2),
    ]
    assert cut_is_contested(rule, standings)


def test_a_tie_entirely_inside_the_field_is_not_contested():
    """Both tied racers advance regardless of which order they are in —
    nothing about the *cut* is in question."""
    rule = AdvancementRule(source="ALL", num_racers=3)
    standings = [
        Standing(racer_id=1, rank=1),
        Standing(racer_id=2, rank=1),
        Standing(racer_id=3, rank=3),
        Standing(racer_id=4, rank=4),
    ]
    assert not cut_is_contested(rule, standings)


def test_a_resolved_tie_no_longer_contests_the_cut():
    """Once the tiebreak chain separated the pair, `standings_ranks` would not
    have stamped them the same rank — the caller building `Standing` reflects
    that, and this reads it rather than re-deciding anything."""
    rule = AdvancementRule(source="ALL", num_racers=2)
    standings = [
        Standing(racer_id=1, rank=1),
        Standing(racer_id=2, rank=2),
        Standing(racer_id=3, rank=3),
    ]
    assert not cut_is_contested(rule, standings)


def test_a_caller_with_no_rank_never_contests():
    """A `Standing` built without a rank (every caller before #540) fails
    closed rather than flagging every cut."""
    rule = AdvancementRule(source="ALL", num_racers=1)
    standings = [Standing(racer_id=1), Standing(racer_id=2)]
    assert not cut_is_contested(rule, standings)


def test_no_racer_count_is_never_contested():
    standings = [Standing(racer_id=1, rank=1), Standing(racer_id=2, rank=1)]
    assert not cut_is_contested(
        AdvancementRule(source="ALL", num_racers=None), standings
    )
    assert not cut_is_contested(AdvancementRule(source="ALL", num_racers=0), standings)


def test_a_cut_at_the_end_of_the_field_is_never_contested():
    """Nothing is outside the field to tie the last slot with."""
    rule = AdvancementRule(source="ALL", num_racers=2)
    standings = [Standing(racer_id=1, rank=1), Standing(racer_id=2, rank=1)]
    assert not cut_is_contested(rule, standings)


def test_a_round_scoped_cut_is_contested_the_same_way():
    rule = AdvancementRule(source="ROUND:9", num_racers=1)
    standings = [Standing(racer_id=1, rank=1), Standing(racer_id=2, rank=1)]
    assert cut_is_contested(rule, standings)


def test_each_group_checks_the_cut_within_its_own_group():
    """A tie between two racers of *different* racing groups does not contest
    an `EACH_GROUP` cut — each group has its own boundary."""
    rule = AdvancementRule(source="EACH_GROUP", num_racers=1)
    standings = [
        Standing(racer_id=1, racing_group_id=10, rank=1),
        Standing(racer_id=2, racing_group_id=20, rank=1),
    ]
    assert not cut_is_contested(rule, standings, racing_group_ids=[10, 20])


def test_each_group_flags_a_tie_within_one_group():
    rule = AdvancementRule(source="EACH_GROUP", num_racers=1)
    standings = [
        Standing(racer_id=1, racing_group_id=10, rank=1),
        Standing(racer_id=2, racing_group_id=10, rank=1),
        Standing(racer_id=3, racing_group_id=20, rank=1),
    ]
    assert cut_is_contested(rule, standings, racing_group_ids=[10, 20])


def test_a_from_bottom_cut_reads_the_reversed_order():
    """The mirror of the top-picking cases: the boundary is between the
    slowest ``num_racers`` racers and the one just faster than them."""
    rule = AdvancementRule(source="ALL", num_racers=1, from_bottom=True)
    standings = [
        Standing(racer_id=1, rank=1),
        Standing(racer_id=2, rank=2),
        Standing(racer_id=3, rank=2),
    ]
    assert cut_is_contested(rule, standings)
