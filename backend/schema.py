import base64
import csv
import io
import json
import os
import typing
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, List, Optional

import strawberry
from strawberry.types import Info

from . import crud, models, schemas, scoring
from .pubsub import pubsub


@strawberry.type
class LaneResult:
    """
    Represents the result of a single racer in a single lane of a heat.
    """

    lane: int
    racer_id: Optional[int]
    time: Optional[float]
    place: Optional[int]


@strawberry.type
class Heat:
    """
    Represents a single heat in a round.
    """

    id: int
    race_id: int
    round_id: int
    heat_number: int
    lane_results: Optional[str]

    @strawberry.field
    def round_number(self, info: Info) -> int:
        round_obj = (
            info.context["db"]
            .query(models.Round)
            .filter(models.Round.id == self.round_id)
            .first()
        )
        return round_obj.round_number if round_obj else 0

    @strawberry.field
    def round_name(self, info: Info) -> Optional[str]:
        round_obj = (
            info.context["db"]
            .query(models.Round)
            .filter(models.Round.id == self.round_id)
            .first()
        )
        return round_obj.name if round_obj else None

    @strawberry.field
    def parsed_results(self) -> List[LaneResult]:
        if not self.lane_results:
            return []
        try:
            data = json.loads(self.lane_results)
            return [
                LaneResult(
                    lane=r.get("lane"),
                    racer_id=r.get("racer_id"),
                    time=r.get("time"),
                    place=r.get("place"),
                )
                for r in data
            ]
        except (json.JSONDecodeError, TypeError):
            return []


@strawberry.type
class Round:
    """
    Represents a single round of racing.
    """

    id: int
    race_id: int
    round_number: int
    name: Optional[str]
    scheduling_strategy: str
    advancement_source: Optional[str]
    advancement_num_racers: Optional[int]

    @strawberry.field
    def heats(self, info: Info) -> List[Heat]:
        """Get all heats in this round."""
        return (
            info.context["db"]
            .query(models.Heat)
            .filter(models.Heat.round_id == self.id)
            .order_by(models.Heat.heat_number)
            .all()
        )


@strawberry.type
class AdvancementRacer:
    """
    Represents a racer eligible for advancement to a championship round.
    """

    racer_id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    den_name: str
    score: float
    rank: int
    is_advancing: bool


@strawberry.type
class AdvancementStatus:
    """
    Represents the status of advancement for a round, including eligible racers.
    """

    is_ready: bool
    requires_advancement: bool
    already_advanced: bool
    advancing_racers: List[AdvancementRacer]
    source: Optional[str]
    num_racers: Optional[int]


@strawberry.type
class InitialConfigStatus:
    """
    Represents the system initialization state.
    """

    initialized: bool
    group_name: Optional[str] = None
    tracks: List["Track"] = strawberry.field(default_factory=list)
    current_race_id: Optional[int] = None


@strawberry.input
class InitialConfigInput:
    """
    Input for initial system configuration.
    """

    group_name: str
    tracks: List["TrackInput"]


@strawberry.input
class RacerInput:
    """
    Input type for creating or updating a racer participant.
    """

    first_name: str
    last_name: str
    car_number: Optional[int] = None
    den_id: Optional[int] = None
    car_name: Optional[str] = None
    car_passed_inspection: bool = False
    car_weight: Optional[float] = None
    racer_image_url: Optional[str] = None
    car_image_url: Optional[str] = None
    race_id: Optional[int] = None


@strawberry.input
class DenInput:
    """
    Input type for creating or updating a Den sub-group.
    """

    name: str
    color: str = "#000000"
    rank: Optional[str] = None
    car_number_range_start: Optional[int] = None
    car_number_range_end: Optional[int] = None


@strawberry.input
class RaceInput:
    """
    Input type for creating or updating a race event.
    """

    name: str
    date_time: Optional[str] = None
    location: Optional[str] = None
    group_id: int = 1
    track_id: int
    scoring_strategy: str = "TIMED"
    car_numbering_strategy: str = "MANUAL"
    global_start_number: int = 1
    championship_trophies: int = 3


@strawberry.input
class RaceUpdateInput:
    """
    Input type for updating an existing race event.
    """

    name: Optional[str] = None
    date_time: Optional[str] = None
    location: Optional[str] = None
    track_id: Optional[int] = None
    scoring_strategy: Optional[str] = None
    car_numbering_strategy: Optional[str] = None
    global_start_number: Optional[int] = None
    championship_trophies: Optional[int] = None


@strawberry.input
class TrackInput:
    """
    Input type for creating or updating a physical track configuration.
    """

    name: str = "Main Track"
    lane_count: int = 4
    length_feet: Optional[int] = None
    timer_type: str = "FAKE"
    serial_port: Optional[str] = None


@strawberry.input
class WizardGeneralRoundInput:
    """
    Configuration for a general racing round in the wizard.
    """

    type: str  # "PACK" or "DEN"
    runs_per_lane: int = 1


@strawberry.input
class WizardChampionshipRoundInput:
    """
    Configuration for a championship racing round in the wizard.
    """

    name: str = "Championship Round"
    source: str = "PACK"  # "PACK" (Overall) or "DEN" (Each Den)
    num_top_racers: int = 3
    runs_per_lane: int = 1


