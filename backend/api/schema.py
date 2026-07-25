import asyncio
import base64
import contextlib
import csv
import io
import json
import os
import random
import typing
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any, Optional

import pillow_heif
import strawberry
from sqlalchemy.orm import Session
from strawberry.types import Info

from backend.api.loaders import RequestLoaders
from backend.api.pubsub import pubsub
from backend.db import crud, models, schemas
from backend.db.database import UPLOAD_DIR
from backend.domain import lanes
from backend.domain import scoring as domain_scoring
from backend.services import scoring
from backend.services.image_processing import convert_to_browser_safe_png
from backend.services.timer.devices.base import (
    LaneResult as TimerLaneResult,
)
from backend.services.timer.devices.base import RaceStarted
from backend.services.timer.devices.fake import FakeTimerDevice
from backend.services.timer.devices.microwizard import MicroWizardDevice
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

pillow_heif.register_heif_opener()


def _session_factory(info: Info):
    """Session factory for TimerManagers created during a request.

    They persist results from a background task, so they cannot reuse the
    request's session. Falls back to the process-wide factory for contexts
    built outside the HTTP path.
    """
    from backend.db.database import SessionLocal

    return info.context.get("session_factory") or SessionLocal


def _loaders(info: Info) -> RequestLoaders:
    """Per-operation loader cache.

    Contexts built outside the HTTP path (tests, some tooling) may not carry
    one, so fall back to a fresh instance bound to this operation's session.
    """
    loaders = info.context.get("loaders")
    if loaders is None:
        loaders = RequestLoaders(info.context["db"])
        info.context["loaders"] = loaders
    return loaders


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
    def round_number(self) -> int:
        # `self` is the ORM Heat; the round is eagerly loaded by the resolvers
        # that return heats, so this costs nothing.
        return self.round.round_number if self.round else 0

    @strawberry.field
    def round_name(self) -> Optional[str]:
        return self.round.name if self.round else None

    @strawberry.field
    def global_heat_number(self, info: Info) -> int:
        number = _loaders(info).global_heat_number(self.race_id, self.id)
        return number if number is not None else self.heat_number

    @strawberry.field
    def parsed_results(self) -> list[LaneResult]:
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
    advancing_racers: list[AdvancementRacer]
    source: Optional[str]
    num_racers: Optional[int]


def _advancement_status(info: Info, race_id: int, round_id: int) -> AdvancementStatus:
    """Whether a round can advance, and who would advance if it did.

    A plain function rather than a resolver because both ``Query`` and ``Round``
    expose it. ``Round.advancement_status`` used to instantiate ``Query()`` and
    call the method on it, with a cast to silence the resulting type error.
    """
    db = info.context["db"]
    loaders = _loaders(info)

    round_obj = next(
        (r for r in loaders.rounds_for_race(race_id) if r.id == round_id), None
    )
    if not round_obj:
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        raise ValueError("Round not found")

    requires_advancement = round_obj.advancement_source is not None

    # This round has been advanced once no placeholder slots remain.
    already_advanced = not any(
        lane.is_placeholder
        for heat in loaders.heats_for_round(race_id, round_id)
        for lane in lanes.parse(heat.lane_results)
    )

    all_rounds = loaders.rounds_for_race(race_id)

    # Ready when every earlier round has a result for every real racer. Note
    # this accepts a place without a time, which is how a POINTS race records
    # results — hence not domain `is_complete`, which requires a time.
    def _earlier_heats_finished() -> bool:
        for r in all_rounds:
            if r.round_number >= round_obj.round_number:
                continue
            for heat in loaders.heats_for_round(race_id, r.id):
                if not heat.lane_results:
                    return False
                for lane in lanes.parse(heat.lane_results):
                    if lane.is_real_racer and lane.time is None and lane.place is None:
                        return False
        return True

    is_ready = _earlier_heats_finished()

    adv_source = round_obj.advancement_source
    adv_num = round_obj.advancement_num_racers

    if not requires_advancement:
        # A general round shows the field for whichever championship round comes
        # next, so the operator can see who is on track to advance.
        next_round = next(
            (
                r
                for r in all_rounds
                if r.round_number > round_obj.round_number
                and r.advancement_source is not None
            ),
            None,
        )
        if next_round:
            requires_advancement = True
            adv_source = next_round.advancement_source
            adv_num = next_round.advancement_num_racers

    winner_ids: set[int] = set()
    if requires_advancement:
        winner_ids = set(scoring.get_advancing_racers(db, race_id, adv_source, adv_num))

    advancing_racers = [
        AdvancementRacer(
            racer_id=entry["racer_id"],
            first_name=entry["first_name"],
            last_name=entry["last_name"],
            car_number=entry.get("car_number"),
            den_name=entry["den_name"],
            score=entry["score"],
            rank=entry["rank"],
            is_advancing=entry["racer_id"] in winner_ids,
        )
        for entry in loaders.leaderboard(race_id)
    ]

    return AdvancementStatus(
        is_ready=is_ready,
        requires_advancement=requires_advancement,
        already_advanced=already_advanced,
        advancing_racers=advancing_racers,
        source=adv_source,
        num_racers=adv_num,
    )


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
    def heats(self, info: Info) -> list[Heat]:
        """Get all heats in this round."""
        return typing.cast(Any, _loaders(info).heats_for_round(self.race_id, self.id))

    @strawberry.field
    def advancement_status(self, info: Info) -> AdvancementStatus:
        """Check if a round is ready to advance."""
        return _advancement_status(info, self.race_id, self.id)


@strawberry.type
class InitialConfigStatus:
    """
    Represents the system initialization state.
    """

    initialized: bool
    version: str
    group_name: Optional[str] = None
    debug_mode: bool = False
    tracks: list["Track"] = strawberry.field(default_factory=list)
    current_race_id: Optional[int] = None


@strawberry.input
class InitialConfigInput:
    """
    Input for initial system configuration.
    """

    group_name: str
    debug_mode: bool = False
    tracks: list["TrackInput"]


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
    auto_advance_heat: Optional[bool] = None


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
    championship_rounds: list[WizardChampionshipRoundInput]


