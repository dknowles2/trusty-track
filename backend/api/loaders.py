"""Request-scoped batching and memoisation for GraphQL field resolvers.

Strawberry types in ``schema.py`` are duck-typed shells filled with ORM objects,
and every relationship used to be a fresh query inside a field resolver. On a
list of N heats that is N queries per field.

The resolvers are synchronous, so this is a plain memo cache rather than an
async ``DataLoader``: the data is small and local, and the win here is avoiding
repeated identical queries within one operation, not I/O concurrency.

Lifetime
--------
One instance per GraphQL context. For HTTP that is one per request, which is
exactly right. Subscriptions hold a context open for the life of the connection
and re-read the database on every published event, so they **must** call
:meth:`RequestLoaders.clear` after ``db.expire_all()`` or they will replay stale
data to the audience displays. ``clear()`` is also wired to the session's
``after_commit`` event as a backstop.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session, selectinload

from backend.db import crud, models
from backend.domain import lanes
from backend.domain import scoring as domain_scoring
from backend.services import awards as awards_service
from backend.services import scoring


class RequestLoaders:
    """Caches per-race collections for the lifetime of one GraphQL operation."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self._rounds_by_race: dict[int, list[models.Round]] = {}
        self._heats_by_race: dict[int, list[models.Heat]] = {}
        self._racing_groups_by_race: dict[int, list[models.RacingGroup]] = {}
        self._racers_by_race: dict[int, list[models.Racer]] = {}
        self._leaderboards: dict[
            tuple[int, int | None, str], list[scoring.LeaderboardEntry]
        ] = {}
        self._global_heat_numbers: dict[int, dict[int, int]] = {}
        self._tracks: dict[int, models.Track | None] = {}
        self._organizations: dict[int, models.Organization | None] = {}
        self._lanes: dict[int, dict[int, list[models.HeatLane]]] = {}
        self._lane_values: dict[tuple[int, int], list[lanes.Lane]] = {}
        self._awards_by_race: dict[int, list[models.Award]] = {}
        self._award_recipients: dict[int, dict[int, int | None]] = {}
        self._award_vote_tallies: dict[int, dict[int, list[tuple[int, int]]]] = {}
        self._award_contested: dict[int, dict[int, bool]] = {}

        event.listen(db, "after_commit", self._on_commit)

    def _on_commit(self, _session) -> None:
        self.clear()

    def clear(self) -> None:
        """Drop everything cached. Call after the underlying data may have moved."""
        self._rounds_by_race.clear()
        self._heats_by_race.clear()
        self._racing_groups_by_race.clear()
        self._racers_by_race.clear()
        self._leaderboards.clear()
        self._global_heat_numbers.clear()
        self._tracks.clear()
        self._organizations.clear()
        self._lanes.clear()
        self._lane_values.clear()
        self._awards_by_race.clear()
        self._award_recipients.clear()
        self._award_vote_tallies.clear()
        self._award_contested.clear()

    # ------------------------------------------------------------------ #
    # Collections, loaded once per race                                    #
    # ------------------------------------------------------------------ #

    def rounds_for_race(self, race_id: int) -> list[models.Round]:
        if race_id not in self._rounds_by_race:
            self._rounds_by_race[race_id] = (
                self._db.query(models.Round)
                .filter(models.Round.race_id == race_id)
                .order_by(models.Round.round_number)
                .all()
            )
        return self._rounds_by_race[race_id]

    def heats_for_race(self, race_id: int) -> list[models.Heat]:
        """All heats for a race, with their round eagerly loaded.

        Eager-loading ``round`` here is what keeps ``Heat.round_number`` and
        ``Heat.round_name`` from costing a query each.

        Official heats only. Free race heats live in the same table (#6) and
        every caller of this feeds a schedule, a leaderboard or an advancement
        decision — none of which they belong in.
        """
        if race_id not in self._heats_by_race:
            self._heats_by_race[race_id] = models.official_heats(
                self._db.query(models.Heat)
                .options(selectinload(models.Heat.round))
                .filter(models.Heat.race_id == race_id)
            ).all()
        return self._heats_by_race[race_id]

    def heats_for_round(self, race_id: int, round_id: int) -> list[models.Heat]:
        """Heats in one round, served from the per-race load."""
        return sorted(
            (h for h in self.heats_for_race(race_id) if h.round_id == round_id),
            key=lambda h: h.heat_number,
        )

    def racing_groups_for_race(self, race_id: int) -> list[models.RacingGroup]:
        if race_id not in self._racing_groups_by_race:
            self._racing_groups_by_race[race_id] = (
                self._db.query(models.RacingGroup)
                .filter(models.RacingGroup.race_id == race_id)
                .all()
            )
        return self._racing_groups_by_race[race_id]

    def racing_group_by_id(
        self, race_id: int, racing_group_id: int
    ) -> models.RacingGroup | None:
        """Resolve a racing group from the race's already-loaded racing groups.

        Falls back to a direct lookup for the rare case of a racing group belonging to a
        different race than the one being resolved.
        """
        for racing_group in self.racing_groups_for_race(race_id):
            if racing_group.id == racing_group_id:
                return racing_group
        return (
            self._db.query(models.RacingGroup)
            .filter(models.RacingGroup.id == racing_group_id)
            .first()
        )

    def awards_for_race(self, race_id: int) -> list[models.Award]:
        if race_id not in self._awards_by_race:
            self._awards_by_race[race_id] = crud.get_awards(self._db, race_id)
        return self._awards_by_race[race_id]

    def racer_by_id(self, race_id: int, racer_id: int) -> models.Racer | None:
        """Resolve a racer from the race's already-loaded roster.

        Falls back to a direct lookup, as `racing_group_by_id` does, for a racer who
        belongs to a different race than the one being resolved.
        """
        for racer in self.racers_for_race(race_id):
            if racer.id == racer_id:
                return racer
        return self._db.query(models.Racer).filter(models.Racer.id == racer_id).first()

    def racers_for_race(self, race_id: int) -> list[models.Racer]:
        if race_id not in self._racers_by_race:
            self._racers_by_race[race_id] = (
                self._db.query(models.Racer)
                .filter(models.Racer.race_id == race_id)
                .all()
            )
        return self._racers_by_race[race_id]

    def lanes_for_heat(self, race_id: int, heat_id: int) -> list[models.HeatLane]:
        """One heat's lanes, from a single query covering the whole race.

        Both kinds in one batch: they are one table now (#6), and a screen that
        shows free heats shows them alongside official ones.

        ``heat_lanes`` has no ``race_id`` of its own, so the batch is scoped by
        joining ``heats``.
        """
        if race_id not in self._lanes:
            rows = (
                self._db.query(models.HeatLane)
                .join(models.Heat, models.Heat.id == models.HeatLane.heat_id)
                .filter(models.Heat.race_id == race_id)
                .order_by(models.HeatLane.lane)
                .all()
            )
            by_heat: dict[int, list[models.HeatLane]] = {}
            for row in rows:
                by_heat.setdefault(row.heat_id, []).append(row)
            self._lanes[race_id] = by_heat
        return self._lanes[race_id].get(heat_id, [])

    def lane_values_for_heat(self, race_id: int, heat_id: int) -> list[lanes.Lane]:
        """One heat's lanes as domain values, off the same batched query.

        The shape the rules take. Resolvers that used to parse the heat's blob
        for this ask here instead (#72), so they neither re-read a string nor
        pay a query per heat.
        """
        key = (race_id, heat_id)
        if key not in self._lane_values:
            self._lane_values[key] = [
                crud.lane_from_row(row) for row in self.lanes_for_heat(race_id, heat_id)
            ]
        return self._lane_values[key]

    def track_by_id(self, track_id: int) -> models.Track | None:
        if track_id not in self._tracks:
            self._tracks[track_id] = (
                self._db.query(models.Track).filter(models.Track.id == track_id).first()
            )
        return self._tracks[track_id]

    def organization_by_id(self, organization_id: int) -> models.Organization | None:
        if organization_id not in self._organizations:
            self._organizations[organization_id] = (
                self._db.query(models.Organization)
                .filter(models.Organization.id == organization_id)
                .first()
            )
        return self._organizations[organization_id]

    # ------------------------------------------------------------------ #
    # Derived values                                                       #
    # ------------------------------------------------------------------ #

    def leaderboard(
        self,
        race_id: int,
        round_id: int | None = None,
        scope: str = domain_scoring.PRELIM,
    ) -> list[scoring.LeaderboardEntry]:
        """Memoised leaderboard.

        ``advancementStatus`` is resolved once per round and each call used to
        recompute the whole-race leaderboard, re-parsing every heat's
        ``lane_results`` each time.

        ``scope`` is part of the cache key: prelim-only and all-heats standings
        are different answers and must not share an entry.
        """
        key = (race_id, round_id, scope)
        if key not in self._leaderboards:
            self._leaderboards[key] = scoring.get_leaderboard(
                self._db, race_id, round_id=round_id, scope=scope
            )
        return self._leaderboards[key]

    def award_recipients(self, race_id: int) -> dict[int, int | None]:
        """Memoised ``{award_id: racer_id or None}`` for a whole race (#170).

        Whole-race and cached because resolving one speed award is a full
        scoring pass over the heats it draws from, and an awards screen asks
        for every award at once. Per-award resolution would be one pass each.
        """
        if race_id not in self._award_recipients:
            self._award_recipients[race_id] = awards_service.recipients_of(
                self._db, race_id, self.awards_for_race(race_id)
            )
        return self._award_recipients[race_id]

    def award_vote_tallies(self, race_id: int) -> dict[int, list[tuple[int, int]]]:
        """Memoised ``{award_id: [(racer_id, vote_count), ...]}`` (#305).

        Whole-race, the same shape as :meth:`award_recipients` and for the
        same reason: a tally screen showing every votable award asks for all
        of them at once.
        """
        if race_id not in self._award_vote_tallies:
            self._award_vote_tallies[race_id] = awards_service.vote_tallies_for(
                self._db, self.awards_for_race(race_id)
            )
        return self._award_vote_tallies[race_id]

    def award_contested(self, race_id: int) -> dict[int, bool]:
        """Memoised ``{award_id: bool}`` — a `SPEED` award's place is a tie
        the tiebreak chain left standing (#540).

        Whole-race, the same shape as :meth:`award_recipients` and for the
        same reason.
        """
        if race_id not in self._award_contested:
            self._award_contested[race_id] = awards_service.contested_of(
                self._db, race_id, self.awards_for_race(race_id)
            )
        return self._award_contested[race_id]

    def global_heat_number(self, race_id: int, heat_id: int) -> int | None:
        """Position of a heat across the whole race, 1-indexed.

        Computed once for the race rather than with a JOIN + COUNT per heat.
        """
        if race_id not in self._global_heat_numbers:
            ordered = sorted(
                self.heats_for_race(race_id),
                key=lambda h: (
                    h.round.round_number if h.round else 0,
                    h.heat_number,
                ),
            )
            self._global_heat_numbers[race_id] = {
                heat.id: index for index, heat in enumerate(ordered, start=1)
            }
        return self._global_heat_numbers[race_id].get(heat_id)

    def scheduled_racer_ids(self, race_id: int) -> list[int]:
        """Ids of every racer appearing in any official heat of the race.

        One ``DISTINCT`` over ``heat_lanes`` (#72), where it used to load every
        heat and parse its blob. A placeholder needs no special case here: the
        table holds it as ``placeholder_slot`` with a null ``racer_id``, so the
        negative-id convention the blob forced is simply gone.
        """
        rows = (
            models.official_heats(
                self._db.query(models.HeatLane.racer_id).join(
                    models.Heat, models.HeatLane.heat_id == models.Heat.id
                )
            )
            .filter(
                models.Heat.race_id == race_id,
                models.HeatLane.racer_id.isnot(None),
            )
            .distinct()
            .all()
        )
        return sorted(racer_id for (racer_id,) in rows)
