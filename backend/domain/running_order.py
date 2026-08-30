"""Master running order: one interleaved sequence of heats across racing groups.

A pack running several dens normally runs each den's round as its own block —
Lions, then Tigers, then Wolves — and the track sits empty between blocks
while the next den's cars are collected and staged. A *master running order*
interleaves the heats of several already-scheduled rounds into one sequence,
so heat 2 can be a Tiger heat while the Lions are still queuing for heat 3.

This module does not schedule anything. Every heat here is a heat some other
generator (PPC, balanced, elimination) already produced, in the order that
generator wants it run — this module only decides which heat lands at which
*position* in the combined sequence. That position is `Heat.heat_number`,
written through the same `reorderHeats` path an operator already uses to drag
a heat by hand — a master order is a view over heats that already exist, not
a new kind of round.

Two properties, and they are sometimes in tension:

* **Proportional pacing.** A den of four and a den of twelve interleaved
  turn-for-turn exhausts the four-den after a quarter of the schedule,
  leaving the remaining three-quarters entirely to the twelve-den — the same
  "one den waits on another" problem this feature exists to fix, just moved
  later rather than solved. :func:`interleave` weights each group by its
  total heat count and uses the "smooth weighted round-robin" credit scheme
  (the one nginx uses for upstream selection) to spend that weight: every
  still-active group's credit grows by its own weight every round; the group
  with the highest credit is picked, its credit is then charged the sum of
  every active group's weight, and a group that has run out of heats simply
  drops out of the running. The credit a group has not yet spent is exactly
  what "heats it has left, proportionally" means in this scheme, and the
  effect is that every group's *share* of the sequence stays close to its
  size throughout, not merely on average by the end.
* **No car twice in a row.** A car that just raced should not be staged again
  immediately — the whole point of interleaving is giving the crew that just
  ran a moment before their next heat, not handing them straight back to the
  line. At each pick, a candidate whose heat does not repeat a car from the
  previous heat is preferred over the highest-credit one; the highest-credit
  candidate is used only when no other active group can avoid the repeat.

  This is genuinely best-effort, not a guarantee, and there are two ways it
  can be unavoidable. If only one group still has heats left, there is
  nothing to interleave with, and a repeat already present in that group's
  own order (PPC does not promise no *consecutive* meeting either — see
  `docs/scheduling-algorithms.md`) passes through unchanged: this module
  never reorders within a group. And two groups whose racers never overlap —
  the ordinary case, since a den's racers are its own — satisfy the rule
  trivially no matter what the credits say: no heat from group A can ever
  repeat a car from group B's previous heat.

No storage, no GraphQL, and no callers yet. `crud` will read a race's rounds,
build a :class:`GroupSchedule` per round from its heats, and write the
returned order back through `heat_number`.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Generic, TypeVar

H = TypeVar("H")


@dataclass(frozen=True)
class HeatEntry(Generic[H]):
    """One heat: an opaque handle, plus which racers it holds.

    ``handle`` is whatever the caller wants back out of :func:`interleave` —
    a heat id, typically. This module never looks inside it; only
    ``racer_ids`` decides anything.
    """

    handle: H
    racer_ids: frozenset[int]


@dataclass(frozen=True)
class GroupSchedule(Generic[H]):
    """One group's heats, in the order that group already runs them.

    ``group_id`` need not mean anything outside this call. It only breaks
    ties between groups whose credit (see :func:`interleave`) comes out
    exactly equal, which keeps the result deterministic for the same input
    rather than depending on dict iteration order.
    """

    group_id: int
    heats: Sequence[HeatEntry[H]]


def interleave(groups: Sequence[GroupSchedule[H]]) -> list[H]:
    """One master order across every group's heats. See the module docstring.

    Every heat in every group appears exactly once, and a group's own heats
    keep their relative order — this only decides how the groups' sequences
    are woven together, never reorders within one. A group with no heats
    contributes nothing and needs no special handling from the caller.
    """
    active = [g for g in groups if g.heats]
    if not active:
        return []

    weights = {g.group_id: len(g.heats) for g in active}
    positions = {g.group_id: 0 for g in active}
    credits = {g.group_id: 0 for g in active}
    by_id = {g.group_id: g for g in active}
    remaining = set(by_id)

    order: list[H] = []
    previous_racers: frozenset[int] = frozenset()

    while remaining:
        for group_id in remaining:
            credits[group_id] += weights[group_id]

        # Highest credit first; group_id only breaks an exact tie, which is
        # what keeps the result reproducible without meaning anything on its
        # own — callers are free to number groups however they like.
        ranked = sorted(remaining, key=lambda g: (-credits[g], g))

        chosen = ranked[0]
        for group_id in ranked:
            entry = by_id[group_id].heats[positions[group_id]]
            if not (previous_racers & entry.racer_ids):
                chosen = group_id
                break

        entry = by_id[chosen].heats[positions[chosen]]
        order.append(entry.handle)
        previous_racers = entry.racer_ids
        positions[chosen] += 1
        # Charged the sum of every *active* group's weight, `chosen`
        # included — the standard smooth-WRR debit, which is what keeps a
        # heavy group from being picked over and over before a lighter one
        # gets its next turn.
        credits[chosen] -= sum(weights[g] for g in remaining)

        if positions[chosen] == len(by_id[chosen].heats):
            remaining.discard(chosen)

    return order
