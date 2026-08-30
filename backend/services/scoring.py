"""Leaderboards and advancement, wired to the database.

The rules themselves are in :mod:`backend.domain.scoring` and
:mod:`backend.domain.advancement`. This module does the part that needs a
session: load the heats and racers, hand plain values to the domain, and shape
the answer for callers.

Scoring is always computed on demand — there is no stored leaderboard.
"""

from dataclasses import dataclass
from typing import TypedDict

from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.domain import advancement as domain_advancement
from backend.domain import scoring as domain_scoring
from backend.domain import tiebreak as domain_tiebreak
from backend.domain.lanes import Lane


def _scoring_heats(db: Session, race_id: int, round_id: int | None, scope: str) -> list:
    """The heats that count, given a round filter and a scope.

    An explicit ``round_id`` always wins — asking for one round's standings
    means that round, championship or not. Otherwise ``scope`` decides.

    If a race has no prelim rounds at all, ``PRELIM`` falls back to every heat.
    An empty leaderboard on a race that has clearly been run reads as a bug, and
    "all rounds are championship rounds" is a degenerate setup rather than a
    request for no standings.

    A round **disrupted** by a lane going out of service part-way through is
    dropped under ``POINTS`` and kept under ``TIMED``; see
    :func:`backend.domain.scoring.counts_a_disrupted_round` for why the two
    strategies differ. An explicit ``round_id`` overrides that too — asking for
    one round's standings means that round, disrupted or not, and the screen
    asking is showing that round rather than the race.
    """
    heats = crud.get_heats(db, race_id, round_id=round_id)
    if round_id is not None or scope == domain_scoring.ALL:
        return heats

    race = crud.get_race(db, race_id)
    strategy = race.scoring_strategy if race else domain_scoring.TIMED
    rounds = db.query(models.Round).filter(models.Round.race_id == race_id).all()

    if not domain_scoring.counts_a_disrupted_round(strategy):
        disrupted = {r.id for r in rounds if r.disrupted}
        if disrupted:
            heats = [h for h in heats if h.round_id not in disrupted]

    # An elimination round never feeds the aggregate standings. Its heat
    # counts are uneven *by design* — an eliminated car races fewer heats —
    # which poisons a POINTS sum outright (#26's shape) and skews a TIMED
    # average toward whoever was knocked out early. Its result is survival,
    # and it is read by asking for the round itself.
    elimination_ids = {
        r.id
        for r in rounds
        if r.scheduling_strategy == models.SchedulingStrategy.ELIMINATION
    }
    if elimination_ids:
        heats = [h for h in heats if h.round_id not in elimination_ids]

    # An elimination round has no `advancement_source`, so it would qualify
    # here — but its heats are already gone from `heats` above, which is the
    # filter that matters. Repeating the exclusion in this set changes no
    # answer, so it is not repeated.
    prelim_round_ids = {r.id for r in rounds if r.advancement_source is None}
    if not prelim_round_ids:
        return heats
    return [h for h in heats if h.round_id in prelim_round_ids]


def calculate_racer_scores(
    db: Session,
    race_id: int,
    round_id: int | None = None,
    scope: str = domain_scoring.PRELIM,
) -> dict[int, dict[str, float]]:
    """Per-racer aggregate scores for a race, optionally limited to one round.

    Returns ``{racer_id: {"score", "heats_completed", "total_time",
    "total_points"}}``. Lower ``score`` is better under both strategies.

    See :data:`backend.domain.scoring.PRELIM` for what ``scope`` means.
    """
    race = crud.get_race(db, race_id)
    if not race:
        return {}

    heats = _scoring_heats(db, race_id, round_id, scope)
    parsed = crud.lanes_for_heats(db, heats)

    scores = domain_scoring.score_heats(
        parsed, race.scoring_strategy, race.drop_worst_runs
    )
    return {racer_id: score.as_dict() for racer_id, score in scores.items()}


