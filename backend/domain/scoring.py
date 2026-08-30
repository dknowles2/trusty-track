"""Scoring rules: turning recorded lanes into ranked standings.

Four strategies, all lower-is-better (#547 stage 1 adds the last two):

``TIMED``
    Average of the racer's heat times.
``POINTS``
    Sum of the racer's finishing places.
``CUMULATIVE_TIME``
    Sum (not average) of the racer's heat times. Identical *ordering* to
    ``TIMED`` only while every racer has the same number of heats — a lane
    outage (#171), a latecomer (#172) or a shrunk lane count (#325) each
    break that, and once they do, a racer with one fewer heat has one fewer
    time to add up, which sums to *less* — a summing method's failure shape,
    same as ``POINTS`` (#26). It shares ``TIMED``'s DNF handling (the
    ``DNF_PENALTY_SECONDS`` penalty) rather than inventing a second rule for
    the same fact: a recorded ``0.0`` is still evidence of a heat that
    happened, just a bad one, and the penalty is what keeps that heat in a
    sum-based total rather than silently deleting it (which POINTS cannot do
    either, for the same reason #225 gave it a last-place penalty instead).
``FASTEST_TIME``
    The racer's single best (lowest) recorded time — "fastest run wins", the
    traditional pinewood answer. A DNF (a recorded time of zero or less) is
    not a candidate at all: it is skipped outright rather than penalised, so
    a racer who was quick once and unlucky twice places on the once. A racer
    whose *every* run is a DNF therefore has no candidate time and reads as
    unraced (``heats_completed == 0``), which is what puts them below every
    racer who finished at least one heat — a DNF is bad, but "never finished
    anything" has to be worse, not merely absent from the average the way it
    is under ``TIMED``.

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
CUMULATIVE_TIME = "CUMULATIVE_TIME"
FASTEST_TIME = "FASTEST_TIME"

#: Every strategy this module knows, in the order `RaceForm` (stage 3) offers
#: them — the same forward-declared shape `domain.tiebreak.ALL_METHODS` used
#: for its own stage 3.
ALL_STRATEGIES: tuple[str, ...] = (TIMED, POINTS, CUMULATIVE_TIME, FASTEST_TIME)

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
    #: The lowest recorded, non-DNF time seen so far — ``FASTEST_TIME`` only.
    #: Not exposed by :meth:`as_dict`, which nothing downstream reads for the
    #: other three strategies either; ``score`` is the answer every caller
    #: wants.
    best_time: float | None = None

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

    ``TIMED`` and ``CUMULATIVE_TIME`` need no penalty for a skip, for the same
    reason: a skipped heat contributes nothing to either a scale-free average
    or a sum, so a heat that never ran simply is not in it. ``FASTEST_TIME``
    needs no penalty either — a DNF (a recorded time of zero or less) is
    dropped as a candidate rather than counted, so it is not a heat this
    racer "completed" for scoring purposes at all; see the module docstring.
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

            if strategy in (TIMED, CUMULATIVE_TIME):
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
            elif strategy == FASTEST_TIME:
                seconds = lane.seconds
                # Not a candidate: unrecorded, or a DNF — ignored entirely
                # rather than penalised, per the module docstring. Skipped
                # for the same reason a skip needs no penalty above: no
                # finite time exists to be a candidate.
                if seconds is None or seconds <= 0.0:
                    continue
                if entry.best_time is None or seconds < entry.best_time:
                    entry.best_time = seconds
                entry.heats_completed += 1

    for entry in scores.values():
        if entry.heats_completed == 0:
            continue
        if strategy == TIMED:
            entry.score = entry.total_time / entry.heats_completed
        elif strategy == POINTS:
            entry.score = entry.total_points
        elif strategy == CUMULATIVE_TIME:
            entry.score = entry.total_time
        elif strategy == FASTEST_TIME:
            # heats_completed > 0 under FASTEST_TIME only when a candidate
            # was found, so best_time is never None here.
            assert entry.best_time is not None
            entry.score = entry.best_time

    return scores


#: Strategies that **sum** a per-heat value, so a racer with fewer counted
#: heats scores *better* — the shape #26 keeps arriving by new routes.
#: ``POINTS`` sums placements; ``CUMULATIVE_TIME`` sums times (#547 stage 1).
#: Both need a disrupted round excluded, for the same reason.
_SUMMING_STRATEGIES = frozenset({POINTS, CUMULATIVE_TIME})


def counts_a_disrupted_round(strategy: str) -> bool:
    """Whether a round that lost a lane part-way through still counts (#171).

    The whole difference is scale-freeness, stated once:

    ``TIMED`` averages a racer's heat times and ``FASTEST_TIME`` (#547 stage 1)
    takes the single best of them — both scale-free: somebody who ran four
    heats and somebody who ran five are compared on the same footing, so a
    round where a lane died is still perfectly good evidence. (A racer with
    fewer heats under ``FASTEST_TIME`` had fewer *chances* at a low time,
    which is a disadvantage, not the reward a summing method hands out — the
    opposite of the failure this function guards against, so there is
    nothing here for it to guard.)

    ``POINTS`` **sums** placements and ``CUMULATIVE_TIME`` **sums** times, so
    neither is. A racer whose remaining heat was in the lane that failed has
    one fewer placement, or one fewer time, to add up, and a lower total is a
    *better* score under both. Counting that round would hand them a trophy
    for a heat they never ran, which is #26's failure arriving by a third
    (``POINTS``) and now a fifth (``CUMULATIVE_TIME``) route — see
    ``_SUMMING_STRATEGIES``.

    Excluding the round is the blunt answer and it is the honest one: the
    alternative is inventing a placement, or a time, for a heat nobody raced.
    """
    return strategy not in _SUMMING_STRATEGIES


def rank_key(score: float, heats_completed: int, racer_id: int) -> tuple:
    """Sort key for standings: score ascending, unraced racers last.

    Racer id breaks ties so the *order* is stable and reproducible rather than
    dependent on dict iteration. It does not break the *rank* — see
    :func:`standings_ranks`, which is what keeps a tie visible.
    """
    return (float(score) if heats_completed > 0 else float("inf"), racer_id)


def standings_ranks(
    scored: Sequence[tuple[float, int]], separated: Sequence[bool] | None = None
) -> list[int]:
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

    ``separated`` is how a resolved tie stops sharing a rank (#540).
    ``separated[index]`` means index ``index`` no longer counts as tied with
    ``index - 1`` even though their scores are equal — because
    ``backend.domain.tiebreak`` told them apart. Left ``None`` (the default),
    every equal score ties, which is the whole of what this function did
    before a tiebreaker existed. A pair a tiebreaker could not separate — the
    method's own "still tied" answer — is simply never marked, so it keeps
    sharing a rank exactly as it always did.
    """
    ranks: list[int] = []
    for index, (score, heats_completed) in enumerate(scored):
        previous = scored[index - 1] if index else None
        tied = (
            previous is not None
            and heats_completed > 0
            and previous[1] > 0
            and float(score) == float(previous[0])
            and not (separated[index] if separated is not None else False)
        )
        ranks.append(ranks[-1] if tied else index + 1)
    return ranks
