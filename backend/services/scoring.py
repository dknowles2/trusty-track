"""Leaderboards and advancement, wired to the database.

The rules themselves are in :mod:`backend.domain.scoring` and
:mod:`backend.domain.advancement`. This module does the part that needs a
session: load the heats and racers, hand plain values to the domain, and shape
the answer for callers.

Scoring is always computed on demand — there is no stored leaderboard.
"""

from typing import NotRequired, TypedDict

from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.domain import advancement as domain_advancement
from backend.domain import lanes as domain_lanes
from backend.domain import scoring as domain_scoring


def _scoring_heats(db: Session, race_id: int, round_id: int | None, scope: str) -> list:
    """The heats that count, given a round filter and a scope.

    An explicit ``round_id`` always wins — asking for one round's standings
    means that round, championship or not. Otherwise ``scope`` decides.

    If a race has no prelim rounds at all, ``PRELIM`` falls back to every heat.
    An empty leaderboard on a race that has clearly been run reads as a bug, and
    "all rounds are championship rounds" is a degenerate setup rather than a
    request for no standings.
    """
    heats = crud.get_heats(db, race_id, round_id=round_id)
    if round_id is not None or scope == domain_scoring.ALL:
        return heats

    prelim_round_ids = {
        r.id
        for r in db.query(models.Round).filter(
            models.Round.race_id == race_id,
            models.Round.advancement_source.is_(None),
        )
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
    parsed = [domain_lanes.parse(heat.lane_results) for heat in heats]

    scores = domain_scoring.score_heats(parsed, race.scoring_strategy)
    return {racer_id: score.as_dict() for racer_id, score in scores.items()}


class LeaderboardEntry(TypedDict):
    """One row of the standings.

    Typed because the entries are sorted on three of these fields and ranked on
    the result; as a bare dict they are `object` to a checker, and `rank_key`
    takes a float and two ints.
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
    rank: NotRequired[int]


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

    for idx, entry in enumerate(leaderboard):
        entry["rank"] = idx + 1

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
    db: Session, race_id: int, source: str, num_top: int
) -> list[int]:
    """Racer ids that should advance into a championship round, in rank order.

    ``source`` is ``"PACK"``, ``"DEN"``, or ``"ROUND:<id>"``; see
    :class:`backend.domain.advancement.AdvancementRule`.
    """
    rule = domain_advancement.AdvancementRule(source=source, num_racers=num_top)

    entries = _standings_for(db, race_id, rule)
    standings = [
        domain_advancement.Standing(racer_id=e["racer_id"], den_id=e["den_id"])
        for e in entries
    ]

    den_ids: list[int] = []
    if rule.source == domain_advancement.DEN:
        den_ids = [
            d.id
            for d in db.query(models.Den).filter(models.Den.race_id == race_id).all()
        ]

    return domain_advancement.advancing_racer_ids(rule, standings, den_ids)
