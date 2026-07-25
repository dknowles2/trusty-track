"""Championship advancement: who moves on, and when a round gets rebuilt.

This logic used to be spread across ``crud.trigger_auto_advancements``,
``crud.invalidate_future_rounds``, and ``scoring.get_advancing_racers``, with
the rebuild rule defined by whatever ``test_rerun_logic.py`` happened to assert
and enforced by swallowing a ``ValueError``. The rules are written down here.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Callable

PACK = "PACK"
DEN = "DEN"
ROUND_PREFIX = "ROUND:"


@dataclass(frozen=True)
class Standing:
    """The slice of a leaderboard entry that advancement actually needs."""

    racer_id: int
    den_id: int | None = None


@dataclass(frozen=True)
class AdvancementRule:
    """How a championship round chooses its field.

    ``source`` is one of:

    ``"PACK"``
        The top ``num_racers`` of the whole race.
    ``"DEN"``
        The top ``num_racers`` *from each den*, so the size of the field scales
        with the number of dens.
    ``"ROUND:<id>"``
        The top ``num_racers`` of one specific round's standings.
    """

    source: str
    num_racers: int

    @property
    def is_round_scoped(self) -> bool:
        return self.source.startswith(ROUND_PREFIX)

    @property
    def source_round_id(self) -> int | None:
        """The referenced round id, or ``None`` if this rule is not round-scoped.

        Also ``None`` for a malformed source such as ``"ROUND:"`` or
        ``"ROUND:abc"``, which callers treat as "nobody advances" rather than
        raising — a typo in a rule should not take down the race.
        """
        if not self.is_round_scoped:
            return None
        try:
            return int(self.source.split(":", 1)[1])
        except (IndexError, ValueError):
            return None


def advancing_racer_ids(
    rule: AdvancementRule,
    standings: Sequence[Standing],
    den_ids: Sequence[int] = (),
) -> list[int]:
    """Pick the racers who advance, given standings already sorted best-first.

    For ``DEN``, ``den_ids`` fixes the order dens are visited in, and therefore
    the order of the returned list — which in turn decides which placeholder
    slot each racer lands in. Racers with no den are not eligible under a
    ``DEN`` rule; they have no den to be the top of.

    A ``num_racers`` of ``None`` means no limit, so everyone advances. That is
    almost certainly not what anyone wants, but it is what the previous
    implementation did (``standings[:None]`` is the whole list) and a round left
    without a racer count is a data problem to surface, not to silently
    reinterpret here.
    """
    if rule.is_round_scoped:
        # The caller is responsible for having scoped `standings` to that round;
        # a source referencing a round that no longer exists advances nobody.
        if rule.source_round_id is None:
            return []
        return [s.racer_id for s in standings[: rule.num_racers]]

    if rule.source == PACK:
        return [s.racer_id for s in standings[: rule.num_racers]]

    if rule.source == DEN:
        advancing: list[int] = []
        for den_id in den_ids:
            in_den = [s for s in standings if s.den_id == den_id]
            advancing.extend(s.racer_id for s in in_den[: rule.num_racers])
        return advancing

    return []


def should_populate(
    rule: AdvancementRule,
    completed_round_id: int,
    prior_rounds_complete: Callable[[], bool],
) -> bool:
    """Whether a championship round can be filled in now.

    A round-scoped rule fires the moment its own source round finishes.
    ``PACK`` and ``DEN`` rules read the standings across everything before them,
    so they wait until *every* earlier round is complete — otherwise the field
    would be picked from a partial leaderboard and then quietly change.

    ``prior_rounds_complete`` is a callable because answering it costs a query
    per earlier round, and a round-scoped rule never needs the answer. This runs
    on every recorded heat result, during a live race.
    """
    if rule.is_round_scoped:
        return rule.source == f"{ROUND_PREFIX}{completed_round_id}"
    if rule.source in (PACK, DEN):
        return prior_rounds_complete()
    return False


def is_round_complete(heats_lanes: Iterable[Sequence]) -> bool:
    """True when every heat in the round is finished.

    A round with no heats is not complete — it has not started. Imported here
    rather than reimplemented: see :func:`backend.domain.lanes.is_complete` for
    what "finished" means for a single heat.
    """
    from backend.domain import lanes as lanes_module

    heats = list(heats_lanes)
    if not heats:
        return False
    return all(lanes_module.is_complete(lanes) for lanes in heats)


# --------------------------------------------------------------------------- #
# The invalidation rule                                                        #
# --------------------------------------------------------------------------- #
#
# Recording a result in round N invalidates the field of every *later*
# championship round, because the standings those rounds were drawn from have
# just changed. That includes clearing a result, which is how the operator
# re-runs a heat.
#
# Two limits on that, both deliberate:
#
#   1. Only rounds with an `advancement_source` are affected. A general round's
#      field is the racer roster, which a result does not change.
#
#   2. A later round that has *already been raced* is left alone. Wiping heats
#      that people have actually run, without asking, is worse than leaving a
#      field that was picked from slightly stale standings — the operator can
#      see and fix the latter. This was previously expressed by calling
#      regeneration and swallowing the ValueError it raised.
#
# Both are pure predicates below so the rule is stated once and testable.


def rounds_to_invalidate(rounds: Iterable, changed_round_number: int) -> list:
    """The championship rounds downstream of a change.

    Takes anything with ``round_number`` and ``advancement_source`` attributes.
    """
    return [
        r
        for r in rounds
        if r.round_number > changed_round_number and r.advancement_source is not None
    ]


def may_rebuild(heats_lanes: Iterable[Sequence]) -> bool:
    """Whether a round's heats can be regenerated without destroying results."""
    from backend.domain import lanes as lanes_module

    return not any(lanes_module.has_results(lanes) for lanes in heats_lanes)
