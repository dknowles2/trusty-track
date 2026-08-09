"""Admitting a racer who arrives after the racing has started (#172).

``may_rebuild`` refuses to regenerate a round once any heat in it holds a
result, and that guard is right — rebuilding would discard times people ran.
But it left no path at all for a child who turns up at 9:15, which is an
ordinary race morning rather than an edge case. They sat in the roster, in no
heat, and nothing on screen said why.

The rule here is the same shape as a lane going out of service (#171), because
it is the same problem approached from the other side: something changed about
a round that is already part-way through, and the recorded heats must survive
it. Three cases, decided by what has already been run:

* **Nothing raced** — regenerate the round with the newcomer in it. Everybody
  gets an equal schedule and no result is at risk, because there is none. That
  case never reaches this module; ``crud`` handles it with the ordinary
  generator.
* **Part-way through** — append heats, which is what this module plans.
* **Finished** — leave it alone. The newcomer joins from the next round.

What "append heats" has to get right is **lane balance**, not opponents. PPC
exists because lanes are not equal; who you race matters much less than which
lane you are in. So a newcomer gets one heat per usable lane, taking each lane
once, exactly as the generator would have given them.

The cost is that this is not free for the racers already in the round: the
other lanes of those heats have to hold somebody, and whoever fills them runs
more heats than their peers. Under ``TIMED`` that is harmless — an average is
scale-free — and under ``POINTS`` it is not, because points are summed and an
extra heat can only add to a total where lower is better. That is precisely
what ``Round.disrupted`` already records, so admission sets it and the existing
scoring rule does the rest. The newcomer is short of appearances against a full
field for the same reason, which is the same objection with the same answer.

Nothing here touches the database, and nothing here knows about championship
rounds — a championship field is drawn from the standings, so a latecomer
cannot be inserted into one at all. ``crud`` decides which rounds are eligible.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

__all__ = ["LateHeat", "plan_late_entry", "extra_appearances"]


@dataclass(frozen=True)
class LateHeat:
    """One appended heat: which racer is in which lane.

    Mirrors what ``scheduling.HeatPlan.assignments`` yields, so ``crud`` writes
    it the same way and neither caller has to know which planner produced it.
    """

    assignments: tuple[tuple[int, int], ...]

    @property
    def racer_ids(self) -> tuple[int, ...]:
        return tuple(racer_id for _, racer_id in self.assignments)


def plan_late_entry(
    newcomers: Sequence[int],
    field: Sequence[int],
    usable_lanes: Sequence[int],
    met: Mapping[int, Mapping[int, int]] | None = None,
) -> list[LateHeat]:
    """Plan the heats that admit ``newcomers`` to a round already under way.

    ``field`` is who is already in the round; ``usable_lanes`` is which lanes
    the track has, not how many (#171). ``met`` is how often each pair have
    already raced each other, used only to break ties — a newcomer's opponents
    are the least important thing being decided here, but given a free choice
    it is better to spread them.

    Every newcomer takes each usable lane exactly once, so they finish with the
    same lane spread the generator would have given them. Newcomers fill each
    other's remaining lanes before any established racer is pulled in: two
    children arriving together should race each other rather than each dragging
    a separate set of veterans into extra heats.

    Returns an empty list if there are no newcomers or no usable lanes. A
    newcomer with nobody to race — an empty field and no other newcomer — also
    plans nothing, because a heat of one is not a race.
    """
    lanes_in_use = sorted(set(usable_lanes))
    joining = list(dict.fromkeys(newcomers))
    established = [r for r in dict.fromkeys(field) if r not in set(joining)]

    if not joining or not lanes_in_use:
        return []
    if not established and len(joining) < 2:
        return []

    # How many lanes each newcomer still owes. A newcomer occupies one lane per
    # heat as the *seat holder*; filling somebody else's heat does not discharge
    # the debt, because that seat is whatever lane was left over.
    owed: dict[int, list[int]] = {racer: list(lanes_in_use) for racer in joining}

    # Extra appearances handed out so far, so the load spreads rather than
    # landing on whoever sorts first.
    extra: Counter[int] = Counter()
    met_counts = {racer: dict(met.get(racer, {})) for racer in joining} if met else {}

    heats: list[LateHeat] = []
    while any(owed.values()):
        seat_holder = max(joining, key=lambda r: (len(owed[r]), -r))
        lane = owed[seat_holder].pop(0)

        assignments = [(lane, seat_holder)]
        taken = {seat_holder}

        for other_lane in lanes_in_use:
            if other_lane == lane:
                continue
            filler = _pick_filler(
                other_lane, taken, owed, established, extra, met_counts, seat_holder
            )
            if filler is None:
                continue
            assignments.append((other_lane, filler))
            taken.add(filler)
            if filler in owed and other_lane in owed[filler]:
                # A newcomer filling a lane they still owe discharges it: they
                # have raced that lane, which is the whole point of the debt.
                owed[filler].remove(other_lane)
            else:
                extra[filler] += 1
            for already in taken:
                if already in met_counts:
                    met_counts[already][filler] = met_counts[already].get(filler, 0) + 1
                if filler in met_counts:
                    met_counts[filler][already] = met_counts[filler].get(already, 0) + 1

        heats.append(LateHeat(assignments=tuple(sorted(assignments))))

    return heats


def _pick_filler(
    lane: int,
    taken: set[int],
    owed: Mapping[int, Sequence[int]],
    established: Sequence[int],
    extra: Mapping[int, int],
    met_counts: Mapping[int, Mapping[int, int]],
    seat_holder: int,
) -> int | None:
    """Who fills ``lane``: a newcomer who still owes it, else an established racer."""
    candidates = [
        racer
        for racer, lanes_owed in owed.items()
        if racer not in taken and lane in lanes_owed
    ]
    if candidates:
        return max(candidates, key=lambda r: (len(owed[r]), -r))

    available = [racer for racer in established if racer not in taken]
    if not available:
        return None
    seen = met_counts.get(seat_holder, {})
    return min(available, key=lambda r: (extra.get(r, 0), seen.get(r, 0), r))


def extra_appearances(
    heats: Iterable[LateHeat], newcomers: Sequence[int]
) -> dict[int, int]:
    """How many extra heats each established racer picked up admitting ``newcomers``.

    The operator is told this rather than left to notice it, and it is the
    number that makes ``Round.disrupted`` legible: nobody minds an extra run,
    but under ``POINTS`` it changes a score, so saying how many is saying how
    much the round moved.
    """
    joining = set(newcomers)
    counts: Counter[int] = Counter()
    for heat in heats:
        for racer_id in heat.racer_ids:
            if racer_id not in joining:
                counts[racer_id] += 1
    return dict(counts)