class _LeaderboardRow(TypedDict):
    """The fields every standings row carries.

    Typed because the entries are sorted on three of them and ranked on the
    result; as a bare dict they are `object` to a checker, and `rank_key` takes
    a float and two ints.
    """

    racer_id: int
    first_name: str
    last_name: str
    car_number: int | None
    racing_group_id: int | None
    racing_group_name: str
    racing_group_division: str | None
    score: float
    heats_completed: int
    racer_image_url: str | None
    #: The tiebreak method that gave this row a rank it no longer shares with
    #: anyone (#540) — e.g. ``"BEST_TIME"`` — or ``None`` when the row was
    #: never tied, or was tied and the chain left it that way. Always present,
    #: never left for a caller to default: `_elimination_leaderboard` names
    #: its own reason for the same shape by setting it to ``None`` outright,
    #: since #540 is explicitly out of scope for that format.
    resolved_by: str | None
    #: Whether `Race.drop_worst_runs` (#547 stage 2) actually dropped a run
    #: from this leaderboard — one flag, riding on every row, since it is a
    #: fact about the whole computation rather than about any one racer (the
    #: same "riding along" shape `racing_group_division` already uses for
    #: its own race-wide fact). `False` under an elimination round's own
    #: leaderboard, which never calls `domain.scoring.score_heats` at all —
    #: the modifier has nothing to apply to there.
    drop_worst_runs_applied: bool


class LeaderboardEntry(_LeaderboardRow, total=False):
    """A row, plus the rank stamped on it after sorting.

    Split rather than marked `NotRequired`, which is 3.11; the floor is 3.10.
    """

    rank: int


def _grand_final_exclusions(
    db: Session,
    race: models.Race,
    race_id: int,
    round_id: int | None,
    scope: str,
) -> set[int]:
    """Racer ids to drop because a decided championship round already gave
    them something, and ``Race.exclude_round_winners_from_qualifying_standings``
    says the round they qualified from should not also credit them (#548) —
    a Grand Finals pack champion who should not also hold their own den's
    trophy.

    Applies only to the exact standings a championship round's field was
    actually drawn from: ``round_id`` for a ``"ROUND:<id>"`` source, or the
    aggregate prelim scope (``round_id=None``, ``scope=PRELIM``) for
    ``"ALL"`` and ``"EACH_GROUP"`` — the same scope :func:`_standings_for`
    reads when it picks a championship round's field. A round that has not
    yet decided a winner excludes nobody; a correction that un-decides one
    un-excludes them on the very next read, the same #17 rule as everything
    else here. Elimination rounds are skipped — their "winner" is whoever
    survives, not a rank-1 leaderboard row, and #548 does not ask for that
    format to be covered.
    """
    if not race.exclude_round_winners_from_qualifying_standings:
        return set()
    if scope != domain_scoring.PRELIM:
        return set()

    excluded: set[int] = set()
    championship_rounds = (
        db.query(models.Round)
        .filter(
            models.Round.race_id == race_id,
            models.Round.advancement_source.isnot(None),
            models.Round.scheduling_strategy != models.SchedulingStrategy.ELIMINATION,
        )
        .all()
    )
    for champ_round in championship_rounds:
        # `round_id_in` already answers `None` for `"ALL"` and
        # `"EACH_GROUP"` — the aggregate prelim scope this function is
        # itself called with when `round_id` is `None`.
        source_round_id = domain_advancement.round_id_in(
            champ_round.advancement_source or ""
        )
        if source_round_id != round_id:
            continue
        if not crud.is_round_complete(db, champ_round.id):
            continue
        champ_leaderboard = get_leaderboard(db, race_id, round_id=champ_round.id)
        excluded.update(
            entry["racer_id"] for entry in champ_leaderboard if entry.get("rank") == 1
        )
    return excluded


