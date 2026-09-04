"""At most one trophy per racer (#615).

The near-universal pack rule: a scout who wins the pack championship does not
also take home first in their den — the den trophy *rolls down* to the next
fastest car in the den, so more children leave holding something. Trusty
Track resolved every award in isolation, so the operator did this by hand,
scanning the list for a name appearing twice and working out who the trophy
should go to instead.

Two things about the shape of the rule, both of which fall out of the design
that already exists for awards (:mod:`backend.domain.awards`):

**Nothing is stored.** A speed award names a source and a place, never a
winner (#17's reasoning: a stored recipient is the first thing in the app able
to disagree with the leaderboard). A roll-down is the same — it is a way of
*reading* the standings, computed fresh on every read, so a corrected time
moves every trophy it should.

**The order is the whole problem, and it is stated here rather than falling
out of query order.** Who already holds a trophy depends on which awards were
resolved first, so the order has to be total, stable, and something an
operator can predict from what they can see. It is:

1. **Race-wide podiums before group-scoped ones.** The tradition's own
   statement: the pack champion's den trophy rolls down, never the reverse.
   Breadth is read off the rule alone — an award with no ``racing_group_id``
   is race-wide, whatever round it reads.
2. **Among podiums of the same breadth, the one presented later first.**
   A ceremony builds to the biggest trophy; the last award announced is the
   one nobody hands back. Presentation order (#170) is the operator's one
   existing control, so this adds no second one to keep in step with it.
3. **Within a podium, first place before second before third**, whatever
   order they are announced in — announcing third first is the normal way to
   build suspense, and resolving third *first* would hand it to the third
   fastest car, then roll first place past two cars that already held
   something.

A *podium* is one standings list read one way: the same ``source``, the same
``racing_group_id``, the same ``from_bottom``. Its places are one cascade,
which is why holders of awards on *other* podiums are removed from a podium's
candidates but holders on the same podium are not — filtering everyone would
make second place index past its own first-place winner into the wrong row.

**A judged award never displaces a speed trophy, and is never displaced.**
``SPECIAL`` awards carry a person's decision, and a computed rule does not
override a judge; nor can one roll — nobody knows who painted the
second-best car. They also do not *block*: judging usually finishes after
racing, and a Best Paint pick landing at four o'clock must not silently move
the pack trophy the operator read out at three. What the rule does instead is
*report* the collision (:attr:`Resolution.duplicate_of`) so the screen can
say "already holds Fastest Overall" and the operator can decide.

Every resolution carries its provenance — the position actually read and who
was passed over holding what — because an unexplained empty trophy reads as a
bug. That is what the screen turns into "Liam (2nd in Wolves; Jordan won Pack
Champion)".

Nothing here touches a database. ``services/awards.py`` loads the standings
each source names and calls :func:`resolve_awards`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import groupby

from backend.domain.advancement import Standing
from backend.domain.awards import SpeedRule, eligible_standings, recipient_of

__all__ = [
    "AwardEntry",
    "PassedOver",
    "Podium",
    "Resolution",
    "podium_of",
    "priority_order",
    "resolve_awards",
]


@dataclass(frozen=True)
class AwardEntry:
    """One award as the roll-down sees it.

    ``key`` identifies the award to the caller (its row id). ``rule`` is the
    speed rule, or ``None`` for a judged award — or for a speed row that
    cannot be resolved, which the service already maps to no rule and which
    resolves to nobody here exactly as it does in isolation. ``chosen_racer_id``
    is a judged award's person-picked recipient.

    Entries are given in **presentation order**; the sequence position is the
    tiebreak this module reads, so a caller must not sort them any other way.
    """

    key: int
    rule: SpeedRule | None = None
    chosen_racer_id: int | None = None


@dataclass(frozen=True)
class Podium:
    """One standings list read one way — the unit the roll-down cascades over."""

    source: str
    racing_group_id: int | None
    from_bottom: bool

    @property
    def is_race_wide(self) -> bool:
        return self.racing_group_id is None


@dataclass(frozen=True)
class PassedOver:
    """A racer ranked above an award's recipient who already held ``award_key``."""

    racer_id: int
    award_key: int


@dataclass(frozen=True)
class Resolution:
    """Who an award went to, and why it went there.

    ``position`` is the 1-based row the recipient held in the award's own
    narrowed standings — equal to the rule's ``place`` when nothing rolled,
    larger when it did. ``passed_over`` names every racer above that row who
    already held a trophy on another podium, best-first, so the screen can say
    who caused the roll. Both are empty for an award with no recipient and for
    a judged award.

    ``duplicate_of`` is set on a **judged** award only: the award its chosen
    racer already holds. The judged award keeps its racer regardless — see the
    module docstring — this is the signal for the screen to say so.
    """

    recipient: int | None
    position: int | None = None
    passed_over: tuple[PassedOver, ...] = ()
    duplicate_of: int | None = None


