"""Breaking a tie in the standings — five ways, one door (#540).

`domain.scoring.standings_ranks` makes a tie *visible*: two racers on the same
score share a rank rather than being silently split by registration order.
What it does not do is choose between them, and three consumers of the
standings — advancement, awards, `AdvancementStatus` — used to each pick the
lower racer id without saying so. This module is the one place that pick gets
made, when the pack has asked for it to be made at all.

Five methods, given as plain strings the same way `ScoringStrategy` and
friends cross the domain boundary (``models.TiebreakMethod`` is the ``str``
enum whose values equal these):

``SHARED``
    Not resolved. The default — an install upgrading into this must not find
    its ties suddenly decided by a rule nobody chose, the same reasoning
    `weight_limit_oz` (#205) and `display_theme`'s `"MATCH_APP"` (#498) both
    follow. It is not a no-op *feature*, though: it is what makes today's
    silent pick say so, once a cut starts reading through this module instead
    of past it.
``BEST_TIME``
    Fastest single recorded heat time among the tied cars.
``TOTAL_TIME``
    Lowest total elapsed time across the heats that count.
``COUNTBACK``
    Most 1st places, then most 2nds, and so on.
``HEAD_TO_HEAD``
    Among the tied cars only, the heats where two of them raced together:
    more wins over each other takes it.

A sixth value, ``RUN_OFF``, is not in ``ALL_METHODS`` and cannot be chosen as
a race's ``tiebreaker`` — it is not a policy an operator picks in advance, it
is what happens when they put the tied cars back on the track (#550). See
:func:`tiebreak`'s ``run_off`` parameter: when a decided run-off heat exists
for exactly the tied set being resolved, it beats whichever method the race
is configured with, and ``TiebreakResult.resolved_by`` reports ``RUN_OFF``
rather than the configured method for the rows it separated.

**Inconclusive is a real answer.** `HEAD_TO_HEAD` between two cars that never
shared a heat, `BEST_TIME` on a race with no timer, two cars with identical
values on whichever metric — every one of those returns "still tied" rather
than inventing an order. A tiebreaker that cannot fail is a tiebreaker that
decides a tie no data supports.

**Nothing here loads anything.** `tiebreak` takes the same parsed lanes
`domain.scoring.score_heats` already takes — whatever a caller already has —
so resolving in `services.scoring.get_leaderboard` costs no query beyond what
that function loads today.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from backend.domain.lanes import Lane
from backend.domain.scoring import DNF_PENALTY_SECONDS

SHARED = "SHARED"
BEST_TIME = "BEST_TIME"
TOTAL_TIME = "TOTAL_TIME"
COUNTBACK = "COUNTBACK"
HEAD_TO_HEAD = "HEAD_TO_HEAD"
#: An operator's own run-off heat (#550) — not a race-configurable policy,
#: see the module docstring. Never appears in ``ALL_METHODS``.
RUN_OFF = "RUN_OFF"

#: Every method this module knows, in the order the vocabulary table in the
#: issue lists them — also the order `RaceForm` (stage 3) offers them in.
#: ``RUN_OFF`` is deliberately absent — see the module docstring.
ALL_METHODS: tuple[str, ...] = (SHARED, BEST_TIME, TOTAL_TIME, COUNTBACK, HEAD_TO_HEAD)


@dataclass(frozen=True)
class TiebreakResult:
    """An ordering over a set of tied racers, and what is still tied.

    ``groups`` runs best to worst; every racer handed to :func:`tiebreak`
    appears exactly once, in exactly one group. Two racers who land in the
    same group are the method's own "still tied" answer — the whole input
    landing in one group is the fully inconclusive case, and is what every
    method falls back to rather than inventing a winner.

    Within a group, racer ids are sorted — not a further tiebreak (there is
    none left to apply), just what makes the result reproducible rather than
    dependent on dict iteration, the same reason `rank_key` sorts on racer id.
    """

    groups: tuple[tuple[int, ...], ...]
    #: Which method produced this grouping — usually whatever the caller
    #: asked :func:`tiebreak` for, but ``RUN_OFF`` when a decided run-off
    #: heat took precedence over it (#550). Set regardless of whether the
    #: result is actually :attr:`resolved`; a caller only reads it for a row
    #: it separated, the same way :func:`services.scoring._resolve_ties`
    #: only stamps ``resolved_by`` when a group settled to size one.
    resolved_by: str = SHARED

    @property
    def order(self) -> tuple[int, ...]:
        """Every input racer, best first.

        A total order, but not necessarily a *decided* one: two adjacent ids
        here can still be tied — see :meth:`still_tied` before treating
        adjacency as a resolution.
        """
        return tuple(racer_id for group in self.groups for racer_id in group)

    def still_tied(self, a: int, b: int) -> bool:
        """Whether the method left ``a`` and ``b`` unable to be told apart.

        ``False`` for two racers not both present in the input — there was
        nothing to tie between them here.
        """
        for group in self.groups:
            a_in, b_in = a in group, b in group
            if a_in and b_in:
                return True
            if a_in or b_in:
                return False
        return False

    @property
    def resolved(self) -> bool:
        """Whether the method separated anybody at all."""
        return len(self.groups) > 1


def tiebreak(
    racer_ids: Sequence[int],
    heats: Iterable[Sequence[Lane]],
    method: str,
    run_off: Sequence[Lane] | None = None,
) -> TiebreakResult:
    """Resolve a tie among ``racer_ids`` using ``method``.

    ``heats`` is the same shape :func:`backend.domain.scoring.score_heats`
    takes — an iterable of a heat's parsed lanes — so a caller that already
    loaded them for scoring can hand them straight through; nothing here
    queries anything.

    ``run_off`` is a decided run-off heat's own lanes (#550) — the same shape
    as one entry of ``heats`` — already matched by the caller to exactly this
    ``racer_ids`` set (:func:`services.scoring._resolve_ties` does that
    matching; this function does not query anything, so it cannot). When
    given and it separates anybody, it wins outright: the method argument is
    never consulted, because an operator's own run-off is more authoritative
    than a passive tiebreaker nobody watched happen. When it is absent, or
    every racer in it is still tied (no results yet, or a genuine dead heat),
    resolution falls through to ``method`` exactly as if ``run_off`` had not
    been passed.

    Racers not among ``racer_ids`` are ignored even if they appear in
    ``heats``: a duel between two tied cars still counts under
    ``HEAD_TO_HEAD`` even though the heat that decided it may have held two
    more cars nobody asked to break a tie between.

    Fewer than two distinct ``racer_ids`` needs no method at all — there is
    nothing to tie-break, and the input comes back as one group of however
    many ids were given (zero or one), always "resolved" in the trivial sense
    that nothing was left ambiguous.
    """
    ids = tuple(sorted(set(racer_ids)))
    if len(ids) <= 1:
        return TiebreakResult(groups=(ids,) if ids else (), resolved_by=method)

    if run_off is not None:
        from_run_off = _by_run_off(ids, list(run_off))
        if from_run_off.resolved:
            return from_run_off

    heat_list = [list(lanes) for lanes in heats]

    if method == SHARED:
        return _all_tied(ids, SHARED)
    if method == BEST_TIME:
        return _by_best_time(ids, heat_list)
    if method == TOTAL_TIME:
        return _by_total_time(ids, heat_list)
    if method == COUNTBACK:
        return _by_countback(ids, heat_list)
    if method == HEAD_TO_HEAD:
        return _by_head_to_head(ids, heat_list)
    raise ValueError(f"unknown tiebreak method: {method!r}")


def _all_tied(ids: tuple[int, ...], method: str) -> TiebreakResult:
    return TiebreakResult(groups=(ids,), resolved_by=method)


def _racer_lanes(
    ids: tuple[int, ...], heats: list[list[Lane]]
) -> dict[int, list[Lane]]:
    """Every lane each of ``ids`` held, across ``heats``, keyed by racer id."""
    by_racer: dict[int, list[Lane]] = {racer_id: [] for racer_id in ids}
    for lanes in heats:
        for lane in lanes:
            if lane.racer_id in by_racer:
                by_racer[lane.racer_id].append(lane)
    return by_racer


#: What a metric may be, across the four methods that resolve through
#: :func:`_ranked_groups` — a plain number for `BEST_TIME`/`TOTAL_TIME`/
#: `HEAD_TO_HEAD`, or a placement vector for `COUNTBACK`. Never mixed within
#: one call, so ordinary comparison is well-defined for whichever it is.
_Metric = float | tuple[int, ...]


def _ranked_groups(
    ids: tuple[int, ...], values: dict[int, _Metric], method: str
) -> TiebreakResult:
    """Group ``ids`` by their entry in ``values``, best (lowest) value first.

    Inconclusive — one group holding everyone — the moment even one of
    ``ids`` has no entry: comparing the racers who have a value against one
    who does not would mean either inventing data for the one missing it or
    unfairly demoting them behind racers no more deserving, and this module
    does neither. That is how "no timer" (nobody has a value) and a single
    hold-out (one racer has none) both fall through to the same answer.

    Equal values land in the same group without any special case for it —
    "identical times answer nothing" is this, not a separate rule.

    ``method`` is stamped onto the result regardless of whether it actually
    resolves anything — see :attr:`TiebreakResult.resolved_by`.
    """
    if any(racer_id not in values for racer_id in ids):
        return _all_tied(ids, method)

    buckets: dict[_Metric, list[int]] = {}
    for racer_id in ids:
        buckets.setdefault(values[racer_id], []).append(racer_id)

    groups = tuple(tuple(sorted(buckets[key])) for key in sorted(buckets))
    return TiebreakResult(groups=groups, resolved_by=method)


def _by_best_time(ids: tuple[int, ...], heats: list[list[Lane]]) -> TiebreakResult:
    """Each racer's fastest genuinely-recorded heat time; lower wins.

    A DNF — `Lane.seconds` of zero or less — is excluded rather than
    penalised: it is not a real run, so it can never be anyone's *fastest*
    one, and letting a `0.0` stand as the minimum would hand the tiebreak to
    whoever DNF'd first. A racer with no time above zero anywhere has no
    entry at all, which is what makes a race with no timer, or a car that
    never posted a real run, fall through via :func:`_ranked_groups`.
    """
    values: dict[int, _Metric] = {}
    for racer_id, lanes in _racer_lanes(ids, heats).items():
        times = [
            lane.seconds
            for lane in lanes
            if lane.seconds is not None and lane.seconds > 0.0
        ]
        if times:
            values[racer_id] = min(times)
    return _ranked_groups(ids, values, BEST_TIME)


def _by_total_time(ids: tuple[int, ...], heats: list[list[Lane]]) -> TiebreakResult:
    """Each racer's total elapsed time across their recorded heats; lower wins.

    Unlike `BEST_TIME`, a DNF is *counted* here rather than excluded — the
    same `DNF_PENALTY_SECONDS` penalty `domain.scoring.score_heats` applies
    under `TIMED`, and for the same reason: a naive sum would let a `0.0`
    *reduce* a racer's total, rewarding the DNF it should be penalising. A
    racer with no recorded time at all — nothing to sum — has no entry, the
    same "no timer" fall-through `BEST_TIME` uses.
    """
    values: dict[int, _Metric] = {}
    for racer_id, lanes in _racer_lanes(ids, heats).items():
        recorded = [lane.seconds for lane in lanes if lane.seconds is not None]
        if recorded:
            values[racer_id] = sum(
                DNF_PENALTY_SECONDS if seconds <= 0.0 else seconds
                for seconds in recorded
            )
    return _ranked_groups(ids, values, TOTAL_TIME)


def _by_countback(ids: tuple[int, ...], heats: list[list[Lane]]) -> TiebreakResult:
    """Most 1st places, then most 2nds, and so on; a vector, compared in full.

    Each racer's value is ``(-count of 1st places, -count of 2nd places, ...)``
    out to the worst place seen anywhere in the tied group, so every vector is
    the same length and an ordinary tuple comparison does the lexicographic
    work: negating each count makes "more of this place" sort first, and a
    racer who runs out of counts before the leader still compares correctly
    against zeros. A racer with no recorded place anywhere has no entry, which
    is `COUNTBACK`'s own "no data" case — a `POINTS` race always has one, a
    `TIMED` race on a `NONE` timer might not.
    """
    placings: dict[int, Counter[int]] = {}
    worst_place = 0
    for racer_id, lanes in _racer_lanes(ids, heats).items():
        places = [lane.place for lane in lanes if lane.place is not None]
        if places:
            placings[racer_id] = Counter(places)
            worst_place = max(worst_place, max(places))

    if not placings:
        return _all_tied(ids, COUNTBACK)

    values: dict[int, _Metric] = {
        racer_id: tuple(-counts.get(place, 0) for place in range(1, worst_place + 1))
        for racer_id, counts in placings.items()
    }
    return _ranked_groups(ids, values, COUNTBACK)


def _duel_value(lane: Lane) -> float | None:
    """A lane's finishing order for a `HEAD_TO_HEAD` duel — lower wins.

    Prefers the recorded place, which reads the same regardless of the race's
    scoring strategy; falls back to time when no place was recorded. A DNF (a
    time of zero or less) is scored as the `TIMED` DNF penalty rather than
    its literal value — without that a `0.0` would read as the fastest lap in
    the heat, the same trap `_by_best_time` avoids by excluding it outright,
    except here the lane is real and did lose the duel, so it is penalised
    rather than dropped.
    """
    if lane.place is not None:
        return float(lane.place)
    if lane.seconds is not None:
        return DNF_PENALTY_SECONDS if lane.seconds <= 0.0 else lane.seconds
    return None


def _by_head_to_head(ids: tuple[int, ...], heats: list[list[Lane]]) -> TiebreakResult:
    """More wins over the other tied cars, in the heats they shared; more wins.

    Every unordered pair of tied racers who both have a comparable result
    (:func:`_duel_value`) in the same heat contributes one duel; a racer takes
    it on a strictly lower value, and an equal value decides nothing for
    either side, the same as any other identical-value tie. A racer's total is
    summed across every other tied racer they met this way, so the method
    generalises past a pair without changing what it means for exactly two.

    A racer who never shared a comparable heat with *any* other tied racer has
    no entry at all — not a win count of zero, which would read as "met and
    drew every time" — so the whole group falls through to still-tied unless
    everyone in it met somebody. That is `HEAD_TO_HEAD`'s reading of "the two
    cars having met": met is a precondition to being ranked, not a value of
    zero.
    """
    wins: dict[int, int] = dict.fromkeys(ids, 0)
    met: set[int] = set()

    for lanes in heats:
        duelists = {
            lane.racer_id: lane
            for lane in lanes
            if lane.racer_id in wins and _duel_value(lane) is not None
        }
        racers_here = sorted(duelists)
        for i, a in enumerate(racers_here):
            for b in racers_here[i + 1 :]:
                value_a = _duel_value(duelists[a])
                value_b = _duel_value(duelists[b])
                assert value_a is not None and value_b is not None
                met.add(a)
                met.add(b)
                if value_a < value_b:
                    wins[a] += 1
                elif value_b < value_a:
                    wins[b] += 1

    if not met:
        return _all_tied(ids, HEAD_TO_HEAD)

    values: dict[int, _Metric] = {racer_id: -wins[racer_id] for racer_id in met}
    return _ranked_groups(ids, values, HEAD_TO_HEAD)


def _by_run_off(ids: tuple[int, ...], run_off: list[Lane]) -> TiebreakResult:
    """Resolve ``ids`` by a run-off heat's own recorded order (#550).

    Reads a lane the same way a `HEAD_TO_HEAD` duel does (:func:`_duel_value`):
    a recorded place first, a recorded time otherwise, a DNF (a time of zero
    or less) penalised at the ordinary `TIMED` rate rather than read as the
    fastest lap in the heat.

    A racer named in ``ids`` who holds no lane in ``run_off``, or whose lane
    has neither a place nor a time yet, has no entry — the same "no data"
    fall-through every other method uses. That is what lets a run-off heat
    that has been created but not yet armed change nothing: the tie stays
    exactly as unresolved as it was before the heat existed, until it is
    actually run.
    """
    values: dict[int, _Metric] = {}
    for lane in run_off:
        if lane.racer_id in ids:
            value = _duel_value(lane)
            if value is not None:
                values[lane.racer_id] = value
    return _ranked_groups(ids, values, RUN_OFF)
