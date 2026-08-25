"""Leaderboards and advancement, wired to the database.

The rules themselves are in :mod:`backend.domain.scoring` and
:mod:`backend.domain.advancement`. This module does the part that needs a
session: load the heats and racers, hand plain values to the domain, and shape
the answer for callers.

Scoring is always computed on demand — there is no stored leaderboard.
"""

from typing import TypedDict

from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.domain import advancement as domain_advancement
from backend.domain import scoring as domain_scoring


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

    prelim_round_ids = {
        r.id
        for r in rounds
        if r.advancement_source is None and r.id not in elimination_ids
    }
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

    scores = domain_scoring.score_heats(parsed, race.scoring_strategy)
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
    den_id: int | None
    den_name: str
    score: float
    heats_completed: int
    racer_image_url: str | None


class LeaderboardEntry(_LeaderboardRow, total=False):
    """A row, plus the rank stamped on it after sorting.

    Split rather than marked `NotRequired`, which is 3.11; the floor is 3.10.
    """

    rank: int


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

    racer_scores = calculate_racer_scores(db, race_id, round_id=round_id, scope=scope)

    racer_map = {r.id: r for r in crud.get_racers(db, race_id=race_id)}
    den_map = {
        d.id: d
        for d in db.query(models.Den).filter(models.Den.race_id == race_id).all()
    }

    leaderboard: list[LeaderboardEntry] = []
    for racer_id, score_data in racer_scores.items():
        # Skips placeholders and anyone deleted since the heat was scheduled.
        racer = racer_map.get(racer_id)
        if not racer:
            continue

        den = den_map.get(racer.den_id) if racer.den_id else None

        leaderboard.append(
            LeaderboardEntry(
                racer_id=racer_id,
                first_name=racer.first_name,
                last_name=racer.last_name,
                car_number=racer.car_number,
                den_id=racer.den_id,
                den_name=den.name if den else "Unknown",
                score=score_data["score"],
                heats_completed=int(score_data["heats_completed"]),
                racer_image_url=racer.racer_image_url,
            )
        )

    leaderboard.sort(
        key=lambda entry: domain_scoring.rank_key(
            entry["score"], entry["heats_completed"], entry["racer_id"]
        )
    )

    # Competition ranks: a tie shares a rank rather than being silently
    # resolved by registration order (#226).
    ranks = domain_scoring.standings_ranks(
        [(entry["score"], entry["heats_completed"]) for entry in leaderboard]
    )
    for entry, rank in zip(leaderboard, ranks, strict=True):
        entry["rank"] = rank

    return leaderboard


def _elimination_leaderboard(
    db: Session, race_id: int, round_obj: models.Round
) -> list[LeaderboardEntry]:
    """An elimination round's order of finish, shaped like a leaderboard.

    ``score`` is the racer's loss count — lower is better, like everything
    else — but the *order* is the round's own: survivors first, then the
    eliminated by how long they lasted. Two cars knocked out in the same heat
    share a rank, the same visibility rule as #226.
    """
    from backend.domain import elimination as domain_elimination

    heats = crud.get_heats(db, race_id, round_id=round_obj.id)
    parsed = crud.lanes_for_heats(db, heats)
    threshold = round_obj.elimination_losses or 1
    entries = domain_elimination.standings(parsed, threshold)

    completed: dict[int, int] = {}
    for heat_lanes in parsed:
        for lane in heat_lanes:
            racer_id = lane.racer_id
            if racer_id is not None and (
                lane.seconds is not None or lane.place is not None
            ):
                completed[racer_id] = completed.get(racer_id, 0) + 1

    racer_map = {r.id: r for r in crud.get_racers(db, race_id=race_id)}
    den_map = {
        d.id: d
        for d in db.query(models.Den).filter(models.Den.race_id == race_id).all()
    }

    leaderboard: list[LeaderboardEntry] = []
    previous_key: tuple | None = None
    for entry in entries:
        racer = racer_map.get(entry.racer_id)
        if not racer:
            continue
        den = den_map.get(racer.den_id) if racer.den_id else None
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
                den_id=racer.den_id,
                den_name=den.name if den else "Unknown",
                score=float(entry.losses),
                heats_completed=completed.get(entry.racer_id, 0),
                racer_image_url=racer.racer_image_url,
                rank=rank,
            )
        )
    return leaderboard


def _standings_for(db: Session, race_id: int, rule) -> list[LeaderboardEntry]:
    """The leaderboard a rule should be evaluated against.

    ``PACK`` and ``DEN`` read the default prelim-scoped standings, which is what
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


def get_advancing_racers(
    db: Session,
    race_id: int,
    source: str,
    num_top: int | None,
    from_bottom: bool = False,
) -> list[int]:
    """Racer ids that should advance into a championship round, in rank order.

    ``source`` is ``"PACK"``, ``"DEN"``, or ``"ROUND:<id>"``; see
    :class:`backend.domain.advancement.AdvancementRule`. With ``from_bottom``
    the same standings are read from the other end — a Slowest Race bracket —
    and racers with no recorded result are excluded, slowest first in the
    returned order.
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
            den_id=e["den_id"],
            has_raced=e["heats_completed"] > 0,
        )
        for e in entries
        if e["racer_id"] in checked_in
    ]

    den_ids: list[int] = []
    if rule.source == domain_advancement.DEN:
        den_ids = [
            d.id
            for d in db.query(models.Den).filter(models.Den.race_id == race_id).all()
        ]

    return domain_advancement.advancing_racer_ids(rule, standings, den_ids)
