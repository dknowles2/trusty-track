"""Whether a race's schedule has been run yet — for Home's per-race badge (#847).

Three words, rolled up from every *official* heat in the race (``models.
official_heats``): a free-race exhibition run decides nothing and a run-off
only settles one tie, so neither belongs to the question "is this race done".

**Reuses ``domain.lanes.is_finished``, not a fourth predicate.** This module
asks the same question every other "should the running order move on" caller
in the codebase asks of one heat, and then rolls the answer up across a whole
race:

* ``has_results`` is wrong here — it does not count a skipped heat, so a race
  finished entirely through skips would read "not started" forever.
* ``is_complete`` is wrong here too, for the opposite reason: it is the
  predicate behind advancement eligibility, and treats an unfilled
  championship placeholder as unsettled. A general round never has
  placeholders, so the two agree there, but a fully-raced championship round
  with, say, an odd field size that leaves a slot forever empty would make
  ``is_complete`` refuse to call a race "finished" over a question this badge
  is not asking.
* ``is_finished`` is the one this module wants: "raced, or passed over" is
  exactly "is the operator coming back to this heat", which is exactly what
  a race-level finished/in-progress/not-started badge is describing, heat by
  heat.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from backend.domain.lanes import Lane, is_finished

#: No official heat has been generated, or none of the generated ones has
#: been raced or skipped yet. Deliberately one word for both: an operator
#: scanning Home wants to know whether racing has begun, and "a schedule
#: exists with nothing recorded on it" is not an actionable difference from
#: "no schedule exists at all" — both mean the same next step, generate or
#: run the schedule.
NOT_STARTED = "NOT_STARTED"
#: At least one official heat is finished and at least one is not.
IN_PROGRESS = "IN_PROGRESS"
#: Every official heat the race has is finished — raced, or skipped.
FINISHED = "FINISHED"


def status_of(heats: Iterable[Sequence[Lane]]) -> str:
    """Roll a race's official heats into ``NOT_STARTED``/``IN_PROGRESS``/``FINISHED``.

    ``heats`` is one lane sequence per official heat — the caller's own
    concern is fetching those (see ``RequestLoaders.prime_race_status``,
    which does it in a fixed number of queries regardless of how many races
    or heats are involved); this function knows nothing about the database.

    A race with no heats at all takes the same branch as a race whose heats
    are all unfinished, since ``total == 0`` never reaches ``finished >=
    total`` before the ``finished == 0`` check below short-circuits it.
    """
    total = 0
    finished = 0
    for lanes in heats:
        total += 1
        if is_finished(lanes):
            finished += 1
    if finished == 0:
        return NOT_STARTED
    if finished >= total:
        return FINISHED
    return IN_PROGRESS
