"""Ladderless elimination: lose N heats and you are out, last car standing wins.

The classic bracket ("ladder") is unworkable on a real derby morning — a
four-lane track does not race two cars at a time, and a chart drawn for the
cars that showed up is wrong by the first no-show. The ladderless form keeps
only the part that matters: count each car's losses, retire a car at N, and
keep racing the survivors against each other until one remains. Heats are
drawn from cars with equal losses where the numbers allow, which keeps the
undefeated racing the undefeated.

Sources: McGrew's Derby Race Methods (rahul.net/mcgrew/derby/methods.html)
and Stan Pope's No-Chart N-Elimination (stanpope.net/nelim.html).

Pure rules over plain values, like the rest of :mod:`backend.domain` — the
database wiring lives in ``crud``.

Three decisions worth writing down:

- **A loss is "did not win the heat".** Second of four is a loss, the same as
  fourth — that is what makes the method ladderless double/triple elimination
  rather than a points race. A DNF is a loss. A *skipped* lane is neither a
  win nor a loss: the car never ran.
- **Nobody races alone.** Heats are chunked within a loss group, and a
  leftover single car spills into the next group's pool rather than making a
  solo run — a one-car heat on a timer records a meaningless win. If the last
  heat of the wave would hold one car, it borrows from the heat before it.
- **Everything is recomputed from the recorded heats.** Losses, eliminations
  and the next wave are all answers about the state of the round *now*, never
  about which heat just finished — a corrected earlier result changes the
  loss counts and the next wave is simply drawn from the corrected numbers,
  the same self-healing shape as advancement's #248.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from backend.domain.lanes import Lane, is_finished


def losses_by_racer(heats_lanes: Iterable[Sequence[Lane]]) -> dict[int, int]:
    """Each racer's losses across the finished heats, keyed by racer id.

    A racer appears the moment they are scheduled, with zero losses, so the
    caller can tell "never lost" from "never raced" by who is in the dict.
    Only heats with any result count; a pending heat says nothing yet.
    """
    losses: dict[int, int] = {}
    for lanes in heats_lanes:
        raced = [(lane.racer_id, lane) for lane in lanes if lane.racer_id is not None]
        for racer_id, _lane in raced:
            losses.setdefault(racer_id, 0)
        finished = [
            (racer_id, lane)
            for racer_id, lane in raced
            if lane.seconds is not None or lane.place is not None
        ]
        if len(finished) < 2:
            # Nothing to lose to — an unraced heat, or a lone finisher.
            continue
        winner = _winner(finished)
        for racer_id, _lane in finished:
            if racer_id != winner:
                losses[racer_id] += 1
    return losses


def _winner(finished: Sequence[tuple[int, Lane]]) -> int | None:
    """The racer who won a heat: best place, or fastest time without places."""
    placed = [
        (place, racer_id)
        for racer_id, lane in finished
        if (place := lane.place) is not None
    ]
    if placed:
        return min(placed)[1]
    timed = [
        (seconds, racer_id)
        for racer_id, lane in finished
        if (seconds := lane.seconds) is not None and seconds > 0
    ]
    if timed:
        return min(timed)[1]
    return None


def eliminated(losses: dict[int, int], max_losses: int) -> set[int]:
    """Racers whose losses have reached the threshold."""
    return {racer_id for racer_id, count in losses.items() if count >= max_losses}


def next_wave(
    losses: dict[int, int],
    max_losses: int,
    heat_size: int,
    rng: random.Random | None = None,
) -> list[list[int]]:
    """The next round of heats, or ``[]`` when the race is decided.

    Cars are grouped by loss count (fewest first), shuffled within their
    group, and chunked into heats of ``heat_size``. A group's leftover cars
    spill into the next group rather than racing short-handed, and a final
    one-car heat borrows from the heat before it, so no heat ever holds a
    single car.
    """
    alive = [racer_id for racer_id, count in losses.items() if count < max_losses]
    if len(alive) < 2:
        return []
    if rng is None:
        rng = random.Random()

    ordered: list[int] = []
    by_losses: dict[int, list[int]] = {}
    for racer_id in alive:
        by_losses.setdefault(losses[racer_id], []).append(racer_id)
    for loss_count in sorted(by_losses):
        group = sorted(by_losses[loss_count])
        rng.shuffle(group)
        ordered.extend(group)

    heats = [ordered[i : i + heat_size] for i in range(0, len(ordered), heat_size)]
    if len(heats) > 1 and len(heats[-1]) == 1:
        heats[-1].insert(0, heats[-2].pop())
    return heats


def is_decided(losses: dict[int, int], max_losses: int) -> bool:
    """Whether a winner exists: at most one car is still standing.

    An empty round is not decided — it has not started.
    """
    if not losses:
        return False
    alive = [r for r, count in losses.items() if count < max_losses]
    return len(alive) <= 1


@dataclass(frozen=True)
class EliminationStanding:
    """One racer's place in an elimination round's standings."""

    racer_id: int
    losses: int
    #: Still in the running — or the winner, once the round is decided.
    alive: bool
    #: The heat index (0-based, schedule order) of the racer's final loss,
    #: or None while they are alive. Later is better: it means they survived
    #: longer.
    out_after: int | None


def standings(
    heats_lanes: Sequence[Sequence[Lane]], max_losses: int
) -> list[EliminationStanding]:
    """The round's order of finish, best first.

    Survivors rank ahead of the eliminated, fewest losses first; the
    eliminated rank by how long they lasted, the last car out placing
    highest. Ties (two cars out in the same heat) are left adjacent and
    share their fate visibly, the same as the leaderboard's shared ranks.
    """
    final = losses_by_racer(heats_lanes)
    out_at: dict[int, int] = {}
    running: dict[int, int] = {}
    for index, lanes in enumerate(heats_lanes):
        for racer_id, count in losses_by_racer([lanes]).items():
            if count:
                running[racer_id] = running.get(racer_id, 0) + count
                if running[racer_id] >= max_losses and racer_id not in out_at:
                    out_at[racer_id] = index

    entries = [
        EliminationStanding(
            racer_id=racer_id,
            losses=count,
            alive=count < max_losses,
            out_after=out_at.get(racer_id),
        )
        for racer_id, count in final.items()
    ]
    return sorted(
        entries,
        key=lambda e: (
            not e.alive,
            e.losses if e.alive else 0,
            -(e.out_after if e.out_after is not None else 0),
            e.racer_id,
        ),
    )


# --- The chart ---------------------------------------------------------------
#
# A tournament bracket is a *prediction*: it draws the matchups that have not
# happened yet. This format refuses to do that on purpose — the next wave is
# drawn from the loss counts once the current one is finished, and a corrected
# result redraws it — so the only bracket-shaped thing that can be shown
# truthfully is the record of what *has* happened: which heats each wave held,
# who won each, whose losses mounted, and who is still standing (#710).
#
# Nothing here reaches past the heats that exist. A pending wave is real (its
# rows have been written) and is shown; the wave after it is not drawn,
# because nobody knows who will be in it.

#: A lane's outcome in a finished heat. ``None`` means no result was counted
#: for it — the heat has not run, or this lane held no finisher — so it is
#: neither a win nor a loss, the same rule `losses_by_racer` follows.
OUTCOME_WON = "WON"
OUTCOME_LOST = "LOST"
OUTCOME_SKIPPED = "SKIPPED"


@dataclass(frozen=True)
class ChartLane:
    """One lane of one heat, as the chart shows it."""

    lane: int
    racer_id: int | None
    outcome: str | None
    #: The racer's losses once this heat is counted — what the chart draws as
    #: the loss pips beside the name. For a heat yet to run, the losses so far.
    losses_after: int
    #: Reached the loss limit at or before this heat.
    out: bool


@dataclass(frozen=True)
class ChartHeat:
    """One heat, by its index into the sequence the chart was built from.

    An index rather than an id: the domain knows nothing about rows, and the
    caller that supplied the lanes in order is the one that can map it back.
    """

    index: int
    finished: bool
    lanes: tuple[ChartLane, ...]


@dataclass(frozen=True)
class ChartWave:
    """One set of heats the schedule grew at once."""

    number: int
    heats: tuple[ChartHeat, ...]


def waves_of(heats_lanes: Sequence[Sequence[Lane]]) -> list[list[int]]:
    """Group heat indices into the waves the schedule grew in.

    No row records which wave a heat belongs to, and it does not need to:
    every wave fields each car at most once (`next_wave` chunks every alive
    car exactly once, and the first wave is drawn the same way), so a new
    wave starts at the first heat in which a car *reappears*. A heat holding
    nobody — every lane vacated by a deleted racer — stays with the wave
    before it rather than starting one.

    This reads the heats in the order given, which is the round's own heat
    order; `_write_elimination_wave` appends each wave after the last, and the
    master running order preserves a round's internal order (#549), so that
    order is wave order.
    """
    waves: list[list[int]] = []
    seen: set[int] = set()
    for index, lanes in enumerate(heats_lanes):
        racers = {lane.racer_id for lane in lanes if lane.racer_id is not None}
        if not waves or racers & seen:
            waves.append([index])
            seen = set(racers)
        else:
            waves[-1].append(index)
            seen |= racers
    return waves


def chart(heats_lanes: Sequence[Sequence[Lane]], max_losses: int) -> list[ChartWave]:
    """The record of the round so far, wave by wave.

    Every loss here comes from `losses_by_racer` applied one heat at a time,
    so the chart cannot disagree with the loss counts that drive the next
    wave: a lane marked ``LOST`` is exactly a lane that cost a loss there.
    The winner is the one finisher in a counted heat charged nothing; a heat
    with a lone finisher charges nobody and so names no winner either, the
    same as `losses_by_racer` — a one-car heat on a timer is a meaningless
    win, and the chart says nothing rather than something false.
    """
    running: dict[int, int] = {}
    heats: list[ChartHeat] = []
    for index, lanes in enumerate(heats_lanes):
        finished = is_finished(lanes)
        heat_losses = losses_by_racer([lanes]) if finished else {}
        counted = [
            lane.racer_id
            for lane in lanes
            if lane.racer_id is not None
            and (lane.seconds is not None or lane.place is not None)
        ]
        names_a_winner = len(counted) >= 2
        chart_lanes: list[ChartLane] = []
        for lane in lanes:
            racer_id = lane.racer_id
            outcome: str | None = None
            if racer_id is not None and finished:
                if lane.skipped and lane.seconds is None and lane.place is None:
                    outcome = OUTCOME_SKIPPED
                elif heat_losses.get(racer_id, 0) > 0:
                    outcome = OUTCOME_LOST
                elif racer_id in counted and names_a_winner:
                    outcome = OUTCOME_WON
            if racer_id is not None:
                running[racer_id] = running.get(racer_id, 0) + heat_losses.get(
                    racer_id, 0
                )
            losses_after = running.get(racer_id, 0) if racer_id is not None else 0
            chart_lanes.append(
                ChartLane(
                    lane=lane.lane,
                    racer_id=racer_id,
                    outcome=outcome,
                    losses_after=losses_after,
                    out=racer_id is not None and losses_after >= max_losses,
                )
            )
        heats.append(
            ChartHeat(index=index, finished=finished, lanes=tuple(chart_lanes))
        )

    return [
        ChartWave(number=number, heats=tuple(heats[i] for i in indices))
        for number, indices in enumerate(waves_of(heats_lanes), start=1)
    ]
