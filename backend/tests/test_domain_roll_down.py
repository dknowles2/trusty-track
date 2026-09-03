"""At most one trophy per racer (#615) — the pure rule.

No database: these build standings by hand and read who each award goes to
and why. The resolution *order* is the design, so it has tests of its own
(`TestPriorityOrder`) that read no standings at all.
"""

from backend.domain.advancement import ALL, Standing
from backend.domain.awards import SpeedRule
from backend.domain.roll_down import (
    AwardEntry,
    PassedOver,
    Podium,
    Resolution,
    podium_of,
    priority_order,
    resolve_awards,
)

WOLF = 1
BEAR = 2

# Racer ids are chosen so the pack order is readable: 10 is fastest overall.
PACK = [
    Standing(racer_id=10, racing_group_id=WOLF),
    Standing(racer_id=11, racing_group_id=BEAR),
    Standing(racer_id=12, racing_group_id=WOLF),
    Standing(racer_id=13, racing_group_id=WOLF),
    Standing(racer_id=14, racing_group_id=BEAR),
    Standing(racer_id=15, racing_group_id=WOLF),
    Standing(racer_id=16, racing_group_id=BEAR),
]


def speed(
    key: int, place: int, *, group: int | None = None, source: str = ALL
) -> AwardEntry:
    return AwardEntry(
        key=key, rule=SpeedRule(source=source, place=place, racing_group_id=group)
    )


def judged(key: int, racer: int | None) -> AwardEntry:
    return AwardEntry(key=key, chosen_racer_id=racer)


def resolve(
    entries: list[AwardEntry], **standings: list[Standing]
) -> dict[int, Resolution]:
    by_source = {ALL: PACK, **standings}
    return resolve_awards(entries, by_source, one_trophy_per_racer=True)


def recipients(
    entries: list[AwardEntry], **standings: list[Standing]
) -> dict[int, int | None]:
    return {k: r.recipient for k, r in resolve(entries, **standings).items()}


class TestOff:
    def test_off_is_exactly_the_isolated_resolution(self) -> None:
        # Every race that existed before this rule reads as it always did.
        entries = [speed(1, 1), speed(2, 1, group=WOLF), judged(3, 10)]
        resolved = resolve_awards(entries, {ALL: PACK}, one_trophy_per_racer=False)
        assert {k: r.recipient for k, r in resolved.items()} == {1: 10, 2: 10, 3: 10}

    def test_off_carries_no_provenance(self) -> None:
        entries = [speed(1, 1), speed(2, 1, group=WOLF), judged(3, 10)]
        resolved = resolve_awards(entries, {ALL: PACK}, one_trophy_per_racer=False)
        assert all(r.passed_over == () for r in resolved.values())
        assert all(r.duplicate_of is None for r in resolved.values())
        assert resolved[1].position == 1

    def test_off_with_a_missing_source_resolves_to_nobody(self) -> None:
        resolved = resolve_awards(
            [speed(1, 1, source="ROUND:9")], {ALL: PACK}, one_trophy_per_racer=False
        )
        assert resolved[1].recipient is None


