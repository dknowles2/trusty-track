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

Drop the worst run (#547 stage 2)
    ``Race.drop_worst_runs`` is a modifier over whichever strategy is chosen,
    not a fifth strategy — every racer's ``N`` worst *counted* results are
    dropped before aggregating, where "worst" is the same value the strategy
    already sums or averages (a time for the three time-based strategies, a
    placement for ``POINTS``). It only fires when every racer who has raced
    has the *same* number of counted results, and that number is at least
    ``N + 1``; otherwise nothing is dropped. Equal counts, not merely "enough
    each" — the issue's own trap is dropping one run from a racer with three
    and one from a racer with four: both individually have enough to give one
    up, but the *remainder* is two against three, still incomparable under a
    summing strategy and still evidence of a round a lane outage or a
    latecomer left uneven. Requiring equal counts up front is what keeps
    dropping the same ``N`` from everybody from merely relocating that
    unfairness one heat later. See :func:`drop_worst_status` for the honest
    "why not" a caller can show for that case.

    ``FASTEST_TIME`` already keeps only the single lowest time, so removing
    the *worst* of a racer's results can never change which one is lowest —
    dropping the worst run is a no-op under it by construction, not a
    special case this module skips. The one generic rule ("drop the highest
    ``N`` counted values, then re-aggregate what is left") produces that
    outcome on its own; nothing here pretends dropping did something it
    could not have.
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

    def as_dict(self) -> dict[str, float]:
        return {
            "score": self.score,
            "heats_completed": self.heats_completed,
            "total_time": self.total_time,
            "total_points": self.total_points,
        }


def _counted_values(
    heats: Iterable[Sequence[Lane]], strategy: str
) -> dict[int, list[float]]:
    """Per-racer list of the value each of their counted results contributes.

    One list entry per heat this racer's result counts toward ``strategy`` —
    a time (with the DNF penalty already applied) for ``TIMED`` and
    ``CUMULATIVE_TIME``, a placement (with a skip or a DNF already scored as
    last) for ``POINTS``, and a finite non-DNF time for ``FASTEST_TIME``. This
    is exactly what :func:`score_heats` sums, averages or takes the minimum
    of — factored out so it and :func:`drop_worst_status` read one list
    rather than keeping two copies of "what counts" free to disagree.

    A racer who is scheduled but has recorded nothing yet still gets an
    entry, with an empty list — the leaderboard shows them as unranked rather
    than omitting them, and :func:`score_heats` needs that entry to do so.

    Lanes with no racer are ignored: empty lanes, and unadvanced championship
    slots, whose ``racer_id`` is ``None`` since #164.
    """
    values: dict[int, list[float]] = {}

    for lanes in heats:
        # Last place in this heat, for POINTS's skip/DNF penalty below. The
        # racers actually in the heat, not the track's lane count — a
        # three-car heat on a six-lane track has a last place of 3.
        field = sum(1 for entrant in lanes if entrant.racer_id is not None)
        for lane in lanes:
            racer_id = lane.racer_id
            if not racer_id:
                continue

            entry = values.setdefault(racer_id, [])

            if strategy in (TIMED, CUMULATIVE_TIME):
                seconds = lane.seconds
                if seconds is None:
                    continue
                entry.append(DNF_PENALTY_SECONDS if seconds <= 0.0 else seconds)
            elif strategy == POINTS:
                place = lane.place
                if place is None:
                    seconds = lane.seconds
                    dnf = seconds is not None and seconds <= 0.0
                    if not (lane.skipped or dnf):
                        continue
                    place = field
                entry.append(float(place))
            elif strategy == FASTEST_TIME:
                seconds = lane.seconds
                # Not a candidate: unrecorded, or a DNF — ignored entirely
                # rather than penalised, per the module docstring. Skipped
                # for the same reason a skip needs no penalty above: no
                # finite time exists to be a candidate.
                if seconds is None or seconds <= 0.0:
                    continue
                entry.append(seconds)

    return values


def _drop_applies(
    values_by_racer: dict[int, list[float]], drop_worst_runs: int
) -> bool:
    """Whether dropping ``drop_worst_runs`` per racer keeps counts equal.

    ``drop_worst_runs <= 0`` is the off state and never applies. Otherwise
    every racer who has actually raced — at least one counted result — must
    have *exactly the same number* of them, and that number must be at least
    ``drop_worst_runs + 1``. Equal counts, not merely "each has enough":
    dropping one run from a racer with three and one from a racer with four
    individually satisfies "enough to drop", but leaves two against three —
    still uneven, the module docstring's trap. Requiring the starting counts
    to match is what guarantees the counts dropping leaves behind match too.

    A racer with no counted results at all (unraced, or under
    ``FASTEST_TIME`` an all-DNF racer) does not veto the drop; they are not
    ranked yet, the same "unraced" test :func:`rank_key` already applies.
    """
    if drop_worst_runs <= 0:
        return False
    counts = {len(values) for values in values_by_racer.values() if values}
    if len(counts) != 1:
        return False
    (common_count,) = counts
    return common_count >= drop_worst_runs + 1


def drop_worst_status(
    heats: Iterable[Sequence[Lane]], strategy: str, drop_worst_runs: int
) -> bool:
    """Whether :func:`score_heats` will actually drop runs for this field.

    ``True`` means every ranked racer had the same number of counted results
    and it was at least ``drop_worst_runs + 1``. ``False`` means the setting
    is off (``drop_worst_runs <= 0``), the counts were not all equal, or the
    common count was not enough — in any of those cases
    :func:`score_heats` drops nothing at all, and a caller showing this to an
    operator should say why: "not applied, everybody would need at least
    N+1 runs."
    """
    return _drop_applies(_counted_values(heats, strategy), drop_worst_runs)


def _aggregate(values: Sequence[float], strategy: str) -> tuple[float, float, int]:
    """``(score, total_time, total_points)`` for one racer's counted values.

    The three-tuple is what :class:`RacerScore` wants; ``total_time`` and
    ``total_points`` are 0 for strategies that do not use them, matching the
    dataclass's own defaults.
    """
    if strategy == TIMED:
        total = sum(values)
        return total / len(values), total, 0
    if strategy == POINTS:
        total_points = int(sum(values))
        return float(total_points), 0.0, total_points
    if strategy == CUMULATIVE_TIME:
        total = sum(values)
        return total, total, 0
    # FASTEST_TIME: dropping the worst (highest) values first, as
    # score_heats does, can never remove the minimum — see the module
    # docstring on why the drop is a no-op here by construction.
    return min(values), 0.0, 0


def score_heats(
    heats: Iterable[Sequence[Lane]], strategy: str, drop_worst_runs: int = 0
) -> dict[int, RacerScore]:
    """Aggregate every recorded lane into a per-racer score.

    Racers appear in the result as soon as they are *scheduled*, with
    ``heats_completed == 0`` until they actually race — the leaderboard shows
    them as unranked rather than omitting them.

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

    ``drop_worst_runs`` (#547 stage 2) drops each racer's highest-valued
    counted results — the module docstring's "worst" — before aggregating,
    but only when :func:`drop_worst_status` says every ranked racer has
    enough to drop evenly; otherwise this is a no-op, silently, which is why
    a caller wanting to explain that to an operator calls
    :func:`drop_worst_status` itself rather than inferring it from the score.
    ``heats_completed`` always reports the racer's full raced count, whether
    or not a drop happened — it is a fact about participation, not about the
    scoring math a modifier changed.
    """
    per_racer = _counted_values(heats, strategy)
    drop = drop_worst_runs if _drop_applies(per_racer, drop_worst_runs) else 0

    scores: dict[int, RacerScore] = {}
    for racer_id, values in per_racer.items():
        entry = RacerScore(heats_completed=len(values))
        counted = sorted(values)[: len(values) - drop] if drop else values
        if counted:
            entry.score, entry.total_time, entry.total_points = _aggregate(
                counted, strategy
            )
        scores[racer_id] = entry

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