def get_leaderboard(
    db: Session,
    race_id: int,
    round_id: int | None = None,
    scope: str = domain_scoring.PRELIM,
) -> list[LeaderboardEntry]:
    """Current standings, best first, each entry carrying a 1-indexed ``rank``.

    By default this covers **prelim rounds only** — rounds with no
    ``advancement_source``. Championship heats are excluded because they are a
    consequence of the standings, not an input to them; see
    :data:`backend.domain.scoring.PRELIM` and issue #17.

    Pass ``round_id`` for one round's standings, or ``scope=ALL`` for the
    whole-race average the app used before #17.
    """
    race = crud.get_race(db, race_id)
    if not race:
        return []

    if round_id is not None:
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if (
            round_obj
            and round_obj.scheduling_strategy == models.SchedulingStrategy.ELIMINATION
        ):
            return _elimination_leaderboard(db, race_id, round_obj)

    heats = _scoring_heats(db, race_id, round_id, scope)
    parsed = crud.lanes_for_heats(db, heats)

    racer_map = {r.id: r for r in crud.get_racers(db, race_id=race_id)}
    grand_final_excluded = _grand_final_exclusions(db, race, race_id, round_id, scope)
    excluded_ids = {
        racer_id for racer_id, r in racer_map.items() if r.excluded_from_standings
    } | grand_final_excluded

    # A car that races and is not ranked (#548) — check-in, heat generation
    # and the live views never read this flag; only this one place does. Its
    # lanes are stripped *before* scoring, not merely dropped from the rows
    # below, so `drop_worst_status`'s "did every ranked racer have the same
    # number of counted results" reasons about the ranked population only —
    # an exhibition car with an irregular heat count must not silently turn
    # the modifier off for everybody else. The trade a caller accepts for
    # that: under POINTS, a DNF or skipped lane in the same heat as an
    # excluded racer is now scored last among the *ranked* cars still in it
    # rather than the true physical field size — a minor, deliberate cost,
    # not an oversight.
    if excluded_ids:
        parsed = [
            [lane for lane in heat_lanes if lane.racer_id not in excluded_ids]
            for heat_lanes in parsed
        ]

    drop_worst_runs_applied = domain_scoring.drop_worst_status(
        parsed, race.scoring_strategy, race.drop_worst_runs
    )
    scores = domain_scoring.score_heats(
        parsed, race.scoring_strategy, race.drop_worst_runs
    )
    racer_scores = {racer_id: score.as_dict() for racer_id, score in scores.items()}

    racing_group_map = {
        d.id: d
        for d in db.query(models.RacingGroup)
        .filter(models.RacingGroup.race_id == race_id)
        .all()
    }

    leaderboard: list[LeaderboardEntry] = []
    for racer_id, score_data in racer_scores.items():
        # Skips placeholders and anyone deleted since the heat was scheduled.
        # An excluded racer never reaches this loop at all — their lanes were
        # stripped above, so `score_heats` never produced an entry for them.
        racer = racer_map.get(racer_id)
        if not racer:
            continue

        racing_group = (
            racing_group_map.get(racer.racing_group_id)
            if racer.racing_group_id
            else None
        )

        leaderboard.append(
            LeaderboardEntry(
                racer_id=racer_id,
                first_name=racer.first_name,
                last_name=racer.last_name,
                car_number=racer.car_number,
                racing_group_id=racer.racing_group_id,
                racing_group_name=racing_group.name if racing_group else "Unknown",
                racing_group_division=racing_group.division
                if racing_group and racing_group.division
                else None,
                score=score_data["score"],
                heats_completed=int(score_data["heats_completed"]),
                racer_image_url=racer.racer_image_url,
                resolved_by=None,
                drop_worst_runs_applied=drop_worst_runs_applied,
            )
        )

    leaderboard.sort(
        key=lambda entry: domain_scoring.rank_key(
            entry["score"], entry["heats_completed"], entry["racer_id"]
        )
    )

    # Break same-score clusters per the race's tiebreaker (#540) — reorders
    # `leaderboard` in place within each cluster, stamps `resolved_by` on
    # every row it separated, and reports which adjacent pairs stopped being
    # tied so the rank stamped below does not share one for them.
    separated = _resolve_ties(leaderboard, parsed, race.tiebreaker)

    # Competition ranks: a tie shares a rank rather than being silently
    # resolved by registration order (#226).
    ranks = domain_scoring.standings_ranks(
        [(entry["score"], entry["heats_completed"]) for entry in leaderboard],
        separated=separated,
    )
    for entry, rank in zip(leaderboard, ranks, strict=True):
        entry["rank"] = rank

    return leaderboard


