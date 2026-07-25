"""Leaderboards and advancement, wired to the database.

The rules themselves are in :mod:`backend.domain.scoring` and
:mod:`backend.domain.advancement`. This module does the part that needs a
session: load the heats and racers, hand plain values to the domain, and shape
the answer for callers.

Scoring is always computed on demand — there is no stored leaderboard.
"""

from typing import Optional

from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.domain import advancement as domain_advancement
from backend.domain import lanes as domain_lanes
from backend.domain import scoring as domain_scoring


def calculate_racer_scores(
    db: Session, race_id: int, round_id: Optional[int] = None
) -> dict[int, dict[str, float]]:
    """Per-racer aggregate scores for a race, optionally limited to one round.

    Returns ``{racer_id: {"score", "heats_completed", "total_time",
    "total_points"}}``. Lower ``score`` is better under both strategies.
    """
    race = crud.get_race(db, race_id)
    if not race:
        return {}

    heats = crud.get_heats(db, race_id, round_id=round_id)
    parsed = [domain_lanes.parse(heat.lane_results) for heat in heats]

    scores = domain_scoring.score_heats(parsed, race.scoring_strategy)
    return {racer_id: score.as_dict() for racer_id, score in scores.items()}


def get_leaderboard(
    db: Session, race_id: int, round_id: Optional[int] = None
) -> list[dict]:
    """Current standings, best first, each entry carrying a 1-indexed ``rank``.

    Note that with no ``round_id`` this spans every heat in the race, so
    championship results average in with prelims. Whether that is the intended
    definition of "the standings" is issue #17.
    """
    race = crud.get_race(db, race_id)
    if not race:
        return []

    racer_scores = calculate_racer_scores(db, race_id, round_id=round_id)

    racer_map = {r.id: r for r in crud.get_racers(db, race_id=race_id)}
    den_map = {
        d.id: d
        for d in db.query(models.Den).filter(models.Den.race_id == race_id).all()
    }

    leaderboard = []
    for racer_id, score_data in racer_scores.items():
        # Skips placeholders and anyone deleted since the heat was scheduled.
        racer = racer_map.get(racer_id)
        if not racer:
            continue

        den = den_map.get(racer.den_id) if racer.den_id else None

        leaderboard.append(
            {
                "racer_id": racer_id,
                "first_name": racer.first_name,
                "last_name": racer.last_name,
                "car_number": racer.car_number,
                "den_id": racer.den_id,
                "den_name": den.name if den else "Unknown",
                "score": score_data["score"],
                "heats_completed": score_data["heats_completed"],
                "racer_image_url": racer.racer_image_url,
            }
        )

    leaderboard.sort(
        key=lambda entry: domain_scoring.rank_key(
            entry["score"], entry["heats_completed"], entry["racer_id"]
        )
    )

    for idx, entry in enumerate(leaderboard):
        entry["rank"] = idx + 1

    return leaderboard


def _standings_for(db: Session, race_id: int, rule) -> list[dict]:
    """The leaderboard a rule should be evaluated against."""
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
