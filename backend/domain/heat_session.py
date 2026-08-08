"""What is happening on the track right now.

Issue #7. Three things knew part of the answer and nothing owned putting them
together:

===========================  ==================================================
``heats.lane_results``       the schedule, and results once they are persisted
``TimerManager``             live lane times that have arrived but not landed
``RaceExecution.tsx``        what the operator is looking at
===========================  ==================================================

The merge happened in a React render function — the most safety-critical rule in
the app, recomputed on every render, in the browser, untested. This module is
that rule, as plain functions over plain values.

Pure on purpose
---------------
Like the rest of ``backend/domain``, this imports no SQLAlchemy and no
Strawberry. The caller loads the heat, asks the timer for its pending results,
and passes both in. That is what lets the interesting cases — a heat that was
raced and is being re-run, a timer that reported three lanes of four, a lane
whose racer the timer knows but the schedule does not — be tested by writing
them down rather than by staging them.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import Enum

from backend.domain import lanes as domain_lanes

#: Timer states that mean a heat is under way. ``RESULTS_OVERDUE`` is the timer
#: having seen a start and not yet all the finishes — from the operator's point
#: of view the heat is still running.
_RUNNING_STATES = frozenset({"RUNNING", "RESULTS_OVERDUE"})


def is_recorded(stored: Sequence[domain_lanes.Lane]) -> bool:
    """Whether this heat is done with — raced, or passed over.

    Deliberately *not* :func:`domain.lanes.has_results`, which ignores
    ``skipped`` because it guards regeneration and a skipped round may still be
    rebuilt. Here a skipped heat is finished: the operator said so, and the
    screen must not offer to run it again as though nothing had happened.
    """
    return any(lane.time is not None or lane.skipped for lane in stored)


class Phase(str, Enum):
    """Where this track is in running a heat.

    Deliberately *not* the timer's state, which is about the device
    (``DISCONNECTED``, ``ARMED``, ``FAULT``…). This is about the event, and it
    is what the operator screen renders from.
    """

    #: Nothing selected.
    NO_HEAT = "NO_HEAT"
    #: A championship heat whose racers have not been decided yet.
    NOT_READY = "NOT_READY"
    #: Selected, nothing recorded, timer not running.
    WAITING = "WAITING"
    #: Under way. Lane times may be arriving.
    RUNNING = "RUNNING"
    #: Raced, or passed over. Results are persisted.
    RECORDED = "RECORDED"


@dataclass(frozen=True)
class PendingLane:
    """A lane time the timer has reported but nothing has persisted yet."""

    lane: int
    time_seconds: float | None = None
    place: int | None = None
    racer_id: int | None = None


@dataclass(frozen=True)
class LiveLane:
    """One lane as it should appear on screen right now.

    ``pending`` says the time came from the timer and is not in the database.
    The operator needs that distinction: an unsaved time can still be lost by
    an abort, and the screen should not imply otherwise.
    """

    lane: int
    racer_id: int | None = None
    placeholder_slot: int | None = None
    time_seconds: float | None = None
    place: int | None = None
    skipped: bool = False
    pending: bool = False


def merge(
    stored: Sequence[domain_lanes.Lane],
    pending: Sequence[PendingLane] = (),
    racer_by_lane: Mapping[int, int | None] | None = None,
) -> list[LiveLane]:
    """The authoritative lane view: the schedule, plus whatever is live.

    Once a heat is recorded the stored lanes *are* the answer and the timer is
    ignored — anything still pending belongs to a run that has already been
    superseded, and showing it would contradict the saved result.

    Until then the schedule is shown with its times cleared, and the timer's
    reports are laid over it. Clearing matters for a re-run: the operator has
    asked to race the heat again, so last time's times must not linger while
    this time's arrive.

    A lane's racer is taken from the timer if it named one, then from the
    mapping the timer was armed with, then from the schedule. The timer is
    preferred because it is the one that knows which car actually went down
    which lane.
    """
    stored_lanes = list(stored)
    if is_recorded(stored_lanes):
        return [_from_stored(lane) for lane in stored_lanes]

    by_lane: dict[int, LiveLane] = {
        lane.lane: _from_stored(lane, clear_results=True) for lane in stored_lanes
    }
    mapping = racer_by_lane or {}

    for report in pending:
        existing = by_lane.get(report.lane)
        by_lane[report.lane] = LiveLane(
            lane=report.lane,
            racer_id=(
                report.racer_id
                or mapping.get(report.lane)
                or (existing.racer_id if existing else None)
            ),
            placeholder_slot=existing.placeholder_slot if existing else None,
            time_seconds=report.time_seconds,
            place=report.place,
            skipped=False,
            pending=True,
        )

    return sorted(by_lane.values(), key=lambda lane: lane.lane)


def _from_stored(lane: domain_lanes.Lane, clear_results: bool = False) -> LiveLane:
    racer_id = lane.racer_id
    slot = lane.placeholder_slot
    return LiveLane(
        lane=lane.lane,
        racer_id=racer_id,
        placeholder_slot=slot,
        time_seconds=None if clear_results else lane.seconds,
        place=None if clear_results else lane.place,
        # Carried either way. Nothing reaches the clearing branch with a
        # skipped lane — `is_recorded` counts those — but dropping a field
        # because it "cannot" be set is how it comes back to bite.
        skipped=lane.skipped,
    )


def phase(
    stored: Sequence[domain_lanes.Lane] | None,
    timer_state: str | None = None,
) -> Phase:
    """Where the track is, given the heat and the timer.

    ``stored`` is None when no heat is selected. Order matters:

    - **NOT_READY** outranks everything. A heat with undecided championship
      slots cannot be armed, so saying "waiting" would invite the operator to
      start something that will not start.
    - **RECORDED** outranks RUNNING. If the results are saved and the timer is
      still reporting, the timer is behind, not the database.
    """
    if stored is None:
        return Phase.NO_HEAT
    stored_lanes = list(stored)
    if any(lane.is_placeholder for lane in stored_lanes):
        return Phase.NOT_READY
    if is_recorded(stored_lanes):
        return Phase.RECORDED
    if timer_state in _RUNNING_STATES:
        return Phase.RUNNING
    return Phase.WAITING
