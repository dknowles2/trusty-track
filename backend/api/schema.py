import asyncio
import base64
import contextlib
import csv
import enum
import io
import json
import logging
import os
import typing
import uuid
from collections.abc import AsyncGenerator, Iterable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

import pillow_heif
import strawberry
from pydantic import ValidationError
from sqlalchemy.orm import Session, object_session
from strawberry.types import Info

from backend import demo_mode
from backend.api import auth
from backend.api.auth import AuditExtension, RolePolicyExtension
from backend.api.demo_policy import DemoPolicyExtension
from backend.api.loaders import RequestLoaders
from backend.api.pubsub import pubsub
from backend.db import crud, models, schemas
from backend.db.database import UPLOAD_DIR
from backend.domain import advancement, audit, lanes
from backend.domain import displays as domain_displays
from backend.domain import heat_session as domain_heat_session
from backend.domain import scoring as domain_scoring
from backend.services import displays as displays_service
from backend.services import records as records_service
from backend.services import scoring
from backend.services.image_processing import convert_to_browser_safe_png
from backend.services.timer.devices import ALL_PROFILES, DEFAULT_PROFILE, FAKE
from backend.services.timer.devices import by_key as _profile_by_key
from backend.services.timer.devices import fake as fake_timer
from backend.services.timer.devices.base import (
    LaneResult as TimerLaneResult,
)
from backend.services.timer.devices.base import RaceStarted, TimerProfile
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

logger = logging.getLogger(__name__)

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


#: What a CSV column may say to mean "yes" for `car_passed_inspection`.
#: The import UI normalizes to `yes` before sending; this covers a file posted
#: to the mutation directly, and mirrors the same set in `csvMapping.ts`.
_TRUTHY_CSV_VALUES = frozenset({"y", "yes", "true", "1", "x", "passed", "pass"})

#: How many heats past the one on the track the audience display shows (#209).
#:
#: Two, because staging takes a heat's notice: the child in the bleachers is
#: not watching the screen, so a display that names only the next heat names
#: them at the moment the announcer is already calling for them. Three would be
#: a wall of names nobody reads.
ON_DECK_DEPTH = 2


def _unfinished(db: Session, heats: Sequence[models.Heat]) -> list[models.Heat]:
    """The heats the race has not got to yet, in the order given.

    "Not got to yet" is :func:`domain.lanes.is_finished` — a skipped heat counts
    as done. The audience subscriptions used to test lane 0 of the blob for a
    time, which meant a skipped heat stayed at the head of this list for the rest
    of the event and pinned `currentlyRacing` to it (#55).
    """
    heats = list(heats)
    return [
        heat
        for heat, heat_lanes in zip(heats, crud.lanes_for_heats(db, heats), strict=True)
        if not lanes.is_finished(heat_lanes)
    ]


def _stored_lanes(db: Session, heat: models.Heat) -> list[lanes.Lane]:
    """One heat's lanes, from the table (#72).

    For the mutation resolvers, which deal in a single heat and so cannot
    N+1 — the loaders' batched version is for the read path, where a page asks
    about every heat in a race.
    """
    return crud.lanes_for_heats(db, [heat])[0]


def _free_race_heats(db: Session, race_id: int, recorded: bool) -> list[models.Heat]:
    """A race's free heats, newest first, split on whether they have been run.

    Since #6 a free heat holds its schedule in ``lane_results`` from the moment
    it is created, just as an official heat does, so "has it been run" is no
    longer a null check on a column and cannot be asked in SQL of a JSON blob.
    Free heats are few and short-lived, so the scan is cheap.
    """
    heats = (
        db.query(models.Heat)
        .filter(
            models.Heat.race_id == race_id,
            models.Heat.kind == models.HeatKind.FREE,
        )
        .order_by(models.Heat.id.desc())
        .all()
    )
    return [
        heat
        for heat, heat_lanes in zip(heats, crud.lanes_for_heats(db, heats), strict=True)
        if lanes.has_results(heat_lanes) is recorded
    ]


def _as_heat_lanes(rows: Iterable[models.HeatLane]) -> list["HeatLane"]:
    """``heat_lanes`` rows as the GraphQL type."""
    return [
        HeatLane(
            lane=row.lane,
            racer_id=row.racer_id,
            placeholder_slot=row.placeholder_slot,
            time=row.time_seconds,
            place=row.place,
            skipped=row.skipped,
        )
        for row in rows
    ]


def _heat_lanes(info: Info, obj: Any, heat_id: int) -> list["HeatLane"]:
    """Resolve a heat's lanes, from a snapshot if it brought its own.

    Defined here rather than as a method so both GraphQL heat types share it.

    ``obj`` is whatever is standing in for the heat. Events published to
    subscribers carry a detached :class:`_HeatSnapshot` with its lanes already
    captured, because by the time a subscriber renders it there is no session
    left to load them from.
    """
    captured = getattr(obj, "captured_lanes", None)
    if captured is not None:
        return captured
    return _as_heat_lanes(_loaders(info).lanes_for_heat(obj.race_id, heat_id))


@strawberry.type
class LaneResult:
    """
    Represents the result of a single racer in a single lane of a heat.
    """

    lane: int
    racer_id: int | None
    time: float | None
    place: int | None


@strawberry.type
class HeatLane:
    """One lane of one heat, read from the ``heat_lanes`` table.

    The structured replacement for picking apart the ``laneResults`` JSON string
    on the client (issue #5). Two things the blob conflated are separate here:

    - an empty lane and an undecided championship slot are both ``racerId:
      null``, told apart by ``placeholderSlot`` — the blob encoded the slot as a
      *negative* ``racer_id``, which clients had to know to filter out;
    - ``skipped`` is a real field rather than a key the backend carried around
      without reading.

    This is the only lane read path. ``laneResults`` — the raw blob, handed out
    as a string — was kept alongside it while the client moved over, and is
    gone: an API that offers both invites new code to pick the untyped one.
    """

    lane: int
    racer_id: int | None
    placeholder_slot: int | None
    time: float | None
    place: int | None
    skipped: bool


@strawberry.type
class Heat:
    """
    Represents a single heat in a round.
    """

    id: int
    race_id: int
    round_id: int
    heat_number: int

    @strawberry.field
    def lanes(self, info: Info) -> list[HeatLane]:
        """This heat's lanes, in lane order."""
        return _heat_lanes(info, self, self.id)

    @strawberry.field
    def round_number(self) -> int:
        # `self` is the ORM Heat; the round is eagerly loaded by the resolvers
        # that return heats, so this costs nothing.
        return self.round.round_number if self.round else 0

    @strawberry.field
    def round_name(self) -> str | None:
        return self.round.name if self.round else None

    @strawberry.field
    def global_heat_number(self, info: Info) -> int:
        number = _loaders(info).global_heat_number(self.race_id, self.id)
        return number if number is not None else self.heat_number


@strawberry.type
class AdvancementRacer:
    """
    Represents a racer eligible for advancement to a championship round.
    """

    racer_id: int
    first_name: str
    last_name: str
    car_number: int | None
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
    source: str | None
    num_racers: int | None
    #: The field is drawn from the bottom of the standings — a Slowest Race
    #: bracket. The screens read this to say "slowest" where they would say
    #: "top", and nothing else about advancement changes.
    from_bottom: bool = False
    #: The round was raced, and its field no longer matches who would advance
    #: from the standings as they now are (#229). Invalidation deliberately
    #: leaves a raced round alone when an earlier result is corrected — "a
    #: stale field the operator can see and fix beats silently wiping heats
    #: people ran" — and this is the seeing half, which did not exist.
    field_is_stale: bool = False


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
        for lane in loaders.lane_values_for_heat(race_id, heat.id)
    )

    all_rounds = loaders.rounds_for_race(race_id)

    # Ready when every earlier round is settled. This used to be a private
    # copy of the rule that accepted a place without a time (how a POINTS race
    # is entered by hand) while the domain's required a time — so the screen
    # said ready while `trigger_auto_advancements`, reading the domain rule,
    # never fired (#224). The domain rule accepts both now, and skipped heats
    # too; this reads it rather than restating it.
    def _earlier_heats_finished() -> bool:
        for r in all_rounds:
            if r.round_number >= round_obj.round_number:
                continue
            round_lanes = [
                loaders.lane_values_for_heat(race_id, heat.id)
                for heat in loaders.heats_for_round(race_id, r.id)
            ]
            if not advancement.is_round_complete(round_lanes):
                return False
        return True

    is_ready = _earlier_heats_finished()

    adv_source = round_obj.advancement_source
    adv_num = round_obj.advancement_num_racers
    adv_from_bottom = round_obj.advancement_from_bottom

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
            adv_from_bottom = next_round.advancement_from_bottom

    winner_ids: set[int] = set()
    if requires_advancement:
        winner_ids = set(
            scoring.get_advancing_racers(
                db, race_id, adv_source, adv_num, from_bottom=adv_from_bottom
            )
        )

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

    # A raced championship round whose field has drifted from the standings.
    # Only a *raced* round can be stale: an unraced one is re-fielded by
    # invalidation (or withdrawal) the moment the standings move, so a
    # mismatch there is a bug, not a state. Sets, not lists — lane order is
    # the scheduler's business.
    field_is_stale = False
    if round_obj.advancement_source is not None and already_advanced and winner_ids:
        round_lanes = [
            loaders.lane_values_for_heat(race_id, heat.id)
            for heat in loaders.heats_for_round(race_id, round_id)
        ]
        actual_field = {
            lane.racer_id
            for heat_lanes in round_lanes
            for lane in heat_lanes
            if lane.racer_id is not None
        }
        raced = any(lanes.has_results(heat_lanes) for heat_lanes in round_lanes)
        field_is_stale = raced and bool(actual_field) and actual_field != winner_ids

    return AdvancementStatus(
        is_ready=is_ready,
        requires_advancement=requires_advancement,
        already_advanced=already_advanced,
        advancing_racers=advancing_racers,
        source=adv_source,
        num_racers=adv_num,
        from_bottom=adv_from_bottom,
        field_is_stale=field_is_stale,
    )


@strawberry.type
class Round:
    """
    Represents a single round of racing.
    """

    id: int
    race_id: int
    round_number: int
    name: str | None
    scheduling_strategy: str
    advancement_source: str | None
    advancement_num_racers: int | None
    #: A Slowest Race bracket: the field is drawn from the bottom of the
    #: standings instead of the top, and cars with no recorded result are
    #: left out. Everything else about a championship round is unchanged.
    advancement_from_bottom: bool
    #: Ladderless elimination only: how many heats a car may lose before it
    #: is out. Null for every other scheduling strategy.
    elimination_losses: int | None
    #: Balanced racing only: how many phases the round runs. Null for every
    #: other scheduling strategy.
    balanced_phases: int | None
    #: A lane went out of service part-way through this round (#171). The
    #: racers in the vacated lanes raced fewer times than everybody else, so it
    #: does not count toward `POINTS` standings — see `domain/scoring`.
    disrupted: bool

    @strawberry.field
    def heats(self, info: Info) -> list[Heat]:
        """Get all heats in this round."""
        return typing.cast(Any, _loaders(info).heats_for_round(self.race_id, self.id))

    @strawberry.field
    def advancement_status(self, info: Info) -> AdvancementStatus:
        """Check if a round is ready to advance."""
        return _advancement_status(info, self.race_id, self.id)


@strawberry.type
class TimerModel:
    """One timer the app knows how to talk to, for the operator to pick from.

    The frontend has no copy of the profiles and should not get one — the
    backend owns every piece of protocol state, and the browser is a wire even
    when it is holding the port. What it needs is a list to show and a key to
    send back.

    ``provenance`` is here because "we have a profile for your timer" and "your
    timer is known to work" are different claims, and for most of these only
    the first is true. An operator choosing a model deserves to see which.
    """

    key: str
    name: str
    provenance: str
    #: Whether a probe can find this model on its own. False means choosing it
    #: by hand is the *only* way to reach it — which is what #143 was about.
    detectable: bool
    #: The port framing, so the picker can warn that a hand-entered port will
    #: be opened at something other than the usual 9600 8-N-1.
    baud_rate: int
    data_bits: int
    stop_bits: float
    parity: str