@strawberry.input
class WizardConfigurationInput:
    """
    Full configuration for the race scheduling wizard.
    """

    general_round: WizardGeneralRoundInput
    championship_rounds: List[WizardChampionshipRoundInput]


@strawberry.type
class LeaderboardEntry:
    """
    Represents a single entry in the race leaderboard.
    """

    racer_id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    den_id: Optional[int]
    den_name: str
    score: float
    heats_completed: int
    racer_image_url: Optional[str]
    rank: int


@strawberry.type
class Den:
    """
    Represents a Den (sub-group of racers), usually corresponding to a rank or age group.
    """

    id: int
    name: str
    color: str
    rank: Optional[str]
    race_id: int
    car_number_range_start: Optional[int]
    car_number_range_end: Optional[int]

    @strawberry.field
    def racers(self, info: Info) -> List["Racer"]:
        """Get all racers belonging to this den."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.den_id == self.id)
            .all()
        )


@strawberry.input
class PopulateTestDataInput:
    """Input for populating a race with test data."""

    count: int = 10
    add_racer_photos: bool = True
    add_car_photos: bool = True
    assign_dens: bool = True
    check_in: bool = False


@strawberry.input
class RoundCreateInput:
    """Input for creating a new race round."""

    scheduling_strategy: str = "PPC"
    name: Optional[str] = None
    advancement_source: Optional[str] = None
    advancement_num_racers: Optional[int] = None
    runs_per_lane: int = 1
    general_type: str = "PACK"


@strawberry.input
class HeatReorderItemInput:
    """Input for a single heat reorder operation."""

    heat_id: int
    new_heat_number: int


@strawberry.type
class HeatReorderResponse:
    """Response after reordering heats."""

    updated_count: int
    heats: List["Heat"]


@strawberry.type
class Racer:
    """
    Represents a single racer participant in the event.
    """

    id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    car_name: Optional[str]
    car_passed_inspection: bool
    car_weight: Optional[float]
    racer_image_url: Optional[str]
    car_image_url: Optional[str]
    den_id: Optional[int]
    race_id: int

    @strawberry.field
    def den(self, info: Info) -> Optional[Den]:
        """Get the den this racer belongs to, if any."""
        if not self.den_id:
            return None
        return (
            info.context["db"]
            .query(models.Den)
            .filter(models.Den.id == self.den_id)
            .first()
        )


@strawberry.type
class Race:
    """
    Represents a Race event, which contains multiple racers, dens, and rounds.
    """

    id: int
    name: str
    date_time: Optional[str]
    location: Optional[str]
    group_id: int
    track_id: Optional[int]
    car_numbering_strategy: str
    global_start_number: int
    championship_trophies: int
    scoring_strategy: str

    @strawberry.field
    def leaderboard(self, info: Info) -> List[LeaderboardEntry]:
        """Get the current leaderboard for this race."""
        standings = scoring.get_leaderboard(info.context["db"], self.id)
        return [LeaderboardEntry(**s) for s in standings]

    @strawberry.field
    def registered_count(self, info: Info) -> int:
        """Get the number of registered racers."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.race_id == self.id)
            .count()
        )

    @strawberry.field
    def checked_in_count(self, info: Info) -> int:
        """Get the number of checked-in racers."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(
                models.Racer.race_id == self.id,
                models.Racer.car_passed_inspection,
            )
            .count()
        )

    @strawberry.field
    def dens(self, info: Info) -> List[Den]:
        """Get all dens associated with this race."""
        return (
            info.context["db"]
            .query(models.Den)
            .filter(models.Den.race_id == self.id)
            .all()
        )

    @strawberry.field
    def racers(self, info: Info) -> List[Racer]:
        """Get all racers registered for this race."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.race_id == self.id)
            .all()
        )

    @strawberry.field
    def scheduled_racer_ids(self, info: Info) -> List[int]:
        """Get IDs of all racers scheduled in any official heats of this race."""
        db = info.context["db"]
        heats = db.query(models.Heat).filter(models.Heat.race_id == self.id).all()
        ids = set()
        for h in heats:
            if h.lane_results:
                try:
                    results = json.loads(h.lane_results)
                    for r in results:
                        if r.get("racer_id") is not None:
                            ids.add(r["racer_id"])
                except (json.JSONDecodeError, TypeError):
                    continue
        return sorted(list(ids))

    @strawberry.field
    def group(self, info: Info) -> "Group":
        """Get the organization group that owns this race."""
        return (
            info.context["db"]
            .query(models.Group)
            .filter(models.Group.id == self.group_id)
            .first()
        )

    @strawberry.field
    def rounds(self, info: Info) -> List[Round]:
        """Get all rounds for this race."""
        return (
            info.context["db"]
            .query(models.Round)
            .filter(models.Round.race_id == self.id)
            .order_by(models.Round.round_number)
            .all()
        )

    @strawberry.field
    def heats(self, info: Info) -> List[Heat]:
        """Get all heats for this race."""
        return (
            info.context["db"]
            .query(models.Heat)
            .filter(models.Heat.race_id == self.id)
            .all()
        )

    @strawberry.field
    def track(self, info: Info) -> Optional["Track"]:
        """Get the track configuration for this race."""
        if not self.track_id:
            return None
        return (
            info.context["db"]
            .query(models.Track)
            .filter(models.Track.id == self.track_id)
            .first()
        )


