"""Awards, wired to the database (#170).

The rules are in :mod:`backend.domain.awards`. This module does the part that
needs a session: work out which standings each speed award reads, load them
once per distinct source, and hand plain values to the domain.

Like the leaderboard, a recipient is **computed on demand and never stored**.
An award defined at the start of an event stays correct when a time is
corrected at the end of it, which is the whole reason a speed award names a
source rather than a winner.
"""

from sqlalchemy.orm import Session

from backend.db import models
from backend.domain import advancement as domain_advancement
from backend.domain import awards as domain_awards
from backend.services import scoring


def _rule_for(award: models.Award) -> domain_awards.SpeedRule | None:
    """The domain rule an award row describes, or ``None`` if it is not one.

    A `SPEED` award missing its source or place is a data problem — a row
    written by something that did not go through `crud.create_award` — and it
    resolves to no recipient rather than raising. An award nobody can win is
    visible on the operator screen; an exception here takes down the awards
    query and, with it, the presentation display mid-ceremony.
    """
    if award.kind is not models.AwardKind.SPEED:
        return None
    if award.source is None or award.place is None:
        return None
    try:
        return domain_awards.SpeedRule(
            source=award.source,
            place=award.place,
            den_id=award.den_id,
            from_bottom=award.from_bottom,
        )
    except ValueError:
        # `place` below 1. Same reasoning as above.
        return None


def _standings_cache(
    db: Session, race_id: int, sources: set[str]
) -> dict[str, list[domain_advancement.Standing]]:
    """The standings each distinct source names, loaded once each.

    Keyed on the source string rather than the award, because a race giving
    first, second and third from the same round asks the same question three
    times, and `get_leaderboard` is a full scoring pass over every heat.
    """
    cache: dict[str, list[domain_advancement.Standing]] = {}
    for source in sources:
        round_id = domain_advancement.round_id_in(source)
        if domain_advancement.is_round_scoped(source) and round_id is None:
            # A malformed source names no round, so nobody qualifies.
            cache[source] = []
            continue
        entries = scoring.get_leaderboard(db, race_id, round_id=round_id)
        cache[source] = [
            domain_advancement.Standing(
                racer_id=entry["racer_id"],
                den_id=entry["den_id"],
                # Only a `from_bottom` award reads this, and for it the
                # distinction is the whole point: the leaderboard sorts cars
                # with no result below every car that raced, so without it the
                # slowest-car trophy goes to somebody who never ran.
                has_raced=entry["heats_completed"] > 0,
            )
            for entry in entries
        ]
    return cache


def recipients_for(db: Session, race_id: int) -> dict[int, int | None]:
    """``{award_id: racer_id or None}`` for every award in a race.

    Whole-race rather than per-award: three awards drawn from one round are one
    scoring pass, not three, and the presentation screen asks for all of them at
    once. A `SPECIAL` award reports the racer it stores.
    """
    awards = (
        db.query(models.Award)
        .filter(models.Award.race_id == race_id)
        .order_by(models.Award.sort_order, models.Award.id)
        .all()
    )
    return recipients_of(db, race_id, awards)


def recipients_of(
    db: Session, race_id: int, awards: list[models.Award]
) -> dict[int, int | None]:
    """As :func:`recipients_for`, for awards the caller has already loaded."""
    rules = {award.id: _rule_for(award) for award in awards}
    sources = {rule.source for rule in rules.values() if rule is not None}

    cache = _standings_cache(db, race_id, sources) if sources else {}

    resolved: dict[int, int | None] = {}
    for award in awards:
        rule = rules[award.id]
        if rule is None:
            # SPECIAL, or a SPEED row that cannot be resolved.
            resolved[award.id] = (
                award.racer_id if award.kind is models.AwardKind.SPECIAL else None
            )
            continue
        resolved[award.id] = domain_awards.recipient_of(rule, cache[rule.source])
    return resolved
