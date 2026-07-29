"""The lane assignment/result value object, and the codec for the JSON blob.

``Heat.lane_results`` is a JSON string doing four jobs at once: it is the
schedule (who is in which lane), the results (time and place), the placeholder
list for unadvanced championship slots (negative racer ids), and the heat's
status (inferred by looking for a recorded time or a ``skipped`` flag).

This module is the only place that knows that. Everything else works with
:class:`Lane` objects. When issue #5 replaces the blob with a ``heat_lanes``
table, :func:`parse` and :func:`serialize` are what get replaced.

Round-tripping is lossless on purpose
-------------------------------------
The frontend writes keys the backend never reads — ``skipped`` is set by
``RaceExecution.tsx`` to mark a heat that was passed over rather than run. Any
key we do not model is carried in :attr:`Lane.extra` and re-emitted by
:func:`serialize`, so a parse/modify/serialize cycle (which is what advancement
does to every championship heat) cannot silently drop it.

``time`` is likewise stored as it was found. The frontend sometimes writes it as
a string, and rewriting ``"3.45"`` as ``3.45`` while resolving placeholders
would be an unannounced change to the user's stored race data. Use
:attr:`Lane.seconds` to get the numeric value.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

#: Keys :class:`Lane` models directly; everything else round-trips via ``extra``.
_KNOWN_KEYS = ("lane", "racer_id", "time", "place")

#: Keys carried in ``extra`` that the GraphQL write path now states explicitly.
#: :func:`carry_extras` must not restore these from the stored blob — an update
#: that omits ``skipped`` is saying the heat is no longer skipped.
_STRUCTURED_KEYS = ("skipped",)


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
    def is_placeholder(self) -> bool:
        """An unadvanced championship slot, encoded as a negative id."""
        return self.racer_id is not None and self.racer_id < 0

    @property
    def is_real_racer(self) -> bool:
        return self.racer_id is not None and self.racer_id > 0

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

    def to_dict(self) -> dict[str, Any]:
        """Back to the blob's shape, known keys first, then anything carried."""
        out: dict[str, Any] = {
            "lane": self.lane,
            "racer_id": self.racer_id,
            "time": self.time,
            "place": self.place,
        }
        out.update(self.extra)
        return out


def from_dict(raw: dict[str, Any]) -> Lane:
    return Lane(
        lane=raw.get("lane"),
        racer_id=raw.get("racer_id"),
        time=raw.get("time"),
        place=raw.get("place"),
        extra={k: v for k, v in raw.items() if k not in _KNOWN_KEYS},
    )


def parse(raw: str | None) -> list[Lane]:
    """Decode a ``lane_results`` blob.

    Returns ``[]`` for null, empty, or malformed input rather than raising.
    Callers throughout the codebase already treat "can't read it" as "no
    results" — a heat with a corrupt blob should show as unraced, not take down
    the audience display mid-event.
    """
    if not raw:
        return []
    try:
        decoded = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(decoded, list):
        return []
    return [from_dict(item) for item in decoded if isinstance(item, dict)]


def serialize(lanes: Iterable[Lane]) -> str:
    return json.dumps([lane.to_dict() for lane in lanes])


# --------------------------------------------------------------------------- #
# Heat-level predicates                                                        #
# --------------------------------------------------------------------------- #


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
    return [lane.racer_id for lane in lanes if lane.is_real_racer]


def carry_extras(updates: Sequence[Lane], stored: Sequence[Lane]) -> list[Lane]:
    """Return *updates* with each lane's unmodelled keys taken from *stored*.

    Structured input names every field this module models, so rebuilding a blob
    from it is lossless for everything we know about — but the blob has always
    carried keys we do not model, and a client that cannot see them cannot send
    them back. Matching on lane number keeps them.

    ``skipped`` is deliberately *not* carried: it is modelled now, so an update
    that omits it means the operator un-skipped the heat.
    """
    extras = {lane.lane: lane.extra for lane in stored}
    merged = []
    for update in updates:
        carried = {
            key: value
            for key, value in extras.get(update.lane, {}).items()
            if key not in update.extra and key not in _STRUCTURED_KEYS
        }
        merged.append(
            Lane(
                lane=update.lane,
                racer_id=update.racer_id,
                time=update.time,
                place=update.place,
                extra={**carried, **update.extra},
            )
        )
    return merged


def resolve_placeholders(lanes: Sequence[Lane], racer_ids: Sequence[int]) -> bool:
    """Replace placeholder slots with real racers, in place.

    Placeholder ``-1`` takes ``racer_ids[0]``, ``-2`` takes ``racer_ids[1]``,
    and so on. A placeholder with no corresponding entry is left alone, which is
    what happens when fewer racers advanced than the round has slots.

    Returns whether anything changed, so callers can skip a needless write.
    """
    modified = False
    for lane in lanes:
        if not lane.is_placeholder:
            continue
        index = abs(lane.racer_id) - 1
        if index < len(racer_ids):
            lane.racer_id = racer_ids[index]
            modified = True
    return modified