@strawberry.type
class Track:
    """
    Represents a physical track configuration (lanes, timer hardware, etc.).
    """

    id: int
    name: str
    lane_count: int
    length_feet: Optional[int]
    timer_type: str
    serial_port: Optional[str]

    @strawberry.field
    def races(self, info: Info) -> List[Race]:
        """Get all races that have used this track."""
        return (
            info.context["db"]
            .query(models.Race)
            .filter(models.Race.track_id == self.id)
            .all()
        )


@strawberry.type
class Group:
    """
    Represents an organization or group (e.g. 'Pack 123') that holds races.
    """

    id: int
    name: str

    @strawberry.field
    def races(self, info: Info) -> List[Race]:
        """Get all races organized by this group."""
        return (
            info.context["db"]
            .query(models.Race)
            .filter(models.Race.group_id == self.id)
            .all()
        )


@strawberry.type
class FreeRaceHeat:
    """A heat run in Free Race mode. Results do not affect standings."""

    id: int
    race_id: int
    lane_assignments: str  # JSON
    lane_results: Optional[str]  # JSON, null until completed
    created_at: str

    @strawberry.field
    def parsed_assignments(self) -> List[LaneResult]:
        """Parse lane_assignments JSON into LaneResult objects."""
        if not self.lane_assignments:
            return []
        try:
            data = json.loads(self.lane_assignments)
            return [
                LaneResult(
                    lane=r.get("lane"),
                    racer_id=r.get("racer_id"),
                    time=r.get("time"),
                    place=r.get("place"),
                )
                for r in data
            ]
        except (json.JSONDecodeError, TypeError):
            return []

    @strawberry.field
    def parsed_results(self) -> List[LaneResult]:
        """Parse lane_results JSON into LaneResult objects."""
        if not self.lane_results:
            return []
        try:
            data = json.loads(self.lane_results)
            return [
                LaneResult(
                    lane=r.get("lane"),
                    racer_id=r.get("racer_id"),
                    time=r.get("time"),
                    place=r.get("place"),
                )
                for r in data
            ]
        except (json.JSONDecodeError, TypeError):
            return []


@strawberry.type
class FreeRaceLaneAssignment:
    """A single lane assignment returned from a query."""

    lane: int
    racer_id: Optional[int]


@strawberry.input
class FreeRaceLaneAssignmentInput:
    """A single lane assignment for a free race heat."""

    lane: int
    racer_id: Optional[int] = None  # None = empty lane


