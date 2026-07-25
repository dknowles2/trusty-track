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

    Lanes with a falsy racer id are ignored. That covers empty lanes, and is
    also why a placeholder is *not* excluded here: negative ids are truthy, and
    a placeholder never carries a time anyway, so it lands with zero heats
    completed. Preserved as-is; the placeholder encoding is on its way out with
    issue #5.
    """
    scores: dict[int, RacerScore] = {}

    for lanes in heats:
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
                if lane.place is None:
                    continue
                entry.total_points += lane.place
                entry.heats_completed += 1

    for entry in scores.values():
        if entry.heats_completed == 0:
            continue
        if strategy == TIMED:
            entry.score = entry.total_time / entry.heats_completed
        elif strategy == POINTS:
            entry.score = entry.total_points

    return scores


def rank_key(score: float, heats_completed: int, racer_id: int) -> tuple:
    """Sort key for standings: score ascending, unraced racers last.

    Racer id breaks ties so the order is stable and reproducible rather than
    dependent on dict iteration.
    """
    return (float(score) if heats_completed > 0 else float("inf"), racer_id)
