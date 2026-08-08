"""Who won what (#170).

Every pack derby hands out awards, and until this the app could produce
standings and nothing else. The gap that mattered was not the speed trophies —
those fall out of the leaderboard — but the ones a person decides: Best Paint,
Most Original, Judges' Choice. There was nowhere to put them, so they lived on
paper and the app never knew.

An award is one name and one recipient. There are two kinds, and the difference
is *where the recipient comes from*:

``SPEED``
    The award names a **source**, not a winner. "Top of the prelim standings",
    "winner of the final", "fastest Wolf" — the recipient is computed, so it
    stays correct when a time is corrected after the award was defined. This is
    the same reasoning as #17: standings are computed on demand and never
    stored, and an award that snapshotted a racer id would be the first thing in
    the app to disagree with the leaderboard.

``SPECIAL``
    The award carries a racer chosen by a person, and no source. Nothing here
    can work out who painted the best car.

That split is the whole design. Everything else is a form and a list.

Nothing in this module touches a database. `services/awards.py` loads the
standings and calls :func:`recipient_of`.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from backend.domain.advancement import (
    PACK,
    ROUND_PREFIX,
    Standing,
    is_round_scoped,
    round_id_in,
)

__all__ = [
    "PACK",
    "ROUND_PREFIX",
    "SPECIAL",
    "SPEED",
    "SpeedRule",
    "recipient_of",
    "sources_for",
]

#: The two kinds of award. Values equal their names so they cross the GraphQL
#: boundary as plain strings, like the other enum-ish vocabulary here.
SPEED = "SPEED"
SPECIAL = "SPECIAL"


@dataclass(frozen=True)
class SpeedRule:
    """Which position in which standings an award is for.

    ``source`` is either ``"PACK"`` — the race's default prelim standings — or
    ``"ROUND:<id>"`` for one round's. It is the same vocabulary
    :class:`backend.domain.advancement.AdvancementRule` uses, parsed by the same
    functions, deliberately: an operator who has set up a championship round
    already knows what "ROUND:4" means.

    **``DEN`` is not a source here, and that is the one departure.** For
    advancement it means "the top N of *each* den", which yields a set of
    racers — right for filling a field, wrong for an award, which has exactly
    one recipient. A den-scoped award is instead an ordinary source with
    ``den_id`` set, so "fastest Wolf" is the pack standings narrowed to the
    Wolves. Six of them is six awards, which is also how they are presented.

    ``place`` is 1-based: 1 is the winner. Sub-1 places are refused rather than
    silently treated as 1, because `standings[place - 1]` with ``place = 0``
    would index from the end and hand the trophy to the slowest car.
    """

    source: str
    place: int
    den_id: int | None = None

    def __post_init__(self) -> None:
        if self.place < 1:
            raise ValueError(f"place is 1-based; got {self.place}")

    @property
    def is_round_scoped(self) -> bool:
        return is_round_scoped(self.source)

    @property
    def source_round_id(self) -> int | None:
        """The round this award reads, or ``None`` if it is not round-scoped."""
        return round_id_in(self.source)


def recipient_of(rule: SpeedRule, standings: Sequence[Standing]) -> int | None:
    """The racer holding this award's place, or ``None`` if nobody does yet.

    ``standings`` must already be sorted best-first and scoped to the rule's
    source; the caller does that, because which heats count is a database
    question. What is decided here is the narrowing and the position.

    ``None`` is the ordinary answer for most of an event, not an error: an award
    for third place has no recipient until three cars have run, and a den award
    has none until somebody in that den has. The presentation screen shows the
    award with no name against it, which is what the announcer is looking at
    anyway.
    """
    eligible = standings
    if rule.den_id is not None:
        eligible = [s for s in standings if s.den_id == rule.den_id]

    index = rule.place - 1
    if index >= len(eligible):
        return None
    return eligible[index].racer_id


def sources_for(round_ids: Sequence[int]) -> list[str]:
    """Every source string a race with these rounds can offer.

    The pack standings first, then one entry per round. Exists so the operator
    screen and the validation agree on what is offerable without either
    rebuilding the `ROUND:<id>` spelling.
    """
    return [PACK] + [f"{ROUND_PREFIX}{round_id}" for round_id in round_ids]