@strawberry.type
class Query:
    """
    Root query type for fetching data.
    """

    @strawberry.field
    def races(self, info: Info, skip: int = 0, limit: int = 100) -> List[Race]:
        """Get a list of races with pagination."""
        return typing.cast(
            Any, crud.get_races(info.context["db"], skip=skip, limit=limit)
        )

    @strawberry.field
    def race(self, info: Info, race_id: int) -> Optional[Race]:
        """Get a single race by ID."""
        return typing.cast(Any, crud.get_race(info.context["db"], race_id=race_id))

    @strawberry.field
    def racers(
        self, info: Info, race_id: Optional[int] = None, skip: int = 0, limit: int = 100
    ) -> List[Racer]:
        """Get a list of racers, optionally filtering by race_id."""
        return typing.cast(
            Any,
            crud.get_racers(
                info.context["db"], skip=skip, limit=limit, race_id=race_id
            ),
        )

    @strawberry.field
    def racer(self, info: Info, racer_id: int) -> Optional[Racer]:
        """Get a single racer by ID."""
        return typing.cast(
            Any,
            (
                info.context["db"]
                .query(models.Racer)
                .filter(models.Racer.id == racer_id)
                .first()
            ),
        )

    @strawberry.field
    def tracks(self, info: Info) -> List[Track]:
        """Get all available tracks."""
        return typing.cast(Any, crud.get_tracks(info.context["db"]))

    @strawberry.field
    def groups(self, info: Info) -> List[Group]:
        """Get all registered groups."""
        return typing.cast(Any, info.context["db"].query(models.Group).all())

    @strawberry.field
    def initial_config(self, info: Info) -> InitialConfigStatus:
        """Get the system initialization status."""
        db = info.context["db"]
        tracks = crud.get_tracks(db)
        if tracks:
            group = db.query(models.Group).first()
            race = db.query(models.Race).first()
            return InitialConfigStatus(
                initialized=True,
                group_name=group.name if group else None,
                tracks=typing.cast(Any, tracks),
                current_race_id=race.id if race else None,
            )
        return InitialConfigStatus(initialized=False)

    @strawberry.field
    def rounds(self, info: Info, race_id: int) -> List[Round]:
        """Get all rounds for a specific race."""
        return typing.cast(Any, crud.get_rounds(info.context["db"], race_id=race_id))

    @strawberry.field
    def advancement_status(
        self, info: Info, race_id: int, round_id: int
    ) -> AdvancementStatus:
        """Check if a round is ready to advance."""
        db = info.context["db"]
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if not round_obj:
            raise ValueError("Round not found")

        requires_advancement = round_obj.advancement_source is not None

        # Logic replicated from main.py's get_round_advancement_status
        heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
        already_advanced = True
        for heat in heats:
            if heat.lane_results:
                results = json.loads(heat.lane_results)
                for res in results:
                    if res.get("racer_id") is not None and res.get("racer_id") < 0:
                        already_advanced = False
                        break
            if not already_advanced:
                break

        all_rounds = (
            db.query(models.Round)
            .filter(models.Round.race_id == race_id)
            .order_by(models.Round.round_number)
            .all()
        )

        is_ready = True
        for r in all_rounds:
            if r.round_number < round_obj.round_number:
                previous_heats = (
                    db.query(models.Heat).filter(models.Heat.round_id == r.id).all()
                )
                for ph in previous_heats:
                    if not ph.lane_results:
                        is_ready = False
                        break
                    results = json.loads(ph.lane_results)
                    for res in results:
                        if res.get("racer_id") is not None and res.get("racer_id") > 0:
                            if res.get("time") is None and res.get("place") is None:
                                is_ready = False
                                break
                    if not is_ready:
                        break
            if not is_ready:
                break

        advancing_racers = []
        standings = scoring.get_leaderboard(db, race_id)

        adv_source = round_obj.advancement_source
        adv_num = round_obj.advancement_num_racers

        if not requires_advancement:
            next_round = (
                db.query(models.Round)
                .filter(
                    models.Round.race_id == race_id,
                    models.Round.round_number > round_obj.round_number,
                    models.Round.advancement_source.is_not(None),
                )
                .order_by(models.Round.round_number.asc())
                .first()
            )

            if next_round:
                requires_advancement = True
                adv_source = next_round.advancement_source
                adv_num = next_round.advancement_num_racers

        winner_ids = set()
        if requires_advancement:
            winner_ids = set(
                scoring.get_advancing_racers(db, race_id, adv_source, adv_num)
            )

        for s_data in standings:
            advancing_racers.append(
                AdvancementRacer(
                    racer_id=s_data["racer_id"],
                    first_name=s_data["first_name"],
                    last_name=s_data["last_name"],
                    car_number=s_data.get("car_number"),
                    den_name=s_data["den_name"],
                    score=s_data["score"],
                    rank=s_data["rank"],
                    is_advancing=s_data["racer_id"] in winner_ids,
                )
            )

        return AdvancementStatus(
            is_ready=is_ready,
            requires_advancement=requires_advancement,
            already_advanced=already_advanced,
            advancing_racers=advancing_racers,
            source=adv_source,
            num_racers=adv_num,
        )

    @strawberry.field
    def free_race_heats(
        self, info: Info, race_id: int, limit: int = 10
    ) -> List[FreeRaceHeat]:
        """Get the most recent free race heats for a race."""
        return typing.cast(
            Any, crud.get_free_race_heats(info.context["db"], race_id, limit)
        )

    @strawberry.field
    def active_free_race_heat(self, info: Info, race_id: int) -> Optional[FreeRaceHeat]:
        """
        Return the most recently started FreeRaceHeat whose results have not yet
        been recorded (lane_results is null). Returns None if no heat is in
        progress. Used by the Observation page to show exhibition heats.
        """
        return typing.cast(
            Any,
            info.context["db"]
            .query(models.FreeRaceHeat)
            .filter(
                models.FreeRaceHeat.race_id == race_id,
                models.FreeRaceHeat.lane_results.is_(None),
            )
            .order_by(models.FreeRaceHeat.id.desc())
            .first(),
        )

    @strawberry.field
    def random_free_race_lanes(
        self, info: Info, race_id: int
    ) -> List[FreeRaceLaneAssignment]:
        """
        Return a random lane assignment for the race's track lane count,
        using only checked-in racers. Frontend can display this as a preview
        before the operator commits to starting the heat.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        lane_count = race.track.lane_count if race and race.track else 4
        assignments = crud.get_random_lane_assignments(db, race_id, lane_count)
        return [
            FreeRaceLaneAssignment(lane=a["lane"], racer_id=a["racer_id"])
            for a in assignments
        ]


@strawberry.type
class Mutation:
    """
    Root mutation type for creating and updating data.
    """

    @strawberry.mutation
    async def create_race(self, info: Info, race: RaceInput) -> Race:
        """Create a new race."""
        race_in = schemas.RaceCreate(**typing.cast(Any, strawberry.asdict(race)))
        new_race = typing.cast(Any, crud.create_race(info.context["db"], race_in))
        await _publish_race_state(new_race.id)
        return new_race

    @strawberry.mutation
    def update_race(self, info: Info, id: int, race: RaceUpdateInput) -> Optional[Race]:
        """Update an existing race."""
        db = info.context["db"]
        data = strawberry.asdict(race)
        filtered_data = {k: v for k, v in data.items() if v is not None}
        race_update = schemas.RaceUpdate(**typing.cast(Any, filtered_data))
        return typing.cast(
            Any, crud.update_race(db, race_id=id, race_update=race_update)
        )

    @strawberry.mutation
    def delete_race(self, info: Info, id: int) -> bool:
        """Delete a race."""
        db = info.context["db"]
        return crud.delete_race(db, race_id=id)

    # Racer Mutations
    @strawberry.mutation
    async def create_racer(self, info: Info, racer: RacerInput) -> Racer:
        """Create a new racer."""
        db = info.context["db"]
        racer_in = schemas.RacerCreate(**typing.cast(Any, strawberry.asdict(racer)))
        new_racer = typing.cast(Any, crud.create_racer(db, racer_in))
        await _publish_race_state(new_racer.race_id)
        return new_racer

    @strawberry.mutation
    async def update_racer(self, info: Info, id: int, racer: RacerInput) -> Optional[Racer]:
        """Update an existing racer."""
        db = info.context["db"]
        data = strawberry.asdict(racer)
        filtered_data = {k: v for k, v in data.items() if v is not None}
        racer_update = schemas.RacerUpdate(**typing.cast(Any, filtered_data))
        updated = typing.cast(
            Any, crud.update_racer(db, racer_id=id, racer_update=racer_update)
        )
        if updated:
            await _publish_race_state(updated.race_id)
        return updated

    @strawberry.mutation
    async def delete_racer(self, info: Info, id: int) -> bool:
        """Delete a racer."""
        db = info.context["db"]
        racer = db.query(models.Racer).filter(models.Racer.id == id).first()
        race_id = racer.race_id if racer else None
        result = crud.delete_racer(db, racer_id=id) is not None
        if race_id:
            await _publish_race_state(race_id)
        return result

    @strawberry.mutation
    async def check_in_racer(
        self,
        info: Info,
        id: int,
        passed_inspection: bool,
        weight: Optional[float],
        racer_image_url: Optional[str] = None,
        car_image_url: Optional[str] = None,
    ) -> Optional[Racer]:
        """Check in a racer."""
        db = info.context["db"]
        racer_update = schemas.RacerUpdate(
            car_passed_inspection=passed_inspection,
            car_weight=weight,
            racer_image_url=racer_image_url,
            car_image_url=car_image_url,
        )
        updated = typing.cast(
            Any, crud.update_racer(db, racer_id=id, racer_update=racer_update)
        )
        if updated:
            await _publish_race_state(updated.race_id)
        return updated

    # Den Mutations
    @strawberry.mutation
    async def create_den(self, info: Info, race_id: int, den: DenInput) -> Den:
        """Create a new den."""
        db = info.context["db"]
        den_in = schemas.DenCreate(**typing.cast(Any, strawberry.asdict(den)))
        new_den = typing.cast(Any, crud.create_den(db, den_in, race_id=race_id))
        await _publish_race_state(race_id)
        return new_den

    @strawberry.mutation
    async def update_den(self, info: Info, id: int, den: DenInput) -> Optional[Den]:
        """Update an existing den."""
        db = info.context["db"]
        den_update = schemas.DenUpdate(**typing.cast(Any, strawberry.asdict(den)))
        updated = typing.cast(Any, crud.update_den(db, den_id=id, den_update=den_update))
        if updated:
            await _publish_race_state(updated.race_id)
        return updated

    @strawberry.mutation
    async def delete_den(self, info: Info, id: int) -> bool:
        """Delete a den."""
        db = info.context["db"]
        den = db.query(models.Den).filter(models.Den.id == id).first()
        race_id = den.race_id if den else None
        result = crud.delete_den(db, den_id=id) is not None
        if race_id:
            await _publish_race_state(race_id)
        return result

    # Track Mutations
    @strawberry.mutation
    def create_track(self, info: Info, track: TrackInput) -> Track:
        """Create a new track."""
        db = info.context["db"]
        track_in = schemas.TrackCreate(**typing.cast(Any, strawberry.asdict(track)))
        return typing.cast(Any, crud.create_track(db, track_in))

    @strawberry.mutation
    def update_track(self, info: Info, id: int, track: TrackInput) -> Optional[Track]:
        """Update an existing track."""
        db = info.context["db"]
        db_track = crud.get_track(db, id)
        if not db_track:
            return None
        track_update = schemas.TrackBase(**typing.cast(Any, strawberry.asdict(track)))
        return typing.cast(Any, crud.update_track(db, db_track, track_update))

    @strawberry.mutation
    def delete_track(self, info: Info, id: int) -> bool:
        """Delete a track."""
        db = info.context["db"]
        try:
            return crud.delete_track(db, track_id=id)
        except ValueError:
            return False

    # Round / Schedule Mutations
    @strawberry.mutation
    async def create_round_wizard(
        self, info: Info, race_id: int, config: WizardConfigurationInput
    ) -> List[Round]:
        """Create rounds using the wizard logic."""
        db = info.context["db"]
        # Logic replicated from main.py's create_race_wizard
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        existing_rounds = crud.get_rounds(db, race_id)
        if existing_rounds:
            raise ValueError("Cannot use wizard: rounds already exist for this race.")

        created_rounds = []
        current_round_number = 1

        try:
            # General Round
            if config.general_round.type == "PACK":
                round_obj = crud.create_round(
                    db,
                    race_id,
                    current_round_number,
                    models.SchedulingStrategy.PPC,
                    "All Pack",
                )
                for i in range(config.general_round.runs_per_lane):
                    crud.generate_heats_for_round(
                        db, round_obj.id, clear_existing=(i == 0)
                    )
                created_rounds.append(round_obj)
                current_round_number += 1
            elif config.general_round.type == "DEN":
                dens = crud.get_dens(db, race_id)
                for den in dens:
                    racers = (
                        db.query(models.Racer)
                        .filter(models.Racer.den_id == den.id)
                        .all()
                    )
                    if not racers:
                        continue
                    round_obj = crud.create_round(
                        db,
                        race_id,
                        current_round_number,
                        models.SchedulingStrategy.PPC,
                        den.name,
                        den_id=den.id,
                    )
                    p_ids = [r.id for r in racers]
                    for i in range(config.general_round.runs_per_lane):
                        crud.generate_heats_for_round(
                            db, round_obj.id, racer_ids=p_ids, clear_existing=(i == 0)
                        )
                    created_rounds.append(round_obj)
                    current_round_number += 1

            # Championship Rounds
            for champ_cfg in config.championship_rounds:
                round_obj = crud.create_round(
                    db,
                    race_id,
                    current_round_number,
                    models.SchedulingStrategy.PPC,
                    champ_cfg.name,
                    advancement_source=champ_cfg.source,
                    advancement_num_racers=champ_cfg.num_top_racers,
                )
                num_placeholders = champ_cfg.num_top_racers
                if champ_cfg.source == "DEN":
                    den_count = (
                        db.query(models.Den)
                        .filter(models.Den.race_id == race_id)
                        .count()
                    )
                    num_placeholders = champ_cfg.num_top_racers * den_count
                for i in range(champ_cfg.runs_per_lane):
                    crud.generate_heats_for_round(
                        db,
                        round_obj.id,
                        num_placeholders=num_placeholders,
                        clear_existing=(i == 0),
                    )
                created_rounds.append(round_obj)
                current_round_number += 1
        except ValueError as e:
            for r in created_rounds:
                crud.delete_round(db, r.id)
            raise e

        db.commit()
        await _publish_race_state(race_id)
        return typing.cast(Any, created_rounds)

    @strawberry.mutation
    async def regenerate_round(self, info: Info, round_id: int) -> List[Heat]:
        """Regenerate heats for a round."""
        db = info.context["db"]
        # We need to know if it's a placeholder round or racer round.
        # crud.generate_heats_for_round handles this if we pass the right params,
        # but it defaults to all racers if none provided.
        # For simplicity, let's just call it.
        heats = typing.cast(Any, crud.generate_heats_for_round(db, round_id))
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if round_obj:
            await _publish_race_state(round_obj.race_id)
        return heats

    @strawberry.mutation
    async def delete_round(self, info: Info, round_id: int) -> bool:
        """Delete a round."""
        db = info.context["db"]
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        race_id = round_obj.race_id if round_obj else None
        try:
            result = crud.delete_round(db, round_id)
        except ValueError:
            return False
        if race_id:
            await _publish_race_state(race_id)
        return result

    @strawberry.mutation
    async def advance_round(self, info: Info, race_id: int, round_id: int) -> int:
        """Advance racers to a round."""
        db = info.context["db"]
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if not round_obj or not round_obj.advancement_source:
            return 0
        winner_ids = scoring.get_advancing_racers(
            db, race_id, round_obj.advancement_source, round_obj.advancement_num_racers
        )
        if not winner_ids:
            return 0
        crud.resolve_round_placeholders(db, round_id, winner_ids)
        await _publish_race_state(race_id)
        return len(winner_ids)

    # Heat Mutations
    @strawberry.mutation
    async def update_heat_result(
        self, info: Info, heat_id: int, results: str
    ) -> Optional[Heat]:
        """Update results for a heat."""
        db = info.context["db"]
        updated_heat = typing.cast(Any, crud.record_heat_result(db, heat_id, results))
        if updated_heat:
            await _publish_race_state(updated_heat.race_id)
        return updated_heat

    # Bulk Mutations
    @strawberry.mutation
    async def bulk_auto_number(self, info: Info, racer_ids: List[int]) -> int:
        """Bulk auto-number racers."""
        db = info.context["db"]
        if not racer_ids:
            return 0
        racer = db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first()
        if not racer:
            return 0
        count = crud.auto_number_racers(db, racer.race_id, racer_ids)
        await _publish_race_state(racer.race_id)
        return count

    @strawberry.mutation
    async def bulk_clear_numbers(self, info: Info, racer_ids: List[int]) -> bool:
        """Bulk clear car numbers."""
        db = info.context["db"]
        racer = db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first() if racer_ids else None
        crud.bulk_clear_car_numbers(db, racer_ids)
        if racer:
            await _publish_race_state(racer.race_id)
        return True

    @strawberry.mutation
    async def bulk_move_to_den(
        self, info: Info, racer_ids: List[int], den_id: Optional[int]
    ) -> bool:
        """Bulk move racers to a den."""
        db = info.context["db"]
        racer = db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first() if racer_ids else None
        crud.bulk_move_racers_to_den(db, racer_ids, den_id)
        if racer:
            await _publish_race_state(racer.race_id)
        return True

    @strawberry.mutation
    async def bulk_delete_racers(self, info: Info, racer_ids: List[int]) -> bool:
        """Bulk delete racers."""
        db = info.context["db"]
        racer = db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first() if racer_ids else None
        race_id = racer.race_id if racer else None
        crud.bulk_delete_racers(db, racer_ids)
        if race_id:
            await _publish_race_state(race_id)
        return True

    @strawberry.mutation
    def create_initial_config(
        self, info: Info, config: InitialConfigInput
    ) -> InitialConfigStatus:
        """Initialize the system with group name and tracks."""
        db = info.context["db"]
        if crud.get_tracks(db):
            raise ValueError("System already initialized")

        config_dict = strawberry.asdict(config)
        config_in = schemas.InitialConfigCreate(**config_dict)
        group, tracks = crud.create_initial_config(db, config_in)

        # Link existing races if any
        if tracks:
            db.query(models.Race).filter(models.Race.track_id.is_(None)).update(
                {models.Race.track_id: tracks[0].id}
            )
            db.commit()

        return InitialConfigStatus(
            initialized=True, group_name=group.name, tracks=typing.cast(Any, tracks)
        )

    @strawberry.mutation
    async def update_initial_config(
        self, info: Info, config: InitialConfigInput
    ) -> InitialConfigStatus:
        """Update system organization name."""
        db = info.context["db"]
        group = db.query(models.Group).first()
        if group and group.name != config.group_name:
            existing = crud.get_group_by_name(db, config.group_name)
            if existing:
                raise ValueError(f"Group '{config.group_name}' already exists")
            crud.update_group(db, group, config.group_name)
            db.refresh(group)

        tracks = crud.get_tracks(db)
        
        # If there's an active race, notify it of potential name changes
        race = db.query(models.Race).first()
        if race:
            await _publish_race_state(race.id)
            
        return InitialConfigStatus(
            initialized=True,
            group_name=group.name if group else None,
            tracks=typing.cast(Any, tracks),
        )

    @strawberry.mutation
    async def populate_race(
        self, info: Info, race_id: int, config: PopulateTestDataInput
    ) -> str:
        """Populate a race with test data."""
        from . import populate

        db = info.context["db"]
        populate.generate_fake_racers(
            db,
            race_id,
            count=config.count,
            add_racer_photos=config.add_racer_photos,
            add_car_photos=config.add_car_photos,
            assign_dens=config.assign_dens,
            check_in=config.check_in,
        )
        await _publish_race_state(race_id)
        return f"Populated race {race_id} with {config.count} racers"

    @strawberry.mutation
    async def import_racers(self, info: Info, race_id: int, csv_data: str) -> int:
        """Import racers from a CSV data string."""
        db = info.context["db"]
        # Verification: ensure race exists
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        f = io.StringIO(csv_data)
        reader = csv.DictReader(f)
        count = 0

        # Helper to get value from row with case-insensitive and space-insensitive key search
        def get_val(row, *aliases):
            for alias in aliases:
                # Direct match
                if alias in row:
                    return row[alias]
                # Normalized match
                norm_alias = alias.lower().replace(" ", "_")
                for key in row.keys():
                    norm_key = key.lower().replace(" ", "_")
                    if norm_key == norm_alias:
                        return row[key]
            return None

        for row in reader:
            den_id = None
            den_val = get_val(row, "den")
            if den_val:
                den_name = den_val.strip()
                db_den = (
                    db.query(models.Den)
                    .filter(models.Den.race_id == race_id, models.Den.name == den_name)
                    .first()
                )
                if not db_den:
                    db_den = crud.create_den(
                        db,
                        schemas.DenCreate(name=den_name, color="#808080"),
                        race_id,
                    )
                den_id = db_den.id

            first_name = get_val(row, "first_name", "first")
            last_name = get_val(row, "last_name", "last")
            car_number = get_val(row, "car_number", "car_#", "number")

            if not first_name or not last_name:
                continue

            racer_in = schemas.RacerCreate(
                first_name=first_name.strip(),
                last_name=last_name.strip(),
                car_number=int(car_number)
                if car_number and car_number.isdigit()
                else None,
                den_id=den_id,
                race_id=race_id,
            )
            crud.create_racer(db, racer_in)
            count += 1
            
        await _publish_race_state(race_id)
        return count

    @strawberry.mutation
    async def create_round(
        self, info: Info, race_id: int, round_data: RoundCreateInput
    ) -> List[Round]:
        """Create a new round and generate heats."""
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        try:
            existing_rounds = crud.get_rounds(db, race_id)
            next_round_number = len(existing_rounds) + 1

            if not round_data.advancement_source:
                # General Round
                round_obj = crud.create_round(
                    db,
                    race_id,
                    next_round_number,
                    models.SchedulingStrategy(round_data.scheduling_strategy),
                    round_data.name or "All Pack",
                )
                # Generate Heats
                for i in range(round_data.runs_per_lane):
                    crud.generate_heats_for_round(
                        db, round_obj.id, clear_existing=(i == 0)
                    )
                await _publish_race_state(race_id)
                return [typing.cast(Any, round_obj)]
            else:
                # Championship Round (Placeholder)
                round_obj = crud.create_round(
                    db,
                    race_id,
                    next_round_number,
                    models.SchedulingStrategy(round_data.scheduling_strategy),
                    round_data.name or f"Finals ({round_data.advancement_source})",
                    advancement_source=round_data.advancement_source,
                    advancement_num_racers=round_data.advancement_num_racers,
                )

                # Generate Placeholder Heats
                for i in range(round_data.runs_per_lane):
                    crud.generate_heats_for_round(
                        db,
                        round_obj.id,
                        num_placeholders=round_data.advancement_num_racers or 0,
                        clear_existing=(i == 0),
                    )
                await _publish_race_state(race_id)
                return [typing.cast(Any, round_obj)]
        except ValueError as e:
            raise ValueError(str(e))

    @strawberry.mutation
    async def reorder_heats(
        self, info: Info, heat_updates: List[HeatReorderItemInput]
    ) -> HeatReorderResponse:
        """Reorder heats in a round."""
        db = info.context["db"]
        updates = [
            {"heat_id": u.heat_id, "new_heat_number": u.new_heat_number}
            for u in heat_updates
        ]
        updated_heats = crud.reorder_heats(db, updates)
        # Determine race_id from the first updated heat
        if updated_heats:
            await _publish_race_state(updated_heats[0].race_id)
        return HeatReorderResponse(
            updated_count=len(updated_heats), heats=typing.cast(Any, updated_heats)
        )

    # Free Race Mutations
    @strawberry.mutation
    def start_free_race_heat(
        self,
        info: Info,
        race_id: int,
        lane_assignments: List[FreeRaceLaneAssignmentInput],
    ) -> FreeRaceHeat:
        """
        Persist a free race heat with the given lane assignments.
        Returns the created FreeRaceHeat (results will be null until recorded).
        """
        db = info.context["db"]
        assignments = [
            {"lane": a.lane, "racer_id": a.racer_id} for a in lane_assignments
        ]
        return typing.cast(Any, crud.create_free_race_heat(db, race_id, assignments))

    @strawberry.mutation
    async def record_free_race_result(
        self,
        info: Info,
        heat_id: int,
        results: str,  # JSON string, same shape as lane_assignments + time/place
    ) -> Optional[FreeRaceHeat]:
        """Record timing results for a free race heat."""
        db = info.context["db"]
        try:
            lane_results = json.loads(results)
        except (json.JSONDecodeError, TypeError):
            return None
        updated = typing.cast(
            Any, crud.update_free_race_heat_result(db, heat_id, lane_results)
        )
        if updated:
            await _publish_race_state(updated.race_id)
        return updated

    @strawberry.mutation
    def upload_image(self, info: Info, data_url: str) -> str:
        """Upload an image from a Base64 data URL and return the static URL.

        Args:
            info: GraphQL context info.
            data_url: A data URL string (e.g. 'data:image/png;base64,...').

        Returns:
            The static URL path to the saved image.
        """
        upload_dir = "backend/uploads"
        os.makedirs(upload_dir, exist_ok=True)

        # Parse data URL: data:<mime>;base64,<data>
        if "," not in data_url:
            raise ValueError("Invalid data URL format")
        header, encoded = data_url.split(",", 1)

        # Determine file extension from mime type
        ext = ".jpg"
        if "image/png" in header:
            ext = ".png"
        elif "image/gif" in header:
            ext = ".gif"
        elif "image/webp" in header:
            ext = ".webp"

        filename = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(upload_dir, filename)

        image_data = base64.b64decode(encoded)
        with open(file_path, "wb") as f:
            f.write(image_data)

        return f"/static/{filename}"


@strawberry.type
class RaceStateChangedEvent:
    """Event emitted whenever a race's state is modified by a mutation."""

    race_id: int
    changed_at: str  # ISO 8601 UTC timestamp


async def _publish_race_state(race_id: int) -> None:
    """Publish a RaceStateChangedEvent for *race_id* on the pub/sub bus.

    Args:
        race_id: ID of the race whose state changed.
    """
    await pubsub.publish(
        f"race_state:{race_id}",
        RaceStateChangedEvent(
            race_id=race_id,
            changed_at=datetime.now(timezone.utc).isoformat(),
        ),
    )


@strawberry.type
class Subscription:
    """Root subscription type for real-time race state updates."""

    @strawberry.subscription
    async def race_state_changed(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[RaceStateChangedEvent, None]:
        """Subscribe to state changes for a specific race.

        Emits a RaceStateChangedEvent whenever any mutation that modifies
        race data is executed for *race_id*.

        Args:
            info: GraphQL context info.
            race_id: The race to subscribe to.

        Yields:
            RaceStateChangedEvent payloads.
        """
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            async for event in stream:
                yield event


schema = strawberry.Schema(query=Query, mutation=Mutation, subscription=Subscription)