def _resolve_ties(
    leaderboard: list[LeaderboardEntry],
    heats: list[list[Lane]],
    method: str,
) -> list[bool]:
    """Break each same-score cluster in ``leaderboard`` per ``method`` (#540).

    ``leaderboard`` must already be sorted by :func:`domain_scoring.rank_key`,
    so every cluster of equal-score, already-raced rows is contiguous.
    Mutates it in place, reordering a cluster to
    :attr:`backend.domain.tiebreak.TiebreakResult.order` and stamping
    ``resolved_by`` on any row the method left standing alone — no longer
    sharing its rank with anyone it was tied with. A row still sharing a group
    with somebody keeps ``resolved_by`` at its initial ``None``: the chain did
    not decide it, so it is reported exactly like a tie always has been.

    Returns a same-length list of booleans: ``[i]`` is ``True`` when row ``i``
    is no longer considered tied with row ``i - 1`` despite an equal score —
    what :func:`domain_scoring.standings_ranks` needs to stop sharing their
    rank. Rows outside any cluster are always ``False`` there, which changes
    nothing: their scores already differ, so `standings_ranks` was never going
    to tie them regardless.

    ``method == SHARED`` (or any inconclusive answer) reorders a cluster to
    exactly its input order — :func:`backend.domain.tiebreak.tiebreak`'s own
    unresolved answer sorts racer ids ascending, the same tiebreak
    :func:`domain_scoring.rank_key` already applied to get that order — so a
    race left on the default sees no change at all.
    """
    separated = [False] * len(leaderboard)
    index = 0
    n = len(leaderboard)
    while index < n:
        start = index
        while (
            index + 1 < n
            and leaderboard[start]["heats_completed"] > 0
            and leaderboard[index + 1]["heats_completed"] > 0
            and float(leaderboard[index + 1]["score"])
            == float(leaderboard[start]["score"])
        ):
            index += 1
        end = index  # inclusive

        if end > start:
            cluster = leaderboard[start : end + 1]
            racer_ids = [entry["racer_id"] for entry in cluster]
            result = domain_tiebreak.tiebreak(racer_ids, heats, method)

            order_position = {
                racer_id: position for position, racer_id in enumerate(result.order)
            }
            cluster.sort(key=lambda entry: order_position[entry["racer_id"]])
            leaderboard[start : end + 1] = cluster

            for i in range(start + 1, end + 1):
                a = leaderboard[i - 1]["racer_id"]
                b = leaderboard[i]["racer_id"]
                if not result.still_tied(a, b):
                    separated[i] = True

            group_size = {
                racer_id: len(group) for group in result.groups for racer_id in group
            }
            for entry in cluster:
                if group_size[entry["racer_id"]] == 1:
                    entry["resolved_by"] = method

        index += 1

    return separated