@strawberry.type
class InitialConfigStatus:
    """
    Represents the system initialization state.
    """

    initialized: bool
    version: str
    group_name: str | None = None
    debug_mode: bool = False
    tracks: list["Track"] = strawberry.field(default_factory=list)
    current_race_id: int | None = None
    #: Whether this process is serving the public demo
    #: (:mod:`backend.demo_mode`). The client needs it for the same reason the
    #: PIN flags below are here: it is a fact about the *install* that changes
    #: what the UI should do, and there is no other way for a page served by
    #: this server to find out. It drives the idle disconnect — a parked demo
    #: tab holds a subscription socket open, and an instance with a socket open
    #: never scales to zero.
    demo_mode: bool = False
    #: Whether an operator PIN is set — i.e. whether roles are enforced at all
    #: (#15). Never the PIN or its hash: this says only that a lock exists, so
    #: the settings page can tell the operator which state they are in.
    pin_required: bool = False
    #: The same fact about the optional check-in PIN. Both are needed because
    #: the settings page can only offer to *remove* a PIN that exists, and a
    #: blank field means "leave it alone" rather than "there isn't one" (#192).
    checkin_pin_set: bool = False
    #: Whether the *caller* currently holds the operator role. Lets the UI ask
    #: for the PIN before an action fails rather than after.
    is_operator: bool = True


@strawberry.input
class InitialConfigInput:
    """
    Input for initial system configuration.
    """

    group_name: str
    debug_mode: bool = False
    tracks: list["TrackInput"]
    #: Four digits, or empty/None to leave unchanged. Setting the operator PIN
    #: is what turns enforcement on; clearing it turns it off again, which is
    #: the escape hatch for an operator who has locked themselves out and can
    #: reach the machine (#15).
    operator_pin: str | None = None
    checkin_pin: str | None = None


@strawberry.input
class RacerInput:
    """
    Input type for creating or updating a racer participant.
    """

    first_name: str
    last_name: str
    car_number: int | None = None
    den_id: int | None = None
    car_name: str | None = None
    car_passed_inspection: bool = False
    car_weight: float | None = None
    racer_image_url: str | None = None
    car_image_url: str | None = None
    race_id: int | None = None


@strawberry.input
class DenInput:
    """
    Input type for creating or updating a Den sub-group.
    """

    name: str
    color: str = "#000000"
    rank: str | None = None
    car_number_range_start: int | None = None
    car_number_range_end: int | None = None


@strawberry.input
class RaceInput:
    """
    Input type for creating or updating a race event.
    """

    name: str
    date_time: str | None = None
    location: str | None = None
    group_id: int = 1
    track_id: int
    scoring_strategy: str = "TIMED"
    car_numbering_strategy: str = "MANUAL"
    global_start_number: int = 1
    championship_trophies: int = 3
    # The pack's weight limit in ounces, or null for no check (#205).
    weight_limit_oz: float | None = None


@strawberry.input
class RaceUpdateInput:
    """
    Input type for updating an existing race event.
    """

    name: str | None = None
    date_time: str | None = None
    location: str | None = None
    track_id: int | None = None
    scoring_strategy: str | None = None
    car_numbering_strategy: str | None = None
    global_start_number: int | None = None
    championship_trophies: int | None = None
    auto_advance_heat: bool | None = None
    weight_limit_oz: float | None = None
    # Turning the weight check off, explicitly (#205).
    #
    # `update_race` drops every null from its payload — absent means "leave
    # alone", which is what lets the settings page re-submit the whole race
    # without wiping the fields it does not offer. So there is no way to *set*
    # a field back to null, and without this the weight check could be switched
    # on and never off again. Same shape as the PIN's removal control (#192),
    # and for the same reason.
    clear_weight_limit: bool = False


@strawberry.input
class TrackInput:
    """
    Input type for creating or updating a physical track configuration.
    """

    name: str = "Main Track"
    lane_count: int = 4
    length_feet: int | None = None
    timer_type: str = "FAKE"
    serial_port: str | None = None
    #: Which timer model, by `TimerProfile.key`. Null detects it (#143).
    timer_profile: str | None = None
    remote_start_installed: bool = False


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
    avg_time: float | None


@strawberry.type
class RacerStat:
    """Per-racer statistics computed across all completed heats."""

    racer_id: int
    first_name: str
    last_name: str
    car_number: int | None
    den_name: str
    heats_completed: int
    heats_scheduled: int
    min_time: float | None
    max_time: float | None
    mean_time: float | None
    std_dev: float | None
    times_per_lane: list[TimesPerLane]


@strawberry.type
class LaneTimeStat:
    """Fairness statistics for a single lane."""

    lane: int
    avg_time: float | None
    heat_count: int
    relative_advantage_pct: float | None


@strawberry.type
class HeatHighlight:
    """A notable moment from the race (fastest heat, closest race, etc.)."""

    type: str  # "FASTEST_HEAT" | "CLOSEST_RACE"
    round_name: str
    heat_number: int
    global_heat_number: int
    racer_name: str | None
    time: float | None
    margin: float | None


@strawberry.type
class DenStat:
    """Aggregate statistics for a den."""

    den_id: int
    den_name: str
    den_color: str
    racer_count: int
    avg_score: float | None
    best_racer_name: str | None


@strawberry.type
class HeatResultRow:
    """A single lane result row, used for CSV export."""

    round_name: str
    heat_number: int
    global_heat_number: int
    lane: int
    car_number: int | None
    racer_first_name: str
    racer_last_name: str
    time: float | None
    place: int | None


@strawberry.type
class TrackRecord:
    """One racer's best time on this race's track, across every race on it.

    Computed on every read, never stored — a corrected time moves the
    record, and deleting a race deletes the records it set. A null
    ``race_id`` marks a historical record, entered by hand for an event
    from before Trusty Track; its labels are whatever the operator typed.
    """

    time_seconds: float
    racer_name: str
    car_number: int | None
    race_id: int | None
    race_name: str | None
    race_date: str | None


@strawberry.type
class HistoricalTrackRecord:
    """A hand-entered record from before Trusty Track was keeping them.

    The management view — what the operator sees on the track's card in
    System Settings. The record board itself merges these into
    `RaceStats.track_records`.
    """

    id: int
    track_id: int
    time_seconds: float
    racer_name: str
    car_number: int | None
    race_name: str | None
    race_date: str | None


@strawberry.input
class HistoricalTrackRecordInput:
    """A historical record as typed in: a time, a name, and labels."""

    time_seconds: float
    racer_name: str
    car_number: int | None = None
    race_name: str | None = None
    race_date: str | None = None


def _historical_record_input(
    record: HistoricalTrackRecordInput,
) -> schemas.HistoricalTrackRecordCreate:
    """Validate a typed-in record, refusing with a sentence rather than a trace.

    The rules live on the Pydantic schema — one copy — and Pydantic's own
    refusal is a wall of locations and error codes. The operator typing at
    the settings page gets the message the validator wrote.
    """
    try:
        return schemas.HistoricalTrackRecordCreate(
            time_seconds=record.time_seconds,
            racer_name=record.racer_name,
            car_number=record.car_number,
            race_name=record.race_name,
            race_date=record.race_date,
        )
    except ValidationError as exc:
        first = exc.errors()[0]["msg"].removeprefix("Value error, ")
        raise ValueError(first.capitalize().rstrip(".") + ".") from exc


def _historical_record(row: models.HistoricalTrackRecord) -> HistoricalTrackRecord:
    """The one converter from the stored row to the management type."""
    return HistoricalTrackRecord(
        id=row.id,
        track_id=row.track_id,
        time_seconds=row.time_seconds,
        racer_name=row.racer_name,
        car_number=row.car_number,
        race_name=row.race_name,
        race_date=row.race_date,
    )


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
    track_records: list[TrackRecord]


