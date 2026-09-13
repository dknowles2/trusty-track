"""The rules for who wins what (#170).

Pure, so these run without a database — the point of `domain/`. The wiring is
covered in `test_awards.py`.
"""

import pytest

from backend.domain.advancement import Standing
from backend.domain.awards import (
    ALL,
    MEDAL,
    SPECIAL,
    SPEED,
    TORTOISE,
    TROPHY,
    AwardSeed,
    SpeedRule,
    can_be_voted_on,
    championship_award_seed,
    default_artwork_key,
    ordinal,
    place_is_contested,
    rank_tally,
    recipient_of,
    sources_for,
)


def standings(*pairs: tuple[int, int | None]) -> list[Standing]:
    """Standings best-first, as ``(racer_id, racing_group_id)`` pairs."""
    return [
        Standing(racer_id=racer_id, racing_group_id=racing_group_id)
        for racer_id, racing_group_id in pairs
    ]


def ranked_standings(*rows: tuple[int, int, int | None]) -> list[Standing]:
    """Standings best-first, as ``(racer_id, rank, racing_group_id)`` rows —
    for :func:`place_is_contested`, which reads the rank."""
    return [
        Standing(racer_id=racer_id, rank=rank, racing_group_id=racing_group_id)
        for racer_id, rank, racing_group_id in rows
    ]


class TestPlace:
    def test_first_place_is_the_top_of_the_standings(self) -> None:
        rule = SpeedRule(source=ALL, place=1)
        assert recipient_of(rule, standings((7, None), (8, None))) == 7

    def test_place_is_one_based(self) -> None:
        # The obvious off-by-one, and an expensive one: it hands second place's
        # trophy to the winner.
        rule = SpeedRule(source=ALL, place=2)
        assert recipient_of(rule, standings((7, None), (8, None), (9, None))) == 8

    def test_a_place_nobody_has_reached_has_no_recipient(self) -> None:
        # The ordinary state for most of an event, not an error.
        rule = SpeedRule(source=ALL, place=3)
        assert recipient_of(rule, standings((7, None), (8, None))) is None

    def test_empty_standings_have_no_recipient(self) -> None:
        assert recipient_of(SpeedRule(source=ALL, place=1), []) is None

    def test_a_place_below_one_is_refused_when_the_rule_is_built(self) -> None:
        # `standings[place - 1]` with a place of 0 indexes from the end and
        # hands the trophy to the *slowest* car, so this is caught at
        # construction rather than at resolution.
        with pytest.raises(ValueError, match="1-based"):
            SpeedRule(source=ALL, place=0)
        with pytest.raises(ValueError, match="1-based"):
            SpeedRule(source=ALL, place=-1)


class TestDenScope:
    def test_a_den_award_reads_the_standings_narrowed_to_that_den(self) -> None:
        # "Fastest Wolf" is the ordinary standings filtered, which is why EACH_GROUP is
        # not a source here the way it is for advancement.
        rule = SpeedRule(source=ALL, place=1, racing_group_id=2)
        assert recipient_of(rule, standings((7, 1), (8, 2), (9, 2))) == 8

    def test_place_counts_within_the_den_not_the_pack(self) -> None:
        rule = SpeedRule(source=ALL, place=2, racing_group_id=2)
        assert recipient_of(rule, standings((7, 1), (8, 2), (9, 1), (10, 2))) == 10

    def test_a_den_nobody_has_raced_in_has_no_recipient(self) -> None:
        rule = SpeedRule(source=ALL, place=1, racing_group_id=99)
        assert recipient_of(rule, standings((7, 1), (8, 2))) is None

    def test_racers_with_no_den_are_not_in_a_den_award(self) -> None:
        rule = SpeedRule(source=ALL, place=1, racing_group_id=1)
        assert recipient_of(rule, standings((7, None), (8, 1))) == 8


class TestFromBottom:
    """The slowest-car trophy: the same standings, read from the other end."""

    def test_first_place_from_the_bottom_is_the_slowest_car(self) -> None:
        rule = SpeedRule(source=ALL, place=1, from_bottom=True)
        assert recipient_of(rule, standings((7, None), (8, None), (9, None))) == 9

    def test_place_counts_up_from_the_slowest(self) -> None:
        rule = SpeedRule(source=ALL, place=2, from_bottom=True)
        assert recipient_of(rule, standings((7, None), (8, None), (9, None))) == 8

    def test_a_car_that_never_ran_is_not_the_slowest_car(self) -> None:
        # The leaderboard sorts racers with no result below everyone who has
        # raced, so the raw bottom of the standings is absent cars. Handing
        # them the trophy in front of a room is the failure this prevents.
        entries = [
            Standing(racer_id=7),
            Standing(racer_id=8),
            Standing(racer_id=9, has_raced=False),
        ]
        rule = SpeedRule(source=ALL, place=1, from_bottom=True)
        assert recipient_of(rule, entries) == 8

    def test_nobody_has_raced_yet_means_nobody_wins_it(self) -> None:
        entries = [Standing(racer_id=7, has_raced=False)]
        rule = SpeedRule(source=ALL, place=1, from_bottom=True)
        assert recipient_of(rule, entries) is None

    def test_a_den_is_narrowed_before_it_is_reversed(self) -> None:
        # "Slowest Wolf" is the Wolves read backwards, not the pack read
        # backwards and then filtered.
        rule = SpeedRule(source=ALL, place=1, racing_group_id=2, from_bottom=True)
        assert recipient_of(rule, standings((7, 2), (8, 1), (9, 2), (10, 1))) == 9

    def test_the_default_reads_from_the_top(self) -> None:
        assert SpeedRule(source=ALL, place=1).from_bottom is False