@strawberry.type
class TimesPerLane:
    """Average time a racer recorded in a specific lane."""

    lane: int
    avg_time: Optional[float]


@strawberry.type
class RacerStat:
    """Per-racer statistics computed across all completed heats."""

    racer_id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    den_name: str
    heats_completed: int
    heats_scheduled: int
    min_time: Optional[float]
    max_time: Optional[float]
    mean_time: Optional[float]
    std_dev: Optional[float]
    times_per_lane: list[TimesPerLane]


@strawberry.type
class LaneTimeStat:
    """Fairness statistics for a single lane."""

    lane: int
    avg_time: Optional[float]
    heat_count: int
    relative_advantage_pct: Optional[float]


@strawberry.type
class HeatHighlight:
    """A notable moment from the race (fastest heat, closest race, etc.)."""

    type: str  # "FASTEST_HEAT" | "CLOSEST_RACE"
    round_name: str
    heat_number: int
    global_heat_number: int
    racer_name: Optional[str]
    time: Optional[float]
    margin: Optional[float]


@strawberry.type
class DenStat:
    """Aggregate statistics for a den."""

    den_id: int
    den_name: str
    den_color: str
    racer_count: int
    avg_score: Optional[float]
    best_racer_name: Optional[str]


@strawberry.type
class HeatResultRow:
    """A single lane result row, used for CSV export."""

    round_name: str
    heat_number: int
    global_heat_number: int
    lane: int
    car_number: Optional[int]
    racer_first_name: str
    racer_last_name: str
    time: Optional[float]
    place: Optional[int]


@strawberry.type
class RaceStats:
    """Full statistics payload for a race."""

    race_id: int
    race_name: str
    scoring_strategy: str
    total_heats_scheduled: int
    total_heats_completed: int
    total_racers: int
    lane_stats: list[LaneTimeStat]
    racer_stats: list[RacerStat]
    highlights: list[HeatHighlight]
    den_stats: list[DenStat]
    heat_results: list[HeatResultRow]


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
    """Represents a Den (sub-group of racers), usually by rank or age."""

    id: int
    name: str
    color: str
    rank: Optional[str]
    race_id: int
    car_number_range_start: Optional[int]
    car_number_range_end: Optional[int]

    @strawberry.field
    def racers(self, info: Info) -> list["Racer"]:
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
class PhotoAssignmentInput:
    """Single racer-to-photo assignment for bulk photo assignment."""

    racer_id: int
    url: str  # /static/{uuid}.jpg from uploadImage
    photo_type: str  # "racer" or "car"


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
    heats: list["Heat"]


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
        return typing.cast(Any, _loaders(info).den_by_id(self.race_id, self.den_id))


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
    auto_advance_heat: bool

    @strawberry.field
    def leaderboard(
        self,
        info: Info,
        round_id: Optional[int] = None,
        include_all_rounds: bool = False,
    ) -> list[LeaderboardEntry]:
        """Standings for this race.

        By default these are **prelim standings** — championship rounds are
        excluded, because a championship field is chosen *from* the standings
        and folding its results back in is circular (issue #17).

        Pass ``roundId`` for a single round's standings, which is how the UI
        shows championship results. ``includeAllRounds: true`` restores the
        pre-#17 whole-race average.
        """
        scope = domain_scoring.ALL if include_all_rounds else domain_scoring.PRELIM
        return [
            LeaderboardEntry(**s)
            for s in _loaders(info).leaderboard(self.id, round_id=round_id, scope=scope)
        ]

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
    def dens(self, info: Info) -> list[Den]:
        """Get all dens associated with this race."""
        return typing.cast(Any, _loaders(info).dens_for_race(self.id))

    @strawberry.field
    def racers(self, info: Info) -> list[Racer]:
        """Get all racers registered for this race."""
        return typing.cast(Any, _loaders(info).racers_for_race(self.id))

    @strawberry.field
    def scheduled_racer_ids(self, info: Info) -> list[int]:
        """Get IDs of all racers scheduled in any official heats of this race."""
        return _loaders(info).scheduled_racer_ids(self.id)

    @strawberry.field
    def group(self, info: Info) -> "Group":
        """Get the organization group that owns this race."""
        return typing.cast(Any, _loaders(info).group_by_id(self.group_id))

    @strawberry.field
    def rounds(self, info: Info) -> list[Round]:
        """Get all rounds for this race."""
        return typing.cast(Any, _loaders(info).rounds_for_race(self.id))

    @strawberry.field
    def heats(self, info: Info) -> list[Heat]:
        """Get all heats for this race."""
        return typing.cast(Any, _loaders(info).heats_for_race(self.id))

    @strawberry.field
    def track(self, info: Info) -> Optional["Track"]:
        """Get the track configuration for this race."""
        if not self.track_id:
            return None
        return typing.cast(Any, _loaders(info).track_by_id(self.track_id))


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
    def races(self, info: Info) -> list[Race]:
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
    def races(self, info: Info) -> list[Race]:
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
    def parsed_assignments(self) -> list[LaneResult]:
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
    def parsed_results(self) -> list[LaneResult]:
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
class SerialLogEntry:
    """A single serial command logged by the timer."""

    direction: str  # "RX" or "TX"
    data: str
    timestamp: str


@strawberry.type
class TimerStatus:
    """Current state of the timer for a track."""

    state: str
    device_name: Optional[str]
    lane_count: Optional[int]
    active_heat_id: Optional[int]
    last_error: Optional[str]
    pending_results: list[LaneResult] = strawberry.field(default_factory=list)
    serial_log: list[SerialLogEntry] = strawberry.field(default_factory=list)
    racer_by_lane: Optional[str] = None  # JSON mapping of lane -> racer_id


@strawberry.type
class TimerStateChangedEvent:
    """Event emitted whenever the timer state changes for a track."""

    track_id: int
    status: TimerStatus
    changed_at: str  # ISO 8601 UTC timestamp