@strawberry.type
class LeaderboardEntry:
    """
    Represents a single entry in the race leaderboard.
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
    rank: int


@strawberry.type
class Den:
    """Represents a Den (sub-group of racers), usually by rank or age."""

    id: int
    name: str
    color: str
    rank: str | None
    race_id: int
    car_number_range_start: int | None
    car_number_range_end: int | None

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
    name: str | None = None
    advancement_source: str | None = None
    advancement_num_racers: int | None = None
    runs_per_lane: int = 1
    general_type: str = "PACK"
    #: Draw the field from the bottom of the standings — a Slowest Race
    #: bracket. Only meaningful with an ``advancement_source``.
    advancement_from_bottom: bool = False
    #: Ladderless elimination only: losses before a car is out. Defaults to
    #: 3 when the strategy is ``ELIMINATION`` and this is not supplied.
    elimination_losses: int | None = None
    #: Balanced racing only: how many phases to run. Defaults to the track's
    #: lane count when the strategy is ``BALANCED`` and this is not supplied
    #: — GPRM's own advice, one phase per lane.
    balanced_phases: int | None = None


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
    car_number: int | None
    car_name: str | None
    car_passed_inspection: bool
    car_weight: float | None
    racer_image_url: str | None
    car_image_url: str | None
    den_id: int | None
    race_id: int

    @strawberry.field
    def den(self, info: Info) -> Den | None:
        """Get the den this racer belongs to, if any."""
        if not self.den_id:
            return None
        return typing.cast(Any, _loaders(info).den_by_id(self.race_id, self.den_id))


@strawberry.type
class Award:
    """One trophy, and whoever is holding it (#170).

    ``recipient`` is a **field**, not a column. For a `SPEED` award it is worked
    out from the standings every time it is asked for, so an award defined
    before the racing starts stays correct when a time is corrected at the end
    of it. Storing it would make this the first thing in the app able to
    disagree with the leaderboard.

    A null recipient is the ordinary state for most of an event, not an error:
    third place has nobody until three cars have run, and Best Paint has nobody
    until somebody decides.
    """

    id: int
    race_id: int
    name: str
    kind: str
    sort_order: int
    #: `SPEED` only: `"PACK"` or `"ROUND:<id>"`, and a 1-based `place`.
    source: str | None
    place: int | None
    den_id: int | None

    @strawberry.field
    def recipient(self, info: Info) -> "Racer | None":
        """Whoever has won this, or null if nobody has yet."""
        racer_id = _loaders(info).award_recipients(self.race_id).get(self.id)
        if racer_id is None:
            return None
        return typing.cast(Any, _loaders(info).racer_by_id(self.race_id, racer_id))

    @strawberry.field
    def den(self, info: Info) -> Den | None:
        """The den this award is narrowed to, if any."""
        if not self.den_id:
            return None
        return typing.cast(Any, _loaders(info).den_by_id(self.race_id, self.den_id))


@strawberry.input
class AwardInput:
    """Creating or editing an award.

    Every field but `name` is optional, and the ones belonging to the other kind
    are cleared server-side — `crud._clear_fields_of_other_kind`. A client that
    switches an award from `SPEED` to `SPECIAL` should not also have to remember
    to null the source.
    """

    name: str
    kind: str = "SPECIAL"
    source: str | None = None
    place: int | None = None
    den_id: int | None = None
    racer_id: int | None = None
    sort_order: int | None = None


@strawberry.type
class Race:
    """
    Represents a Race event, which contains multiple racers, dens, and rounds.
    """

    id: int
    name: str
    date_time: str | None
    location: str | None
    group_id: int
    track_id: int | None
    car_numbering_strategy: str
    global_start_number: int
    championship_trophies: int
    scoring_strategy: str
    auto_advance_heat: bool
    # Null means the race does not check weights (#205).
    weight_limit_oz: float | None

    @strawberry.field
    def leaderboard(
        self,
        info: Info,
        round_id: int | None = None,
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
    def awards(self, info: Info) -> list[Award]:
        """The trophies this race hands out, in presentation order (#170)."""
        return typing.cast(Any, _loaders(info).awards_for_race(self.id))

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
    length_feet: int | None
    timer_type: str
    serial_port: str | None
    #: Which timer model the operator picked, or null to detect it (#143).
    timer_profile: str | None
    #: This track has a solenoid on the start gate. Not detectable from any
    #: timer protocol, so it is a setting — see `TimerStatus.can_remote_start`
    #: for whether the control is actually available, which also needs the
    #: connected device to have a command for it.
    remote_start_installed: bool

    @strawberry.field
    def lane_outages(self, info: Info) -> list[int]:
        """Lanes of this track that are out of service, in order (#171).

        A field rather than a column: it is a set of rows, and the empty list —
        every lane working — is what every track has until somebody says
        otherwise.
        """
        return crud.lane_outages_for_track(info.context["db"], self.id)

    @strawberry.field
    def historical_records(self, info: Info) -> list[HistoricalTrackRecord]:
        """This track's hand-entered records, best first.

        The management list for the track's card in System Settings — only
        the rows an operator typed, never the computed ones, because these
        are the only ones there is anything to edit.
        """
        rows = crud.historical_track_records(info.context["db"], self.id)
        return [
            HistoricalTrackRecord(
                id=row.id,
                track_id=row.track_id,
                time_seconds=row.time_seconds,
                racer_name=row.racer_name,
                car_number=row.car_number,
                race_name=row.race_name,
                race_date=row.race_date,
            )
            for row in rows
        ]

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
    """A heat run in Free Race mode. Results do not affect standings.

    Backed by a ``Heat`` row with ``kind = FREE`` since #6; the separate table
    is gone. Kept as its own GraphQL type because the free race screens ask
    different questions of it than the race-control screens ask of a heat.
    """

    id: int
    race_id: int
    created_at: str

    @strawberry.field
    def lanes(self, info: Info) -> list[HeatLane]:
        """This heat's lanes, in lane order."""
        return _heat_lanes(info, self, self.id)

    @strawberry.field
    def recorded(self, info: Info) -> bool:
        """Whether a result has been recorded.

        Replaces testing ``laneResults`` for null. A free race heat used to keep
        its schedule and its results in two columns, so an unrecorded heat had
        no results at all; now it holds its schedule in the same place an
        official heat does, and the question is whether anything was timed.

        Off the same batched lane load the ``lanes`` field above uses, so a
        page asking for both pays for one.
        """
        return lanes.has_results(
            _loaders(info).lane_values_for_heat(self.race_id, self.id)
        )


@strawberry.type
class FreeRaceLaneAssignment:
    """A single lane assignment returned from a query."""

    lane: int
    racer_id: int | None


@strawberry.input
class FreeRaceLaneAssignmentInput:
    """A single lane assignment for a free race heat."""

    lane: int
    racer_id: int | None = None  # None = empty lane


@strawberry.input
class HeatLaneInput:
    """One lane of a heat being written (#5).

    The write-path counterpart of :class:`HeatLane`, and the replacement for
    handing the server a JSON string it had to trust. ``racerId`` and
    ``placeholderSlot`` are mutually exclusive; a lane with neither is empty.
    """

    lane: int
    racer_id: int | None = None
    placeholder_slot: int | None = None
    time: float | None = None
    place: int | None = None
    skipped: bool = False


def _lanes_from_input(lane_inputs: list[HeatLaneInput]) -> list[lanes.Lane]:
    """Structured input as :class:`~backend.domain.lanes.Lane` objects.

    Took the stored blob as a second argument until #72 dropped the column, so
    that ``lanes.carry_extras`` could preserve keys a client cannot see and so
    cannot send back. ``heat_lanes`` models every field there is now, so there
    is nothing left to carry.
    """
    return [
        lanes.Lane(
            lane=item.lane,
            racer_id=item.racer_id,
            placeholder_slot=item.placeholder_slot,
            time=item.time,
            place=item.place,
            skipped=item.skipped,
        )
        for item in lane_inputs
    ]


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
    device_name: str | None
    #: Where the device's description came from, and whether it has ever been
    #: run against the hardware. Most profiles are adapted from DerbyNet and
    #: have not been, which the operator deserves to know before trusting one.
    device_provenance: str | None = None
    lane_count: int | None = None
    active_heat_id: int | None = None
    last_error: str | None = None
    #: The serial port in use, if any. In backend-direct mode this is usually
    #: found rather than configured (#89), so it is the only way for an
    #: operator to see which port the timer was detected on.
    port: str | None = None
    #: Whether to offer the operator a "release the gate" control. True needs
    #: both halves: the connected device has a command for it, and the track is
    #: marked as having the solenoid it drives. Reported here rather than
    #: derived on the client, because the client has no copy of the profiles.
    can_remote_start: bool = False
    pending_results: list[LaneResult] = strawberry.field(default_factory=list)
    serial_log: list[SerialLogEntry] = strawberry.field(default_factory=list)
    racer_by_lane: str | None = None  # JSON mapping of lane -> racer_id
    #: The armed (or just-finished) run is a bench exercise, not a heat
    #: (#235) — the diagnostics page shows its results as a test's.
    test_run: bool = False


#: The domain's phase enum, published as-is. Wrapped from here rather than
#: decorated where it is defined, so `backend/domain` keeps importing no
#: Strawberry — and wrapped rather than re-declared, so there is one copy of the
#: vocabulary and a phase added there cannot be forgotten here.
HeatPhase = strawberry.enum(domain_heat_session.Phase, name="HeatPhase")

#: What an audience display is showing (#174). Wrapped for the same reason as
#: the phase above: one copy of the vocabulary, and a view added to the domain
#: cannot be forgotten here.
DisplayViewEnum = strawberry.enum(domain_displays.DisplayView, name="DisplayView")


def _require_operator_role(info: Info) -> None:
    """Refuse anything but an operator.

    `RolePolicyExtension` guards *mutations*, and this is a query — the same
    gap `/api/backup` and `/ws/timer/{track_id}` each close for themselves. It
    matters more here than most: the log says which device did what, and
    handing that to a wall display would be worse than the log not existing.
    """
    if auth.resolve_role(info.context) is not auth.Role.OPERATOR:
        raise auth.PermissionDeniedError("The activity log is operator-only")


@strawberry.type
class AuditLogEntry:
    """One line of the timeline (#219).

    Everything a screen needs to render the entry is on the entry. Nothing here
    is looked up against the race, deliberately: a round deleted in March
    cannot be named by asking what round 4 is called today, and an entry whose
    story changed as the data moved would be a second view of the present
    rather than a record of the past.
    """

    id: int
    #: ISO 8601 UTC.
    at: str
    action: str
    role: str
    outcome: str
    race_id: int | None
    #: The redacted details, as a JSON object. A string because the shape
    #: differs per action and a typed field per action would be forty of them.
    details: str | None

    @strawberry.field
    def source_ip(self, info: Info) -> str | None:
        """Where the request came from.

        Operator-only, like the query that reaches it — but named as its own
        field so a screen can choose not to ask. The timeline does not, by
        default: an address against every line is noise until the one evening
        somebody needs to know which device did something.
        """
        _require_operator_role(info)
        # `self` is the ORM row, not this class — Strawberry types here are
        # duck-typed shells. So this reads the column rather than recursing.
        return self.source_ip  # type: ignore[attr-defined,no-any-return]

    @strawberry.field
    def summary(self) -> str:
        """The sentence to show, rendered from this entry alone."""
        return audit.describe(
            audit.Entry(
                action=self.action,
                role=audit.ActorRole(self.role),
                at=self.at,
                outcome=audit.Outcome(self.outcome),
                race_id=self.race_id,
                details=json.loads(self.details) if self.details else {},
            )
        )

    @strawberry.field
    def noteworthy(self) -> bool:
        """Whether this one deserves attention rather than merely a line."""
        return audit.is_noteworthy(
            audit.Entry(
                action=self.action,
                role=audit.ActorRole(self.role),
                at=self.at,
                outcome=audit.Outcome(self.outcome),
            )
        )


@strawberry.type
class Display:
    """One audience display, and what it has been told to show (#174).

    Presence lives in memory rather than the database — see
    `services/displays.py` for why a screen that was on a wall last March is
    not a row worth keeping.
    """

    display_id: str
    name: str
    race_id: int
    view: DisplayViewEnum  # type: ignore[valid-type]
    cycle_seconds: int
    connected: bool
    #: Whether an operator has told this display anything. False means it is
    #: still following its own URL, which is what every display did before
    #: #174 — see `services/displays.py`.
    assigned: bool
    #: What it is showing, in words, so the operator's list does not have to
    #: reimplement the vocabulary to render a row.
    description: str
    #: Whether this view waits for a person. Only the ceremony does, and a
    #: screen assigned to it that nobody drives simply sits on one trophy.
    paced_by_a_person: bool
    #: The operator's last ceremony step for this screen, as a **step** and a
    #: counter saying it is a new one — never a slide number, which only the
    #: screen knows. See `services/displays.Display.slide_seq`.
    #:
    #: The ceremony page applies `slide_delta` when `slide_seq` changes, and
    #: ignores the value it arrives holding: an opening payload is a
    #: reconnection, not an instruction, and obeying it would jump the screen
    #: a trophy every time the wifi hiccuped.
    slide_seq: int
    slide_delta: int


def _display(display: displays_service.Display) -> Display:
    return Display(
        display_id=display.display_id,
        name=display.name,
        race_id=display.race_id,
        view=display.assignment.view,
        cycle_seconds=display.assignment.cycle_seconds,
        connected=display.connected,
        assigned=display.assigned,
        description=domain_displays.describe(display.assignment),
        paced_by_a_person=domain_displays.is_paced_by_a_person(display.assignment.view),
        slide_seq=display.slide_seq,
        slide_delta=display.slide_delta,
    )


async def _publish_displays(race_id: int) -> None:
    """Tell the operator's list that something about a display changed."""
    await pubsub.publish(f"displays:{race_id}", None)


@strawberry.type
class LiveLane:
    """One lane of the heat on the track right now (#7).

    The same shape as :class:`HeatLane`, plus ``pending``. The extra field is
    the point: a time that came from the timer and is not in the database yet
    can still be lost to an abort, and the operator screen has to be able to
    say so rather than presenting it as final.
    """

    lane: int
    racer_id: int | None
    placeholder_slot: int | None
    time: float | None
    place: int | None
    skipped: bool
    pending: bool


@strawberry.type
class HeatSession:
    """What is happening on a track right now — issue #7.

    Three things knew part of this and nothing owned assembling it: the heat row
    holds the schedule and any saved results, the ``TimerManager`` holds lane
    times that have arrived but not landed, and ``RaceExecution.tsx`` merged the
    two in its render function. The rule now lives in
    :mod:`backend.domain.heat_session`; this is where it is served from.
    """

    track_id: int
    heat_id: int | None
    phase: HeatPhase
    #: The device's own state (``IDLE``, ``ARMED``, ``FAULT``…), which is a
    #: different question from :attr:`phase` and still worth showing.
    timer_state: str
    lanes: list[LiveLane]


def _live_lanes(merged: Iterable[domain_heat_session.LiveLane]) -> list[LiveLane]:
    return [
        LiveLane(
            lane=lane.lane,
            racer_id=lane.racer_id,
            placeholder_slot=lane.placeholder_slot,
            time=lane.time_seconds,
            place=lane.place,
            skipped=lane.skipped,
            pending=lane.pending,
        )
        for lane in merged
    ]


def _pending_lanes(status) -> list[domain_heat_session.PendingLane]:
    """The timer's unsaved reports, as the domain layer takes them.

    ``racerId`` is left unset deliberately. Our devices report a lane and a
    time, not a car — the racer comes from the mapping the timer was armed with,
    which is passed to ``merge`` separately. Filling it in from that same
    mapping here would make two of the domain's three sources one source wearing
    a hat, which is what the frontend did.
    """
    if status is None:
        return []
    return [
        domain_heat_session.PendingLane(
            lane=result["lane"],
            time_seconds=result["time"],
            place=result["place"],
        )
        for result in status.pending_results
    ]


def _build_heat_session(
    db: Session,
    timer_managers: Mapping[int, Any],
    track_id: int,
    heat_id: int | None = None,
) -> HeatSession:
    """Assemble the live view of a track from the heat and the timer.

    A plain function rather than a method so the query and the subscription
    answer identically — the subscription's whole job is to re-emit this, and
    two copies of the assembly is how they would drift.
    """
    manager = timer_managers.get(track_id)
    status = manager.status() if manager else None

    if heat_id is None and status is not None:
        heat_id = status.active_heat_id

    heat = (
        db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        if heat_id is not None
        else None
    )
    # A heat id that names nothing is NO_HEAT, not an error: the operator can
    # delete a round while its heat is still armed.
    stored = _stored_lanes(db, heat) if heat is not None else None

    return HeatSession(
        track_id=track_id,
        heat_id=heat.id if heat is not None else None,
        phase=domain_heat_session.phase(stored, status.state if status else None),
        timer_state=status.state if status else "DISCONNECTED",
        lanes=(
            _live_lanes(
                domain_heat_session.merge(
                    stored,
                    _pending_lanes(status),
                    racer_by_lane=status.racer_by_lane if status else None,
                )
            )
            if stored is not None
            else []
        ),
    )


@strawberry.type
class TimerStateChangedEvent:
    """Event emitted whenever the timer state changes for a track."""

    track_id: int
    status: TimerStatus
    changed_at: str  # ISO 8601 UTC timestamp


def _timer_status(s) -> TimerStatus:
    """Convert the ``TimerStatus`` dataclass to the Strawberry type.

    One copy, deliberately. The query built this from a manager and the
    subscription built it inline from the dataclass the pub/sub channel
    carries, which is the arrangement where a field added to one is silently
    missing from the other — and with a normalized cache on the client, a
    subscription payload lacking a field the query supplied is how a value
    disappears from a screen mid-event.
    """
    return TimerStatus(
        state=s.state,
        device_name=s.device_name,
        device_provenance=s.device_provenance,
        port=s.port,
        can_remote_start=s.can_remote_start,
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
        test_run=s.test_run,
    )


def _timer_status_from_manager(mgr) -> TimerStatus:
    return _timer_status(mgr.status())


@strawberry.type
class Query:
    """
    Root query type for fetching data.
    """

    @strawberry.field
    def displays(self, race_id: int) -> list[Display]:
        """Every audience display known for this race (#174).

        Includes ones that have gone quiet, deliberately: a screen that has
        dropped off the wifi is the one the operator most wants to see.
        """
        return [_display(d) for d in displays_service.registry.for_race(race_id)]

    @strawberry.field
    def audit_log(
        self,
        info: Info,
        race_id: int | None = None,
        limit: int = 200,
        before_id: int | None = None,
    ) -> list[AuditLogEntry]:
        """The timeline, newest first (#219).

        Operator-only, and it says so itself: the role policy only guards
        mutations, and this query is exactly the sort a wall display must never
        be able to run.

        ``raceId`` narrows to one race. Entries that concern no particular race
        — setting up a track, restoring a backup — are then out of the way,
        which is what makes a race filter useful rather than merely a filter.

        **A query and not a subscription**, which is a departure from every
        other live view here and is about layering rather than taste. Half the
        entries are written from ``crud`` — the timer records a heat through
        its own session, outside any request (#9) — and publishing from there
        would mean ``db`` importing the api layer's pub/sub to announce its own
        writes. The timeline refetches on ``raceStateChanged`` instead, which
        fires for everything a race-scoped log would want to show and which the
        client already subscribes to.
        """
        _require_operator_role(info)
        return typing.cast(
            Any,
            crud.get_audit_entries(
                info.context["db"],
                race_id=race_id,
                limit=min(limit, 500),
                before_id=before_id,
            ),
        )

    @strawberry.field
    def races(self, info: Info, skip: int = 0, limit: int = 100) -> list[Race]:
        """Get a list of races with pagination."""
        return typing.cast(
            Any, crud.get_races(info.context["db"], skip=skip, limit=limit)
        )

    @strawberry.field
    def timer_models(self) -> list[TimerModel]:
        """Every timer model a track can be set to, in probe order.

        The fake timer is deliberately absent: it is chosen by setting
        ``timer_type`` to FAKE, not by naming a model, and offering it in both
        places would let a track ask for a fake timer over a real serial port.
        """
        return [
            TimerModel(
                key=profile.key,
                name=profile.name,
                provenance=profile.provenance,
                detectable=bool(profile.probe and profile.identification),
                baud_rate=profile.baud_rate,
                data_bits=profile.data_bits,
                stop_bits=profile.stop_bits,
                parity=profile.parity,
            )
            for profile in ALL_PROFILES
        ]

    @strawberry.field
    def version(self) -> str:
        """Get the current application version."""
        try:
            from backend.version import __version__

            return __version__
        except ImportError:
            return "unknown"

    @strawberry.field
    def race(self, info: Info, race_id: int) -> Race | None:
        """Get a single race by ID."""
        return typing.cast(Any, crud.get_race(info.context["db"], race_id=race_id))

    @strawberry.field
    def racers(
        self, info: Info, race_id: int | None = None, skip: int = 0, limit: int = 100
    ) -> list[Racer]:
        """Get a list of racers, optionally filtering by race_id."""
        return typing.cast(
            Any,
            crud.get_racers(
                info.context["db"], skip=skip, limit=limit, race_id=race_id
            ),
        )

    @strawberry.field
    def racer(self, info: Info, racer_id: int) -> Racer | None:
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
            pin_required = bool(group and group.operator_pin_hash)
            return InitialConfigStatus(
                initialized=True,
                version=_version,
                demo_mode=demo_mode.enabled(),
                group_name=group.name if group else None,
                debug_mode=group.debug_mode if group else False,
                tracks=typing.cast(Any, tracks),
                current_race_id=race.id if race else None,
                pin_required=pin_required,
                checkin_pin_set=bool(group and group.checkin_pin_hash),
                # Resolved here rather than left to the extension: this is a
                # *query*, so nothing has asked for a role yet, and the point is
                # to let the UI prompt before an action fails.
                is_operator=auth.resolve_role(info.context) is auth.Role.OPERATOR,
            )
        # Reported on the unconfigured branch too. A demo seeds itself before
        # it serves, so this is only reachable if seeding failed — and a first
        # -run wizard is the one screen that must not be idled out from under
        # somebody halfway through it.
        return InitialConfigStatus(
            initialized=False, version=_version, demo_mode=demo_mode.enabled()
        )

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
    def active_free_race_heat(self, info: Info, race_id: int) -> FreeRaceHeat | None:
        """The most recently started free race heat with no result yet.

        None if nothing is in progress. Used by the Observation page to show
        exhibition heats.

        "No result yet" used to be a null ``lane_results`` column. Since #6 a
        free heat holds its schedule there from the moment it is created, like
        an official one, so the question is whether any lane was timed — which
        cannot be asked in SQL of a JSON blob, hence the scan. Free heats are
        few and short-lived.
        """
        unrun = _free_race_heats(info.context["db"], race_id, recorded=False)
        return typing.cast(Any, unrun[0]) if unrun else None

    @strawberry.field
    def random_free_race_lanes(
        self, info: Info, race_id: int, shuffle: int = 0
    ) -> list[FreeRaceLaneAssignment]:
        """
        Return a random lane assignment for the race's track lane count,
        using only checked-in racers. Frontend can display this as a preview
        before the operator commits to starting the heat.

        ``shuffle`` counts the re-shuffles the operator has asked for, and it
        exists because the draw may be seeded (`demo_seed`): the public demo
        sets ``TRUSTYTRACK_DEMO_SEED``, so without it every call keyed on the
        race alone returned the identical draw and the Re-shuffle button did
        nothing at all. Counting the draws keys each one separately, so a
        re-shuffle really re-shuffles while the *first* draw a screen shows
        stays the fixed one the screenshots and the demo want.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        lane_count = race.track.lane_count if race and race.track else 4
        assignments = crud.get_random_lane_assignments(
            db, race_id, lane_count, shuffle=shuffle
        )
        return [
            FreeRaceLaneAssignment(lane=a["lane"], racer_id=a["racer_id"])
            for a in assignments
        ]

    @strawberry.field
    def timer_status(self, info: Info, track_id: int) -> TimerStatus | None:
        """Return the current timer state for a track."""
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return None
        return _timer_status_from_manager(mgr)

    @strawberry.field
    def heat_session(
        self, info: Info, track_id: int, heat_id: int | None = None
    ) -> HeatSession:
        """The live view of a track: the heat, merged with the timer (#7).

        ``heatId`` names the heat the caller is looking at. It is optional
        because the timer already knows which heat it was armed for, and the
        server answering on its own is the direction of #7 — but the operator
        screen selects the next heat before arming it, so during that window
        only the caller knows.
        """
        return _build_heat_session(
            info.context["db"],
            info.context.get("timer_managers", {}),
            track_id,
            heat_id,
        )

    @strawberry.field
    def race_stats(self, info: Info, race_id: int) -> RaceStats | None:
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
            track_records=[
                TrackRecord(
                    time_seconds=tr.time_seconds,
                    racer_name=tr.racer_name,
                    car_number=tr.car_number,
                    race_id=tr.race_id,
                    race_name=tr.race_name,
                    race_date=tr.race_date,
                )
                for tr in data["track_records"]
            ],
        )


async def _revalidate_timers(info: Info) -> None:
    """Disarm any timer whose heat has just been rewritten underneath it (#50).

    Call after anything that regenerates, deletes or re-fields heats. Recording
    already refuses a stale heat, but only after the cars have run — this moves
    the discovery to the moment it happens, while the track is still empty and
    the operator can simply re-arm.

    Every track is checked rather than the one that owns the changed race: a
    manager knows which heat it armed, and asking it is cheaper than working
    out which races each track could be running.
    """
    db = info.context["db"]
    for mgr in info.context.get("timer_managers", {}).values():
        reason = await mgr.revalidate_armed_heat(db)
        if reason is not None:
            logger.warning("Track %d disarmed: %s", mgr.track_id, reason)


async def _admit_late_racers(info: Info, race_id: int) -> None:
    """Bring the schedule into line with who is checked in (#172, #228).

    Call after anything that changes a round's field — check-in is the gate,
    since ``car_passed_inspection`` is what the generator draws from, so
    creating a racer is not enough on its own. Both directions run from the
    one hook: withdrawal first, so a regeneration fields from the roster as
    it now stands, then admission. Each is idempotent, which is what lets an
    un-check-and-recheck heal itself.

    Timers are revalidated afterwards for the same reason ``regenerateRound``
    does it: either direction can rebuild an unraced round's heats, and an
    armed heat must not be swapped underneath the operator (#50).
    """
    db = info.context["db"]
    crud.withdraw_absent_racers(db, race_id)
    crud.admit_late_racers(db, race_id)
    await _revalidate_timers(info)


def _device_for(track: Any) -> TimerProfile:
    """The profile a track should run on.

    ``FAKE`` is its own device. Otherwise it is the model the operator picked,
    and ``DEFAULT_PROFILE`` only when they picked none — where it is an
    assumption a probe is expected to replace, not an answer (#143).

    A key that names nothing, or names the fake timer on a transport that needs
    a real port, falls back rather than failing: a stale setting should leave
    the track detecting, not leave it dead.
    """
    if track.timer_type == models.TimerType.FAKE:
        return FAKE
    chosen = _profile_by_key(track.timer_profile) if track.timer_profile else None
    return chosen if chosen in ALL_PROFILES else DEFAULT_PROFILE


def _manager_for(track: Any, info: Info) -> TimerManager:
    """A ``TimerManager`` configured from a track row.

    Three mutations create one, and every setting a manager reads off a track
    has to reach all three. Same reason as ``_start_backend_direct`` below,
    same standing reminder: #48.
    """
    device = _device_for(track)
    return TimerManager(
        track.id,
        device,
        session_factory=_session_factory(info),
        remote_start_installed=track.remote_start_installed,
    )


def _start_backend_direct(
    mgr: TimerManager, serial_port: str | None, profile: TimerProfile | None = None
) -> None:
    """Bring a backend-direct timer up, in the background.

    A port entered by hand is honoured exactly as given — the operator may know
    something the probe does not, and a probe writes to every port it tries.
    With no port configured, go and find the timer, which is what
    ``AUTO_DETECT_BACKEND`` has always been named for (#89).

    ``profile`` is the model the operator named, if they named one. It narrows
    the port search to that model rather than walking all seven: they are
    asking *which port*, not *which timer*, and the probe's writes land on
    their hardware either way (#143).

    One helper rather than the branch written out at each call site: there are
    four, and #48 is the standing reminder of what happens when a rule like
    this ends up on only some of them.
    """
    if serial_port:
        asyncio.create_task(mgr.connect_direct(serial_port))
    else:
        asyncio.create_task(mgr.autodetect([profile] if profile else None))


def _apply_pins(group: Any, config: "InitialConfigInput") -> None:
    """Store whichever PINs the wizard sent, hashed (#15).

    Absent means *leave alone* and an explicit empty string means *clear*. The
    two have to differ: the settings page re-submits the whole config on every
    save, and it cannot send back a PIN it is never given — so treating "not
    supplied" as "clear it" would switch enforcement off every time the operator
    changed a track name.
    """
    for field, column in (
        ("operator_pin", "operator_pin_hash"),
        ("checkin_pin", "checkin_pin_hash"),
    ):
        value = getattr(config, field, None)
        if value is None:
            continue
        setattr(group, column, auth.hash_pin(value) if value else None)


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
        await _publish_race_state(new_race.id, kind=RaceChangeKind.RACE_SETTINGS)
        return new_race

    @strawberry.mutation
    def update_race(self, info: Info, id: int, race: RaceUpdateInput) -> Race | None:
        """Update an existing race."""
        db = info.context["db"]
        data = strawberry.asdict(race)
        clear_weight_limit = data.pop("clear_weight_limit", False)
        filtered_data = {k: v for k, v in data.items() if v is not None}
        # Explicit removal beats an absent field, which means "leave alone"
        # here for every other column (#205, following #192).
        if clear_weight_limit:
            filtered_data["weight_limit_oz"] = None
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
    async def assign_display(
        self,
        view: DisplayViewEnum,  # type: ignore[valid-type]
        display_id: str,
        cycle_seconds: int | None = None,
    ) -> Display | None:
        """Tell an audience display what to show (#174).

        Operator-only, and the display is the thing being told: it never asks
        for this, it is handed the answer over the subscription it already
        holds. Returns null for a display nobody has seen, which is what the
        operator gets if a screen was forgotten between listing and clicking.
        """
        if cycle_seconds is not None and cycle_seconds < 1:
            raise ValueError("cycle_seconds must be at least 1")
        display = displays_service.registry.assign(display_id, view, cycle_seconds)
        if display is None:
            return None
        await pubsub.publish(f"display_assignment:{display_id}", None)
        await _publish_displays(display.race_id)
        return _display(display)

    @strawberry.mutation
    async def advance_display(self, display_id: str, delta: int) -> Display | None:
        """Step a screen's awards ceremony from the operator's list.

        The ceremony is paced by a person, and until now that person had to be
        standing at the screen — which is the one place the operator is not,
        having just assigned it from across the room.

        A **step**, not a slide number: the display owns the index, because it
        is the only thing that knows which trophy is up, and it holds no PIN
        so it can report nothing back (#15). Stepping composes with the keys
        and the presenter remote at the screen, which go on working.
        """
        if delta == 0:
            # A step of nowhere still bumps the counter, so every screen would
            # obey a command that means nothing.
            raise ValueError("A ceremony step must move forwards or backwards.")
        display = displays_service.registry.advance(display_id, delta)
        if display is None:
            return None
        await pubsub.publish(f"display_assignment:{display_id}", None)
        return _display(display)

    @strawberry.mutation
    async def rename_display(self, display_id: str, name: str) -> Display | None:
        """Give a display a name the operator will recognise — "gym north"."""
        display = displays_service.registry.rename(display_id, name)
        if display is None:
            return None
        await _publish_displays(display.race_id)
        return _display(display)

    @strawberry.mutation
    async def forget_display(self, display_id: str) -> bool:
        """Drop a display from the list.

        The only way one leaves it. A screen that is switched off looks exactly
        like one whose wifi dropped, so nothing but a person can tell them
        apart — and guessing either way is worse than a row somebody clears.
        """
        display = displays_service.registry.get(display_id)
        race_id = display.race_id if display else None
        removed = displays_service.registry.forget(display_id)
        if removed and race_id is not None:
            await _publish_displays(race_id)
        return removed

    @strawberry.mutation
    async def create_racer(self, info: Info, racer: RacerInput) -> Racer:
        """Create a new racer."""
        db = info.context["db"]
        racer_in = schemas.RacerCreate(**typing.cast(Any, strawberry.asdict(racer)))
        new_racer = typing.cast(Any, crud.create_racer(db, racer_in))
        if new_racer.car_passed_inspection:
            # A racer created already inspected — the check-in desk adding
            # somebody who was never on the roster, which is the commonest way
            # a latecomer actually arrives.
            await _admit_late_racers(info, new_racer.race_id)
        await _publish_race_state(
            new_racer.race_id, kind=RaceChangeKind.ROSTER, racer=new_racer
        )
        return new_racer

    @strawberry.mutation
    async def update_racer(
        self, info: Info, id: int, racer: RacerInput
    ) -> Racer | None:
        """Update an existing racer."""
        db = info.context["db"]
        data = strawberry.asdict(racer)
        filtered_data = {k: v for k, v in data.items() if v is not None}
        racer_update = schemas.RacerUpdate(**typing.cast(Any, filtered_data))
        updated = typing.cast(
            Any, crud.update_racer(db, racer_id=id, racer_update=racer_update)
        )
        if updated:
            # Both directions: a check-in admits (#172), an un-check
            # withdraws (#228). The helper is idempotent either way.
            await _admit_late_racers(info, updated.race_id)
            await _publish_race_state(
                updated.race_id, kind=RaceChangeKind.RACER, racer=updated
            )
        return updated

    @strawberry.mutation
    async def delete_racer(self, info: Info, id: int) -> bool:
        """Delete a racer."""
        db = info.context["db"]
        racer = db.query(models.Racer).filter(models.Racer.id == id).first()
        race_id = racer.race_id if racer else None
        result = crud.delete_racer(db, racer_id=id) is not None
        if race_id:
            await _publish_race_state(race_id, kind=RaceChangeKind.ROSTER)
        return result

    @strawberry.mutation
    async def check_in_racer(
        self,
        info: Info,
        id: int,
        passed_inspection: bool,
        weight: float | None,
        racer_image_url: str | None = None,
        car_image_url: str | None = None,
    ) -> Racer | None:
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
            # Both directions — un-checking is how a withdrawal is recorded
            # (#228), and it has to reach the schedule like a check-in does.
            await _admit_late_racers(info, updated.race_id)
            await _publish_race_state(
                updated.race_id, kind=RaceChangeKind.RACER, racer=updated
            )
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
    async def update_den(self, info: Info, id: int, den: DenInput) -> Den | None:
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

    @strawberry.mutation
    async def set_lane_outages(
        self, info: Info, track_id: int, lanes: list[int]
    ) -> list[int]:
        """Record exactly which of a track's lanes are out of service (#171).

        The whole set, not one lane at a time: the operator screen is a row of
        checkboxes and submits them together, and a lane that has come back is
        simply absent.

        Existing heats are brought into line as well, and what happens depends
        on how far the round has got: one nobody has raced is regenerated for
        the lanes that remain, one part-way through keeps its results and has
        the dead lane vacated from the heats still to come, and one already
        finished is untouched. See `crud.apply_outages_to_scheduled_heats`.

        A round in that middle case is marked `disrupted`, because the racers
        in the vacated lanes end up having raced fewer times than everybody
        else. Under `POINTS` that would make their score *better*, so a
        disrupted round is dropped from `POINTS` standings; under `TIMED`,
        which averages, it still counts.
        """
        db = info.context["db"]
        outages = crud.set_lane_outages(db, track_id, lanes)
        crud.apply_outages_to_scheduled_heats(db, track_id)
        # Regenerating a round replaces its heats, so anything armed against the
        # old ids has to be told (#50). Same reason `updateHeatResult` and
        # `regenerateRound` call it.
        await _revalidate_timers(info)
        for race in db.query(models.Race).filter(models.Race.track_id == track_id):
            await _publish_race_state(race.id)
        return outages

    @strawberry.mutation
    def create_track_record(
        self, info: Info, track_id: int, record: HistoricalTrackRecordInput
    ) -> HistoricalTrackRecord:
        """Enter a track record from before Trusty Track was keeping them.

        It joins the record board as typed: a 2019 record at 2.89 seconds
        stands until a computed 2.88 beats it. The validation is
        `schemas.HistoricalTrackRecordBase`'s — a time of zero or less and a
        blank name are refused where they arrive.
        """
        db = info.context["db"]
        row = crud.create_historical_track_record(
            db, track_id, _historical_record_input(record)
        )
        if row is None:
            raise ValueError("That track no longer exists.")
        return _historical_record(row)

    @strawberry.mutation
    def update_track_record(
        self, info: Info, record_id: int, record: HistoricalTrackRecordInput
    ) -> HistoricalTrackRecord:
        """Correct a hand-entered track record — a typo in a time or a name."""
        db = info.context["db"]
        row = crud.update_historical_track_record(
            db, record_id, _historical_record_input(record)
        )
        if row is None:
            raise ValueError("That record no longer exists.")
        return _historical_record(row)

    @strawberry.mutation
    def delete_track_record(self, info: Info, record_id: int) -> bool:
        """Remove a hand-entered track record.

        Only the hand-entered ones can be removed — a computed record is the
        heats it came from, and goes when they do.
        """
        return crud.delete_historical_track_record(info.context["db"], record_id)

    # Award Mutations (#170)
    @strawberry.mutation
    async def create_award(self, info: Info, race_id: int, award: AwardInput) -> Award:
        """Add an award to a race, at the end of the running order."""
        db = info.context["db"]
        award_in = schemas.AwardCreate(**typing.cast(Any, strawberry.asdict(award)))
        created = typing.cast(Any, crud.create_award(db, race_id, award_in))
        await _publish_race_state(race_id)
        return created

    @strawberry.mutation
    async def update_award(
        self, info: Info, id: int, award: AwardInput
    ) -> Award | None:
        """Edit an award, including reassigning a special award's recipient."""
        db = info.context["db"]
        award_update = schemas.AwardUpdate(**typing.cast(Any, strawberry.asdict(award)))
        updated = typing.cast(
            Any, crud.update_award(db, award_id=id, award_update=award_update)
        )
        if updated:
            await _publish_race_state(updated.race_id)
        return updated

    @strawberry.mutation
    async def delete_award(self, info: Info, id: int) -> bool:
        """Remove an award."""
        db = info.context["db"]
        award = db.query(models.Award).filter(models.Award.id == id).first()
        race_id = award.race_id if award else None
        deleted = crud.delete_award(db, award_id=id) is not None
        if race_id:
            await _publish_race_state(race_id)
        return deleted

    @strawberry.mutation
    async def reorder_awards(
        self, info: Info, race_id: int, award_ids: list[int]
    ) -> list[Award]:
        """Set the order awards are presented in, first to last."""
        db = info.context["db"]
        reordered = typing.cast(Any, crud.reorder_awards(db, race_id, award_ids))
        await _publish_race_state(race_id)
        return reordered

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
            timer_managers[new_track.id] = _manager_for(new_track, info)

        return new_track

    @strawberry.mutation
    async def update_track(
        self, info: Info, id: int, track: TrackInput
    ) -> Track | None:
        """Update an existing track."""
        db = info.context["db"]
        db_track = crud.get_track(db, id)
        if not db_track:
            return None

        old_timer_type = db_track.timer_type
        old_serial_port = db_track.serial_port
        old_profile = db_track.timer_profile

        track_update = schemas.TrackBase(**typing.cast(Any, strawberry.asdict(track)))
        updated_track = typing.cast(Any, crud.update_track(db, db_track, track_update))

        # Handle TimerManager updates
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(id)
        if mgr:
            await mgr.set_remote_start_installed(track.remote_start_installed)

            # Swap the device when either half of "which timer" moved: the
            # transport, or the model on it (#143).
            device = _device_for(updated_track)
            if track.timer_type != old_timer_type or track.timer_profile != old_profile:
                await mgr.set_device(device)

            # If backend-direct mode, handle connection
            if track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                if (
                    track.serial_port != old_serial_port
                    or track.timer_type != old_timer_type
                    or track.timer_profile != old_profile
                ):
                    _start_backend_direct(
                        mgr,
                        track.serial_port,
                        device if track.timer_profile else None,
                    )
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
                # On the rollback list from the moment the row exists —
                # `create_round` commits, so a failure in heat generation
                # leaves a round the rollback must know about (#249).
                created_rounds.append(round_obj)
                crud.generate_heats_for_round(
                    db,
                    round_obj.id,
                    clear_existing=True,
                    runs=config.general_round.runs_per_lane,
                )
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
                    created_rounds.append(round_obj)
                    p_ids = [r.id for r in racers]
                    crud.generate_heats_for_round(
                        db,
                        round_obj.id,
                        racer_ids=p_ids,
                        clear_existing=True,
                        runs=config.general_round.runs_per_lane,
                    )
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
                created_rounds.append(round_obj)

                # As many runs as asked for, exactly as the general round
                # above does (#143). One call: `runs` is a parameter now, and
                # the rebuild paths preserve it from the heats (#230).
                crud.generate_heats_for_round(
                    db,
                    round_obj.id,
                    num_placeholders=crud.round_field_size(db, round_obj),
                    clear_existing=True,
                    runs=champ_cfg.runs_per_lane,
                )
                current_round_number += 1
        except ValueError as e:
            # Reverse creation order: the general round cannot be deleted
            # while championship rounds still exist, so a forward rollback
            # raised out of the rollback and left the half-made rounds
            # committed — and every later wizard run refused (#249).
            for r in reversed(created_rounds):
                crud.delete_round(db, r.id)
            raise e

        db.commit()
        await _publish_race_state(race_id, kind=RaceChangeKind.SCHEDULE)
        return typing.cast(Any, created_rounds)

    @strawberry.mutation
    async def regenerate_round(self, info: Info, round_id: int) -> list[Heat]:
        """Regenerate heats for a round."""
        db = info.context["db"]
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if not round_obj:
            raise ValueError("Round not found")

        # The run count is preserved by `generate_heats_for_round` itself,
        # derived from the heats it clears. The derivation lived here alone
        # from #143 until #230 found the other rebuild paths never had it.
        heats = crud.generate_heats_for_round(db, round_id, clear_existing=True)

        await _revalidate_timers(info)
        await _publish_race_state(
            round_obj.race_id, kind=RaceChangeKind.SCHEDULE, round_id=round_obj.id
        )
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
        await _revalidate_timers(info)
        if race_id:
            await _publish_race_state(race_id, kind=RaceChangeKind.SCHEDULE)
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
        await _revalidate_timers(info)
        if race_id:
            await _publish_race_state(race_id, kind=RaceChangeKind.SCHEDULE)
        return result

    @strawberry.mutation
    async def delete_free_race_heat(self, info: Info, heat_id: int) -> bool:
        """Delete a single free race heat."""
        db = info.context["db"]
        heat = crud.get_free_race_heat(db, heat_id)
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
            db,
            race_id,
            round_obj.advancement_source,
            round_obj.advancement_num_racers,
            from_bottom=round_obj.advancement_from_bottom,
        )
        if not winner_ids:
            return 0
        crud.populate_round_field(db, round_id, winner_ids)
        await _revalidate_timers(info)
        await _publish_race_state(
            race_id, kind=RaceChangeKind.SCHEDULE, round_id=round_id
        )
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
        # No configured port is no longer a reason to refuse: that is precisely
        # the case where the operator wants us to go and look (#89).
        _start_backend_direct(mgr, track.serial_port)
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
    async def start_timer_test(self, info: Info, track_id: int) -> bool:
        """Arm the timer for a bench exercise: every lane, no heat (#235).

        The device gets exactly the commands a real heat would send, so what
        the test exercises is what race day exercises — but there is no heat
        behind it, nothing is recorded anywhere, and no race needs to exist.
        The operator opens the gate by hand and trips the finish sensors; the
        results land in ``timerStatus.pendingResults`` with ``testRun`` set,
        and the report endpoint packages the whole conversation.

        Refused while a real heat is armed or running: a bench test must not
        disarm race day.
        """
        db = info.context["db"]
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return False
        busy = mgr._state in (TimerState.ARMED, TimerState.READY, TimerState.RUNNING)
        if busy and not mgr.status().test_run:
            return False

        track = crud.get_track(db, track_id)
        if track is None:
            return False
        await mgr.prepare_test_heat(track.lane_count)
        return True

    @strawberry.mutation
    async def release_start_gate(self, info: Info, track_id: int) -> str | None:
        """Open the start gate from software, launching the armed heat.

        Returns ``None`` on success, or the reason it did not happen — a string
        rather than a bool because every refusal here has a different operator
        response, and "false" in front of a queue of Cub Scouts is not one.

        Named for what it does to the hardware, not for what the operator wants
        out of it. ``startHeat`` would sit next to ``prepareHeat`` reading like
        its sequel, and it is not: this only ever releases a gate on a heat
        ``prepareHeat`` already armed.
        """
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return "No timer is configured for this track"
        return await mgr.release_start_gate()

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
            free_heat = crud.get_free_race_heat(db, heat_id)
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
        self,
        info: Info,
        heat_id: int,
        is_free_race: bool = False,  # noqa: ARG002
    ) -> bool:
        """Arm the timer for a heat (all timer types).

        Computes the lane mask from occupied lanes in the heat, then calls
        TimerManager.prepare_heat() which sends device commands and transitions
        to ARMED state. For the fake timer no serial commands are sent but the
        state still advances.

        ``is_free_race`` is accepted and ignored: heat ids are unique across
        both kinds since #6, so the kind is read off the heat rather than
        trusted from the caller. Callers still pass it.
        """
        timer_managers = info.context.get("timer_managers", {})
        db = info.context["db"]

        heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        if not heat:
            return False
        race = db.query(models.Race).filter(models.Race.id == heat.race_id).first()
        if race is None or race.track_id is None:
            return False
        mgr = timer_managers.get(race.track_id)
        if mgr is None:
            return False

        lane_mask = 0
        racer_by_lane: dict[int, int | None] = {}
        for lane in _stored_lanes(db, heat):
            if lane.racer_id is not None:
                lane_mask |= 1 << (lane.lane - 1)
                racer_by_lane[lane.lane] = lane.racer_id

        if lane_mask == 0 and heat.kind is models.HeatKind.FREE:
            # A free heat with nobody assigned arms the whole track: the point
            # of an exhibition run is to time whatever is on it.
            track = (
                db.query(models.Track).filter(models.Track.id == race.track_id).first()
            )
            if track:
                lane_mask = (1 << track.lane_count) - 1

        if lane_mask == 0:
            return False

        await mgr.prepare_heat(
            heat_id=heat_id,
            kind=heat.kind,
            lane_mask=lane_mask,
            racer_by_lane=racer_by_lane,
        )
        return True

    @strawberry.mutation
    async def fake_timer_finish(
        self,
        info: Info,
        heat_id: int,
        is_free_race: bool = False,  # noqa: ARG002
    ) -> bool:
        """Generate random results and record them for the fake timer (RUNNING → IDLE).

        Looks up occupied lanes, generates random times (3.0–4.0 s), sorts
        them, assigns placements, then injects LaneResult events into the
        TimerManager. The manager records results through the same path as a
        real timer. Returns False if the timer is not in RUNNING state.

        ``is_free_race`` is accepted and ignored — see ``prepare_heat``.
        """
        timer_managers = info.context.get("timer_managers", {})
        db = info.context["db"]

        heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        if not heat:
            return False

        race = db.query(models.Race).filter(models.Race.id == heat.race_id).first()
        if race is None or race.track_id is None:
            return False
        mgr = timer_managers.get(race.track_id)
        if mgr is None:
            return False
        if mgr._state != TimerState.RUNNING or mgr._active_heat_id != heat_id:
            return False

        occupied = [
            lane.lane for lane in _stored_lanes(db, heat) if lane.racer_id is not None
        ]
        if not occupied:
            # If no racers are assigned (e.g., anonymous free race),
            # generate results for all lanes.
            track = (
                db.query(models.Track).filter(models.Track.id == race.track_id).first()
            )
            if not track:
                return False
            occupied = list(range(1, track.lane_count + 1))

        # Times, fastest first, so the enumeration below is the placement.
        # Keyed on the heat rather than drawn from a running sequence — see
        # `devices.fake.lane_times`.
        timed = fake_timer.lane_times(occupied, key=f"{race.name}#{heat.heat_number}")
        for place, (lane, t) in enumerate(timed, start=1):
            await mgr.inject_event(
                TimerLaneResult(lane=lane, time_seconds=t, place=place)
            )

        return True

    # Heat Mutations
    @strawberry.mutation
    async def update_heat_result(
        self,
        info: Info,
        heat_id: int,
        # Named `lanes` on the wire; the local name would shadow the domain
        # module this resolver uses.
        lanes_input: Annotated[list[HeatLaneInput], strawberry.argument(name="lanes")],
    ) -> Heat | None:
        """Update results for a heat.

        Took a JSON string until #5. The server could not tell a malformed blob
        from an empty heat, and every client had to know that an undecided
        championship slot was a negative racer id.
        """
        db = info.context["db"]
        heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        if heat is None:
            return None
        results = _lanes_from_input(lanes_input)
        # A person typed this: Edit, Override, or a skipped heat. The timer's
        # own results come by a different route entirely (#219).
        updated_heat = typing.cast(
            Any,
            crud.record_heat_result(
                db, heat_id, results, source=audit.ResultSource.OPERATOR
            ),
        )
        # Recording here can re-field a later championship round (#50).
        await _revalidate_timers(info)
        if updated_heat:
            await _publish_race_state(
                updated_heat.race_id,
                kind=RaceChangeKind.HEAT_RESULT,
                heat=updated_heat,
                round_id=updated_heat.round_id,
            )
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
        await _publish_race_state(racer.race_id, kind=RaceChangeKind.RACER)
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
            await _publish_race_state(racer.race_id, kind=RaceChangeKind.RACER)
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
        # Once for the batch, not once per racer: both directions are
        # idempotent and look at everybody, so a per-racer call would
        # regenerate an unraced round sixty times over a desk queue. Runs for
        # un-checks too — that is how a bulk withdrawal reaches the schedule
        # (#228).
        await _admit_late_racers(info, racer.race_id)
        await _publish_race_state(racer.race_id, kind=RaceChangeKind.RACER)
        return True

    @strawberry.mutation
    async def bulk_move_to_den(
        self, info: Info, racer_ids: list[int], den_id: int | None
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
            await _publish_race_state(racer.race_id, kind=RaceChangeKind.ROSTER)
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
            await _publish_race_state(race_id, kind=RaceChangeKind.ROSTER)
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
            await _publish_race_state(racer.race_id, kind=RaceChangeKind.RACER)
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
        _apply_pins(group, config)
        db.commit()

        # Register a TimerManager for each newly created track so that
        # prepare_heat works immediately without requiring a server restart.
        timer_managers = info.context.get("timer_managers", {})
        for track in tracks:
            if track.id not in timer_managers:
                timer_managers[track.id] = _manager_for(track, info)

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
            pin_required=bool(group.operator_pin_hash),
            checkin_pin_set=bool(group.checkin_pin_hash),
            # The caller who just set the PIN keeps the role they had for this
            # response; the next request resolves it from what they send.
            is_operator=True,
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

        if group:
            _apply_pins(group, config)
            db.commit()

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
                old_profile = db_track.timer_profile
                track_update = schemas.TrackBase(
                    **typing.cast(Any, strawberry.asdict(input_track))
                )
                crud.update_track(db, db_track, track_update)
                mgr = timer_managers.get(db_track.id)
                if mgr:
                    await mgr.set_remote_start_installed(
                        input_track.remote_start_installed
                    )
                    device = _device_for(db_track)
                    if (
                        input_track.timer_type != old_timer_type
                        or input_track.timer_profile != old_profile
                    ):
                        await mgr.set_device(device)
                    if input_track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                        if (
                            input_track.serial_port != old_serial_port
                            or input_track.timer_type != old_timer_type
                            or input_track.timer_profile != old_profile
                        ):
                            _start_backend_direct(
                                mgr,
                                input_track.serial_port,
                                device if input_track.timer_profile else None,
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
                mgr = _manager_for(new_track, info)
                timer_managers[new_track.id] = mgr
                if new_track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                    _start_backend_direct(mgr, new_track.serial_port)

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
            await _publish_race_state(race.id, kind=RaceChangeKind.RACE_SETTINGS)

        from backend.version import __version__ as _version

        return InitialConfigStatus(
            initialized=True,
            version=_version,
            group_name=group.name if group else None,
            debug_mode=group.debug_mode if group else False,
            tracks=typing.cast(Any, tracks),
            pin_required=bool(group and group.operator_pin_hash),
            checkin_pin_set=bool(group and group.checkin_pin_hash),
            is_operator=True,
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
    def create_practice_race(self, info: Info) -> Race:
        """A whole event on a fake timer, ready to run (#201).

        One mutation rather than the five round trips a client would need —
        race, dens, roster, check-in, rounds — because a rehearsal that fails
        half way leaves the operator with a broken race to tidy up, which is
        the opposite of the confidence this exists to give.
        """
        db = info.context["db"]
        return typing.cast(Any, crud.create_practice_race(db))

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
            car_name = get_val(row, "car_name")
            passed = get_val(row, "car_passed_inspection", "passed_inspection")

            if not first_name or not last_name:
                continue

            racer_in = schemas.RacerCreate(
                first_name=first_name.strip(),
                last_name=last_name.strip(),
                car_number=int(car_number)
                if car_number and car_number.isdigit()
                else None,
                car_name=car_name.strip() or None if car_name else None,
                # The column mapping normalizes to yes/no before sending, but a
                # file posted straight to the mutation can hold anything.
                car_passed_inspection=bool(passed)
                and passed.strip().lower() in _TRUTHY_CSV_VALUES,
                den_id=den_id,
                race_id=race_id,
            )
            crud.create_racer(db, racer_in)
            count += 1

        # An import creates racers, so the roster list changed.
        await _publish_race_state(race_id, kind=RaceChangeKind.ROSTER)
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
            # From the highest number, not the count: deleting a middle round
            # leaves fewer rounds than the numbering reaches, and a reused
            # number is invisible to advancement's strict ordering (#250).
            next_round_number = (
                max((r.round_number for r in existing_rounds), default=0) + 1
            )

            if not round_data.advancement_source:
                # General Round
                strategy = models.SchedulingStrategy(round_data.scheduling_strategy)
                is_elimination = strategy == models.SchedulingStrategy.ELIMINATION
                is_balanced = strategy == models.SchedulingStrategy.BALANCED
                losses = None
                if is_elimination:
                    losses = round_data.elimination_losses or 3
                    if losses < 1:
                        raise ValueError("A car must be allowed at least one loss.")
                phases = None
                if is_balanced:
                    # GPRM's own advice: at least one phase per lane.
                    phases = round_data.balanced_phases or crud.lane_count_for_race(
                        db, race_id
                    )
                    if phases < 1:
                        raise ValueError("A round needs at least one phase.")
                default_name = (
                    "Elimination Round"
                    if is_elimination
                    else "Balanced Round"
                    if is_balanced
                    else "All Pack"
                )
                round_obj = crud.create_round(
                    db,
                    race_id,
                    next_round_number,
                    strategy,
                    round_data.name or default_name,
                    elimination_losses=losses,
                    balanced_phases=phases,
                )
                crud.generate_heats_for_round(
                    db,
                    round_obj.id,
                    clear_existing=True,
                    runs=round_data.runs_per_lane,
                )
                await _publish_race_state(race_id, kind=RaceChangeKind.SCHEDULE)
                return [typing.cast(Any, round_obj)]
            else:
                # Championship Round (Placeholder)
                if models.SchedulingStrategy(round_data.scheduling_strategy) in (
                    models.SchedulingStrategy.ELIMINATION,
                    models.SchedulingStrategy.BALANCED,
                ):
                    # A championship field is placeholders until the source
                    # decides it, and an elimination wave of placeholders is
                    # nonsense — the format applies to general rounds.
                    raise ValueError(
                        "An elimination or balanced round cannot also be a "
                        "championship round."
                    )
                default_name = (
                    "Slowest Race"
                    if round_data.advancement_from_bottom
                    else f"Finals ({round_data.advancement_source})"
                )
                round_obj = crud.create_round(
                    db,
                    race_id,
                    next_round_number,
                    models.SchedulingStrategy(round_data.scheduling_strategy),
                    round_data.name or default_name,
                    advancement_source=round_data.advancement_source,
                    advancement_num_racers=round_data.advancement_num_racers,
                    advancement_from_bottom=round_data.advancement_from_bottom,
                )

                # Placeholder heats, one set per run — same as above (#143).
                crud.generate_heats_for_round(
                    db,
                    round_obj.id,
                    num_placeholders=crud.round_field_size(db, round_obj),
                    clear_existing=True,
                    runs=round_data.runs_per_lane,
                )
                # A final added after its source finished has no completion
                # event left to fill it (#248) — ask now rather than wait.
                crud.populate_round_if_decided(db, round_obj)
                await _publish_race_state(race_id, kind=RaceChangeKind.SCHEDULE)
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
            await _publish_race_state(
                updated_heats[0].race_id, kind=RaceChangeKind.SCHEDULE
            )
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
            lanes.Lane(lane=a.lane, racer_id=a.racer_id) for a in lane_assignments
        ]
        return typing.cast(Any, crud.create_free_race_heat(db, race_id, assignments))

    @strawberry.mutation
    async def record_free_race_result(
        self,
        info: Info,
        heat_id: int,
        lanes_input: Annotated[list[HeatLaneInput], strawberry.argument(name="lanes")],
    ) -> FreeRaceHeat | None:
        """Record timing results for a free race heat.

        Took a JSON string until #5, and answered a malformed one with a silent
        null — the operator saw a heat that would not record and no reason why.
        """
        db = info.context["db"]
        heat = crud.get_free_race_heat(db, heat_id)
        if heat is None:
            return None
        lane_results = _lanes_from_input(lanes_input)
        updated = typing.cast(
            Any,
            crud.update_free_race_heat_result(
                db, heat_id, lane_results, source=audit.ResultSource.OPERATOR
            ),
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


@strawberry.enum
class RaceChangeKind(enum.Enum):
    """What kind of change a ``RaceStateChangedEvent`` describes.

    Subscribers use this to decide whether they care. Editing a racer's name
    during check-in should not make the stats page re-query the race.
    """

    #: A heat's results were recorded, cleared, or edited. Carries ``heat``.
    HEAT_RESULT = "HEAT_RESULT"
    #: Fields changed on an existing racer — checked in, renamed, renumbered,
    #: photographed. Carries ``racer`` when a single one changed. Crucially this
    #: does *not* change which racers exist or which den they are in, so a
    #: normalized client cache can merge the payload without refetching a list.
    RACER = "RACER"
    #: Racers were added or removed, or moved between dens. ``Race.racers`` and
    #: ``Den.racers`` membership changed, which no payload can express — a
    #: client has to re-read the list.
    ROSTER = "ROSTER"
    #: Heats or rounds were created, regenerated, reordered, or deleted. The
    #: shape of the schedule changed, so a refetch is genuinely warranted.
    SCHEDULE = "SCHEDULE"
    #: Race-level settings changed — name, scoring strategy, trophies.
    RACE_SETTINGS = "RACE_SETTINGS"
    #: Something changed that has not been classified yet. Treat as "refetch".
    OTHER = "OTHER"


class _HeatSnapshot:
    """A detached copy of a Heat, safe to resolve after the request ends.

    Events are published from a mutation whose session is closed before any
    subscriber renders the payload, and the subscription resolves fields in its
    own context. Handing out a live ORM object across that boundary risks a
    ``DetachedInstanceError`` on the first lazy load. Strawberry types here are
    duck-typed shells, so a plain object with the right attributes serves.
    """

    __slots__ = (
        "id",
        "race_id",
        "round_id",
        "heat_number",
        "round",
        "captured_lanes",
    )

    def __init__(self, heat: models.Heat) -> None:
        self.id = heat.id
        self.race_id = heat.race_id
        self.round_id = heat.round_id
        self.heat_number = heat.heat_number
        # `Heat.round_number` and `Heat.round_name` read through this.
        self.round = (
            _RoundSnapshot(heat.round.round_number, heat.round.name)
            if heat.round
            else None
        )
        # `Heat.lanes` reads through this. Resolved now, while a session still
        # exists — and it must be, not left to the subscriber: the normalized
        # client cache merges this payload into the heat it already holds, so a
        # payload that omitted `lanes` would leave the old lanes in place and
        # the screen would show a result against a stale schedule.
        session = object_session(heat)
        self.captured_lanes = (
            _as_heat_lanes(
                session.query(models.HeatLane)
                .filter(models.HeatLane.heat_id == heat.id)
                .order_by(models.HeatLane.lane)
                .all()
            )
            if session is not None
            else []
        )


class _RoundSnapshot:
    __slots__ = ("round_number", "name")

    def __init__(self, round_number: int, name: str | None) -> None:
        self.round_number = round_number
        self.name = name


class _RacerSnapshot:
    """A detached copy of a Racer. See :class:`_HeatSnapshot`."""

    __slots__ = (
        "id",
        "first_name",
        "last_name",
        "car_number",
        "car_name",
        "car_passed_inspection",
        "car_weight",
        "racer_image_url",
        "car_image_url",
        "den_id",
        "race_id",
    )

    def __init__(self, racer: models.Racer) -> None:
        for field in self.__slots__:
            setattr(self, field, getattr(racer, field))


@strawberry.type
class RaceStateChangedEvent:
    """Event emitted whenever a race's state is modified by a mutation.

    ``kind`` says what changed and the matching payload field carries it, so a
    subscriber can apply the change instead of re-querying the whole race. The
    payloads are typed as the real ``Heat`` and ``Racer`` types on purpose: a
    normalized client cache keys on ``__typename`` plus ``id``, so an event can
    merge straight into the entity a query already put there.

    Older clients that only read ``raceId`` keep working — the extra fields are
    additive, and ``OTHER`` still means "something changed, refetch".
    """

    race_id: int
    changed_at: str  # ISO 8601 UTC timestamp
    kind: RaceChangeKind = RaceChangeKind.OTHER
    heat: Heat | None = None
    racer: Racer | None = None
    round_id: int | None = None


@strawberry.type
class TimingStatsLane:
    """Represents a single lane's result for the Timing Stats observation view."""

    lane_number: int
    racer_name: str
    car_name: str | None
    time: float | None
    place: int | None
    racer_image_url: str | None


@strawberry.type
class TrackRecordBreak:
    """The heat that just finished beat the track's standing record.

    "Standing" means the record as it stood before this race began — earlier
    races on the track plus any hand-entered historical records — so a first
    event with no history never fires this, and one event can fire it more
    than once only by genuinely going faster each time. Derived from state on
    every payload rather than remembered as an event (#248's shape): a
    corrected time changes the answer, and the room has already had its
    moment either way.
    """

    new_seconds: float
    new_holder: str
    previous_seconds: float
    previous_holder: str
    #: The event the old record was set at, if known — a race's name, or the
    #: label typed on a historical record.
    previous_race_name: str | None


@strawberry.type
class TimingStats:
    """Completed heat results for Timing Stats observation."""

    heat_id: int
    round_name: str
    heat_number: int
    global_heat_number: int
    lanes: list[TimingStatsLane]
    #: Set when this heat broke the track record; a free race heat never
    #: does, because exhibition runs cannot hold records (#6).
    record_break: TrackRecordBreak | None


async def _publish_race_state(
    race_id: int,
    kind: RaceChangeKind = RaceChangeKind.OTHER,
    heat: models.Heat | None = None,
    racer: models.Racer | None = None,
    round_id: int | None = None,
) -> None:
    """Publish a RaceStateChangedEvent for *race_id* on the pub/sub bus.

    Pass the ORM object that changed and it is snapshotted here, so callers do
    not have to think about the session lifetime. ``kind`` defaults to ``OTHER``,
    which means every unclassified call site keeps its current behaviour.

    Args:
        race_id: ID of the race whose state changed.
        kind: What sort of change this was.
        heat: The heat that changed, for ``HEAT_RESULT``.
        racer: The racer that changed, for ``RACER``.
        round_id: The round affected, where one is identifiable.
    """
    await pubsub.publish(
        f"race_state:{race_id}",
        RaceStateChangedEvent(
            race_id=race_id,
            changed_at=datetime.now(timezone.utc).isoformat(),
            kind=kind,
            heat=typing.cast(Any, _HeatSnapshot(heat)) if heat is not None else None,
            racer=typing.cast(Any, _RacerSnapshot(racer))
            if racer is not None
            else None,
            round_id=round_id,
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

        The snapshot is taken **inside** the subscription, not before it: a
        transition published in between would land on no queue and be lost, and
        the next one may be minutes away. See :func:`heat_session`.
        """
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        async with pubsub.subscribe(f"timer_state:{track_id}") as stream:
            if mgr is not None:
                yield TimerStateChangedEvent(
                    track_id=track_id,
                    status=_timer_status_from_manager(mgr),
                    changed_at=datetime.now(timezone.utc).isoformat(),
                )
            async for status_dc in stream:
                yield TimerStateChangedEvent(
                    track_id=track_id,
                    status=_timer_status(status_dc),
                    changed_at=datetime.now(timezone.utc).isoformat(),
                )

    @strawberry.subscription
    async def heat_session(
        self, info: Info, track_id: int, heat_id: int | None = None
    ) -> AsyncGenerator[HeatSession, None]:
        """Subscribe to the live view of a track (#7).

        Yields the current session immediately, then a fresh one on every event
        that could change it. Two sources have to be watched, which is what
        `pubsub.subscribe` takes several channels for:

        - the **timer**, for lane times arriving, arming, and aborts;
        - the **race**, for a result being saved or cleared — that is what turns
          RUNNING into RECORDED, and it does not come from the timer.

        The race is resolved once, from the heat this subscription is about.
        Changing heat means changing `heatId`, which is a variable, so the
        client opens a new subscription and the race is re-resolved with it.

        The snapshot is taken **inside** the subscription
        --------------------------------------------------
        `pubsub.subscribe` registers the queue on entry, so anything published
        before that reaches no queue. Building the snapshot first left a window
        — a database query wide — in which an arming published by the operator
        screen's own `prepareHeat` was dropped: the client had already rendered
        from the pre-arm fallback, and the correction never came. The screen sat
        at "Waiting for Timer…" with the start button disabled while the timer
        was in fact ARMED, until some later event happened to refresh it.

        Subscribing first can only duplicate a payload, which is harmless here
        because every emission is a full snapshot rather than a delta.
        """
        db = info.context["db"]
        timer_managers = info.context.get("timer_managers", {})

        # Which race to watch is a property of the heat, and it has to be known
        # before subscribing. Resolved without building the session, so that
        # the session the client receives is built after the queue exists.
        channels = [f"timer_state:{track_id}"]
        watched_heat_id = heat_id
        if watched_heat_id is None:
            manager = timer_managers.get(track_id)
            status = manager.status() if manager else None
            watched_heat_id = status.active_heat_id if status else None
        if watched_heat_id is not None:
            heat = (
                db.query(models.Heat).filter(models.Heat.id == watched_heat_id).first()
            )
            if heat is not None:
                channels.append(f"race_state:{heat.race_id}")

        async with pubsub.subscribe(*channels) as stream:
            yield _build_heat_session(db, timer_managers, track_id, heat_id)
            async for _ in stream:
                # A subscription holds one context for the whole connection, so
                # without this it would answer from rows loaded when the socket
                # opened and replay a stale heat forever.
                db.expire_all()
                _loaders(info).clear()
                yield _build_heat_session(db, timer_managers, track_id, heat_id)

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
    async def display_assignment(
        self, display_id: str, race_id: int, name: str | None = None
    ) -> AsyncGenerator[Display, None]:
        """What this display should be showing, pushed as it changes (#174).

        **Subscribing is how a display registers.** It holds no PIN and is a
        `VIEWER`, and a `VIEWER` may make no mutation at all (#15) — so
        presence cannot be announced by calling one. That constraint produces
        the right shape anyway: the display is the thing being told.

        The registration happens before the opening payload, and the payload is
        sent inside the `pubsub.subscribe` block, for the reason
        `test_subscription_snapshot_race.py` exists: this queue must be
        registered before anything it needs to hear can be published, or an
        assignment made in that window reaches no one and the screen sits on
        the wrong view for the rest of the event.
        """
        async with pubsub.subscribe(f"display_assignment:{display_id}") as stream:
            display = displays_service.registry.connect(display_id, race_id, name)
            await _publish_displays(race_id)
            try:
                yield _display(display)
                async for _ in stream:
                    current = displays_service.registry.get(display_id)
                    if current is not None:
                        yield _display(current)
            finally:
                # The socket closing is the only signal that a screen has gone
                # away, so it has to be handled however the generator ends —
                # cancellation included, which is what a browser tab closing
                # produces.
                displays_service.registry.disconnect(display_id)
                await _publish_displays(race_id)

    @strawberry.subscription
    async def displays(self, race_id: int) -> AsyncGenerator[list[Display], None]:
        """The operator's list of displays, as screens come and go (#174)."""
        async with pubsub.subscribe(f"displays:{race_id}") as stream:
            yield [_display(d) for d in displays_service.registry.for_race(race_id)]
            async for _ in stream:
                yield [_display(d) for d in displays_service.registry.for_race(race_id)]

    @strawberry.subscription
    async def on_deck(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[list[Heat], None]:
        """Subscribe to the heats after the current one, for a specific race.

        **Two of them, nearest first** (#209). One was not enough to stage
        with: the child it names is in the bleachers, not watching the screen,
        so by the time their heat is on it the announcer is already calling
        them. Two lets the announcer read names a heat early and have the cars
        at the track when they are wanted.

        A list rather than a second subscription: this is one question — what
        is coming — asked with a bit more depth, and a second socket would have
        to be kept in step with this one over the same channel. Empty is the
        ordinary answer at the end of a race.

        The heats, not their racers (#141). Handing back a racer list dropped
        the lane each one is in — `lanes.real_racer_ids` is dense, so a vacated
        lane or an undecided championship slot simply closed the gap — and the
        audience display, having nothing else to go on, numbered them by
        position. A car in lane 3 of a heat whose lane 2 is empty was announced
        as being in lane 2.

        Symmetric with :func:`currently_racing`, which returns the heat on the
        track. One shape for "what is on the track" and "what is next" is also
        one code path on the client.
        """
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_on_deck() -> list[Heat]:
                heats = models.official_heats(
                    db.query(models.Heat).filter(models.Heat.race_id == race_id)
                ).all()
                # Sort by round number and heat number
                sorted_heats = sorted(
                    heats, key=lambda h: (h.round.round_number, h.heat_number)
                )
                uncompleted = _unfinished(db, sorted_heats)
                # Index 0 is on the track; the two after it are what to stage.
                return typing.cast(Any, uncompleted[1 : 1 + ON_DECK_DEPTH])

            yield _get_on_deck()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_on_deck()

    @strawberry.subscription
    async def currently_racing(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[Heat | None, None]:
        """Subscribe to the current heat for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_current():
                heats = models.official_heats(
                    db.query(models.Heat).filter(models.Heat.race_id == race_id)
                ).all()
                sorted_heats = sorted(
                    heats, key=lambda h: (h.round.round_number, h.heat_number)
                )
                uncompleted = _unfinished(db, sorted_heats)
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
    ) -> AsyncGenerator[TimingStats | None, None]:
        """Subscribe to the most recently completed heat's timing results."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_timing_stats():
                # Both kinds, ranked together. An exhibition run is the thing
                # that just happened when it is the thing that just happened; a
                # rule preferring official heats made free ones unreachable from
                # the first result onward (#59).
                #
                # Times, not `is_finished`: this view shows a heat's results, and
                # a skipped heat has none to show.
                race_heats = (
                    db.query(models.Heat).filter(models.Heat.race_id == race_id).all()
                )
                recorded = [
                    heat
                    for heat, heat_lanes in zip(
                        race_heats, crud.lanes_for_heats(db, race_heats), strict=True
                    )
                    if lanes.has_results(heat_lanes)
                ]
                if not recorded:
                    return None

                # `recorded_at` is when the result was saved, which is the only
                # thing an official heat and a free one can be compared on.
                # Rows recorded before the column existed hold null and fall back
                # to schedule order, behind anything stamped.
                def _most_recent(heat: models.Heat):
                    return (
                        heat.recorded_at or "",
                        heat.round.round_number if heat.round else 0,
                        heat.heat_number,
                    )

                target_heat = max(recorded, key=_most_recent)
                is_free = target_heat.kind is models.HeatKind.FREE

                heat_lanes = _stored_lanes(db, target_heat)
                racer_ids = lanes.real_racer_ids(heat_lanes)
                racers = (
                    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).all()
                )
                racer_map = {r.id: r for r in racers}

                lane_stats = []
                for lane in heat_lanes:
                    racer = racer_map.get(lane.racer_id)
                    lane_stats.append(
                        TimingStatsLane(
                            lane_number=lane.lane,
                            racer_name=f"{racer.first_name} {racer.last_name}"
                            if racer
                            else "Unknown",
                            car_name=racer.car_name if racer else None,
                            time=lane.seconds,
                            place=lane.place,
                            racer_image_url=racer.racer_image_url if racer else None,
                        )
                    )

                if is_free:
                    global_num = 0
                else:
                    this_round = target_heat.round
                    before_count = (
                        models.official_heats(db.query(models.Heat))
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

                # Did this heat beat the record as it stood before this race?
                # Never for an exhibition run — a free heat cannot hold a
                # record, so it cannot break one either.
                record_break = None
                if not is_free:
                    race = crud.get_race(db, race_id)
                    if race and race.track_id:
                        baseline = records_service.track_records(
                            db, race.track_id, limit=1, exclude_race_id=race_id
                        )
                        winning = records_service.broken_record(
                            [lane.seconds for lane in heat_lanes if lane.seconds],
                            baseline[0] if baseline else None,
                        )
                        if winning is not None:
                            fastest = min(
                                (
                                    lane
                                    for lane in heat_lanes
                                    if lane.seconds and lane.seconds > 0
                                ),
                                key=lambda lane: lane.seconds,
                            )
                            breaker = racer_map.get(fastest.racer_id)
                            previous = baseline[0]
                            record_break = TrackRecordBreak(
                                new_seconds=winning,
                                new_holder=f"{breaker.first_name} {breaker.last_name}"
                                if breaker
                                else "Unknown",
                                previous_seconds=previous.time_seconds,
                                previous_holder=previous.racer_name,
                                previous_race_name=previous.race_name,
                            )

                return TimingStats(
                    heat_id=target_heat.id,
                    round_name="Exhibition" if is_free else target_heat.round.name,
                    heat_number=0 if is_free else target_heat.heat_number,
                    global_heat_number=global_num,
                    lanes=lane_stats,
                    record_break=record_break,
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
    ) -> AsyncGenerator[FreeRaceHeat | None, None]:
        """Subscribe to updates for a specific free race heat.

        The snapshot is taken inside the subscription for the reason
        :func:`heat_session` gives: a change published before the queue exists
        reaches nobody.
        """
        db = info.context["db"]

        def _get_heat():
            return crud.get_free_race_heat(db, heat_id)

        # Which race to watch is a property of the heat. A heat that is not
        # there has no channel, so say so once and stop.
        heat = _get_heat()
        if not heat:
            yield None
            return

        async with pubsub.subscribe(f"race_state:{heat.race_id}") as stream:
            yield _get_heat()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_heat()

    @strawberry.subscription
    async def active_free_race_heat(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[FreeRaceHeat | None, None]:
        """Subscribe to the active (uncompleted) free race heat for a specific race."""
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_active_free():
                unrun = _free_race_heats(db, race_id, recorded=False)
                return unrun[0] if unrun else None

            yield _get_active_free()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_active_free()


schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
    subscription=Subscription,
    # Refuses a mutation the caller's role does not carry (#15). One seam, and
    # it covers the WebSocket as well as HTTP — see `api/auth.py` for why the
    # second layer the design sketch proposed is not here.
    # Order is load-bearing and reads backwards: a later extension *wraps* an
    # earlier one, so `AuditExtension` has to come second to see the
    # `PermissionDeniedError` the policy raises — otherwise a refused mutation
    # is turned away with nothing recorded, which is the line the log most
    # wants (#219). Measured rather than assumed; the first draft had these the
    # other way round and recorded no refusals at all.
    # `test_audit_log.py::TestRefusals` fails if they are swapped back.
    # `DemoPolicyExtension` sits between them, and both neighbours matter:
    # before `AuditExtension` so a demo refusal is recorded like any other, and
    # after `RolePolicyExtension` so it runs *first* — on a demo no PIN is set,
    # so every caller is `OPERATOR` and the role policy would have allowed the
    # mutation and reported the wrong reason. Inert unless `TRUSTYTRACK_DEMO_MODE`
    # is set; see `api/demo_policy.py`.
    extensions=[RolePolicyExtension, DemoPolicyExtension, AuditExtension],
)
