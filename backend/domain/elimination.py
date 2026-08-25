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

from backend.domain.lanes import Lane


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