class TestRollDown:
    def test_a_den_trophy_rolls_down_from_the_pack_champion(self) -> None:
        # The tradition's own example: Jordan wins the pack, the Wolf trophy
        # goes to the next fastest Wolf.
        entries = [speed(1, 1, group=WOLF), speed(2, 1)]
        assert recipients(entries) == {2: 10, 1: 12}

    def test_the_roll_is_explained(self) -> None:
        entries = [speed(1, 1, group=WOLF), speed(2, 1)]
        wolf = resolve(entries)[1]
        assert wolf.position == 2
        assert wolf.passed_over == (PassedOver(racer_id=10, award_key=2),)

    def test_an_award_that_did_not_roll_says_so(self) -> None:
        entries = [speed(1, 1, group=WOLF), speed(2, 1)]
        pack = resolve(entries)[2]
        assert pack.position == 1
        assert pack.passed_over == ()

    def test_a_whole_podium_shifts_together(self) -> None:
        # Pack 1-2-3 take 10, 11, 12. The Wolf podium is then 13, 15 — and
        # third has nobody, because there is no fourth Wolf left.
        entries = [
            speed(1, 3, group=WOLF),
            speed(2, 2, group=WOLF),
            speed(3, 1, group=WOLF),
            speed(4, 3),
            speed(5, 2),
            speed(6, 1),
        ]
        assert recipients(entries) == {6: 10, 5: 11, 4: 12, 3: 13, 2: 15, 1: None}

    def test_second_place_on_a_podium_is_the_second_candidate_not_the_second_survivor(
        self,
    ) -> None:
        # The trap: filtering *every* holder out would leave Wolf 2nd looking
        # at a list that its own first-place winner has already left, and
        # index one past the right row. A podium's places are one cascade.
        entries = [speed(1, 1, group=WOLF), speed(2, 2, group=WOLF), speed(3, 1)]
        resolved = resolve(entries)
        assert resolved[1].recipient == 12
        assert resolved[2].recipient == 13
        assert resolved[2].position == 3
        # Only the *other* podium's holder is reported as passed over; the
        # Wolf first-place winner above is the ordinary cascade, not a roll.
        assert resolved[2].passed_over == (PassedOver(racer_id=10, award_key=3),)

    def test_a_gap_in_a_podium_leaves_the_missing_place_unfilled(self) -> None:
        # First and third, no second: third is still the third candidate.
        entries = [speed(1, 1, group=WOLF), speed(2, 3, group=WOLF)]
        assert recipients(entries) == {1: 10, 2: 13}

    def test_dens_do_not_interfere_with_each_other(self) -> None:
        entries = [speed(1, 1, group=WOLF), speed(2, 1, group=BEAR), speed(3, 1)]
        assert recipients(entries) == {3: 10, 1: 12, 2: 11}

    def test_a_racer_who_won_nothing_higher_keeps_their_own_den_trophy(self) -> None:
        # Bear 11 is second overall and there is no pack second, so nothing rolls.
        entries = [speed(1, 1, group=BEAR), speed(2, 1)]
        resolved = resolve(entries)
        assert resolved[1].recipient == 11
        assert resolved[1].position == 1
        assert resolved[1].passed_over == ()

    def test_a_podium_nobody_is_left_for_has_no_recipient(self) -> None:
        # One-car den: its only member is the pack champion.
        only = [Standing(racer_id=10, racing_group_id=WOLF)]
        entries = [speed(1, 1, group=WOLF), speed(2, 1)]
        assert recipients(entries, **{ALL: only}) == {2: 10, 1: None}

    def test_a_missing_source_resolves_to_nobody_rather_than_raising(self) -> None:
        entries = [speed(1, 1, source="ROUND:9"), speed(2, 1)]
        assert recipients(entries) == {2: 10, 1: None}

    def test_a_duplicate_award_on_one_podium_rolls_rather_than_doubling(self) -> None:
        # Two "Fastest Wolf" rows — a trophy and a medal, say. One racer,
        # one trophy: the second goes to the next Wolf.
        entries = [speed(1, 1, group=WOLF), speed(2, 1, group=WOLF)]
        resolved = resolve(entries)
        assert resolved[1].recipient == 10
        assert resolved[2].recipient == 12
        assert resolved[2].position == 2

    def test_a_slowest_car_award_is_its_own_podium(self) -> None:
        # Three cars: the slowest overall is a Wolf, and so is the fastest.
        # Slowest overall (race-wide) is decided first; fastest Wolf is
        # presented after slowest Wolf, so it resolves first and takes 10;
        # slowest Wolf then finds both Wolves already holding something.
        three = [
            Standing(racer_id=10, racing_group_id=WOLF),
            Standing(racer_id=11, racing_group_id=BEAR),
            Standing(racer_id=15, racing_group_id=WOLF),
        ]
        slowest = AwardEntry(
            key=1, rule=SpeedRule(source=ALL, place=1, from_bottom=True)
        )
        slowest_wolf = AwardEntry(
            key=2,
            rule=SpeedRule(source=ALL, place=1, racing_group_id=WOLF, from_bottom=True),
        )
        entries = [slowest_wolf, speed(3, 1, group=WOLF), slowest]
        resolved = resolve(entries, **{ALL: three})
        assert {k: r.recipient for k, r in resolved.items()} == {1: 15, 3: 10, 2: None}
        assert resolved[3].position == 1

    def test_two_race_wide_podiums_resolve_one_at_a_time(self) -> None:
        # A final's podium and a prelim podium, both race-wide. The final is
        # announced last, so it is decided in full first; the prelim podium
        # then goes to whoever is left — never interleaved place by place,
        # which would hand second in the final the prelim trophy and third
        # in the final the final's own silver.
        final = [Standing(racer_id=r) for r in (10, 11, 12, 13, 14)]
        entries = [
            speed(1, 3),
            speed(2, 2),
            speed(3, 1),
            speed(4, 3, source="ROUND:5"),
            speed(5, 2, source="ROUND:5"),
            speed(6, 1, source="ROUND:5"),
        ]
        assert recipients(entries, **{"ROUND:5": final}) == {
            6: 10,
            5: 11,
            4: 12,
            3: 13,
            2: 14,
            1: 15,
        }


