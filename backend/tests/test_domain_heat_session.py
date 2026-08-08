"""Tests for the live view of a heat — issue #7, step one.

These cases previously had no test at all. The merge they cover ran in
``RaceExecution.tsx``'s render function, so the only way to exercise it was to
open the operator screen and race a heat. Written down here they take
microseconds, which is what makes the awkward ones — a re-run, a partial set of
lane times, a timer that knows a racer the schedule does not — worth stating.
"""

import pytest

from backend.domain import lanes as domain_lanes
from backend.domain.heat_session import (
    LiveLane,
    PendingLane,
    Phase,
    is_recorded,
    merge,
    phase,
)


def lane(number, racer_id=None, time=None, place=None, **flags):
    """A lane. A negative `racer_id` is an unadvanced championship slot.

    That is a fixture shorthand, not how `Lane` stores it (#164) — it carries
    the slot in its own field. Kept because it is compact and every test here
    already reads that way.
    """
    placeholder = -racer_id if racer_id is not None and racer_id < 0 else None
    return domain_lanes.Lane(
        lane=number,
        racer_id=None if placeholder is not None else racer_id,
        placeholder_slot=placeholder,
        time=time,
        place=place,
        skipped=bool(flags.get("skipped")),
    )


def schedule(*racer_ids):
    """A heat as generated: racers assigned, nothing run."""
    return [lane(i + 1, racer_id=rid) for i, rid in enumerate(racer_ids)]


# --------------------------------------------------------------------------- #
# is_recorded                                                                  #
# --------------------------------------------------------------------------- #


def test_a_scheduled_heat_is_not_recorded():
    assert is_recorded(schedule(10, 11)) is False


def test_one_time_is_enough():
    """A heat the timer reported partially and something persisted is not
    offered up to be raced again from scratch."""
    assert is_recorded([lane(1, 10, time=3.1), lane(2, 11)]) is True


def test_a_skipped_heat_counts_as_recorded():
    """The distinction from `lanes.has_results`, and the reason this function
    exists. The operator passed the heat over; the screen must not present it
    as still to run."""
    stored = [lane(1, 10, skipped=True), lane(2, 11, skipped=True)]

    assert domain_lanes.has_results(stored) is False
    assert is_recorded(stored) is True


def test_an_empty_heat_is_not_recorded():
    assert is_recorded([]) is False


def test_an_unreadable_time_still_counts_as_recorded():
    """Matches `lanes.has_results`, which asks whether the key is set rather
    than whether it parses. The value surfaces as None, so a heat with a corrupt
    time reads as run with nothing to show — which is what happened."""
    stored = [lane(1, 10, time="")]

    assert is_recorded(stored) is True
    assert merge(stored)[0].time_seconds is None


# --------------------------------------------------------------------------- #
# merge — the recorded case                                                    #
# --------------------------------------------------------------------------- #


def test_a_recorded_heat_shows_what_was_saved():
    stored = [lane(1, 10, time=3.412, place=2), lane(2, 11, time=3.310, place=1)]

    assert merge(stored) == [
        LiveLane(lane=1, racer_id=10, time_seconds=3.412, place=2),
        LiveLane(lane=2, racer_id=11, time_seconds=3.310, place=1),
    ]


def test_a_recorded_heat_ignores_the_timer():
    """The timer is behind, not the database.

    This is the case where being wrong is expensive: the heat has been raced
    and its results are saved, so a pending report belongs to a run that has
    already been superseded. Showing it would put a time on screen that
    disagrees with the standings.
    """
    stored = [lane(1, 10, time=3.412, place=1)]
    stale = [PendingLane(lane=1, time_seconds=9.999, place=4)]

    assert merge(stored, stale) == [
        LiveLane(lane=1, racer_id=10, time_seconds=3.412, place=1)
    ]


def test_a_string_time_comes_back_as_a_number():
    """The frontend has historically written `time` as a string. `Lane.seconds`
    is what normalizes it, and the live view must not leak the raw value."""
    assert merge([lane(1, 10, time="3.45")])[0].time_seconds == 3.45


def test_a_recorded_heat_carries_skipped():
    assert merge([lane(1, 10, skipped=True)]) == [
        LiveLane(lane=1, racer_id=10, skipped=True)
    ]