def _elimination_leaderboard(
    db: Session, race_id: int, round_obj: models.Round
) -> list[LeaderboardEntry]:
    """An elimination round's order of finish, shaped like a leaderboard.

    ``score`` is the racer's loss count — lower is better, like everything
    else — but the *order* is the round's own: survivors first, then the
    eliminated by how long they lasted. Two cars knocked out in the same heat
    share a rank, the same visibility rule as #226.

    Filtered to who is still checked in, the same population
    `crud.extend_elimination_round` fields the next wave from (#313). A
    withdrawn car that never lost a heat — every lane it held was skipped,
    never raced — would otherwise sit at zero losses and tie the actual
    winner for first, though it never crossed the line.

    Also filtered to who is not `excluded_from_standings` (#548) — survival
    order is still a ranking. Elimination has no "round they qualified
    from" in the sense `Race.exclude_round_winners_from_qualifying_standings`
    means, so only the racer-level flag applies here, not the Grand Finals
    one.
    """
    from backend.domain import elimination as domain_elimination

    heats = crud.get_heats(db, race_id, round_id=round_obj.id)
    parsed = crud.lanes_for_heats(db, heats)
    threshold = round_obj.elimination_losses or 1
    eligible = set(crud.eligible_racer_ids(db, race_id, round_obj.racing_group_id))

    racer_map = {r.id: r for r in crud.get_racers(db, race_id=race_id)}
    excluded_ids = {
        racer_id for racer_id, r in racer_map.items() if r.excluded_from_standings
    }
    entries = [
        entry
        for entry in domain_elimination.standings(parsed, threshold)
        if entry.racer_id in eligible and entry.racer_id not in excluded_ids
    ]

    completed: dict[int, int] = {}
    for heat_lanes in parsed:
        for lane in heat_lanes:
            racer_id = lane.racer_id
            if racer_id is not None and (
                lane.seconds is not None or lane.place is not None
            ):
                completed[racer_id] = completed.get(racer_id, 0) + 1

    racing_group_map = {
        d.id: d
        for d in db.query(models.RacingGroup)
        .filter(models.RacingGroup.race_id == race_id)
        .all()
    }

    leaderboard: list[LeaderboardEntry] = []
    previous_key: tuple | None = None
    for entry in entries:
        racer = racer_map.get(entry.racer_id)
        if not racer:
            continue
        racing_group = (
            racing_group_map.get(racer.racing_group_id)
            if racer.racing_group_id
            else None
        )
        key = (entry.alive, entry.losses, entry.out_after)
        rank = (
            leaderboard[-1]["rank"]
            if leaderboard and key == previous_key
            else len(leaderboard) + 1
        )
        previous_key = key
        leaderboard.append(
            LeaderboardEntry(
                racer_id=entry.racer_id,
                first_name=racer.first_name,
                last_name=racer.last_name,
                car_number=racer.car_number,
                racing_group_id=racer.racing_group_id,
                racing_group_name=racing_group.name if racing_group else "Unknown",
                racing_group_division=racing_group.division
                if racing_group and racing_group.division
                else None,
                score=float(entry.losses),
                heats_completed=completed.get(entry.racer_id, 0),
                racer_image_url=racer.racer_image_url,
                rank=rank,
                # #540 is deliberately out of scope for elimination — its
                # rank sharing is survival, not a score, and has its own rule
                # above. Always present, never left implicit, same as the
                # ordinary leaderboard's rows.
                resolved_by=None,
                # Drop-worst is a modifier over `domain.scoring.score_heats`,
                # which this leaderboard never calls — survival is scored by
                # loss count, not by any of the four strategies it modifies.
                drop_worst_runs_applied=False,
            )
        )
    return leaderboard


def _standings_for(db: Session, race_id: int, rule) -> list[LeaderboardEntry]:
    """The leaderboard a rule should be evaluated against.

    ``ALL`` and ``EACH_GROUP`` read the default prelim-scoped standings, which is what
    breaks the feedback loop #17 describes: before this, a championship result
    fed back into the leaderboard that had chosen the championship field, so
    recording a final-round time could change who was supposed to be in the
    final round. ``crud.record_heat_result`` re-runs advancement after every
    result, so that loop was live during a race.
    """
    if rule.is_round_scoped:
        round_id = rule.source_round_id
        if round_id is None:
            return []
        return get_leaderboard(db, race_id, round_id=round_id)
    return get_leaderboard(db, race_id)


