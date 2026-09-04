"""Awards, wired to the database (#170, #615).

The rules are in :mod:`backend.domain.awards` and, for the roll-down,
:mod:`backend.domain.roll_down`. This module does the part that needs a
session: work out which standings each speed award reads, load them once per
distinct source, and hand plain values to the domain.

Like the leaderboard, a recipient is **computed on demand and never stored**.
An award defined at the start of an event stays correct when a time is
corrected at the end of it, which is the whole reason a speed award names a
source rather than a winner. The roll-down (#615) is the same rule applied to
a whole race's awards at once: nothing about who already holds a trophy is
stored either, so a corrected time can still move every trophy it should.
"""

from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.domain import advancement as domain_advancement
from backend.domain import awards as domain_awards
from backend.domain import roll_down as domain_roll_down
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
            racing_group_id=award.racing_group_id,
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

    Every row carries its `rank` — see `domain.advancement.Standing` — so a
    caller resolving contested places (#540) reads it off the same load
    `recipient_of` uses, rather than a second pass. An elimination round's
    rank means something else entirely — survival order, not a tiebreak
    outcome — and #540 leaves that format alone, so those rows carry `rank =
    None` and read as never contested, the same "no data" fallback a race
    with no tiebreaker gives.

    A racer with `excluded_from_standings` set (#548) never appears here
    either — `scoring.get_leaderboard` already dropped them — so a `SPEED`
    award falls out unable to name an exhibition car for the same reason
    `get_advancing_racers` cannot pick one.
    """
    # Every round-scoped source in one query, not one per source — the same
    # amortization `award_recipients` already relies on, extended to the
    # lookup this function's own docstring added.
    round_ids = {
        rid
        for source in sources
        if (rid := domain_advancement.round_id_in(source)) is not None
    }
    elimination_round_ids = (
        {
            r.id
            for r in db.query(models.Round.id)
            .filter(
                models.Round.id.in_(round_ids),
                models.Round.scheduling_strategy
                == models.SchedulingStrategy.ELIMINATION,
            )
            .all()
        }
        if round_ids
        else set()
    )

    cache: dict[str, list[domain_advancement.Standing]] = {}
    for source in sources:
        round_id = domain_advancement.round_id_in(source)
        if domain_advancement.is_round_scoped(source) and round_id is None:
            # A malformed source names no round, so nobody qualifies.
            cache[source] = []
            continue
        is_elimination = round_id in elimination_round_ids
        entries = scoring.get_leaderboard(db, race_id, round_id=round_id)
        cache[source] = [
            domain_advancement.Standing(
                racer_id=entry["racer_id"],
                racing_group_id=entry["racing_group_id"],
                # Only a `from_bottom` award reads this, and for it the
                # distinction is the whole point: the leaderboard sorts cars
                # with no result below every car that raced, so without it the
                # slowest-car trophy goes to somebody who never ran.
                has_raced=entry["heats_completed"] > 0,
                rank=None if is_elimination else entry["rank"],
            )
            for entry in entries
        ]
    return cache


def resolutions_for(
    db: Session, race_id: int, *, one_trophy_per_racer: bool = False
) -> dict[int, domain_roll_down.Resolution]:
    """``{award_id: Resolution}`` for every award in a race (#615).

    Whole-race rather than per-award: three awards drawn from one round are one
    scoring pass, not three, and the presentation screen asks for all of them at
    once.
    """
    awards = (
        db.query(models.Award)
        .filter(models.Award.race_id == race_id)
        .order_by(models.Award.sort_order, models.Award.id)
        .all()
    )
    return resolutions_of(
        db, race_id, awards, one_trophy_per_racer=one_trophy_per_racer
    )


def resolutions_of(
    db: Session,
    race_id: int,
    awards: list[models.Award],
    *,
    one_trophy_per_racer: bool = False,
) -> dict[int, domain_roll_down.Resolution]:
    """As :func:`resolutions_for`, for awards the caller has already loaded.

    Builds one :class:`domain.roll_down.AwardEntry` per award, in the
    caller's own order — `sort_order`, `id`, which is also presentation
    order (#170) and so the tiebreak `domain.roll_down.priority_order` reads
    a podium's own award-to-award order from — and hands them to
    :func:`domain.roll_down.resolve_awards`. ``one_trophy_per_racer`` off
    (every race that existed before #615, and the default here) answers
    byte-for-byte what `domain.awards.recipient_of` always answered per
    award, with no provenance — see that module's docstring for why one
    function covers both.
    """
    rules = {award.id: _rule_for(award) for award in awards}
    sources = {rule.source for rule in rules.values() if rule is not None}

    cache = _standings_cache(db, race_id, sources) if sources else {}

    entries = [
        domain_roll_down.AwardEntry(
            key=award.id,
            rule=rules[award.id],
            chosen_racer_id=(
                award.racer_id if award.kind is models.AwardKind.SPECIAL else None
            ),
        )
        for award in awards
    ]
    return domain_roll_down.resolve_awards(
        entries, cache, one_trophy_per_racer=one_trophy_per_racer
    )


def recipients_for(db: Session, race_id: int) -> dict[int, int | None]:
    """``{award_id: racer_id or None}`` for every award in a race.

    Whole-race rather than per-award: three awards drawn from one round are one
    scoring pass, not three, and the presentation screen asks for all of them at
    once. A `SPECIAL` award reports the racer it stores.

    Always the isolated resolution (`one_trophy_per_racer=False`) — a caller
    that wants the roll-down's own answer, with provenance, wants
    :func:`resolutions_for` instead. `loaders.award_recipients` is the one
    caller that needs the race's actual setting, and it reads
    :func:`resolutions_of` directly for that reason.
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
    resolved = resolutions_of(db, race_id, awards, one_trophy_per_racer=False)
    return {award_id: resolution.recipient for award_id, resolution in resolved.items()}


def contested_for(db: Session, race_id: int) -> dict[int, bool]:
    """``{award_id: bool}`` — whether a `SPEED` award's place is a tie the
    tiebreak chain left standing (#540), for every award in a race.

    Whole-race and shared, the same shape as :func:`recipients_for` and for
    the same reason: an awards screen showing a dozen trophies at once should
    not repeat a scoring pass per trophy.
    """
    awards = (
        db.query(models.Award)
        .filter(models.Award.race_id == race_id)
        .order_by(models.Award.sort_order, models.Award.id)
        .all()
    )
    return contested_of(db, race_id, awards)


def contested_of(
    db: Session, race_id: int, awards: list[models.Award]
) -> dict[int, bool]:
    """As :func:`contested_for`, for awards the caller has already loaded."""
    rules = {award.id: _rule_for(award) for award in awards}
    sources = {rule.source for rule in rules.values() if rule is not None}

    cache = _standings_cache(db, race_id, sources) if sources else {}

    contested: dict[int, bool] = {}
    for award in awards:
        rule = rules[award.id]
        # SPECIAL, or a SPEED row that cannot be resolved: nothing computed
        # named the place, so there is nothing to contest.
        contested[award.id] = (
            False
            if rule is None
            else domain_awards.place_is_contested(rule, cache[rule.source])
        )
    return contested


def vote_tallies_for(
    db: Session, awards: list[models.Award]
) -> dict[int, list[tuple[int, int]]]:
    """``{award_id: [(racer_id, vote_count), ...]}``, ranked (#305).

    One query for the whole set — `crud.vote_counts_for_awards` — the same
    "ask once for everything a screen needs" shape as `recipients_for`. Every
    award is a key, including a `SPEED` one or one that has never taken a
    ballot; its list is simply empty.
    """
    counts = crud.vote_counts_for_awards(db, [award.id for award in awards])
    return {
        award_id: domain_awards.rank_tally(award_counts)
        for award_id, award_counts in counts.items()
    }