class TestSource:
    def test_pack_is_not_round_scoped(self) -> None:
        rule = SpeedRule(source=ALL, place=1)
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
        assert sources_for([4, 5]) == [ALL, "ROUND:4", "ROUND:5"]

    def test_a_race_with_no_rounds_can_still_offer_the_pack(self) -> None:
        assert sources_for([]) == [ALL]


class TestDefaultArtworkKey:
    """A `SPEED` award's artwork, worked out from its rule with no picker (#306)."""

    def test_first_place_gets_the_trophy(self) -> None:
        rule = SpeedRule(source=ALL, place=1)
        assert default_artwork_key(rule) == TROPHY

    def test_a_lesser_place_gets_the_medal(self) -> None:
        rule = SpeedRule(source=ALL, place=2)
        assert default_artwork_key(rule) == MEDAL

    def test_the_slowest_car_gets_its_own_key_regardless_of_place(self) -> None:
        # `from_bottom` wins over `place`: a "3rd slowest" award is still a
        # slowest-car award, not a bronze medal.
        first = SpeedRule(source=ALL, place=1, from_bottom=True)
        third = SpeedRule(source=ALL, place=3, from_bottom=True)
        assert default_artwork_key(first) == TORTOISE
        assert default_artwork_key(third) == TORTOISE

    def test_a_den_scope_does_not_change_the_key(self) -> None:
        # "Fastest Wolf" is still a first-place trophy; racing_group narrowing is about
        # who is eligible, not what kind of award it is.
        rule = SpeedRule(source=ALL, place=1, racing_group_id=3)
        assert default_artwork_key(rule) == TROPHY


class TestCanBeVotedOn:
    """A `SPEED` award has a computed recipient — a ballot for one is
    nonsense, regardless of what `votable` happens to hold (#305)."""

    def test_a_special_award_flagged_votable_can_be_voted_on(self) -> None:
        assert can_be_voted_on(SPECIAL, True) is True

    def test_a_special_award_not_flagged_cannot(self) -> None:
        assert can_be_voted_on(SPECIAL, False) is False

    def test_a_speed_award_never_can_even_if_flagged(self) -> None:
        assert can_be_voted_on(SPEED, True) is False


class TestRankTally:
    def test_the_most_votes_come_first(self) -> None:
        assert rank_tally({7: 2, 8: 5, 9: 1}) == [(8, 5), (7, 2), (9, 1)]

    def test_ties_are_broken_by_racer_id(self) -> None:
        # Deterministic order, not whatever the database happens to return.
        assert rank_tally({9: 3, 7: 3, 8: 3}) == [(7, 3), (8, 3), (9, 3)]

    def test_an_empty_tally_is_an_empty_list(self) -> None:
        assert rank_tally({}) == []


class TestPlaceIsContested:
    """Whether an award's place is a tie the tiebreak chain left standing
    (#540)."""

    def test_a_clear_winner_is_not_contested(self) -> None:
        rule = SpeedRule(source=ALL, place=1)
        rows = ranked_standings((7, 1, None), (8, 2, None))
        assert place_is_contested(rule, rows) is False

    def test_a_tie_for_the_place_is_contested(self) -> None:
        rule = SpeedRule(source=ALL, place=1)
        rows = ranked_standings((7, 1, None), (8, 1, None))
        assert place_is_contested(rule, rows) is True

    def test_a_tie_one_step_below_the_place_is_still_contested(self) -> None:
        """Second place, sharing a rank with third: there is no clean "2nd"
        to hand out."""
        rule = SpeedRule(source=ALL, place=2)
        rows = ranked_standings((7, 1, None), (8, 2, None), (9, 2, None))
        assert place_is_contested(rule, rows) is True

    def test_a_place_nobody_has_reached_is_not_contested(self) -> None:
        rule = SpeedRule(source=ALL, place=3)
        rows = ranked_standings((7, 1, None), (8, 2, None))
        assert place_is_contested(rule, rows) is False

    def test_a_caller_with_no_rank_is_never_contested(self) -> None:
        rule = SpeedRule(source=ALL, place=1)
        rows = standings((7, None), (8, None))
        assert place_is_contested(rule, rows) is False

    def test_a_racing_group_narrows_before_checking(self) -> None:
        """Tied overall, but the only Wolf in the race — nothing to contest
        within the group."""
        rule = SpeedRule(source=ALL, place=1, racing_group_id=10)
        rows = ranked_standings((7, 1, 10), (8, 1, 20))
        assert place_is_contested(rule, rows) is False

    def test_a_racing_group_tie_is_contested(self) -> None:
        rule = SpeedRule(source=ALL, place=1, racing_group_id=10)
        rows = ranked_standings((7, 1, 10), (8, 1, 10))
        assert place_is_contested(rule, rows) is True

    def test_a_from_bottom_award_reads_the_reversed_order(self) -> None:
        rule = SpeedRule(source=ALL, place=1, from_bottom=True)
        rows = ranked_standings((7, 1, None), (8, 2, None), (9, 2, None))
        assert place_is_contested(rule, rows) is True


