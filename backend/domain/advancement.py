"""Championship advancement: who moves on, and when a round gets rebuilt.

This logic used to be spread across ``crud.trigger_auto_advancements``,
``crud.invalidate_future_rounds``, and ``scoring.get_advancing_racers``, with
the rebuild rule defined by whatever ``test_rerun_logic.py`` happened to assert
and enforced by swallowing a ``ValueError``. The rules are written down here.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

ALL = "ALL"
EACH_GROUP = "EACH_GROUP"
ROUND_PREFIX = "ROUND:"


@dataclass(frozen=True)
class Standing:
    """The slice of a leaderboard entry that advancement actually needs.

    Also what an award is resolved against; see :mod:`backend.domain.awards`.

    ``has_raced`` matters only when picking from the bottom: the leaderboard
    sorts racers with no results *below* everyone who has raced, so the naive
    bottom of the standings is full of cars that never ran. A car that never
    ran is not the slowest car, it is an absent one. Defaults true so the
    top-picking callers, for whom the distinction changes nothing, need not
    say anything.

    ``rank`` is the competition rank :func:`backend.domain.scoring.
    standings_ranks` stamped on the row this came from — ``None`` when a
    caller has not supplied one (every caller before #540). Two standings
    sharing a rank are, by that function's own rule, a tie the tiebreak chain
    did not separate; :func:`cut_is_contested` reads it for exactly that
    reason and nothing here compares it to anything else.
    """

    racer_id: int
    racing_group_id: int | None = None
    has_raced: bool = True
    rank: int | None = None


def is_round_scoped(source: str) -> bool:
    """Whether a source string names one round rather than a population."""
    return source.startswith(ROUND_PREFIX)


def round_id_in(source: str) -> int | None:
    """The round id a source names, or ``None`` if it does not name one.

    Also ``None`` for a malformed source such as ``"ROUND:"`` or
    ``"ROUND:abc"``, which callers treat as "nobody qualifies" rather than
    raising — a typo in a rule should not take down the race.

    Module-level rather than only a property of :class:`AdvancementRule`,
    because awards speak the same source vocabulary and there should be one
    parser for it.
    """
    if not is_round_scoped(source):
        return None
    try:
        return int(source.split(":", 1)[1])
    except (IndexError, ValueError):
        return None


@dataclass(frozen=True)
class AdvancementRule:
    """How a championship round chooses its field.

    ``source`` is one of:

    ``"ALL"``
        The top ``num_racers`` of the whole race.
    ``"EACH_GROUP"``
        The top ``num_racers`` *from each racing group*, so the size of the field
        scales with the number of racing groups.
    ``"ROUND:<id>"``
        The top ``num_racers`` of one specific round's standings.

    ``from_bottom`` flips which end of those standings the field comes from —
    a "Slowest Race" bracket. The source vocabulary is deliberately unchanged
    by the flip: slowest-overall, slowest-per-racing-group and slowest-of-a-round
    are all the same standings read from the other end, so a second vocabulary
    would be a second copy of this one.
    """

    source: str
    #: ``None`` means no limit — everyone in the source advances.
    num_racers: int | None
    from_bottom: bool = False

    @property
    def is_round_scoped(self) -> bool:
        return is_round_scoped(self.source)

    @property
    def source_round_id(self) -> int | None:
        """The referenced round id, or ``None`` if this rule is not round-scoped."""
        return round_id_in(self.source)


def _picking_order(
    rule: AdvancementRule, standings: Sequence[Standing]
) -> list[Standing]:
    """The standings, ordered so slicing from the front picks the field.

    For a top rule that is the order given. For a bottom rule the list is
    reversed — slowest first, so slot 1 goes to the slowest car, the mirror of
    slot 1 going to the fastest — and racers who have not raced are dropped
    first: the leaderboard sorts them below everyone with a result, so the raw
    bottom of the standings is cars that never ran, not slow ones.
    """
    if not rule.from_bottom:
        return list(standings)
    return [s for s in reversed(standings) if s.has_raced]


def advancing_racer_ids(
    rule: AdvancementRule,
    standings: Sequence[Standing],
    racing_group_ids: Sequence[int] = (),
) -> list[int]:
    """Pick the racers who advance, given standings already sorted best-first.

    For ``EACH_GROUP``, ``racing_group_ids`` fixes the order racing groups are
    visited in, and therefore the order of the returned list — which in turn
    decides which placeholder slot each racer lands in. Racers with no racing
    group are not eligible under a ``EACH_GROUP`` rule; they have no racing
    group to be the top of.

    A ``num_racers`` of ``None`` means no limit, so everyone advances. That is
    almost certainly not what anyone wants, but it is what the previous
    implementation did (``standings[:None]`` is the whole list) and a round left
    without a racer count is a data problem to surface, not to silently
    reinterpret here.
    """
    ordered = _picking_order(rule, standings)

    if rule.is_round_scoped:
        # The caller is responsible for having scoped `standings` to that round;
        # a source referencing a round that no longer exists advances nobody.
        if rule.source_round_id is None:
            return []
        return [s.racer_id for s in ordered[: rule.num_racers]]

    if rule.source == ALL:
        return [s.racer_id for s in ordered[: rule.num_racers]]

    if rule.source == EACH_GROUP:
        advancing: list[int] = []
        for racing_group_id in racing_group_ids:
            in_group = [s for s in ordered if s.racing_group_id == racing_group_id]
            advancing.extend(s.racer_id for s in in_group[: rule.num_racers])
        return advancing

    return []


def should_populate(
    rule: AdvancementRule,
    source_round_complete: Callable[[int], bool],
    prior_rounds_complete: Callable[[], bool],
) -> bool:
    """Whether a championship round can be filled in now.

    A round-scoped rule fires when its source round is complete. ``ALL`` and
    ``EACH_GROUP`` rules read the standings across everything before them, so they
    wait until *every* earlier round is complete — otherwise the field would
    be picked from a partial leaderboard and then quietly change.

    The question is about the state of the race *now*, never about which round
    just finished. It used to be the latter — a round-scoped rule fired only on
    its own source's completion event — and that stranded a final twice over
    (#248): an earlier-round correction reset its field to placeholders after
    the source round had already finished (which never finishes again), and a
    round created after its source was done had no event left to fire on.
    Stated over the present, the answer is the same wherever it is asked from,
    and a stranded round heals on the next opportunity.

    Both answers arrive as callables because each costs queries — one per
    earlier round for ``prior_rounds_complete`` — and each kind of rule needs
    only its own. This runs on every recorded heat result, during a live race.
    """
    if rule.is_round_scoped:
        source_id = rule.source_round_id
        return source_id is not None and source_round_complete(source_id)
    if rule.source in (ALL, EACH_GROUP):
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

    Takes anything with ``round_number``, ``advancement_source`` and
    ``field_pinned`` attributes.

    A pinned round is left out (#711). Its field was chosen by hand, so the
    standings moving says nothing about it — and this is the list the cascade
    both *resets* and *re-populates* from, so leaving it out here is what
    makes a hand-picked line-up survive the next recorded preliminary result.
    The pin is the whole of the rule: the source vocabulary is unchanged, and
    a pinned round still names the source and count its suggestion came from.
    """
    return [
        r
        for r in rounds
        if r.round_number > changed_round_number
        and r.advancement_source is not None
        and not r.field_pinned
    ]


def hand_pick_problem(
    racer_ids: Sequence[int], eligible_ids: Iterable[int]
) -> str | None:
    """The first thing wrong with a hand-picked line-up, or ``None`` (#711).

    ``eligible_ids`` is who may be picked — the caller supplies this race's
    checked-in racers, because a slot in a race yet to run never goes to a
    car that has left the building (#228), and picking by hand is not a way
    round that: the operator can check the car in first, which is one click.
    A duplicate is refused rather than folded, since a list naming one car
    twice is a mistake the operator should see rather than a field one car
    short of what they typed.

    Two is the floor. A one-car "final" schedules a single heat of one lane,
    which is not a race; and ``advancement_num_racers`` is a *suggestion*
    here rather than a constraint, so there is deliberately no ceiling and
    no requirement to match it — a hand-picked field is exactly as large as
    the hand picked it.
    """
    if len(racer_ids) < 2:
        return "A hand-picked line-up needs at least two racers."
    if len(set(racer_ids)) != len(racer_ids):
        return "The same racer is listed more than once."
    eligible = set(eligible_ids)
    if any(racer_id not in eligible for racer_id in racer_ids):
        return "Only checked-in racers in this race can be picked."
    return None


def may_rebuild(heats_lanes: Iterable[Sequence]) -> bool:
    """Whether a round's heats can be regenerated without destroying results."""
    from backend.domain import lanes as lanes_module

    return not any(lanes_module.has_results(lanes) for lanes in heats_lanes)


def field_size(rule: AdvancementRule, racing_group_count: int) -> int:
    """How many slots a round drawing on this rule needs.

    Issue #52. ``num_racers`` is per *racing group* when the source is
    ``EACH_GROUP`` and absolute otherwise, which is the sort of detail that
    gets copied correctly once and then not. It was in four places: right in
    ``createRoundWizard``, right in ``revert_round_to_placeholders`` (which
    nothing called), and wrong in both ``createRound`` and
    ``invalidate_future_rounds`` — so recording any preliminary heat shrank a
    EACH_GROUP final to a fraction of its field and dropped racers who had
    qualified for it.

    ``racing_group_count`` is only read for ``EACH_GROUP``; callers may pass 0
    otherwise.
    """
    num_racers = rule.num_racers or 0
    return num_racers * racing_group_count if rule.source == EACH_GROUP else num_racers


def placeholder_slots(heats_lanes: Iterable[Sequence]) -> set[int]:
    """Every distinct placeholder slot the round is still holding open.

    Counted from the heats rather than from ``advancement_num_racers``, because
    the two disagree for a ``EACH_GROUP`` round — that one has ``num_racers`` slots
    *per racing group* — and what matters here is what was actually generated.
    """
    return {
        lane.placeholder_slot
        for lanes in heats_lanes
        for lane in lanes
        if lane.placeholder_slot is not None
    }


def scheduled_participant_count(heats_lanes: Iterable[Sequence]) -> int:
    """How many distinct participants a round's existing heats were built for.

    PPC schedules one heat per participant per run (#26), so this is also how
    many heats make up a single run — the divisor a rebuild needs to recover
    how many runs a round held (#230).

    Counted from the heats rather than from ``Round.total_participants``,
    which is the round's *requested* field size. The two disagree whenever
    the field came up short of the request (#48) — a racing group of three answering
    a request for four — and dividing by the request instead of the actual
    field is how a short-field multi-run final collapsed to one run on the
    very next prelim correction (#311): the heats held three participants
    per run, not four, and ``6 // 4`` is not ``6 // 3``.

    Real racers and placeholder slots are different identity spaces — a
    lane's ``racer_id`` and ``placeholder_slot`` never collide — so both are
    counted, keyed apart.
    """
    participants: set[tuple[str, int]] = set()
    for lanes in heats_lanes:
        for lane in lanes:
            if lane.racer_id is not None:
                participants.add(("racer", lane.racer_id))
            elif lane.placeholder_slot is not None:
                participants.add(("slot", lane.placeholder_slot))
    return len(participants)


def field_is_short(heats_lanes: Iterable[Sequence], advancing_count: int) -> bool:
    """Fewer racers qualified than the round was built to hold.

    Issue #48. ``advancement_num_racers`` is a *request* — "top four" — but a
    racing group with three racers in it can only ever supply three. The round's heats
    are generated from the request, before anyone has qualified, so the surplus
    slots are placeholders that no advancement will ever fill.

    Left alone they are fatal rather than untidy: ``heat_session.phase`` reports
    ``NOT_READY`` while any placeholder remains, and the operator screen offers
    no controls at all in that state. The round cannot be run, edited or
    skipped, on race day, in front of everyone.

    So the answer is not to fill the slots but to stop pretending they exist —
    the caller rebuilds the round for the field that actually qualified.
    """
    return advancing_count < len(placeholder_slots(heats_lanes))


def field_is_stale(heats_lanes: Iterable[Sequence], winner_ids: Iterable[int]) -> bool:
    """A raced championship round whose field has drifted from the standings.

    Issue #229. Recording — or clearing — a result upstream moves the
    standings a championship field was drawn from, and only a round that has
    *already been raced* can go stale: an unraced one is simply re-fielded by
    invalidation the moment the standings move, so a mismatch there is a bug,
    not a state worth surfacing.

    Compared as sets, never lists: lane order is the scheduler's business, not
    part of what "the same field" means. A round holding no real racers yet —
    every lane still a placeholder — is not stale either; it has no field to
    have drifted from.
    """
    from backend.domain import lanes as lanes_module

    heats = list(heats_lanes)
    actual_field = {
        lane.racer_id for lanes in heats for lane in lanes if lane.racer_id is not None
    }
    winners = set(winner_ids)
    raced = any(lanes_module.has_results(lanes) for lanes in heats)
    return raced and bool(actual_field) and actual_field != winners


def _boundary_contested(ordered: Sequence[Standing], num_racers: int) -> bool:
    """Whether slot ``num_racers`` and the one just past it are still tied.

    ``ordered`` is standings already arranged the way the field is picked —
    see :func:`_picking_order` — each carrying the rank its row was stamped
    with. Two adjacent rows sharing a rank is exactly what
    :func:`backend.domain.scoring.standings_ranks` means by "still tied":
    a resolved pair stops sharing one. A rank of ``None`` — a caller that
    built ``Standing`` without one — never counts as contested, so a caller
    that forgets to supply it fails closed rather than flagging every cut.
    """
    if num_racers <= 0 or num_racers >= len(ordered):
        return False
    last_in = ordered[num_racers - 1].rank
    first_out = ordered[num_racers].rank
    return last_in is not None and last_in == first_out


def cut_is_contested(
    rule: AdvancementRule,
    standings: Sequence[Standing],
    racing_group_ids: Sequence[int] = (),
) -> bool:
    """Whether the last qualifying slot is a tie the chain did not settle (#540).

    ``standings`` must carry each row's ``rank`` — see :class:`Standing` — and
    the same population and order :func:`advancing_racer_ids` would pick from;
    the caller that builds one builds the other. A ``num_racers`` of ``None``
    or non-positive needs no answer: there is no boundary to be contested.

    The flag says nothing about *which* racer holds the slot — that pick is
    still made, provisionally, by :func:`advancing_racer_ids`, exactly as it
    always was, so the round stays runnable (#48: a placeholder that can never
    fill locks the operator screen entirely). This is only the seeing half,
    the same shape as :func:`field_is_stale`.
    """
    if rule.num_racers is None or rule.num_racers <= 0:
        return False

    if rule.is_round_scoped or rule.source == ALL:
        return _boundary_contested(_picking_order(rule, standings), rule.num_racers)

    if rule.source == EACH_GROUP:
        ordered = _picking_order(rule, standings)
        for racing_group_id in racing_group_ids:
            in_group = [s for s in ordered if s.racing_group_id == racing_group_id]
            if _boundary_contested(in_group, rule.num_racers):
                return True
        return False

    return False