def test_a_placeholder_lane_reports_its_slot_not_a_negative_racer():
    """The negative-id encoding stops at this boundary (see #5)."""
    merged = merge([lane(1, -2, time=3.0)])

    assert merged[0].racer_id is None
    assert merged[0].placeholder_slot == 2


# --------------------------------------------------------------------------- #
# merge — the live case                                                        #
# --------------------------------------------------------------------------- #


def test_an_unrun_heat_shows_the_schedule_with_no_times():
    assert merge(schedule(10, 11)) == [
        LiveLane(lane=1, racer_id=10),
        LiveLane(lane=2, racer_id=11),
    ]


def test_pending_times_are_laid_over_the_schedule():
    merged = merge(
        schedule(10, 11),
        [PendingLane(lane=2, time_seconds=3.201, place=1)],
    )

    assert merged == [
        LiveLane(lane=1, racer_id=10),
        LiveLane(lane=2, racer_id=11, time_seconds=3.201, place=1, pending=True),
    ]


def test_a_partial_report_leaves_the_other_lanes_waiting():
    """Three lanes of four have finished. The fourth is still running, not
    empty and not a DNF — the screen has to be able to tell those apart."""
    merged = merge(
        schedule(10, 11, 12, 13),
        [
            PendingLane(lane=1, time_seconds=3.1, place=1),
            PendingLane(lane=2, time_seconds=3.2, place=2),
            PendingLane(lane=3, time_seconds=3.3, place=3),
        ],
    )

    assert [lane_.pending for lane_ in merged] == [True, True, True, False]
    assert merged[3] == LiveLane(lane=4, racer_id=13)


def test_a_re_run_clears_last_time_s_results():
    """The operator asked to race this heat again, so the timer was armed and
    the stored results were cleared. Until the new times land the lanes must
    show empty — a lingering old time next to a new one is unreadable."""
    stored = [lane(1, 10, time=3.4, place=1), lane(2, 11, time=3.5, place=2)]
    # `prepare_heat` clears the blob, which is what makes this the live branch.
    cleared = [lane(1, 10), lane(2, 11)]

    assert merge(cleared, [PendingLane(lane=1, time_seconds=3.9, place=2)]) == [
        LiveLane(lane=1, racer_id=10, time_seconds=3.9, place=2, pending=True),
        LiveLane(lane=2, racer_id=11),
    ]
    # And with the results still stored, nothing is cleared and nothing is live.
    assert all(not lane_.pending for lane_ in merge(stored))


def test_the_live_branch_clears_a_stale_place():
    """The clearing is observable through `place`, not `time`.

    A lane cannot reach this branch holding a time — `is_recorded` would have
    sent it to the other one — so `time=None` there is belt-and-braces. The
    place is the half that can actually be stale, and last heat's finishing
    order shown against this heat's blanks is worse than showing nothing.
    """
    assert merge([lane(1, 10, place=1), lane(2, 11, place=2)]) == [
        LiveLane(lane=1, racer_id=10),
        LiveLane(lane=2, racer_id=11),
    ]


def test_pending_lanes_are_flagged_as_unsaved():
    """`pending` is the whole point of the distinction: an abort still loses
    these, so the screen must not present them as final."""
    merged = merge(schedule(10), [PendingLane(lane=1, time_seconds=3.0, place=1)])

    assert merged[0].pending is True
    assert merge(schedule(10))[0].pending is False


# --------------------------------------------------------------------------- #
# merge — where a lane's racer comes from                                      #
# --------------------------------------------------------------------------- #


def test_the_timer_s_racer_wins():
    """It is the thing that knows which car went down which lane."""
    merged = merge(
        schedule(10),
        [PendingLane(lane=1, time_seconds=3.0, place=1, racer_id=99)],
        racer_by_lane={1: 50},
    )

    assert merged[0].racer_id == 99


def test_the_arming_mapping_is_the_second_choice():
    merged = merge(
        schedule(10),
        [PendingLane(lane=1, time_seconds=3.0, place=1)],
        racer_by_lane={1: 50},
    )

    assert merged[0].racer_id == 50


def test_the_schedule_is_the_fallback():
    merged = merge(schedule(10), [PendingLane(lane=1, time_seconds=3.0, place=1)])

    assert merged[0].racer_id == 10


