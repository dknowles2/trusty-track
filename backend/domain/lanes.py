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

Two of the blob's conventions outlived it, and are deliberately still here:

* an unadvanced slot is held as a *negative* ``racer_id``, read back through
  :attr:`Lane.placeholder_slot`. ``heat_lanes`` has a real column for it, and
  :func:`from_parts` re-encodes on the way in;
* ``skipped`` lives in :attr:`Lane.extra` rather than being a field.

Both are storage conventions with no storage left to justify them, and both are
reachable only through the accessors, so nothing outside this module repeats
them. Straightening them out is a change to this file and its constructors, and
is worth doing separately from the migration that made it possible.

``time`` is stored as it was found. ``heat_lanes.time_seconds`` is a float, so
a string can no longer be *persisted*, but the field is still :class:`Any` and
:attr:`Lane.seconds` is the coercion every reader goes through.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Lane:
    """One lane of one heat: an assignment, and possibly a result."""

    lane: int
    racer_id: int | None = None
    time: Any = None
    place: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        """No racer assigned — a short heat's unused lane."""
        return self.racer_id is None

    @property
    def placeholder_slot(self) -> int | None:
        """Which championship slot this lane holds, 1-based, or ``None``.

        The blob encodes an unadvanced slot as a *negative* racer id, so slot 1
        is ``-1``. Returning the slot rather than a bool is what lets callers
        use it without repeating the sign convention — and what lets a type
        checker see that a placeholder lane has an id at all.
        """
        racer_id = self.racer_id
        if racer_id is None or racer_id >= 0:
            return None
        return -racer_id

    @property
    def is_placeholder(self) -> bool:
        """An unadvanced championship slot, encoded as a negative id."""
        return self.placeholder_slot is not None

    @property
    def real_racer_id(self) -> int | None:
        """The racer in this lane — ``None`` if it is empty or a placeholder."""
        racer_id = self.racer_id
        return racer_id if racer_id is not None and racer_id > 0 else None

    @property
    def is_real_racer(self) -> bool:
        return self.real_racer_id is not None

    @property
    def has_result(self) -> bool:
        return self.time is not None

    @property
    def skipped(self) -> bool:
        """Set by the operator UI when a heat is passed over rather than run."""
        return bool(self.extra.get("skipped"))

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
    entry point now that the table is where lanes come from. Scalars rather
    than a row object, so this module still imports no SQLAlchemy.

    It has to *re-encode* the placeholder slot as a negative racer id, and put
    ``skipped`` back into ``extra``, because that is what :class:`Lane` still
    holds. Both are the blob's conventions outliving the blob; retiring the
    column is what lets the dataclass carry the slot directly and this function
    lose half its body.
    """
    if placeholder_slot is not None:
        racer_id = -placeholder_slot
    return Lane(
        lane=lane,
        racer_id=racer_id,
        time=time_seconds,
        place=place,
        extra={"skipped": True} if skipped else {},
    )


def has_results(lanes: Sequence[Lane]) -> bool:
    """True if any lane has a recorded time.

    This is the check that guards regeneration: a round that has been raced must
    not be silently rebuilt underneath the operator.

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
    """True if every assigned lane holds a real racer with a recorded time.

    A placeholder counts as incomplete even if it somehow has a time: the heat
    cannot be finished by a racer who has not been decided yet.
    """
    if not lanes:
        return False
    for lane in lanes:
        if lane.is_empty:
            continue
        if lane.time is None:
            return False
        if lane.is_placeholder:
            return False
    return True


def real_racer_ids(lanes: Iterable[Lane]) -> list[int]:
    """Assigned, non-placeholder racer ids, in lane order."""
    return [racer_id for lane in lanes if (racer_id := lane.real_racer_id) is not None]


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
            modified = True
    return modified