def podium_of(rule: SpeedRule) -> Podium:
    return Podium(rule.source, rule.racing_group_id, rule.from_bottom)


def priority_order(entries: Sequence[AwardEntry]) -> list[AwardEntry]:
    """The speed awards among ``entries``, in the order they are resolved.

    Total and stable: every speed award lands on exactly one podium; podiums
    sort on ``(group-scoped, -last presentation index)``, which is unique per
    podium since two podiums cannot share an award; and within a podium the
    key is ``(place, presentation index)``, unique per award. Nothing here
    depends on dictionary order or on how the caller loaded the rows beyond
    the presentation order they arrived in.

    Exposed on its own so the order can be pinned by a test that reads no
    standings — the order is the design, and it deserves a test of its own.
    """
    speed = [(i, e) for i, e in enumerate(entries) if e.rule is not None]

    last_presented: dict[Podium, int] = {}
    for i, entry in speed:
        assert entry.rule is not None
        last_presented[podium_of(entry.rule)] = i

    def podium_key(podium: Podium) -> tuple[bool, int]:
        return (not podium.is_race_wide, -last_presented[podium])

    def award_key(item: tuple[int, AwardEntry]) -> tuple[tuple[bool, int], int, int]:
        i, entry = item
        assert entry.rule is not None
        return (podium_key(podium_of(entry.rule)), entry.rule.place, i)

    return [entry for _, entry in sorted(speed, key=award_key)]


def resolve_awards(
    entries: Sequence[AwardEntry],
    standings_by_source: Mapping[str, Sequence[Standing]],
    *,
    one_trophy_per_racer: bool,
) -> dict[int, Resolution]:
    """``{award key: Resolution}`` for every entry.

    With ``one_trophy_per_racer`` off this is :func:`awards.recipient_of` per
    award and a judged award's chosen racer, with no provenance — byte for
    byte what every race resolved to before this rule existed, which is what
    lets the service have one code path.

    With it on, speed awards are resolved in :func:`priority_order`, each
    podium's candidates being its narrowed standings less every racer holding
    a trophy on another podium; then judged awards are visited in presentation
    order, keeping their racer and reporting a collision. A missing source in
    ``standings_by_source`` reads as empty standings, so the award goes to
    nobody rather than raising — the ordinary state, not an error.
    """
    if not one_trophy_per_racer:
        return {
            e.key: Resolution(
                recipient=(
                    e.chosen_racer_id
                    if e.rule is None
                    else recipient_of(
                        e.rule, standings_by_source.get(e.rule.source, ())
                    )
                ),
                position=None if e.rule is None else e.rule.place,
            )
            for e in entries
        }

    holders: dict[int, int] = {}  # racer_id -> award key
    resolved: dict[int, Resolution] = {}

    def podium_of_entry(entry: AwardEntry) -> Podium:
        assert entry.rule is not None
        return podium_of(entry.rule)

    # `priority_order` is podium-major, so each podium's awards are contiguous.
    for podium, group in groupby(priority_order(entries), key=podium_of_entry):
        on_podium = list(group)
        first = on_podium[0]
        assert first.rule is not None

        eligible = eligible_standings(
            first.rule, standings_by_source.get(podium.source, ())
        )
        # Holders at this point all hold trophies on earlier podiums — this
        # podium's own winners are added below, and are deliberately not
        # removed from the candidates: its places are one cascade.
        candidates = [
            (row, s) for row, s in enumerate(eligible) if s.racer_id not in holders
        ]
        above: list[tuple[int, PassedOver]] = [
            (row, PassedOver(s.racer_id, holders[s.racer_id]))
            for row, s in enumerate(eligible)
            if s.racer_id in holders
        ]

        taken: set[int] = set()
        for entry in on_podium:
            assert entry.rule is not None
            pick = next(
                (
                    (row, s)
                    for row, s in candidates[entry.rule.place - 1 :]
                    if s.racer_id not in taken
                ),
                None,
            )
            if pick is None:
                resolved[entry.key] = Resolution(recipient=None)
                continue
            row, standing = pick
            taken.add(standing.racer_id)
            holders[standing.racer_id] = entry.key
            resolved[entry.key] = Resolution(
                recipient=standing.racer_id,
                position=row + 1,
                passed_over=tuple(p for r, p in above if r < row),
            )

    for entry in entries:
        if entry.rule is not None:
            continue
        racer = entry.chosen_racer_id
        if racer is None:
            resolved[entry.key] = Resolution(recipient=None)
            continue
        duplicate_of = holders.get(racer)
        if duplicate_of is None:
            holders[racer] = entry.key
        resolved[entry.key] = Resolution(recipient=racer, duplicate_of=duplicate_of)

    return resolved
