"""The lane assignment/result value object.

:class:`Lane` is what the domain layer passes around — scheduling, scoring,
advancement and ``heat_session`` all take parsed lanes — and what
``crud.set_heat_lanes`` stores. It carries who is in a lane, their time and
place, and whether the lane is an unadvanced championship slot.

This module used to be the codec for ``Heat.lane_results`` as well: a JSON
string doing four jobs at once, and the only place that knew it. #72 finished
replacing that with the ``heat_lanes`` table, so ``parse``, ``serialize``,
``from_dict``, ``to_dict`` and ``carry_extras`` are gone. What is left is the
value and the predicates over it.

Two of the blob's conventions outlived it and are now gone too (#164). An
unadvanced championship slot was a *negative* ``racer_id`` — slot 1 was ``-1`` —
and ``skipped`` lived in an ``extra`` dict, because a blob could carry keys
nothing modelled. Both are fields now, and ``extra`` is gone: ``heat_lanes`` has
a column for everything, and ``HeatLaneInput`` is typed, so no unknown key can
arrive.

One consequence worth stating, because it is the trap in that change:
:attr:`Lane.is_empty` asks about *both* fields. A placeholder used to hold a
negative id, so it was never "empty"; with the id now ``None`` it would be,
and :func:`is_complete` would skip it and call a round of undecided slots
finished.

``time`` is stored as it was found. ``heat_lanes.time_seconds`` is a float, so
a string can no longer be *persisted*, but the field is still :class:`Any` and
:attr:`Lane.seconds` is the coercion every reader goes through.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass
class Lane:
    """One lane of one heat: an assignment, and possibly a result."""

    lane: int
    #: The racer in this lane. ``None`` for an unused lane *and* for a
    #: championship slot nobody has advanced into yet — see
    #: :attr:`placeholder_slot`, which is what tells those two apart.
    racer_id: int | None = None
    #: Which championship slot this lane holds, 1-based, or ``None``.
    placeholder_slot: int | None = None
    time: Any = None
    place: int | None = None
    #: Set by the operator UI when a heat is passed over rather than run.
    skipped: bool = False

    @property
    def is_empty(self) -> bool:
        """No racer and no slot — a short heat's unused lane.

        Both fields, deliberately. An unadvanced slot has no ``racer_id`` and is
        emphatically not an unused lane: :func:`is_complete` skips empty lanes,
        so calling one empty would let a round of undecided slots read as
        finished.
        """
        return self.racer_id is None and self.placeholder_slot is None

    @property
    def is_placeholder(self) -> bool:
        """An unadvanced championship slot."""
        return self.placeholder_slot is not None

    @property
    def has_result(self) -> bool:
        """This lane holds a result — a time, or a hand-entered place.

        Historically a lane never held a ``place`` without a ``time``: every
        writer that set one set both, because the only way a place ever got
        there was :func:`backend.domain.scoring` deriving it from a time.
        Issue #490 adds the first exception — a ``POINTS`` race entered by
        hand through the Override/Edit modal writes a place with no time at
        all, because there is nothing to time. That is a result too, so this
        broadened to match rather than leaving every caller that asks "has
        this lane been decided" — :func:`has_results`, :func:`is_finished`,
        ``heat_session.is_recorded`` — blind to it. Data recorded before
        #490 never had a place without a time, so this changes nothing for
        it.
        """
        return self.time is not None or self.place is not None

    @property
    def seconds(self) -> float | None:
        """``time`` as a number, or ``None`` if it is absent or unparseable.

        Does not apply the DNF penalty — that is a scoring decision and lives in
        :mod:`backend.domain.scoring`.
        """
        if self.time is None:
            return None
        try:
            return float(self.time)
        except (TypeError, ValueError):
            return None


def from_parts(
    *,
    lane: int,
    racer_id: int | None,
    placeholder_slot: int | None,
    time_seconds: float | None,
    place: int | None,
    skipped: bool,
) -> Lane:
    """A lane from the columns ``heat_lanes`` stores it in (#72).

    The inverse of the projection in ``db/lane_sync.py``, and the read path's
    entry point. Scalars rather than a row object, so this module still imports
    no SQLAlchemy — that is the whole reason it exists now that the fields line
    up one for one.
    """
    return Lane(
        lane=lane,
        racer_id=racer_id,
        placeholder_slot=placeholder_slot,
        time=time_seconds,
        place=place,
        skipped=skipped,
    )


def from_participant(lane: int, participant_id: int | None) -> Lane:
    """A scheduled lane, from the id the scheduler deals in.

    :mod:`backend.domain.scheduling` matches *opaque* ids — it neither knows
    nor cares whether one is a racer — and its ``placeholder_ids`` hands it
    negative ones for championship slots nobody has advanced into yet.
    That is the scheduler's vocabulary, and it is a good one: teaching a matching
    algorithm about advancement would be worse than translating at its edge.

    This is that edge, and the only place on the write path that knows a
    negative participant id means a slot (#164).
    """
    if participant_id is not None and participant_id < 0:
        return Lane(lane=lane, placeholder_slot=-participant_id)
    return Lane(lane=lane, racer_id=participant_id)


def has_results(lanes: Sequence[Lane]) -> bool:
    """True if any lane has a recorded result — a time, or a hand-entered place.

    This is the check that guards regeneration: a round that has been raced must
    not be silently rebuilt underneath the operator. A ``POINTS`` round entered
    by hand (#490) has no times at all, and still must not be rebuildable.

    Note it does **not** consider :attr:`Lane.skipped` — see :func:`is_finished`
    for the predicate that does. Making this one stricter would change when
    regeneration is refused: a skipped round holds no times, so there is nothing
    to lose by rebuilding it.
    """
    return any(lane.has_result for lane in lanes)


def is_finished(lanes: Sequence[Lane]) -> bool:
    """True if the race is done with this heat — raced, or passed over.

    The counterpart to :func:`has_results`, and the difference between them is
    the point. ``has_results`` asks "would rebuilding this lose a result", which
    is a question about the stored record. This asks "should the displays move
    on", which is a question about the running order: an operator who skipped a
    heat is not coming back to it.

    Matches ``hasRun`` in ``features/racing/lanes.ts``. Anything deciding what
    is on the track or what is next wants this one; #55 is what happens when it
    settles for the other.
    """
    return any(lane.has_result or lane.skipped for lane in lanes)


def is_complete(lanes: Sequence[Lane]) -> bool:
    """True if every assigned lane is *settled* — a time, a place, or skipped.

    This is the predicate behind ``is_round_complete``, which is what decides
    when championship advancement fires, so what counts as settled matters
    (#224). It used to demand a time on every lane, which was wrong twice over:

    * A **skipped** heat has no times, so one skip left its round incomplete
      forever — the automatic advancement never fired and ``advancementStatus``
      reported not-ready with no way to learn why. An operator who skipped a
      heat is not coming back to it; the round is as decided as it will ever be.
    * A **place without a time** is how a ``POINTS`` race is entered by hand.
      ``advancementStatus`` grew a private copy of this rule to accept that,
      which meant the operator screen said ready while the trigger reading
      *this* function never fired. One rule, two copies, two answers — the #48
      shape. The copy is gone; this is the rule.

    A placeholder counts as incomplete even if it somehow has a time: the heat
    cannot be finished by a racer who has not been decided yet.
    """
    if not lanes:
        return False
    for lane in lanes:
        if lane.is_empty:
            continue
        if lane.is_placeholder:
            return False
        if lane.time is None and lane.place is None and not lane.skipped:
            return False
    return True


def real_racer_ids(lanes: Iterable[Lane]) -> list[int]:
    """Assigned racer ids, in lane order.

    Still worth a name: it is dense, so it drops unused lanes and undecided
    slots rather than yielding ``None`` for them.
    """
    return [lane.racer_id for lane in lanes if lane.racer_id is not None]


def duplicate_lane_numbers(lanes: Sequence[Lane]) -> list[int]:
    """Lane numbers claimed by more than one row, each named once.

    A replacement lane set is a client's whole description of a heat
    (:func:`backend.db.crud.validate_lane_replacement`); two rows both
    claiming lane 1 is not a heat, it is two heats squashed into one payload,
    and storing it silently drops one of them. Named in the order they first
    repeat, so the error can point at the first offender rather than an
    unordered set.
    """
    seen: set[int] = set()
    dupes: list[int] = []
    for lane in lanes:
        if lane.lane in seen:
            if lane.lane not in dupes:
                dupes.append(lane.lane)
        else:
            seen.add(lane.lane)
    return dupes


def resolve_placeholders(lanes: Sequence[Lane], racer_ids: Sequence[int]) -> bool:
    """Replace placeholder slots with real racers, in place.

    Placeholder ``-1`` takes ``racer_ids[0]``, ``-2`` takes ``racer_ids[1]``,
    and so on. A placeholder with no corresponding entry is left alone, which is
    what happens when fewer racers advanced than the round has slots.

    Returns whether anything changed, so callers can skip a needless write.
    """
    modified = False
    for lane in lanes:
        slot = lane.placeholder_slot
        if slot is None:
            continue
        index = slot - 1
        if index < len(racer_ids):
            lane.racer_id = racer_ids[index]
            # Clearing this is not tidying. While a slot was a negative id,
            # writing the racer over it *was* the clear; with two fields, a lane
            # that keeps its slot stays a placeholder however real its racer is,
            # and `phase` reports NOT_READY for a round that is ready to run.
            lane.placeholder_slot = None
            modified = True
    return modified