class TestJudged:
    def test_a_judged_award_keeps_its_racer(self) -> None:
        entries = [judged(1, 10), speed(2, 1)]
        assert recipients(entries) == {1: 10, 2: 10}

    def test_a_judged_award_never_moves_a_speed_trophy(self) -> None:
        # Judging finishes after racing; Best Paint landing on the champion
        # must not roll the pack trophy out from under the announcer.
        entries = [judged(1, 10), speed(2, 1), speed(3, 1, group=WOLF)]
        resolved = resolve(entries)
        assert resolved[2].recipient == 10
        assert resolved[2].passed_over == ()
        assert resolved[3].recipient == 12

    def test_the_collision_is_reported_on_the_judged_award(self) -> None:
        entries = [judged(1, 10), speed(2, 1)]
        assert resolve(entries)[1].duplicate_of == 2

    def test_no_collision_is_reported_when_there_is_none(self) -> None:
        entries = [judged(1, 14), speed(2, 1)]
        assert resolve(entries)[1].duplicate_of is None

    def test_two_judged_awards_naming_one_racer_report_each_other(self) -> None:
        entries = [judged(1, 14), judged(2, 14)]
        resolved = resolve(entries)
        assert resolved[1].duplicate_of is None
        assert resolved[2].duplicate_of == 1

    def test_an_undecided_judged_award_is_nobody(self) -> None:
        resolved = resolve([judged(1, None), speed(2, 1)])
        assert resolved[1] == Resolution(recipient=None)


class TestPriorityOrder:
    def test_race_wide_before_group_scoped(self) -> None:
        entries = [speed(1, 1, group=WOLF), speed(2, 1)]
        assert [e.key for e in priority_order(entries)] == [2, 1]

    def test_place_before_presentation_within_a_podium(self) -> None:
        # Announced third, second, first — resolved first, second, third.
        entries = [speed(1, 3), speed(2, 2), speed(3, 1)]
        assert [e.key for e in priority_order(entries)] == [3, 2, 1]

    def test_a_podium_presented_later_resolves_first(self) -> None:
        entries = [speed(1, 1, source="ROUND:5"), speed(2, 1)]
        assert [e.key for e in priority_order(entries)] == [2, 1]

    def test_a_podium_is_placed_by_its_last_award(self) -> None:
        # Prelim 3rd, final 3rd, prelim 2nd, final 2nd, prelim 1st, final 1st:
        # the final's podium ends later, so the whole of it comes first.
        entries = [
            speed(1, 3),
            speed(2, 3, source="ROUND:5"),
            speed(3, 2),
            speed(4, 2, source="ROUND:5"),
            speed(5, 1),
            speed(6, 1, source="ROUND:5"),
        ]
        assert [e.key for e in priority_order(entries)] == [6, 4, 2, 5, 3, 1]

    def test_judged_awards_are_not_in_the_order(self) -> None:
        entries = [judged(1, 10), speed(2, 1), judged(3, None)]
        assert [e.key for e in priority_order(entries)] == [2]

    def test_duplicate_places_keep_presentation_order(self) -> None:
        entries = [speed(1, 1, group=WOLF), speed(2, 1, group=WOLF)]
        assert [e.key for e in priority_order(entries)] == [1, 2]

    def test_the_order_is_stable_under_input_order(self) -> None:
        # Shuffling a caller's list changes only the presentation tiebreak,
        # and here every award is on a distinct podium with a distinct place —
        # so the answer is decided by rule, not by which row came first.
        entries = [speed(1, 2), speed(2, 1, group=WOLF), speed(3, 1)]
        expected = [3, 1, 2]
        assert [e.key for e in priority_order(entries)] == expected
        assert [e.key for e in priority_order(entries[::-1])] == expected


class TestPodium:
    def test_a_podium_is_source_group_and_direction(self) -> None:
        rule = SpeedRule(source=ALL, place=2, racing_group_id=WOLF, from_bottom=True)
        assert podium_of(rule) == Podium(ALL, WOLF, True)

    def test_places_on_one_podium_share_it(self) -> None:
        assert podium_of(SpeedRule(source=ALL, place=1)) == podium_of(
            SpeedRule(source=ALL, place=3)
        )

    def test_a_group_scope_makes_a_podium_not_race_wide(self) -> None:
        assert Podium(ALL, None, False).is_race_wide
        assert not Podium(ALL, WOLF, False).is_race_wide
