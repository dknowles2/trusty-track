"""Balanced racing: each phase matches cars with similar records.

GPRM calls this "Dynamic" scheduling. The first phase is random; every later
phase ranks the field by how it has done so far — most heat wins first, then
fewest points — and races neighbours against neighbours. The fastest cars
race the fastest, which means the slower heats are winnable, which is the
point: the stated goal of the method is to maximize how many racers win at
least one heat. Nobody is eliminated, everyone races once per phase, and the
round ends after a configured number of phases (at least one per lane is the
usual advice).

Unlike an elimination round, a balanced round's heats feed the ordinary
standings: everyone races the same number of times, so a POINTS sum and a
TIMED average are both fair over it.

Source: grandprix-software-central.com, "GPRM Charts: Dynamic".

Pure rules over plain values; the database wiring lives in ``crud``.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from backend.domain.lanes import Lane


@dataclass(frozen=True)
class Record:
    """One racer's record so far, for matchmaking."""

    racer_id: int
    wins: int = 0
    points: int = 0
    heats: int = 0

    @property
    def average_points(self) -> float:
        """Points per heat raced.

        The average rather than GPRM's raw total, for one reason: a latecomer
        has raced fewer heats, and a raw total would rank them above cars
        that raced well all day. Per heat, a missing history simply means an
        unknown record — see :func:`performance_order` for where those go.
        """
        return self.points / self.heats if self.heats else 0.0


def records(heats_lanes: Iterable[Sequence[Lane]]) -> dict[int, Record]:
    """Every scheduled racer's record across the finished heats.

    A win is first place. Points are the finishing place — and last place in
    the heat for a DNF, which never wins but did race. A skipped lane is
    neither: the car never ran, so it adds nothing to the record.
    """
    tallies: dict[int, list[int]] = {}
    for lanes in heats_lanes:
        raced = [(lane.racer_id, lane) for lane in lanes if lane.racer_id is not None]
        for racer_id, _lane in raced:
            tallies.setdefault(racer_id, [0, 0, 0])
        field = len(raced)
        for racer_id, lane in raced:
            place = lane.place
            if place is None:
                seconds = lane.seconds
                if seconds is not None and seconds <= 0.0:
                    place = field
                else:
                    continue
            tally = tallies[racer_id]
            tally[0] += 1 if place == 1 else 0
            tally[1] += place
            tally[2] += 1
    return {
        racer_id: Record(racer_id=racer_id, wins=w, points=p, heats=h)
        for racer_id, (w, p, h) in tallies.items()
    }


def performance_order(entries: Iterable[Record]) -> list[int]:
    """Racer ids best-first: most wins, then lowest points per heat.

    Racers with no record yet — latecomers — go last: an unknown record is
    matched against the field still finding its feet, not against the
    leaders. Racer id breaks ties so the order is reproducible.
    """
    return [
        entry.racer_id
        for entry in sorted(
            entries,
            key=lambda e: (
                e.heats == 0,
                -e.wins,
                e.average_points,
                e.racer_id,
            ),
        )
    ]


def next_phase(
    ordered: Sequence[int],
    lane_uses: dict[int, dict[int, int]],
    usable_lanes: Sequence[int],
    rng: random.Random | None = None,
) -> list[list[tuple[int, int]]]:
    """One phase of heats as ``(lane, racer_id)`` assignments.

    Neighbours in ``ordered`` race each other, chunked to the track's width;
    a final one-car heat borrows from the heat before it, because nobody
    races alone. Within each heat, lanes go to whoever has used them least
    (``lane_uses`` is per racer, per lane) — the "best effort" lane balance
    the method promises, which cannot be a guarantee when the groupings are
    decided by results.
    """
    if len(ordered) < 2:
        return []
    if rng is None:
        rng = random.Random()

    size = len(usable_lanes)
    groups = [list(ordered[i : i + size]) for i in range(0, len(ordered), size)]
    if len(groups) > 1 and len(groups[-1]) == 1:
        groups[-1].insert(0, groups[-2].pop())

    phase: list[list[tuple[int, int]]] = []
    for group in groups:
        remaining = list(group)
        assignment: list[tuple[int, int]] = []
        for lane in usable_lanes:
            if not remaining:
                break
            uses = {r: lane_uses.get(r, {}).get(lane, 0) for r in remaining}
            least = min(uses.values())
            candidates = [r for r in remaining if uses[r] == least]
            racer = candidates[rng.randrange(len(candidates))]
            remaining.remove(racer)
            assignment.append((lane, racer))
        phase.append(assignment)
    return phase


def lane_uses_of(heats_lanes: Iterable[Sequence[Lane]]) -> dict[int, dict[int, int]]:
    """How often each racer has been assigned each lane, scheduled or raced.

    Scheduled counts too — a pending heat is still a lane that racer will
    run, and the next phase should balance against it.
    """
    uses: dict[int, dict[int, int]] = {}
    for lanes in heats_lanes:
        for lane in lanes:
            if lane.racer_id is not None:
                per_racer = uses.setdefault(lane.racer_id, {})
                per_racer[lane.lane] = per_racer.get(lane.lane, 0) + 1
    return uses


def appearances(heats_lanes: Iterable[Sequence[Lane]]) -> dict[int, int]:
    """How many heats each racer is in, scheduled or raced."""
    counts: dict[int, int] = {}
    for lanes in heats_lanes:
        for lane in lanes:
            if lane.racer_id is not None:
                counts[lane.racer_id] = counts.get(lane.racer_id, 0) + 1
    return counts