class _StubAward:
    """A minimal stand-in for `models.Award`, just enough for
    `championship_award_seed`'s structural `kind` check — this module stays
    importable with no database, and a plain object here proves it."""

    def __init__(self, kind: str) -> None:
        self.kind = kind


class TestOrdinal:
    @pytest.mark.parametrize(
        ("place", "expected"),
        [
            (1, "1st"),
            (2, "2nd"),
            (3, "3rd"),
            (4, "4th"),
            (10, "10th"),
            (11, "11th"),
            (12, "12th"),
            (13, "13th"),
            (21, "21st"),
            (22, "22nd"),
            (23, "23rd"),
            (101, "101st"),
            (111, "111th"),
        ],
    )
    def test_matches_the_frontend_s_own_convention(
        self, place: int, expected: str
    ) -> None:
        """The same edge cases `awardText.ordinal.test.ts` pins on the
        frontend — 11th/12th/13th, not 11st/12nd/13rd."""
        assert ordinal(place) == expected


class TestChampionshipAwardSeed:
    """The table #1082 asks for: trophies × (overall | per-group) ×
    existing awards (none / SPEED present / judged only) → the exact seed
    list, plus the floor relationship in the other direction (`place` never
    exceeds the field)."""

    def test_one_award_per_place_overall(self) -> None:
        seeds = championship_award_seed(
            3, 8, [], is_each_group=False, existing_awards=[]
        )
        assert seeds == [
            AwardSeed(name="1st Place", place=1, racing_group_id=None, sort_order=0),
            AwardSeed(name="2nd Place", place=2, racing_group_id=None, sort_order=1),
            AwardSeed(name="3rd Place", place=3, racing_group_id=None, sort_order=2),
        ]

    def test_sort_order_continues_after_the_race_s_existing_awards(self) -> None:
        seeds = championship_award_seed(
            2,
            8,
            [],
            is_each_group=False,
            existing_awards=[],
            sort_order_start=5,
        )
        assert [seed.sort_order for seed in seeds] == [5, 6]

    def test_one_set_per_racing_group_when_each_group(self) -> None:
        seeds = championship_award_seed(
            2, 4, [10, 20], is_each_group=True, existing_awards=[]
        )
        assert [(seed.racing_group_id, seed.place) for seed in seeds] == [
            (10, 1),
            (10, 2),
            (20, 1),
            (20, 2),
        ]
        assert [seed.sort_order for seed in seeds] == [0, 1, 2, 3]

    def test_an_existing_speed_award_blocks_seeding_entirely(self) -> None:
        existing = [_StubAward(kind=SPEED)]
        assert (
            championship_award_seed(
                3, 8, [], is_each_group=False, existing_awards=existing
            )
            == []
        )

    def test_a_judged_only_race_is_still_seeded(self) -> None:
        """The guard is a SPEED award's presence, not any award at all — a
        race that already has a hand-added Best Paint still gets its
        trophies."""
        existing = [_StubAward(kind=SPECIAL)]
        seeds = championship_award_seed(
            2, 8, [], is_each_group=False, existing_awards=existing
        )
        assert len(seeds) == 2

    def test_no_trophies_configured_seeds_nothing(self) -> None:
        assert (
            championship_award_seed(0, 8, [], is_each_group=False, existing_awards=[])
            == []
        )

    def test_a_non_positive_trophy_count_seeds_nothing(self) -> None:
        assert (
            championship_award_seed(-1, 8, [], is_each_group=False, existing_awards=[])
            == []
        )

    def test_place_never_exceeds_the_final_s_own_field(self) -> None:
        """The floor relationship in the other direction — a Slowest Race
        bracket, say, can ask for fewer racers than there are trophies."""
        seeds = championship_award_seed(
            3, 1, [], is_each_group=False, existing_awards=[]
        )
        assert [seed.place for seed in seeds] == [1]

    def test_each_group_caps_per_group_not_the_combined_total(self) -> None:
        seeds = championship_award_seed(
            3, 1, [10, 20], is_each_group=True, existing_awards=[]
        )
        assert [(seed.racing_group_id, seed.place) for seed in seeds] == [
            (10, 1),
            (20, 1),
        ]

    def test_a_zero_or_unknown_field_size_is_not_treated_as_a_bound(self) -> None:
        """`field_size <= 0` means "not known" rather than "no seats" — a
        caller that could not size the field must not seed zero trophies for
        a race that asked for some."""
        seeds = championship_award_seed(
            3, 0, [], is_each_group=False, existing_awards=[]
        )
        assert len(seeds) == 3