@dataclass
class AdvancementPick:
    """A championship round's provisional field, and whether the cut holding
    it together is a tie the tiebreak chain did not settle (#540).

    Two fields off one computation rather than two functions each re-running
    it: `_advancement_status` needs both, and a second call would mean a
    second full `get_leaderboard` pass for every round on screen.
    """

    winner_ids: list[int]
    #: The last qualifying slot is contested and unresolved — see
    #: `domain.advancement.cut_is_contested`. The pick above is still made,
    #: provisionally, so the round stays runnable (#48).
    contested: bool


def pick_advancing_racers(
    db: Session,
    race_id: int,
    source: str,
    num_top: int | None,
    from_bottom: bool = False,
) -> AdvancementPick:
    """Both the provisional field and the contested-cut flag, in one pass.

    :func:`get_advancing_racers` is a thin wrapper over this that keeps its
    old signature and return type for its three other callers, which only
    ever wanted the ids. `_advancement_status` in `schema.py` calls this
    directly so computing both costs one `get_leaderboard` pass, not two.
    """
    rule = domain_advancement.AdvancementRule(
        source=source, num_racers=num_top, from_bottom=from_bottom
    )

    entries = _standings_for(db, race_id, rule)

    # A racer who is no longer checked in does not advance (#228). Their
    # recorded results stand — they stay on the leaderboard — but a
    # championship slot is a place in a race yet to run, and handing one to a
    # car that has left the building wastes it. The next qualifier steps up,
    # which is what "top N" means once somebody scratches.
    checked_in = {
        r.id
        for r in db.query(models.Racer)
        .filter(models.Racer.race_id == race_id, models.Racer.car_passed_inspection)
        .all()
    }
    standings = [
        domain_advancement.Standing(
            racer_id=e["racer_id"],
            racing_group_id=e["racing_group_id"],
            has_raced=e["heats_completed"] > 0,
            # The rank `standings_ranks` stamped this row with (#540) — two
            # rows sharing one is the standings' own record of an unresolved
            # tie, which `cut_is_contested` reads.
            rank=e["rank"],
        )
        for e in entries
        if e["racer_id"] in checked_in
    ]

    racing_group_ids: list[int] = []
    if rule.source == domain_advancement.EACH_GROUP:
        # Ordered (#316): racing group order decides which placeholder slot
        # each racing group's qualifiers land in, so an unordered query is
        # the #240 failure mode
        # on the advancement path — same seed, different field, on a plan
        # change SQLite gives no warning before making.
        racing_group_ids = [
            d.id
            for d in db.query(models.RacingGroup)
            .filter(models.RacingGroup.race_id == race_id)
            .order_by(models.RacingGroup.id)
            .all()
        ]

    winner_ids = domain_advancement.advancing_racer_ids(
        rule, standings, racing_group_ids
    )
    contested = domain_advancement.cut_is_contested(rule, standings, racing_group_ids)
    return AdvancementPick(winner_ids=winner_ids, contested=contested)


def get_advancing_racers(
    db: Session,
    race_id: int,
    source: str,
    num_top: int | None,
    from_bottom: bool = False,
) -> list[int]:
    """Racer ids that should advance into a championship round, in rank order.

    ``source`` is ``"ALL"``, ``"EACH_GROUP"``, or ``"ROUND:<id>"``; see
    :class:`backend.domain.advancement.AdvancementRule`. With ``from_bottom``
    the same standings are read from the other end — a Slowest Race bracket —
    and racers with no recorded result are excluded, slowest first in the
    returned order.

    A racer with ``excluded_from_standings`` set never appears here (#548):
    ``_standings_for`` reads ``get_leaderboard``, which already dropped them,
    so this falls out for free rather than needing its own copy of the rule.
    """
    return pick_advancing_racers(
        db, race_id, source, num_top, from_bottom=from_bottom
    ).winner_ids
