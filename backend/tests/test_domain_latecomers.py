"""Properties of admitting a late racer to a round already under way (#172).

Pure, so it can sweep every field size against every lane count rather than
asserting one worked example — which is how #26 found the scheduler stranding a
lane in one four-lane schedule out of four.
"""

from collections import Counter

import pytest

from backend.domain import latecomers


def _lane_sets():
    """Contiguous tracks, and one with a hole in it (#171)."""
    return [[1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [1, 2, 4], [2, 4, 6]]


@pytest.mark.parametrize("usable_lanes", _lane_sets())
@pytest.mark.parametrize("field_size", [2, 3, 5, 8, 20])
def test_a_newcomer_takes_every_lane_exactly_once(usable_lanes, field_size):
    field = list(range(1, field_size + 1))
    newcomer = 999

    heats = latecomers.plan_late_entry([newcomer], field, usable_lanes)

    seated = [
        lane
        for heat in heats
        for lane, racer_id in heat.assignments
        if racer_id == newcomer
    ]
    assert sorted(seated) == sorted(usable_lanes)


@pytest.mark.parametrize("usable_lanes", _lane_sets())
@pytest.mark.parametrize("field_size", [2, 3, 5, 8, 20])
def test_nobody_races_themselves(usable_lanes, field_size):
    field = list(range(1, field_size + 1))

    heats = latecomers.plan_late_entry([999], field, usable_lanes)

    for heat in heats:
        racer_ids = [racer_id for _, racer_id in heat.assignments]
        assert len(racer_ids) == len(set(racer_ids))


@pytest.mark.parametrize("usable_lanes", _lane_sets())
@pytest.mark.parametrize("field_size", [5, 8, 20])
def test_every_appended_heat_is_full(usable_lanes, field_size):
    """The property #26 established for the generator, restated for admission.

    A field this size can always fill every lane, so a heat that comes back
    short is the same stranded-lane bug arriving by another route.
    """
    field = list(range(1, field_size + 1))

    heats = latecomers.plan_late_entry([999], field, usable_lanes)

    for heat in heats:
        assert len(heat.assignments) == len(usable_lanes)


@pytest.mark.parametrize("usable_lanes", _lane_sets())
def test_lanes_come_from_the_usable_set(usable_lanes):
    heats = latecomers.plan_late_entry([999], [1, 2, 3, 4, 5], usable_lanes)

    used = {lane for heat in heats for lane, _ in heat.assignments}
    assert used <= set(usable_lanes)


@pytest.mark.parametrize("usable_lanes", _lane_sets())
def test_no_lane_is_used_twice_in_one_heat(usable_lanes):
    heats = latecomers.plan_late_entry([999], [1, 2, 3, 4, 5], usable_lanes)

    for heat in heats:
        lane_numbers = [lane for lane, _ in heat.assignments]
        assert len(lane_numbers) == len(set(lane_numbers))


def test_the_extra_load_is_spread_rather_than_landing_on_one_racer():
    """Whoever fills the other lanes runs more heats than their peers.

    That cost is unavoidable — the lanes have to hold somebody — but it must
    not all land on the lowest racer id, which is what a naive `min` over the
    field does.
    """
    field = list(range(1, 13))

    heats = latecomers.plan_late_entry([999], field, [1, 2, 3, 4])

    # Count over the whole field, not over the returned mapping. A racer who
    # picked up nothing is absent from it, so `min(extra.values())` asks only
    # about the racers that were chosen — and a planner that hands every extra
    # run to the same three cars passes that vacuously.
    extra = latecomers.extra_appearances(heats, [999])
    per_racer = [extra.get(racer, 0) for racer in field]
    assert sum(per_racer), "somebody has to fill the other lanes"
    assert max(per_racer) - min(per_racer) <= 1


def test_newcomers_arriving_together_race_each_other():
    """Two children arriving at once share heats.

    Otherwise each drags a separate set of established racers into extra runs,
    which doubles the disruption for no reason — and they are the two people in
    the room who have not raced anybody yet.
    """
    field = list(range(1, 13))

    heats = latecomers.plan_late_entry([998, 999], field, [1, 2, 3, 4])

    together = [
        heat
        for heat in heats
        if {998, 999} <= {racer_id for _, racer_id in heat.assignments}
    ]
    assert together


def test_both_newcomers_still_take_every_lane():
    heats = latecomers.plan_late_entry([998, 999], list(range(1, 13)), [1, 2, 3, 4])

    for newcomer in (998, 999):
        seated = [
            lane
            for heat in heats
            for lane, racer_id in heat.assignments
            if racer_id == newcomer
        ]
        assert sorted(seated) == [1, 2, 3, 4]


@pytest.mark.parametrize("arriving", [1, 2, 3, 4])
def test_a_group_of_latecomers_costs_no_more_heats_than_one_does(arriving):
    """Admitting several at once must not append several separate schedules.

    Each appended heat seats one newcomer and can discharge a lane for every
    other newcomer in it, so a group no larger than the lane count still fits
    in one lane-count's worth of heats. A planner that ran them sequentially
    would append that many times over — and every one of those heats drags
    established racers into another run.
    """
    newcomers = [900 + n for n in range(arriving)]

    heats = latecomers.plan_late_entry(newcomers, list(range(1, 13)), [1, 2, 3, 4])

    assert len(heats) == 4


def test_a_newcomer_is_never_given_an_extra_appearance():
    """`extra_appearances` counts the cost to the round, not to the newcomer.

    The newcomer's runs are the ones being added; counting them would report
    the round as more disturbed the more of it was put right.
    """
    heats = latecomers.plan_late_entry([999], list(range(1, 9)), [1, 2, 3, 4])

    assert 999 not in latecomers.extra_appearances(heats, [999])


def test_two_newcomers_alone_still_get_a_schedule():
    """An empty field is a round nobody has raced yet in every practical sense,
    but two latecomers can still be scheduled against each other."""
    heats = latecomers.plan_late_entry([998, 999], [], [1, 2])

    assert heats
    for heat in heats:
        assert {racer_id for _, racer_id in heat.assignments} <= {998, 999}


def test_a_lone_newcomer_with_nobody_to_race_plans_nothing():
    assert latecomers.plan_late_entry([999], [], [1, 2, 3, 4]) == []


def test_no_newcomers_and_no_lanes_plan_nothing():
    assert latecomers.plan_late_entry([], [1, 2, 3], [1, 2]) == []
    assert latecomers.plan_late_entry([999], [1, 2, 3], []) == []


def test_a_repeated_newcomer_is_admitted_once():
    heats = latecomers.plan_late_entry([999, 999], [1, 2, 3, 4, 5], [1, 2, 3])

    seated = Counter(
        lane for heat in heats for lane, racer_id in heat.assignments if racer_id == 999
    )
    assert seated == Counter({1: 1, 2: 1, 3: 1})


def test_a_newcomer_already_in_the_field_is_not_double_counted():
    """The caller works out who is missing; passing somebody twice must not
    schedule them against themselves."""
    heats = latecomers.plan_late_entry([3], [1, 2, 3, 4, 5], [1, 2, 3])

    for heat in heats:
        racer_ids = [racer_id for _, racer_id in heat.assignments]
        assert racer_ids.count(3) == 1


def test_who_has_already_met_whom_breaks_ties():
    """Given a free choice, prefer an opponent the newcomer has not raced.

    Only a tie-break: lane balance decides first, and it has to, because lanes
    are what PPC exists to even out.
    """
    field = [1, 2, 3, 4]
    met = {999: {1: 5, 2: 5, 3: 0, 4: 0}}

    heats = latecomers.plan_late_entry([999], field, [1, 2], met=met)

    opponents = {
        racer_id
        for heat in heats
        for _, racer_id in heat.assignments
        if racer_id != 999
    }
    assert opponents <= {3, 4}
