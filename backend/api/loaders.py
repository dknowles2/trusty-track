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

import json

from sqlalchemy import event
from sqlalchemy.orm import Session, selectinload

from backend.db import models
from backend.services import scoring


class RequestLoaders:
    """Caches per-race collections for the lifetime of one GraphQL operation."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self._rounds_by_race: dict[int, list[models.Round]] = {}
        self._heats_by_race: dict[int, list[models.Heat]] = {}
        self._dens_by_race: dict[int, list[models.Den]] = {}
        self._racers_by_race: dict[int, list[models.Racer]] = {}
        self._leaderboards: dict[tuple[int, int | None], list[dict]] = {}
        self._global_heat_numbers: dict[int, dict[int, int]] = {}
        self._tracks: dict[int, models.Track | None] = {}
        self._groups: dict[int, models.Group | None] = {}

        event.listen(db, "after_commit", self._on_commit)

    def _on_commit(self, _session) -> None:
        self.clear()

    def clear(self) -> None:
        """Drop everything cached. Call after the underlying data may have moved."""
        self._rounds_by_race.clear()
        self._heats_by_race.clear()
        self._dens_by_race.clear()
        self._racers_by_race.clear()
        self._leaderboards.clear()
        self._global_heat_numbers.clear()
        self._tracks.clear()
        self._groups.clear()

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
        """
        if race_id not in self._heats_by_race:
            self._heats_by_race[race_id] = (
                self._db.query(models.Heat)
                .options(selectinload(models.Heat.round))
                .filter(models.Heat.race_id == race_id)
                .all()
            )
        return self._heats_by_race[race_id]

    def heats_for_round(self, race_id: int, round_id: int) -> list[models.Heat]:
        """Heats in one round, served from the per-race load."""
        return sorted(
            (h for h in self.heats_for_race(race_id) if h.round_id == round_id),
            key=lambda h: h.heat_number,
        )

    def dens_for_race(self, race_id: int) -> list[models.Den]:
        if race_id not in self._dens_by_race:
            self._dens_by_race[race_id] = (
                self._db.query(models.Den).filter(models.Den.race_id == race_id).all()
            )
        return self._dens_by_race[race_id]

    def den_by_id(self, race_id: int, den_id: int) -> models.Den | None:
        """Resolve a den from the race's already-loaded dens.

        Falls back to a direct lookup for the rare case of a den belonging to a
        different race than the one being resolved.
        """
        for den in self.dens_for_race(race_id):
            if den.id == den_id:
                return den
        return self._db.query(models.Den).filter(models.Den.id == den_id).first()

    def racers_for_race(self, race_id: int) -> list[models.Racer]:
        if race_id not in self._racers_by_race:
            self._racers_by_race[race_id] = (
                self._db.query(models.Racer)
                .filter(models.Racer.race_id == race_id)
                .all()
            )
        return self._racers_by_race[race_id]

    def track_by_id(self, track_id: int) -> models.Track | None:
        if track_id not in self._tracks:
            self._tracks[track_id] = (
                self._db.query(models.Track).filter(models.Track.id == track_id).first()
            )
        return self._tracks[track_id]

    def group_by_id(self, group_id: int) -> models.Group | None:
        if group_id not in self._groups:
            self._groups[group_id] = (
                self._db.query(models.Group).filter(models.Group.id == group_id).first()
            )
        return self._groups[group_id]

    # ------------------------------------------------------------------ #
    # Derived values                                                       #
    # ------------------------------------------------------------------ #

    def leaderboard(self, race_id: int, round_id: int | None = None) -> list[dict]:
        """Memoised leaderboard.

        ``advancementStatus`` is resolved once per round and each call used to
        recompute the whole-race leaderboard, re-parsing every heat's
        ``lane_results`` each time.
        """
        key = (race_id, round_id)
        if key not in self._leaderboards:
            self._leaderboards[key] = scoring.get_leaderboard(
                self._db, race_id, round_id=round_id
            )
        return self._leaderboards[key]

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
        """Ids of every racer appearing in any official heat of the race."""
        ids = set()
        for heat in self.heats_for_race(race_id):
            if not heat.lane_results:
                continue
            try:
                for lane in json.loads(heat.lane_results):
                    racer_id = lane.get("racer_id")
                    if racer_id is not None:
                        ids.add(racer_id)
            except (json.JSONDecodeError, TypeError):
                continue
        return sorted(ids)