def test_a_lane_the_schedule_does_not_know_still_appears():
    """A free race armed on more lanes than it assigned, or a timer reporting a
    lane that was left empty. Dropping the report would hide a car that
    physically ran."""
    merged = merge(
        schedule(10),
        [PendingLane(lane=2, time_seconds=3.0, place=1, racer_id=77)],
    )

    assert merged == [
        LiveLane(lane=1, racer_id=10),
        LiveLane(lane=2, racer_id=77, time_seconds=3.0, place=1, pending=True),
    ]


def test_an_unknown_lane_with_no_racer_anywhere_is_still_shown():
    merged = merge(schedule(10), [PendingLane(lane=2, time_seconds=3.0, place=2)])

    assert merged[1] == LiveLane(lane=2, time_seconds=3.0, place=2, pending=True)


def test_a_pending_lane_keeps_the_placeholder_slot_underneath_it():
    """Not a case that should arise — a heat with placeholders cannot be armed
    — but the slot is how the screen labels the lane, and losing it would
    relabel a running lane as empty."""
    merged = merge([lane(1, -1)], [PendingLane(lane=1, time_seconds=3.0, place=1)])

    assert merged[0].placeholder_slot == 1


def test_lanes_come_back_in_lane_order():
    """Order has to be imposed, not inherited: a lane the timer reports but the
    schedule does not hold gets appended, whatever its number."""
    merged = merge(
        [lane(2, 11), lane(3, 12)],
        [PendingLane(lane=1, time_seconds=3.1, place=1)],
    )

    assert [lane_.lane for lane_ in merged] == [1, 2, 3]


# --------------------------------------------------------------------------- #
# phase                                                                        #
# --------------------------------------------------------------------------- #


def test_no_heat_selected():
    assert phase(None) is Phase.NO_HEAT
    assert phase(None, timer_state="RUNNING") is Phase.NO_HEAT


def test_a_scheduled_heat_with_an_idle_timer_is_waiting():
    assert phase(schedule(10, 11), timer_state="IDLE") is Phase.WAITING
    assert phase(schedule(10, 11)) is Phase.WAITING


@pytest.mark.parametrize("state", ["RUNNING", "RESULTS_OVERDUE"])
def test_the_timer_being_under_way_means_running(state):
    """`RESULTS_OVERDUE` is the timer having seen a start and not every finish.
    To the operator that is still a heat in progress, not a fault."""
    assert phase(schedule(10, 11), timer_state=state) is Phase.RUNNING


@pytest.mark.parametrize("state", ["IDLE", "ARMED", "DISCONNECTED", "FAULT", None])
def test_other_timer_states_do_not_mean_running(state):
    assert phase(schedule(10, 11), timer_state=state) is Phase.WAITING


def test_a_heat_with_results_is_recorded():
    stored = [lane(1, 10, time=3.4, place=1), lane(2, 11, time=3.5, place=2)]

    assert phase(stored, timer_state="IDLE") is Phase.RECORDED


def test_a_skipped_heat_is_recorded():
    assert phase([lane(1, 10, skipped=True)]) is Phase.RECORDED


def test_recorded_outranks_running():
    """Same reasoning as the merge: saved results beat a timer that has not
    caught up."""
    stored = [lane(1, 10, time=3.4, place=1)]

    assert phase(stored, timer_state="RUNNING") is Phase.RECORDED


def test_an_undecided_championship_heat_is_not_ready():
    """It cannot be armed, so calling it WAITING would invite the operator to
    start something that will not start."""
    assert phase([lane(1, -1), lane(2, -2)]) is Phase.NOT_READY


def test_a_partly_decided_championship_heat_is_still_not_ready():
    assert phase([lane(1, 10), lane(2, -2)]) is Phase.NOT_READY


def test_not_ready_outranks_everything():
    stored = [lane(1, 10, time=3.4, place=1), lane(2, -2)]

    assert phase(stored, timer_state="RUNNING") is Phase.NOT_READY


def test_an_empty_lane_list_is_waiting_not_recorded():
    """A heat row with no lanes is malformed, but it has certainly not been
    raced — treating it as recorded would hide it behind a results screen."""
    assert phase([]) is Phase.WAITING