def _timer_status_from_manager(mgr) -> TimerStatus:
    """Convert a TimerManager.status() dataclass to the Strawberry TimerStatus type."""
    s = mgr.status()
    return TimerStatus(
        state=s.state,
        device_name=s.device_name,
        lane_count=s.lane_count,
        active_heat_id=s.active_heat_id,
        last_error=s.last_error,
        pending_results=[
            LaneResult(
                lane=r["lane"],
                time=r["time"],
                place=r["place"],
                racer_id=s.racer_by_lane.get(r["lane"]),
            )
            for r in s.pending_results
        ],
        serial_log=[
            SerialLogEntry(
                direction=e.direction,
                data=e.data,
                timestamp=e.timestamp,
            )
            for e in s.serial_log
        ],
        racer_by_lane=json.dumps(s.racer_by_lane) if s.racer_by_lane else None,
    )


@strawberry.type
class Query:
    """
    Root query type for fetching data.
    """

    @strawberry.field
    def races(self, info: Info, skip: int = 0, limit: int = 100) -> list[Race]:
        """Get a list of races with pagination."""
        return typing.cast(
            Any, crud.get_races(info.context["db"], skip=skip, limit=limit)
        )

    @strawberry.field
    def version(self) -> str:
        """Get the current application version."""
        try:
            from backend.version import __version__

            return __version__
        except ImportError:
            return "unknown"

    @strawberry.field
    def race(self, info: Info, race_id: int) -> Optional[Race]:
        """Get a single race by ID."""
        return typing.cast(Any, crud.get_race(info.context["db"], race_id=race_id))

    @strawberry.field
    def racers(
        self, info: Info, race_id: Optional[int] = None, skip: int = 0, limit: int = 100
    ) -> list[Racer]:
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
    def tracks(self, info: Info) -> list[Track]:
        """Get all available tracks."""
        return typing.cast(Any, crud.get_tracks(info.context["db"]))

    @strawberry.field
    def groups(self, info: Info) -> list[Group]:
        """Get all registered groups."""
        return typing.cast(Any, info.context["db"].query(models.Group).all())

    @strawberry.field
    def initial_config(self, info: Info) -> InitialConfigStatus:
        """Get the system initialization status."""
        db = info.context["db"]
        tracks = crud.get_tracks(db)

        try:
            from backend.version import __version__ as _version
        except ImportError:
            _version = "unknown"

        if tracks:
            group = db.query(models.Group).first()
            race = db.query(models.Race).first()
            return InitialConfigStatus(
                initialized=True,
                version=_version,
                group_name=group.name if group else None,
                debug_mode=group.debug_mode if group else False,
                tracks=typing.cast(Any, tracks),
                current_race_id=race.id if race else None,
            )
        return InitialConfigStatus(initialized=False, version=_version)

    @strawberry.field
    def rounds(self, info: Info, race_id: int) -> list[Round]:
        """Get all rounds for a specific race."""
        return typing.cast(Any, crud.get_rounds(info.context["db"], race_id=race_id))

    @strawberry.field
    def advancement_status(
        self, info: Info, race_id: int, round_id: int
    ) -> AdvancementStatus:
        """Check if a round is ready to advance."""
        return _advancement_status(info, race_id, round_id)

    @strawberry.field
    def free_race_heats(
        self, info: Info, race_id: int, limit: int = 10
    ) -> list[FreeRaceHeat]:
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
    ) -> list[FreeRaceLaneAssignment]:
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

    @strawberry.field
    def timer_status(self, info: Info, track_id: int) -> Optional[TimerStatus]:
        """Return the current timer state for a track."""
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return None
        return _timer_status_from_manager(mgr)

    @strawberry.field
    def race_stats(self, info: Info, race_id: int) -> Optional[RaceStats]:
        """Get racer stats, lane fairness, and highlights for a race."""
        from backend.services import stats as race_stats_module

        db = info.context["db"]
        data = race_stats_module.compute_race_stats(db, race_id)
        if data is None:
            return None

        return RaceStats(
            race_id=data["race_id"],
            race_name=data["race_name"],
            scoring_strategy=data["scoring_strategy"],
            total_heats_scheduled=data["total_heats_scheduled"],
            total_heats_completed=data["total_heats_completed"],
            total_racers=data["total_racers"],
            lane_stats=[
                LaneTimeStat(
                    lane=ls["lane"],
                    avg_time=ls["avg_time"],
                    heat_count=ls["heat_count"],
                    relative_advantage_pct=ls["relative_advantage_pct"],
                )
                for ls in data["lane_stats"]
            ],
            racer_stats=[
                RacerStat(
                    racer_id=rs["racer_id"],
                    first_name=rs["first_name"],
                    last_name=rs["last_name"],
                    car_number=rs["car_number"],
                    den_name=rs["den_name"],
                    heats_completed=rs["heats_completed"],
                    heats_scheduled=rs["heats_scheduled"],
                    min_time=rs["min_time"],
                    max_time=rs["max_time"],
                    mean_time=rs["mean_time"],
                    std_dev=rs["std_dev"],
                    times_per_lane=[
                        TimesPerLane(lane=tpl["lane"], avg_time=tpl["avg_time"])
                        for tpl in rs["times_per_lane"]
                    ],
                )
                for rs in data["racer_stats"]
            ],
            highlights=[
                HeatHighlight(
                    type=hl["type"],
                    round_name=hl["round_name"],
                    heat_number=hl["heat_number"],
                    global_heat_number=hl["global_heat_number"],
                    racer_name=hl.get("racer_name"),
                    time=hl.get("time"),
                    margin=hl.get("margin"),
                )
                for hl in data["highlights"]
            ],
            den_stats=[
                DenStat(
                    den_id=ds["den_id"],
                    den_name=ds["den_name"],
                    den_color=ds["den_color"],
                    racer_count=ds["racer_count"],
                    avg_score=ds["avg_score"],
                    best_racer_name=ds["best_racer_name"],
                )
                for ds in data["den_stats"]
            ],
            heat_results=[
                HeatResultRow(
                    round_name=hr["round_name"],
                    heat_number=hr["heat_number"],
                    global_heat_number=hr["global_heat_number"],
                    lane=hr["lane"],
                    car_number=hr["car_number"],
                    racer_first_name=hr["racer_first_name"],
                    racer_last_name=hr["racer_last_name"],
                    time=hr["time"],
                    place=hr["place"],
                )
                for hr in data["heat_results"]
            ],
        )


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
    async def update_racer(
        self, info: Info, id: int, racer: RacerInput
    ) -> Optional[Racer]:
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
        updated = typing.cast(
            Any, crud.update_den(db, den_id=id, den_update=den_update)
        )
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
        """Create a new track and its associated TimerManager."""
        db = info.context["db"]
        track_in = schemas.TrackCreate(**typing.cast(Any, strawberry.asdict(track)))
        new_track = typing.cast(Any, crud.create_track(db, track_in))

        # Handle TimerManager initialization
        timer_managers = info.context.get("timer_managers", {})
        if new_track.id not in timer_managers:
            if new_track.timer_type == models.TimerType.FAKE:
                device = FakeTimerDevice()
            else:
                device = MicroWizardDevice()
            mgr = TimerManager(
                new_track.id, device, session_factory=_session_factory(info)
            )
            timer_managers[new_track.id] = mgr

        return new_track

    @strawberry.mutation
    async def update_track(
        self, info: Info, id: int, track: TrackInput
    ) -> Optional[Track]:
        """Update an existing track."""
        db = info.context["db"]
        db_track = crud.get_track(db, id)
        if not db_track:
            return None

        old_timer_type = db_track.timer_type
        old_serial_port = db_track.serial_port

        track_update = schemas.TrackBase(**typing.cast(Any, strawberry.asdict(track)))
        updated_track = typing.cast(Any, crud.update_track(db, db_track, track_update))

        # Handle TimerManager updates
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(id)
        if mgr:
            # If timer type changed, swap device
            if track.timer_type != old_timer_type:
                if track.timer_type == models.TimerType.FAKE:
                    await mgr.set_device(FakeTimerDevice())
                else:
                    # Everything else currently maps to MicroWizard
                    await mgr.set_device(MicroWizardDevice())

            # If backend-direct mode, handle connection
            if track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                if (
                    track.serial_port != old_serial_port
                    or track.timer_type != old_timer_type
                ) and track.serial_port:
                    # Start connection in background
                    asyncio.create_task(mgr.connect_direct(track.serial_port))
            elif old_timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                # Stopped being backend-direct, ensure it's closed
                await mgr.stop()

        return updated_track

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
    ) -> list[Round]:
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
            previous_champ_round_id = None
            for champ_cfg in config.championship_rounds:
                adv_source = champ_cfg.source
                if adv_source == "PREVIOUS":
                    if previous_champ_round_id:
                        adv_source = f"ROUND:{previous_champ_round_id}"
                    else:
                        # Fallback to PACK if no previous championship round exists
                        adv_source = "PACK"

                round_obj = crud.create_round(
                    db,
                    race_id,
                    current_round_number,
                    models.SchedulingStrategy.PPC,
                    champ_cfg.name,
                    advancement_source=adv_source,
                    advancement_num_racers=champ_cfg.num_top_racers,
                )
                db.flush()  # Ensure the round ID is generated
                previous_champ_round_id = round_obj.id

                num_placeholders = champ_cfg.num_top_racers
                if adv_source == "DEN":
                    den_count = (
                        db.query(models.Den)
                        .filter(models.Den.race_id == race_id)
                        .count()
                    )
                    num_placeholders = champ_cfg.num_top_racers * den_count
                # Championship rounds: 1 run per lane
                for i in range(1):
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
    async def regenerate_round(self, info: Info, round_id: int) -> list[Heat]:
        """Regenerate heats for a round."""
        db = info.context["db"]
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if not round_obj:
            raise ValueError("Round not found")

        # Determine how many runs per lane we have from existing heats
        participants = round_obj.total_participants
        runs_per_lane = 1
        if not round_obj.advancement_source and participants > 0 and round_obj.heats:
            runs_per_lane = len(round_obj.heats) // participants
            if runs_per_lane == 0:
                runs_per_lane = 1
        # Championship rounds (advanced) use runs_per_lane = 1

        heats = []
        for i in range(runs_per_lane):
            new_heats = crud.generate_heats_for_round(
                db,
                round_id,
                clear_existing=(i == 0),
            )
            heats.extend(new_heats)

        await _publish_race_state(round_obj.race_id)
        return typing.cast(Any, heats)

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
    async def delete_heat(self, info: Info, heat_id: int) -> bool:
        """Delete a single heat."""
        db = info.context["db"]
        heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        race_id = heat.race_id if heat else None
        try:
            result = crud.delete_heat(db, heat_id)
        except ValueError:
            return False
        if race_id:
            await _publish_race_state(race_id)
        return result

    @strawberry.mutation
    async def delete_free_race_heat(self, info: Info, heat_id: int) -> bool:
        """Delete a single free race heat."""
        db = info.context["db"]
        heat = (
            db.query(models.FreeRaceHeat)
            .filter(models.FreeRaceHeat.id == heat_id)
            .first()
        )
        race_id = heat.race_id if heat else None
        try:
            result = crud.delete_free_race_heat(db, heat_id)
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

    # Timer Mutations

    @strawberry.mutation
    async def reconnect_timer(self, info: Info, track_id: int) -> bool:
        """Re-trigger the serial connection for a backend-direct timer.

        No-op for FAKE or proxy timers; returns False if the track has no serial port.
        """
        db: Session = info.context["db"]
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return False
        track = crud.get_track(db, track_id)
        if track is None or track.timer_type != models.TimerType.AUTO_DETECT_BACKEND:
            return False
        if not track.serial_port:
            return False
        asyncio.create_task(mgr.connect_direct(track.serial_port))
        return True

    @strawberry.mutation
    async def abort_heat(self, info: Info, track_id: int) -> bool:
        """Abort the current heat and return the timer to IDLE (all timer types)."""
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return False
        await mgr.abort_heat()
        return True

    @strawberry.mutation
    async def force_results(self, info: Info, track_id: int) -> bool:
        """Send the force-results command to the timer device (e.g. RA for MicroWizard)
        and record whatever results have been collected so far.

        No-op for timer types that do not support this command (e.g. FAKE),
        but still forces recording of any pending results.
        Returns False if no manager exists for the track.
        """
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return False

        # 1. Send device command
        await mgr._send_commands(mgr._device.force_results_commands())

        # 2. Force manager to record what it has
        await mgr.force_record()

        return True

    @strawberry.mutation
    async def fake_timer_start(
        self, info: Info, heat_id: int, is_free_race: bool = False
    ) -> bool:
        """Signal race start for the fake timer (ARMED → RUNNING).

        Returns False if the timer is not in ARMED state or heat_id doesn't match.
        """
        timer_managers = info.context.get("timer_managers", {})
        db = info.context["db"]

        if is_free_race:
            free_heat = (
                db.query(models.FreeRaceHeat)
                .filter(models.FreeRaceHeat.id == heat_id)
                .first()
            )
            if not free_heat:
                return False
            race_id = free_heat.race_id
        else:
            heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
            if not heat:
                return False
            race_id = heat.race_id

        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if race is None or race.track_id is None:
            return False
        mgr = timer_managers.get(race.track_id)
        if mgr is None:
            return False
        if mgr._state != TimerState.ARMED or mgr._active_heat_id != heat_id:
            return False

        await mgr.inject_event(RaceStarted())
        return True

    @strawberry.mutation
    async def prepare_heat(
        self, info: Info, heat_id: int, is_free_race: bool = False
    ) -> bool:
        """Arm the timer for a heat (all timer types).

        Computes the lane mask from occupied lanes in the heat, then calls
        TimerManager.prepare_heat() which sends device commands and transitions
        to ARMED state. For the fake timer no serial commands are sent but the
        state still advances.
        """
        timer_managers = info.context.get("timer_managers", {})
        db = info.context["db"]

        heat = None
        free_heat = None

        if is_free_race:
            free_heat = (
                db.query(models.FreeRaceHeat)
                .filter(models.FreeRaceHeat.id == heat_id)
                .first()
            )
            if not free_heat:
                return False
            race = (
                db.query(models.Race)
                .filter(models.Race.id == free_heat.race_id)
                .first()
            )
            lane_results = (
                json.loads(free_heat.lane_assignments)
                if free_heat.lane_assignments
                else []
            )
        else:
            heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
            if not heat:
                return False
            race = db.query(models.Race).filter(models.Race.id == heat.race_id).first()
            lane_results = json.loads(heat.lane_results) if heat.lane_results else []

        if race is None or race.track_id is None:
            return False
        mgr = timer_managers.get(race.track_id)
        if mgr is None:
            return False

        # Compute lane mask and racer mapping
        lane_mask = 0
        racer_by_lane = {}
        if is_free_race:
            # For free races, only arm assigned lanes if any exist.
            # Otherwise arm all lanes on the track so the timer captures everything.
            occupied_lanes = [
                lr["lane"] for lr in lane_results if lr.get("racer_id") is not None
            ]
            if occupied_lanes:
                for lr in lane_results:
                    if lr.get("racer_id") is not None:
                        lane = lr["lane"]
                        lane_mask |= 1 << (lane - 1)
                        racer_by_lane[lane] = lr["racer_id"]
            else:
                track = (
                    db.query(models.Track)
                    .filter(models.Track.id == race.track_id)
                    .first()
                )
                if track:
                    lane_mask = (1 << track.lane_count) - 1
        else:
            # For official heats, compute lane mask from occupied
            # (non-null racer_id) lanes
            for lr in lane_results:
                if lr.get("racer_id") is not None:
                    lane = lr["lane"]
                    lane_mask |= 1 << (lane - 1)
                    racer_by_lane[lane] = lr["racer_id"]

        if lane_mask == 0:
            return False

        await mgr.prepare_heat(
            heat_id=heat_id,
            kind=models.HeatKind.FREE if is_free_race else models.HeatKind.OFFICIAL,
            lane_mask=lane_mask,
            racer_by_lane=racer_by_lane,
        )
        return True

    @strawberry.mutation
    async def fake_timer_finish(
        self, info: Info, heat_id: int, is_free_race: bool = False
    ) -> bool:
        """Generate random results and record them for the fake timer (RUNNING → IDLE).

        Looks up occupied lanes, generates random times (3.0–4.0 s), sorts
        them, assigns placements, then injects LaneResult events into the
        TimerManager. The manager records results through the same path as a
        real timer. Returns False if the timer is not in RUNNING state.
        """
        timer_managers = info.context.get("timer_managers", {})
        db = info.context["db"]

        if is_free_race:
            # Check FreeRaceHeat
            free_heat = (
                db.query(models.FreeRaceHeat)
                .filter(models.FreeRaceHeat.id == heat_id)
                .first()
            )
            if not free_heat:
                return False
            race_id = free_heat.race_id
            lane_results = (
                json.loads(free_heat.lane_assignments)
                if free_heat.lane_assignments
                else []
            )
        else:
            # Official Heat
            heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
            if not heat:
                return False
            race_id = heat.race_id
            lane_results = json.loads(heat.lane_results) if heat.lane_results else []

        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if race is None or race.track_id is None:
            return False
        mgr = timer_managers.get(race.track_id)
        if mgr is None:
            return False
        if mgr._state != TimerState.RUNNING or mgr._active_heat_id != heat_id:
            return False

        occupied = [lr["lane"] for lr in lane_results if lr.get("racer_id") is not None]
        if not occupied:
            # If no racers are assigned (e.g., anonymous free race),
            # generate results for all lanes.
            track = (
                db.query(models.Track).filter(models.Track.id == race.track_id).first()
            )
            if not track:
                return False
            occupied = list(range(1, track.lane_count + 1))

        # Generate random times and sort to assign placements
        timed = [(lane, 3.0 + random.random()) for lane in occupied]
        timed.sort(key=lambda x: x[1])
        for place, (lane, t) in enumerate(timed, start=1):
            await mgr.inject_event(
                TimerLaneResult(lane=lane, time_seconds=t, place=place)
            )

        return True

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
    async def bulk_auto_number(self, info: Info, racer_ids: list[int]) -> int:
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
    async def bulk_clear_numbers(self, info: Info, racer_ids: list[int]) -> bool:
        """Bulk clear car numbers."""
        db = info.context["db"]
        racer = (
            db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first()
            if racer_ids
            else None
        )
        crud.bulk_clear_car_numbers(db, racer_ids)
        if racer:
            await _publish_race_state(racer.race_id)
        return True

    @strawberry.mutation
    async def bulk_check_in(
        self, info: Info, racer_ids: list[int], passed_inspection: bool = True
    ) -> bool:
        """Bulk check-in racers."""
        db = info.context["db"]
        if not racer_ids:
            return False
        racer = db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first()
        if not racer:
            return False
        crud.bulk_check_in_racers(db, racer_ids, passed_inspection)
        await _publish_race_state(racer.race_id)
        return True

    @strawberry.mutation
    async def bulk_move_to_den(
        self, info: Info, racer_ids: list[int], den_id: Optional[int]
    ) -> bool:
        """Bulk move racers to a den."""
        db = info.context["db"]
        racer = (
            db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first()
            if racer_ids
            else None
        )
        crud.bulk_move_racers_to_den(db, racer_ids, den_id)
        if racer:
            await _publish_race_state(racer.race_id)
        return True

    @strawberry.mutation
    async def bulk_delete_racers(self, info: Info, racer_ids: list[int]) -> bool:
        """Bulk delete racers."""
        db = info.context["db"]
        racer = (
            db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first()
            if racer_ids
            else None
        )
        race_id = racer.race_id if racer else None
        crud.bulk_delete_racers(db, racer_ids)
        if race_id:
            await _publish_race_state(race_id)
        return True

    @strawberry.mutation
    async def bulk_assign_photos(
        self,
        info: Info,
        assignments: list[PhotoAssignmentInput],
    ) -> int:
        """Assign uploaded photo URLs to racers in bulk. Returns count updated."""
        db = info.context["db"]
        if not assignments:
            return 0
        assignment_dicts = [
            {"racer_id": a.racer_id, "url": a.url, "photo_type": a.photo_type}
            for a in assignments
        ]
        count = crud.bulk_assign_racer_photos(db, assignment_dicts)
        racer = (
            db.query(models.Racer)
            .filter(models.Racer.id == assignments[0].racer_id)
            .first()
        )
        if racer:
            await _publish_race_state(racer.race_id)
        return count

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

        # Register a TimerManager for each newly created track so that
        # prepare_heat works immediately without requiring a server restart.
        timer_managers = info.context.get("timer_managers", {})
        for track in tracks:
            if track.id not in timer_managers:
                device = (
                    FakeTimerDevice()
                    if track.timer_type == models.TimerType.FAKE
                    else MicroWizardDevice()
                )
                timer_managers[track.id] = TimerManager(
                    track.id, device, session_factory=_session_factory(info)
                )

        # Link existing races if any
        if tracks:
            db.query(models.Race).filter(models.Race.track_id.is_(None)).update(
                {models.Race.track_id: tracks[0].id}
            )
            db.commit()

        from backend.version import __version__ as _version

        return InitialConfigStatus(
            initialized=True,
            version=_version,
            group_name=group.name,
            debug_mode=group.debug_mode,
            tracks=typing.cast(Any, tracks),
        )

    @strawberry.mutation
    async def reset_timer(self, info: Info, track_id: int) -> bool:
        """Manually reset the timer to IDLE state."""
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr:
            await mgr.reset()
            return True
        return False

    @strawberry.mutation
    async def update_initial_config(
        self, info: Info, config: InitialConfigInput
    ) -> InitialConfigStatus:
        """Update system organization name and tracks."""
        db = info.context["db"]
        group = db.query(models.Group).first()
        if group and (
            group.name != config.group_name or group.debug_mode != config.debug_mode
        ):
            if group.name != config.group_name:
                existing = crud.get_group_by_name(db, config.group_name)
                if existing:
                    raise ValueError(f"Group '{config.group_name}' already exists")
            crud.update_group(db, group, config.group_name, config.debug_mode)
            db.refresh(group)

        # Update Tracks by index (setup wizard style)
        db_tracks = crud.get_tracks(db)
        input_tracks = config.tracks
        timer_managers = info.context.get("timer_managers", {})

        for i, input_track in enumerate(input_tracks):
            if i < len(db_tracks):
                # Update existing track inline
                db_track = db_tracks[i]
                old_timer_type = db_track.timer_type
                old_serial_port = db_track.serial_port
                track_update = schemas.TrackBase(
                    **typing.cast(Any, strawberry.asdict(input_track))
                )
                crud.update_track(db, db_track, track_update)
                mgr = timer_managers.get(db_track.id)
                if mgr:
                    if input_track.timer_type != old_timer_type:
                        if input_track.timer_type == models.TimerType.FAKE:
                            await mgr.set_device(FakeTimerDevice())
                        else:
                            await mgr.set_device(MicroWizardDevice())
                    if input_track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                        if (
                            input_track.serial_port != old_serial_port
                            or input_track.timer_type != old_timer_type
                        ) and input_track.serial_port:
                            asyncio.create_task(
                                mgr.connect_direct(input_track.serial_port)
                            )
                    elif old_timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                        await mgr.stop()
            else:
                # Add new track
                track_in = schemas.TrackCreate(
                    **typing.cast(Any, strawberry.asdict(input_track))
                )
                new_track = crud.create_track(db, track_in)

                # Register TimerManager
                if new_track.timer_type == models.TimerType.FAKE:
                    device = FakeTimerDevice()
                else:
                    device = MicroWizardDevice()

                mgr = TimerManager(
                    new_track.id, device, session_factory=_session_factory(info)
                )
                timer_managers[new_track.id] = mgr
                if (
                    new_track.timer_type == models.TimerType.AUTO_DETECT_BACKEND
                    and new_track.serial_port
                ):
                    asyncio.create_task(mgr.connect_direct(new_track.serial_port))

        # Delete extra tracks
        if len(db_tracks) > len(input_tracks):
            for i in range(len(input_tracks), len(db_tracks)):
                track_id = db_tracks[i].id
                mgr = timer_managers.get(track_id)
                if mgr:
                    await mgr.stop()
                    if track_id in timer_managers:
                        del timer_managers[track_id]
                with contextlib.suppress(ValueError):
                    crud.delete_track(db, track_id)

        db.commit()
        tracks = crud.get_tracks(db)

        # Notify active races
        race = db.query(models.Race).first()
        if race:
            await _publish_race_state(race.id)

        from backend.version import __version__ as _version

        return InitialConfigStatus(
            initialized=True,
            version=_version,
            group_name=group.name if group else None,
            debug_mode=group.debug_mode if group else False,
            tracks=typing.cast(Any, tracks),
        )

    @strawberry.mutation
    async def populate_race(
        self, info: Info, race_id: int, config: PopulateTestDataInput
    ) -> str:
        """Populate a race with test data."""
        from backend.db import populate

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

        # Helper for case-insensitive and space-insensitive key search
        def get_val(row, *aliases):
            for alias in aliases:
                # Direct match
                if alias in row:
                    return row[alias]
                # Normalized match
                norm_alias = alias.lower().replace(" ", "_")
                for key in row:
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
    ) -> list[Round]:
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

                # Placeholder Heats (Champ rounds: 1 run per lane)
                for i in range(1):
                    crud.generate_heats_for_round(
                        db,
                        round_obj.id,
                        num_placeholders=round_data.advancement_num_racers or 0,
                        clear_existing=(i == 0),
                    )
                await _publish_race_state(race_id)
                return [typing.cast(Any, round_obj)]
        except ValueError as e:
            raise ValueError(str(e)) from None

    @strawberry.mutation
    async def reorder_heats(
        self, info: Info, heat_updates: list[HeatReorderItemInput]
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
        lane_assignments: list[FreeRaceLaneAssignmentInput],
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
    def upload_image(self, data_url: str) -> str:
        """Upload an image from a Base64 data URL."""
        # Parse data URL: data:<mime>;base64,<data>
        if "," not in data_url:
            raise ValueError("Invalid data URL format")
        header, encoded = data_url.split(",", 1)

        raw_data = base64.b64decode(encoded)
        image_data = convert_to_browser_safe_png(raw_data)

        # If conversion happened (non-browser-safe format like HEIC), the
        # result is PNG regardless of what the data-URL header claims.
        if image_data is not raw_data or "image/png" in header:
            ext = ".png"
        elif "image/gif" in header:
            ext = ".gif"
        elif "image/webp" in header:
            ext = ".webp"
        else:
            ext = ".jpg"

        filename = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(UPLOAD_DIR, filename)

        with open(file_path, "wb") as f:
            f.write(image_data)

        return f"/static/{filename}"


@strawberry.type
class RaceStateChangedEvent:
    """Event emitted whenever a race's state is modified by a mutation."""

    race_id: int
    changed_at: str  # ISO 8601 UTC timestamp


@strawberry.type
class TimingStatsLane:
    """Represents a single lane's result for the Timing Stats observation view."""

    lane_number: int
    racer_name: str
    car_name: Optional[str]
    time: Optional[float]
    place: Optional[int]
    racer_image_url: Optional[str]


@strawberry.type
class TimingStats:
    """Completed heat results for Timing Stats observation."""

    heat_id: int
    round_name: str
    heat_number: int
    global_heat_number: int
    lanes: list[TimingStatsLane]


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
    async def timer_status(
        self, info: Info, track_id: int
    ) -> AsyncGenerator[TimerStateChangedEvent, None]:
        """Subscribe to timer state changes for a specific track.

        Emits a TimerStateChangedEvent on every timer state transition.
        Yields an initial event immediately with the current state.
        """
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is not None:
            yield TimerStateChangedEvent(
                track_id=track_id,
                status=_timer_status_from_manager(mgr),
                changed_at=datetime.now(timezone.utc).isoformat(),
            )
        async with pubsub.subscribe(f"timer_state:{track_id}") as stream:
            async for status_dc in stream:
                yield TimerStateChangedEvent(
                    track_id=track_id,
                    status=TimerStatus(
                        state=status_dc.state,
                        device_name=status_dc.device_name,
                        lane_count=status_dc.lane_count,
                        active_heat_id=status_dc.active_heat_id,
                        last_error=status_dc.last_error,
                        pending_results=[
                            LaneResult(
                                lane=r["lane"],
                                time=r["time"],
                                place=r["place"],
                                racer_id=status_dc.racer_by_lane.get(r["lane"]),
                            )
                            for r in status_dc.pending_results
                        ],
                        serial_log=[
                            SerialLogEntry(
                                direction=e.direction,
                                data=e.data,
                                timestamp=e.timestamp,
                            )
                            for e in status_dc.serial_log
                        ],
                        racer_by_lane=json.dumps(status_dc.racer_by_lane)
                        if status_dc.racer_by_lane
                        else None,
                    ),
                    changed_at=datetime.now(timezone.utc).isoformat(),
                )

    @strawberry.subscription
    async def race_state_changed(
        self, race_id: int
    ) -> AsyncGenerator[RaceStateChangedEvent, None]:
        """Subscribe to state changes for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            async for event in stream:
                yield event

    @strawberry.subscription
    async def leaderboard(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[list[LeaderboardEntry], None]:
        """Subscribe to the leaderboard for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]
            db.commit()
            yield [LeaderboardEntry(**s) for s in scoring.get_leaderboard(db, race_id)]
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield [
                    LeaderboardEntry(**s) for s in scoring.get_leaderboard(db, race_id)
                ]

    @strawberry.subscription
    async def on_deck(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[list[Racer], None]:
        """Subscribe to the 'on deck' racers (next heat) for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_on_deck():
                heats = (
                    db.query(models.Heat).filter(models.Heat.race_id == race_id).all()
                )
                # Sort by round number and heat number
                sorted_heats = sorted(
                    heats, key=lambda h: (h.round.round_number, h.heat_number)
                )
                uncompleted = [
                    h
                    for h in sorted_heats
                    if not h.lane_results
                    or not json.loads(h.lane_results)
                    or json.loads(h.lane_results)[0].get("time") is None
                ]
                if len(uncompleted) > 1:
                    next_heat = uncompleted[1]
                    racer_ids = []
                    results = json.loads(next_heat.lane_results)
                    for r in results:
                        if r.get("racer_id"):
                            racer_ids.append(r["racer_id"])
                    racers = (
                        db.query(models.Racer)
                        .filter(models.Racer.id.in_(racer_ids))
                        .all()
                    )
                    # Maintain order from racer_ids
                    racer_map = {r.id: r for r in racers}
                    return [racer_map[rid] for rid in racer_ids if rid in racer_map]
                return []

            yield _get_on_deck()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_on_deck()

    @strawberry.subscription
    async def currently_racing(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[Optional[Heat], None]:
        """Subscribe to the current heat for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_current():
                heats = (
                    db.query(models.Heat).filter(models.Heat.race_id == race_id).all()
                )
                sorted_heats = sorted(
                    heats, key=lambda h: (h.round.round_number, h.heat_number)
                )
                uncompleted = [
                    h
                    for h in sorted_heats
                    if not h.lane_results
                    or not json.loads(h.lane_results)
                    or json.loads(h.lane_results)[0].get("time") is None
                ]
                return uncompleted[0] if uncompleted else None

            yield _get_current()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_current()

    @strawberry.subscription
    async def timing_stats(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[Optional[TimingStats], None]:
        """Subscribe to the most recently completed heat's timing results."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_timing_stats():
                # Official heats
                heats = (
                    db.query(models.Heat)
                    .filter(models.Heat.race_id == race_id)
                    .join(models.Round)
                    .all()
                )
                completed_official = [
                    h
                    for h in heats
                    if h.lane_results
                    and json.loads(h.lane_results)
                    and json.loads(h.lane_results)[0].get("time") is not None
                ]
                # Sort by round number and heat number, desc
                completed_official.sort(
                    key=lambda h: (h.round.round_number, h.heat_number), reverse=True
                )

                # Free race heats
                free_heats = (
                    db.query(models.FreeRaceHeat)
                    .filter(models.FreeRaceHeat.race_id == race_id)
                    .filter(models.FreeRaceHeat.lane_results.is_not(None))
                    .order_by(models.FreeRaceHeat.id.desc())
                    .all()
                )

                # Pick the most recent one.
                # Since we don't have a reliable cross-table timestamp for all,
                # we'll just check which one exists or is "later" in some sense.
                # Prioritize official if both exist (most common case).
                # Ideally Heat would have an 'updated_at' field.

                target_heat = None
                is_free = False

                if completed_official:
                    target_heat = completed_official[0]
                elif free_heats:
                    target_heat = free_heats[0]
                    is_free = True

                if not target_heat:
                    return None

                results = json.loads(target_heat.lane_results)
                racer_ids = [r.get("racer_id") for r in results if r.get("racer_id")]
                racers = (
                    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).all()
                )
                racer_map = {r.id: r for r in racers}

                lane_stats = []
                for r in results:
                    racer = racer_map.get(r.get("racer_id"))
                    lane_stats.append(
                        TimingStatsLane(
                            lane_number=r.get("lane") or r.get("laneNumber"),
                            racer_name=f"{racer.first_name} {racer.last_name}"
                            if racer
                            else "Unknown",
                            car_name=racer.car_name if racer else None,
                            time=r.get("time"),
                            place=r.get("place"),
                            racer_image_url=racer.racer_image_url if racer else None,
                        )
                    )

                if is_free:
                    global_num = 0
                else:
                    this_round = target_heat.round
                    before_count = (
                        db.query(models.Heat)
                        .join(models.Round, models.Heat.round_id == models.Round.id)
                        .filter(models.Heat.race_id == race_id)
                        .filter(
                            (models.Round.round_number < this_round.round_number)
                            | (
                                (models.Round.round_number == this_round.round_number)
                                & (models.Heat.heat_number < target_heat.heat_number)
                            )
                        )
                        .count()
                    )
                    global_num = before_count + 1

                return TimingStats(
                    heat_id=target_heat.id,
                    round_name="Exhibition" if is_free else target_heat.round.name,
                    heat_number=0 if is_free else target_heat.heat_number,
                    global_heat_number=global_num,
                    lanes=lane_stats,
                )

            yield _get_timing_stats()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_timing_stats()

    @strawberry.subscription
    async def heats(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[list[Round], None]:
        """Subscribe to all rounds and heats for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_rounds():
                return (
                    db.query(models.Round)
                    .filter(models.Round.race_id == race_id)
                    .order_by(models.Round.round_number)
                    .all()
                )

            yield _get_rounds()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_rounds()

    @strawberry.subscription
    async def free_race_heat(
        self, info: Info, heat_id: int
    ) -> AsyncGenerator[Optional[FreeRaceHeat], None]:
        """Subscribe to updates for a specific free race heat."""
        db = info.context["db"]

        def _get_heat():
            return (
                db.query(models.FreeRaceHeat)
                .filter(models.FreeRaceHeat.id == heat_id)
                .first()
            )

        yield _get_heat()
        # Find race_id to subscribe to race_state changes
        heat = _get_heat()
        if not heat:
            return

        async with pubsub.subscribe(f"race_state:{heat.race_id}") as stream:
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_heat()

    @strawberry.subscription
    async def active_free_race_heat(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[Optional[FreeRaceHeat], None]:
        """Subscribe to the active (uncompleted) free race heat for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_active_free():
                return (
                    db.query(models.FreeRaceHeat)
                    .filter(
                        models.FreeRaceHeat.race_id == race_id,
                        models.FreeRaceHeat.lane_results.is_(None),
                    )
                    .order_by(models.FreeRaceHeat.id.desc())
                    .first()
                )

            yield _get_active_free()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_active_free()


schema = strawberry.Schema(query=Query, mutation=Mutation, subscription=Subscription)
