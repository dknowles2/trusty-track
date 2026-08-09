"""Scoring rules: turning recorded lanes into ranked standings.

Both strategies are lower-is-better:

``TIMED``
    Average of the racer's heat times.
``POINTS``
    Sum of the racer's finishing places.

Strategies arrive as plain strings. ``models.ScoringStrategy`` is a ``str`` enum
whose values equal its names, so its members compare equal to these constants
and can be passed straight through.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from backend.domain.lanes import Lane

TIMED = "TIMED"
POINTS = "POINTS"

#: Which rounds count toward the standings.
#:
#: ``PRELIM`` — only rounds with no ``advancement_source``. This is the default
#: and the answer to issue #17. Championship rounds are a *result* of the
#: standings, so folding them back in is circular: a championship time would
#: move the very leaderboard that decided who was racing in it. It also mixes
#: populations, since a championship average is taken against the fastest cars
#: in the pack rather than the whole field.
#:
#: ``ALL`` — every heat in the race, which is what the app did before #17.
#: Kept so a caller can ask for it deliberately.
PRELIM = "PRELIM"
ALL = "ALL"

#: A time of zero (or less) means the timer saw a start but never a finish.
#: Scored as a bad-but-finite result so one DNF does not erase a racer's
#: standing entirely, and so ranking stays a total order.
DNF_PENALTY_SECONDS = 9.999


@dataclass
class RacerScore:
    """A racer's aggregate across the heats considered."""

    score: float = 0.0
    heats_completed: int = 0
    total_time: float = 0.0
    total_points: int = 0

    def as_dict(self) -> dict[str, float]:
        return {
            "score": self.score,
            "heats_completed": self.heats_completed,
            "total_time": self.total_time,
            "total_points": self.total_points,
        }


def score_heats(
    heats: Iterable[Sequence[Lane]], strategy: str
) -> dict[int, RacerScore]:
    """Aggregate every recorded lane into a per-racer score.

    Racers appear in the result as soon as they are *scheduled*, with
    ``heats_completed == 0`` until they actually race — the leaderboard shows
    them as unranked rather than omitting them.

    Lanes with no racer are ignored: empty lanes, and unadvanced championship
    slots, whose ``racer_id`` is ``None`` since #164.

    Under ``POINTS``, a **skipped** lane and a **DNF** (a recorded time of
    zero, which the timer assigns no place) score **last place** — the number
    of racers in the heat (#225). ``POINTS`` sums placements, so before this a
    missing placement was a *reward*: a car that never finished, or sat out a
    skipped heat, summed fewer places than a car that raced everything and
    won. This is the same failure ``counts_a_disrupted_round`` guards a third
    and fourth way in — and the same shape as ``TIMED``'s DNF penalty: bad but
    finite, so the ranking stays a total order. A scratch classifying last is
    what every racing series does.

    ``TIMED`` needs no penalty for a skip: an average is scale-free, so a heat
    that never ran simply is not in it.
    """
    scores: dict[int, RacerScore] = {}

    for lanes in heats:
        # Last place in this heat, for the lanes penalised below. The racers
        # actually in the heat, not the track's lane count — a three-car heat
        # on a six-lane track has a last place of 3.
        field = sum(1 for entrant in lanes if entrant.racer_id is not None)
        for lane in lanes:
            racer_id = lane.racer_id
            if not racer_id:
                continue

            entry = scores.setdefault(racer_id, RacerScore())

            if strategy == TIMED:
                seconds = lane.seconds
                if seconds is None:
                    continue
                entry.total_time += DNF_PENALTY_SECONDS if seconds <= 0.0 else seconds
                entry.heats_completed += 1
            elif strategy == POINTS:
                place = lane.place
                if place is None:
                    seconds = lane.seconds
                    dnf = seconds is not None and seconds <= 0.0
                    if not (lane.skipped or dnf):
                        continue
                    place = field
                entry.total_points += place
                entry.heats_completed += 1

    for entry in scores.values():
        if entry.heats_completed == 0:
            continue
        if strategy == TIMED:
            entry.score = entry.total_time / entry.heats_completed
        elif strategy == POINTS:
            entry.score = entry.total_points

    return scores


def counts_a_disrupted_round(strategy: str) -> bool:
    """Whether a round that lost a lane part-way through still counts (#171).

    The whole difference between the two strategies, stated once:

    ``TIMED`` averages a racer's heat times, which is scale-free — somebody who
    ran four heats and somebody who ran five are compared on the same footing,
    so a round where a lane died is still perfectly good evidence.

    ``POINTS`` **sums** placements, so it is not. A racer whose remaining heat
    was in the lane that failed has one fewer placement to add up, and a lower
    total is a *better* score. Counting that round would hand them a trophy for
    a heat they never ran, which is #26's failure arriving by a third route.

    Excluding the round is the blunt answer and it is the honest one: the
    alternative is inventing a placement for a heat nobody raced.
    """
    return strategy != POINTS


def rank_key(score: float, heats_completed: int, racer_id: int) -> tuple:
    """Sort key for standings: score ascending, unraced racers last.

    Racer id breaks ties so the *order* is stable and reproducible rather than
    dependent on dict iteration. It does not break the *rank* — see
    :func:`standings_ranks`, which is what keeps a tie visible.
    """
    return (float(score) if heats_completed > 0 else float("inf"), racer_id)


def standings_ranks(scored: Sequence[tuple[float, int]]) -> list[int]:
    """Competition ranks (1, 1, 3) for already-sorted ``(score, heats)`` pairs.

    Equal scores share a rank and the next rank skips, so a tie is *visible* —
    two golds on the wall display — rather than silently resolved (#226). The
    underlying sort still breaks ties by racer id, which made the order look
    decided when it was actually registration order: a tie for the last
    championship slot, or for a trophy, went to whoever signed up first and no
    screen ever said so. ``POINTS`` collides constantly, being sums of small
    integers. Deciding a tie is the operator's call — a race-off, a corrected
    time — and they can only make it if they can see it.

    Racers who have not raced keep strictly increasing positions rather than
    tying with each other: their scores are all equally meaningless, and a
    pre-race leaderboard where the whole roster shares rank 1 would be a wall
    of gold medals.
    """
    ranks: list[int] = []
    for index, (score, heats_completed) in enumerate(scored):
        previous = scored[index - 1] if index else None
        tied = (
            previous is not None
            and heats_completed > 0
            and previous[1] > 0
            and float(score) == float(previous[0])
        )
        ranks.append(ranks[-1] if tied else index + 1)
    return ranks
