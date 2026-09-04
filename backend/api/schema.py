import asyncio
import base64
import binascii
import csv
import enum
import io
import json
import logging
import os
import tempfile
import typing
import uuid
from collections.abc import AsyncGenerator, Iterable, Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
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
from backend.api.race_lock import RaceLockExtension
from backend.db import crud, models, schemas
from backend.db.database import UPLOAD_DIR
from backend.domain import advancement, audit, lanes, roster_import
from backend.domain import displays as domain_displays
from backend.domain import elimination as domain_elimination
from backend.domain import heat_session as domain_heat_session
from backend.domain import intermission as domain_intermission
from backend.domain import name_display as domain_name_display
from backend.domain import scoring as domain_scoring
from backend.domain import terminology as domain_terminology
from backend.domain.scale_speed import DEFAULT_SCALE
from backend.domain.scale_speed import scale_mph as domain_scale_mph
from backend.services import displays as displays_service
from backend.services import network, scoring
from backend.services import records as records_service
from backend.services.image_processing import convert_to_browser_safe_png
from backend.services.importers.derbynet import parse_derbynet_database
from backend.services.importers.gprm import parse_gprm_database
from backend.services.timer.devices import ALL_PROFILES, DEFAULT_PROFILE, FAKE, NO_TIMER
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


def _heat_and_manager(
    db: Session,
    timer_managers: Mapping[int, Any],
    heat_id: int,
    *,
    is_free_race: bool = False,
) -> tuple[models.Heat, models.Race, TimerManager] | None:
    """Load a heat, its race, and the ``TimerManager`` for the race's track.

    ``fake_timer_start``, ``prepare_heat`` and ``fake_timer_finish`` each
    re-derived this by hand: load the Heat (or free-race heat), load its
    Race, bail if ``race.track_id`` is None, look the manager up in
    ``timer_managers``, bail if absent — the same guards, three times, free
    to drift apart (#431, the #48 shape CLAUDE.md warns about throughout).
    Returns ``None`` on any failure so callers keep a one-line guard.

    ``is_free_race`` narrows the lookup to ``kind == FREE``, the way
    :func:`crud.get_free_race_heat` does. Only ``fake_timer_start`` passes
    it — heat ids are unique across both kinds since #6, so
    ``prepare_heat`` and ``fake_timer_finish`` read the kind off the row
    instead and call this with the default, exactly as they did before.
    """
    heat = (
        crud.get_free_race_heat(db, heat_id)
        if is_free_race
        else db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    )
    if heat is None:
        return None
    race = db.query(models.Race).filter(models.Race.id == heat.race_id).first()
    if race is None or race.track_id is None:
        return None
    mgr = timer_managers.get(race.track_id)
    if mgr is None:
        return None
    return heat, race, mgr


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
    #: When this heat's result was last saved, or ``None`` for one still
    #: pending (#59). Read by `features/racing/pace.ts` on the frontend: the
    #: gaps between consecutive recorded heats are the only record of how
    #: long a heat actually took, so this is what a schedule estimate learns
    #: from once racing is under way (#591).
    recorded_at: str | None

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

    @strawberry.field
    def run_off_placement(self, info: Info) -> int | None:
        """The standings rank this heat is racing off to decide, or ``None``
        for an ordinary heat — or for a run-off whose tie has since moved
        (#550). This is how `onDeck`/`currentlyRacing` (the only two
        subscriptions that hand back a run-off heat as a plain `Heat`) tell
        the audience display it is watching one: a non-null value both
        identifies the heat as a run-off and names what to announce
        ("racing off for Nth place"), computed fresh on every read rather
        than carried as a stored fact that could disagree with it.
        """
        if self.kind != models.HeatKind.RUN_OFF:
            return None
        return scoring.run_off_contested_rank(info.context["db"], self.race_id, self)


@strawberry.type
class AdvancementRacer:
    """
    Represents a racer eligible for advancement to a championship round.
    """

    racer_id: int
    first_name: str
    last_name: str
    car_number: int | None
    racing_group_name: str
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
    #: The last qualifying slot is a tie the tiebreak chain did not settle
    #: (#540) — the same "seeing half" reasoning as `field_is_stale`, for a
    #: different silence: `advancing_racers` still names somebody for that
    #: slot (the provisional pick, so the round stays runnable), and this is
    #: what says the pick is not the whole story.
    contested_cut: bool = False


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
    contested_cut = False
    if requires_advancement:
        pick = scoring.pick_advancing_racers(
            db, race_id, adv_source, adv_num, from_bottom=adv_from_bottom
        )
        winner_ids = set(pick.winner_ids)
        contested_cut = pick.contested

    advancing_racers = [
        AdvancementRacer(
            racer_id=entry["racer_id"],
            first_name=entry["first_name"],
            last_name=entry["last_name"],
            car_number=entry.get("car_number"),
            racing_group_name=entry["racing_group_name"],
            score=entry["score"],
            rank=entry["rank"],
            is_advancing=entry["racer_id"] in winner_ids,
        )
        for entry in loaders.leaderboard(race_id)
    ]

    # A raced championship round whose field has drifted from the standings.
    # Only a *raced* round can be stale: an unraced one is re-fielded by
    # invalidation (or withdrawal) the moment the standings move, so a
    # mismatch there is a bug, not a state. See domain.advancement.field_is_stale
    # for the rule itself (#433).
    field_is_stale = False
    if round_obj.advancement_source is not None and already_advanced and winner_ids:
        round_lanes = [
            loaders.lane_values_for_heat(race_id, heat.id)
            for heat in loaders.heats_for_round(race_id, round_id)
        ]
        field_is_stale = advancement.field_is_stale(round_lanes, winner_ids)

    return AdvancementStatus(
        is_ready=is_ready,
        requires_advancement=requires_advancement,
        already_advanced=already_advanced,
        advancing_racers=advancing_racers,
        source=adv_source,
        num_racers=adv_num,
        from_bottom=adv_from_bottom,
        field_is_stale=field_is_stale,
        contested_cut=contested_cut,
    )


@strawberry.type
class EliminationChartLane:
    """One lane of one heat on an elimination round's chart (#710).

    `outcome` is `WON`, `LOST`, `SKIPPED`, or null when nothing was counted
    for the lane — the heat has not run, or it held a lone finisher. Every
    `LOST` here is a loss in `domain.elimination.losses_by_racer`, so the
    chart cannot disagree with the counts that draw the next wave.
    """

    lane: int
    racer_id: int | None
    outcome: str | None
    #: The racer's losses once this heat is counted; for a heat yet to run,
    #: the losses so far.
    losses_after: int
    #: At the loss limit from this heat on.
    out: bool


@strawberry.type
class EliminationChartHeat:
    heat_id: int
    heat_number: int
    finished: bool
    lanes: list[EliminationChartLane]


@strawberry.type
class EliminationWave:
    """One set of heats the schedule grew at once — see `elimination.waves_of`."""

    number: int
    heats: list[EliminationChartHeat]


@strawberry.type
class EliminationStandingEntry:
    """Where a racer stands in the round: still racing, or out."""

    racer_id: int
    losses: int
    alive: bool


@strawberry.type
class EliminationChart:
    """The record of an elimination round so far, wave by wave (#710).

    Not a bracket. A bracket draws matchups that have not happened, and this
    format grows its schedule from the results rather than promising one —
    so this draws only the heats that exist: the waves raced, the pending
    wave (real rows, not a guess), and who is still standing. The wave after
    the pending one is deliberately absent, because nobody knows who will be
    in it until this one is scored.

    `standings` is filtered to who is still checked in, the same population
    `extend_elimination_round` fields the next wave from (#313), so a
    withdrawn car is not shown as still racing. `decided` reads
    `crud.is_round_complete`, the one copy of that rule.
    """

    max_losses: int
    decided: bool
    waves: list[EliminationWave]
    standings: list[EliminationStandingEntry]


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
    #: Which racing group this round belongs to, if it is scoped to one — the
    #: same column advancement's `EACH_GROUP` source and the round wizard's
    #: "per group" option already write. Exposed for the master running order
    #: screen (#549 stage 4): a heat's group label is this round's racing
    #: group, straight off the id the frontend already has the name for
    #: (`race.racingGroups`) rather than a second name-resolving field here.
    racing_group_id: int | None

    @strawberry.field
    def heats(self, info: Info) -> list[Heat]:
        """Get all heats in this round."""
        return typing.cast(Any, _loaders(info).heats_for_round(self.race_id, self.id))

    @strawberry.field
    def advancement_status(self, info: Info) -> AdvancementStatus:
        """Check if a round is ready to advance."""
        return _advancement_status(info, self.race_id, self.id)

    @strawberry.field
    def elimination_chart(self, info: Info) -> EliminationChart | None:
        """The round's record so far, wave by wave — elimination rounds only.

        Null for every other scheduling strategy: PPC and balanced rounds
        have no bracket-shaped truth to draw (#710). Reads the heats and lanes
        off the loaders' per-race batch, so asking for it costs the schedule
        screen nothing per heat.
        """
        if self.scheduling_strategy != models.SchedulingStrategy.ELIMINATION:
            return None
        db = info.context["db"]
        loaders = _loaders(info)
        heats = sorted(
            loaders.heats_for_round(self.race_id, self.id),
            key=lambda heat: heat.heat_number,
        )
        heat_lanes = [
            loaders.lane_values_for_heat(self.race_id, heat.id) for heat in heats
        ]
        threshold = self.elimination_losses or 1
        eligible = set(crud.eligible_racer_ids(db, self.race_id, self.racing_group_id))
        return EliminationChart(
            max_losses=threshold,
            decided=crud.is_round_complete(db, self.id),
            waves=[
                EliminationWave(
                    number=wave.number,
                    heats=[
                        EliminationChartHeat(
                            heat_id=heats[heat.index].id,
                            heat_number=heats[heat.index].heat_number,
                            finished=heat.finished,
                            lanes=[
                                EliminationChartLane(
                                    lane=lane.lane,
                                    racer_id=lane.racer_id,
                                    outcome=lane.outcome,
                                    losses_after=lane.losses_after,
                                    out=lane.out,
                                )
                                for lane in heat.lanes
                            ],
                        )
                        for heat in wave.heats
                    ],
                )
                for wave in domain_elimination.chart(heat_lanes, threshold)
            ],
            standings=[
                EliminationStandingEntry(
                    racer_id=entry.racer_id, losses=entry.losses, alive=entry.alive
                )
                for entry in domain_elimination.standings(heat_lanes, threshold)
                if entry.racer_id in eligible
            ],
        )


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
class Terminology:
    """The words a screen should use, fully resolved (#496 stage 3).

    Never null — `domain.terminology.resolve_terminology` always falls back
    to the built-in Scouting words. Served on `Race` (organization default
    layered under a race override) and on `InitialConfigStatus` (organization
    default alone, for the screens with no race — Home, System Settings). The
    frontend reads it through `TerminologyContext`/`useTerminology`: race
    pages get the race's own resolved terms, and screens with no race in view
    get the organization default off `initialConfig`.
    """

    racing_group_singular: str
    racing_group_plural: str
    organization_singular: str
    organization_plural: str
    vehicle_singular: str
    vehicle_plural: str
    #: Which line-art glyph the vehicle word draws with (#551, stage 4) —
    #: one of `domain_terminology.VEHICLE_ARTWORK_KEYS`. Never null, like
    #: every field above: `resolve_terminology` always falls back to `"car"`.
    vehicle_artwork_key: str


def _terminology_overrides(row: Any) -> domain_terminology.TerminologyOverrides:
    """Read one layer's seven override columns off an ORM row.

    Works for both `models.Organization` and `models.Race` — they carry the
    same seven column names for exactly this reason. `crud.default_general_round_name`
    reads the same way, through `domain_terminology.overrides_from_row`
    directly, since `db.crud` has no business importing from `api.schema`.
    """
    return domain_terminology.overrides_from_row(row)


def _terminology_type(t: domain_terminology.Terminology) -> Terminology:
    return Terminology(
        racing_group_singular=t.racing_group_singular,
        racing_group_plural=t.racing_group_plural,
        organization_singular=t.organization_singular,
        organization_plural=t.organization_plural,
        vehicle_singular=t.vehicle_singular,
        vehicle_plural=t.vehicle_plural,
        vehicle_artwork_key=t.vehicle_artwork_key,
    )


def _terminology_status_kwargs(organization: Any) -> dict[str, Any]:
    """The raw override fields plus the resolved `terminology`, for building
    an `InitialConfigStatus`.

    Four call sites build one of these (create, update, the query, and the
    unconfigured branch), and #48 is the standing reminder of what happens
    when a rule like this lands on only some of them.
    """
    overrides = _terminology_overrides(organization) if organization else None
    return {
        "racing_group_singular": organization.racing_group_singular
        if organization
        else None,
        "racing_group_plural": organization.racing_group_plural
        if organization
        else None,
        "organization_singular": organization.organization_singular
        if organization
        else None,
        "organization_plural": organization.organization_plural
        if organization
        else None,
        "vehicle_singular": organization.vehicle_singular if organization else None,
        "vehicle_plural": organization.vehicle_plural if organization else None,
        "vehicle_artwork_key": organization.vehicle_artwork_key
        if organization
        else None,
        "terminology": _terminology_type(
            domain_terminology.resolve_terminology(organization=overrides)
        ),
    }


def _name_display_status_kwargs(organization: Any) -> dict[str, Any]:
    """The raw override plus the resolved name-display setting, for building
    an `InitialConfigStatus` (#552).

    Three call sites build one of these (create, update, the query), the
    same #48 shape `_terminology_status_kwargs` follows.
    """
    raw = organization.name_display if organization else None
    return {
        "name_display": raw,
        "resolved_name_display": domain_name_display.resolve_name_display(
            organization=raw
        ),
    }


@strawberry.type
class InitialConfigStatus:
    """
    Represents the system initialization state.
    """

    initialized: bool
    version: str
    organization_name: str | None = None
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
    #: Which theme the Display and Printables surfaces render, install-wide
    #: (#498). A `ThemeKey` or `"MATCH_APP"` — see `models.Organization.display_theme`
    #: for why this is a plain string rather than a GraphQL enum. There is
    #: deliberately no `appTheme` field here: the App theme lives only in each
    #: device's own `localStorage` and never reaches the server.
    display_theme: str = "MATCH_APP"
    printables_theme: str = "MATCH_APP"
    #: The organization's raw terminology overrides, null where it has not
    #: renamed that word (#496 stage 3) — what the settings form reads back
    #: to populate its inputs, distinct from `terminology` below which is
    #: always filled in.
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    #: The organization's raw vehicle-word override (#551), null where it
    #: has not renamed "Car" — same distinction as the four fields above.
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    #: The organization's raw vehicle-artwork override (#551, stage 4), null
    #: where it has not chosen one — same distinction as the fields above.
    vehicle_artwork_key: str | None = None
    #: The resolved words — organization default over the built-in Scouting
    #: ones, with no race in play here. Defaulted so the unconfigured branch
    #: (no organization yet) still returns something rather than nothing.
    terminology: Terminology = strawberry.field(
        default_factory=lambda: _terminology_type(
            domain_terminology.DEFAULT_TERMINOLOGY
        )
    )
    #: The organization's raw name-display override, null where it has not
    #: changed it from `FULL` (#552) — what the settings form reads back to
    #: populate its picker, distinct from `resolvedNameDisplay` below.
    name_display: str | None = None
    #: The resolved name-display setting for screens with no race in view
    #: (Home, System Settings) — organization default over `FULL`. See
    #: `Race.resolvedNameDisplay` for the layer a race adds on top.
    resolved_name_display: str = domain_name_display.DEFAULT_NAME_DISPLAY


@strawberry.input
class InitialConfigInput:
    """
    Input for initial system configuration.
    """

    organization_name: str
    debug_mode: bool = False
    tracks: list["TrackInput"]
    #: Four digits, or empty/None to leave unchanged. Setting the operator PIN
    #: is what turns enforcement on; clearing it turns it off again, which is
    #: the escape hatch for an operator who has locked themselves out and can
    #: reach the machine (#15).
    operator_pin: str | None = None
    checkin_pin: str | None = None
    #: Absent leaves the current Display/Printables theme alone; any other
    #: value — including `"MATCH_APP"` — is the new setting (#498). Unlike
    #: the PINs and the weight limit, there is no clear flag here: the
    #: column's own "off" state is the non-null string `"MATCH_APP"`, so it
    #: is already reachable as an ordinary value rather than needing a
    #: bare-null sentinel disambiguated by a boolean.
    display_theme: str | None = None
    printables_theme: str | None = None
    #: The install-wide default words for a racing group and for the
    #: organization itself (#496 stage 3). Absent means leave alone, the same
    #: shape as the PINs above — but unlike them (and unlike the themes,
    #: which have a non-null "off" sentinel), there is no value that already
    #: means "reset to Den and Pack", so `clearTerminology` is the explicit
    #: way back to null, following `RaceUpdateInput.clearWeightLimit` (#205).
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    #: The install-wide default word for a racer's vehicle (#551) — "Car" by
    #: default, wrong for a Space Derby or a Raingutter Regatta. Same
    #: absent-means-leave-alone shape as the racing-group/organization words
    #: above, and covered by the same `clearTerminology` flag.
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    #: The install-wide default vehicle artwork (#551, stage 4) — one of
    #: `domain_terminology.VEHICLE_ARTWORK_KEYS`. Same shape as the six
    #: fields above.
    vehicle_artwork_key: str | None = None
    clear_terminology: bool = False
    #: The install-wide default for how much of a racer's name a public
    #: screen may show (#552) — one of `domain_name_display.NAME_DISPLAY_VALUES`.
    #: Absent leaves the current setting alone; any other value — including
    #: `"FULL"` — is the new setting, the same `display_theme` shape: `FULL`
    #: is itself the non-null "off" state, so there is no clear flag here.
    name_display: str | None = None


@strawberry.input
class RacerInput:
    """
    Input type for creating or updating a racer participant.
    """

    first_name: str
    last_name: str
    car_number: int | None = None
    racing_group_id: int | None = None
    car_name: str | None = None
    car_passed_inspection: bool = False
    car_weight: float | None = None
    racer_image_url: str | None = None
    car_image_url: str | None = None
    race_id: int | None = None
    #: Races, but is not ranked (#548) — a sibling or parent's car, an
    #: outlaw-class entry, a demonstration run. Read in exactly one place,
    #: `services/scoring.get_leaderboard`.
    excluded_from_standings: bool = False


@strawberry.input
class RacingGroupInput:
    """
    Input type for creating or updating a RacingGroup sub-organization.
    """

    name: str
    color: str = "#000000"
    division: str | None = None
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
    organization_id: int = 1
    track_id: int
    scoring_strategy: str = "TIMED"
    #: How a shared score is broken at a cut — advancement, an award's place
    #: (#540). `SHARED` (not resolved) is the default; see `domain.tiebreak`.
    tiebreaker: str = "SHARED"
    car_numbering_strategy: str = "MANUAL"
    global_start_number: int = 1
    championship_trophies: int = 3
    # The pack's weight limit in ounces, or null for no check (#205).
    weight_limit_oz: float | None = None
    #: How many of each racer's worst counted results to drop before scoring
    #: (#547 stage 2) — a modifier over `scoring_strategy`, not a strategy of
    #: its own. `0` (the default) is the off state — the same value the
    #: column defaults to, so a race created with no opinion on this behaves
    #: exactly as one created before the column existed.
    drop_worst_runs: int = 0
    #: Custom call-to-action text for the `QRCODE` display view (#614), e.g.
    #: "Scan to Vote for Best in Show!". Null uses a sensible default derived
    #: from what the code points at — see
    #: `frontend/src/features/observation/qrCode.ts`'s `resolveQrHeadline`.
    qr_headline: str | None = None
    #: Optional venue Wi-Fi guidance shown under the code, e.g. "Connect to
    #: Pack 123 Guest Wi-Fi". Null shows nothing — most venues have open wifi
    #: or none worth mentioning.
    qr_wifi_note: str | None = None
    #: The racing groups to create alongside the race (#662) — the setup
    #: wizard's scaffolded dens, or a previous race's structure copied over.
    #: One mutation rather than a `createRace` followed by N
    #: `createRacingGroup` round trips, for #201's reason: a setup that fails
    #: half way leaves the operator with a half-built race to tidy up. Empty
    #: (the default) creates none, which is exactly what every caller before
    #: this field existed got.
    racing_groups: list[RacingGroupInput] = strawberry.field(default_factory=list)
    #: A per-race terminology override, settable at creation (#662) — the
    #: wizard's "what is raced / who is holding it" answers land here, so a
    #: Space Derby reads "Rocket" from its first screen rather than after a
    #: second trip through the edit form. Null means inherit, the same as on
    #: `RaceUpdateInput`; there is no `clearTerminology` here because a race
    #: being created has nothing set yet to clear.
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    vehicle_artwork_key: str | None = None


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
    #: Absent means leave alone, the same as every other field here —
    #: `SHARED` is the non-null "off" state, so there is no separate clear
    #: flag, the `display_theme`/`"MATCH_APP"` precedent (#498).
    tiebreaker: str | None = None
    car_numbering_strategy: str | None = None
    global_start_number: int | None = None
    championship_trophies: int | None = None
    auto_advance_heat: bool | None = None
    weight_limit_oz: float | None = None
    #: One interleaved running order across racing groups, rather than a
    #: block per group (#549 stage 2) — off by default, since running one
    #: den at a time is how many packs deliberately structure an event.
    #: `false` is an ordinary value here, not a sentinel: it is already what
    #: every race had before this column existed, so there is no separate
    #: clear flag the way `clearWeightLimit` needs one.
    master_running_order: bool | None = None
    #: Whether a phone with no PIN may vote right now (#305).
    voting_open: bool | None = None
    # Turning the weight check off, explicitly (#205).
    #
    # `update_race` drops every null from its payload — absent means "leave
    # alone", which is what lets the settings page re-submit the whole race
    # without wiping the fields it does not offer. So there is no way to *set*
    # a field back to null, and without this the weight check could be switched
    # on and never off again. Same shape as the PIN's removal control (#192),
    # and for the same reason.
    clear_weight_limit: bool = False
    #: A per-race override of the organization's terminology (#496 stage 3) —
    #: absent means leave alone, following the same shape as
    #: `weight_limit_oz`/`clear_weight_limit` above.
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    #: A per-race override of the organization's vehicle word (#551), the
    #: same shape as the four fields above.
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    #: A per-race override of the organization's vehicle artwork (#551,
    #: stage 4), the same shape as the six fields above.
    vehicle_artwork_key: str | None = None
    #: The explicit way back to "inherit the organization's word", for the
    #: same reason `clear_weight_limit` exists: absent already means leave
    #: alone, so nothing else can ask for null.
    clear_terminology: bool = False
    #: How many of each racer's worst counted results to drop before scoring
    #: (#547 stage 2) — a modifier over `scoring_strategy`, not a strategy of
    #: its own. Absent means leave alone; `0` is the off state, so there is
    #: no separate clear flag, the same shape `master_running_order`'s
    #: `false` already uses.
    drop_worst_runs: int | None = None
    #: A decided championship round's winner(s) stop counting toward the
    #: standings of the round they qualified from (#548) — the Grand Finals
    #: half of the same mechanism as `Racer.excludedFromStandings`. Absent
    #: means leave alone; `false` is an ordinary value, the same shape
    #: `master_running_order` and `voting_open` already use.
    exclude_round_winners_from_qualifying_standings: bool | None = None
    #: A per-race override of the organization's name-display default
    #: (#552). Absent means leave alone; explicit `"FULL"` here is a real
    #: override ("show full names at this race regardless of what the
    #: organization has chosen"), distinct from inheriting — so unlike the
    #: organization-level field, there is a `clear_name_display` flag to get
    #: back to null.
    name_display: str | None = None
    #: The explicit way back to "inherit the organization's setting", for
    #: the same reason `clear_terminology` exists: absent already means
    #: leave alone, so nothing else can ask for null.
    clear_name_display: bool = False
    #: Locking or unlocking the race (#585). Absent means leave alone, same
    #: as every other field here; `false` is an ordinary value (the unlock),
    #: not a sentinel needing its own clear flag. `api.race_lock` is what
    #: actually restricts what an *update_race* carrying this may also
    #: change while the race is currently locked — see
    #: `race_lock.is_lock_only_update`.
    is_locked: bool | None = None
    #: At most one trophy per racer (#615). Absent means leave alone, same as
    #: every other field here; `false` is an ordinary value, not a sentinel
    #: needing its own clear flag — the same shape `master_running_order`
    #: and `voting_open` already use.
    one_trophy_per_racer: bool | None = None
    #: Custom call-to-action text for the `QRCODE` display view (#614).
    #: Absent means leave alone; an empty string is how the operator clears a
    #: custom headline back to the derived default — there is no other
    #: string this field could legitimately hold that means "unset", so
    #: unlike `weight_limit_oz` there is no separate clear flag.
    qr_headline: str | None = None
    #: Optional venue Wi-Fi guidance for the `QRCODE` view (#614). Same
    #: absent-means-leave-alone, empty-string-means-clear shape as
    #: `qr_headline` above.
    qr_wifi_note: str | None = None


@strawberry.input
class TrackInput:
    """
    Input type for creating or updating a physical track configuration.
    """

    #: Which database row this is, so `updateInitialConfig` can match tracks
    #: by identity rather than by their position in the list (#318). Absent
    #: (or null) means a track the operator just added on this screen, which
    #: has no row yet.
    id: int | None = None
    name: str = "Main Track"
    lane_count: int = 4
    length_feet: int | None = None
    timer_type: str = "FAKE"
    serial_port: str | None = None
    #: Which timer model, by `TimerProfile.key`. Null detects it (#143).
    timer_profile: str | None = None
    remote_start_installed: bool = False
    #: The timer's own lane 1 is wired to this track's highest lane. See
    #: `models.Track.reverse_lanes`.
    reverse_lanes: bool = False
    #: The vehicle-to-real-life ratio scale speed is computed against
    #: (#610). See `models.Track.scale_ratio`.
    scale_ratio: float = DEFAULT_SCALE
    #: Whether scale speed is offered on this track's surfaces at all. See
    #: `models.Track.show_scale_speed`.
    show_scale_speed: bool = True
    #: The colour painted on each physical lane, if any (#611). One hex
    #: string per lane, index 0 meaning lane 1. See `models.Track.lane_colors`
    #: and `domain.lane_colors`.
    lane_colors: list[str] = strawberry.field(default_factory=list)


@strawberry.input
class WizardGeneralRoundInput:
    """
    Configuration for a general racing round in the wizard.
    """

    type: str  # "ALL" or "EACH_GROUP"
    runs_per_lane: int = 1


@strawberry.input
class WizardChampionshipRoundInput:
    """
    Configuration for a championship racing round in the wizard.
    """

    name: str = "Championship Round"
    source: str = "ALL"  # "ALL" (Overall) or "EACH_GROUP" (Each RacingGroup)
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
    racing_group_name: str
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
class RacingGroupStat:
    """Aggregate statistics for a racing group."""

    racing_group_id: int
    racing_group_name: str
    racing_group_color: str
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
    racing_group_stats: list[RacingGroupStat]
    heat_results: list[HeatResultRow]
    track_records: list[TrackRecord]
    #: The fastest heat's time (`highlights`' `FASTEST_HEAT` entry) converted
    #: to scale speed (#610), or null under the same conditions as
    #: `TimingStatsLane.scaleMph` — the track's scale speed turned off, no
    #: configured length, or no heat has finished yet to be fastest.
    top_scale_mph: float | None


@strawberry.type
class LeaderboardEntry:
    """
    Represents a single entry in the race leaderboard.
    """

    racer_id: int
    first_name: str
    last_name: str
    car_number: int | None
    racing_group_id: int | None
    racing_group_name: str
    racing_group_division: str | None
    score: float
    heats_completed: int
    racer_image_url: str | None
    rank: int
    #: The tiebreak method that gave this row a rank it no longer shares with
    #: anyone (#540) — null when the row was never tied, or a tie the chain
    #: could not resolve. See `backend.domain.tiebreak`.
    resolved_by: str | None
    #: Whether `Race.dropWorstRuns` (#547 stage 2) actually dropped a run
    #: from this standings computation — the same value on every row, since
    #: it describes the whole leaderboard rather than this one racer. False
    #: when the setting is off, or when it is on but at least one racer who
    #: has raced does not yet have enough runs to drop evenly.
    drop_worst_runs_applied: bool


@strawberry.type
class RacingGroup:
    """A RacingGroup: sub-organization of racers, usually by category.

    A Cub Scout rank by default, but any free text an operator chooses.
    """

    id: int
    name: str
    color: str
    division: str | None
    race_id: int
    car_number_range_start: int | None
    car_number_range_end: int | None

    @strawberry.field
    def racers(self, info: Info) -> list["Racer"]:
        """Get all racers belonging to this racing group."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.racing_group_id == self.id)
            .all()
        )


@strawberry.input
class PopulateTestDataInput:
    """Input for populating a race with test data."""

    count: int = 10
    add_racer_photos: bool = True
    add_car_photos: bool = True
    assign_racing_groups: bool = True
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
    general_type: str = "ALL"
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
    racing_group_id: int | None
    race_id: int
    #: Races, but is not ranked (#548). `services/scoring.get_leaderboard`
    #: drops this racer before ranking; heat generation, admission,
    #: withdrawal and the live heat view are untouched and still read
    #: check-in — this is not a second way to say "not racing".
    excluded_from_standings: bool

    @strawberry.field
    def racing_group(self, info: Info) -> RacingGroup | None:
        """Get the racing group this racer belongs to, if any."""
        if not self.racing_group_id:
            return None
        return typing.cast(
            Any, _loaders(info).racing_group_by_id(self.race_id, self.racing_group_id)
        )


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
    #: `SPEED` only: `"ALL"` or `"ROUND:<id>"`, and a 1-based `place`.
    source: str | None
    place: int | None
    #: `SPEED` only: which end `place` counts from. False is the fastest car,
    #: true the slowest.
    from_bottom: bool
    racing_group_id: int | None
    #: Which clipart the ceremony slide and the certificate draw, or null for a
    #: plain certificate (#306). `SPEED` awards get this defaulted from their
    #: rule; `SPECIAL` awards get it from the ready-made superlative picker or
    #: whatever the operator typed over it.
    artwork_key: str | None
    #: SPECIAL only. Whether this award takes ballots while the race's voting
    #: is open (#305). Always false for `SPEED`.
    votable: bool

    @strawberry.field
    def recipient(self, info: Info) -> "Racer | None":
        """Whoever has won this, or null if nobody has yet."""
        racer_id = _loaders(info).award_recipients(self.race_id).get(self.id)
        if racer_id is None:
            return None
        return typing.cast(Any, _loaders(info).racer_by_id(self.race_id, racer_id))

    @strawberry.field
    def place_contested(self, info: Info) -> bool:
        """A `SPEED` award's place is a tie the tiebreak chain did not settle
        (#540) — always false for `SPECIAL`, which has no place to contest.

        The operator is choosing trophies; "this could go either way" is what
        they need to know before it is engraved.
        """
        return _loaders(info).award_contested(self.race_id).get(self.id, False)

    @strawberry.field
    def racing_group(self, info: Info) -> RacingGroup | None:
        """The racing group this award is narrowed to, if any."""
        if not self.racing_group_id:
            return None
        return typing.cast(
            Any, _loaders(info).racing_group_by_id(self.race_id, self.racing_group_id)
        )

    @strawberry.field
    def vote_tally(self, info: Info) -> list["AwardVoteTally"]:
        """Ballots for this award, most votes first (#305).

        Empty for a `SPEED` award, or a `SPECIAL` one that has never taken a
        ballot — not an error either way.
        """
        pairs = _loaders(info).award_vote_tallies(self.race_id).get(self.id, [])
        return [
            AwardVoteTally(race_id=self.race_id, racer_id=racer_id, vote_count=count)
            for racer_id, count in pairs
        ]

    @strawberry.field
    def position(self, info: Info) -> int | None:
        """The 1-based row this award's recipient actually held in its own
        narrowed standings (#615) — equal to `place` when nothing rolled
        down, greater when a racer ranked above them already held a trophy
        on another podium. Null for a `SPECIAL` award, and for a `SPEED`
        award with no recipient. See `domain/roll_down.py`.
        """
        resolution = _loaders(info).award_resolutions(self.race_id).get(self.id)
        return resolution.position if resolution is not None else None

    @strawberry.field
    def passed_over(self, info: Info) -> list["AwardPassedOver"]:
        """Every racer ranked above `position` who was skipped because they
        already held a trophy on another podium (#615), best-first — the
        roll-down's own explanation for a screen to turn into "Liam (2nd in
        Wolves; Jordan won Pack Champion)". Empty when nothing rolled, for a
        judged award, and whenever `Race.oneTrophyPerRacer` is off.
        """
        resolution = _loaders(info).award_resolutions(self.race_id).get(self.id)
        if resolution is None:
            return []
        return [
            AwardPassedOver(
                race_id=self.race_id, racer_id=p.racer_id, award_id=p.award_key
            )
            for p in resolution.passed_over
        ]

    @strawberry.field
    def duplicate_of(self, info: Info) -> "Award | None":
        """Set on a **judged** award only, and only while
        `Race.oneTrophyPerRacer` is on (#615): the award its chosen racer
        already holds. A judged award keeps its racer regardless — a
        computed rule does not override a person's choice — this is the
        signal for the screen to warn about the collision rather than hide
        it. Null the rest of the time, including for a `SPEED` award, which
        cannot collide with itself.
        """
        resolution = _loaders(info).award_resolutions(self.race_id).get(self.id)
        if resolution is None or resolution.duplicate_of is None:
            return None
        for award in _loaders(info).awards_for_race(self.race_id):
            if award.id == resolution.duplicate_of:
                return typing.cast(Any, award)
        return None


@strawberry.type
class AwardPassedOver:
    """A racer who ranked above an award's actual recipient, but already held
    a trophy on another podium (#615) — one line of `Award.passedOver`'s
    explanation for a roll-down.
    """

    race_id: strawberry.Private[int]
    racer_id: int
    #: The award this racer already holds — the one that caused the roll.
    award_id: int

    @strawberry.field
    def racer(self, info: Info) -> "Racer | None":
        return typing.cast(Any, _loaders(info).racer_by_id(self.race_id, self.racer_id))

    @strawberry.field
    def award(self, info: Info) -> "Award | None":
        for award in _loaders(info).awards_for_race(self.race_id):
            if award.id == self.award_id:
                return typing.cast(Any, award)
        return None


@strawberry.type
class AwardVoteTally:
    """One line of an award's tally: how many ballots one car has (#305).

    Not gated behind the operator role — queries carry no role check at all
    (`api/auth.py`'s policy covers mutations only), the same as every other
    read in the app.
    """

    race_id: int
    racer_id: int
    vote_count: int

    @strawberry.field
    def racer(self, info: Info) -> "Racer | None":
        return typing.cast(Any, _loaders(info).racer_by_id(self.race_id, self.racer_id))


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
    from_bottom: bool = False
    racing_group_id: int | None = None
    racer_id: int | None = None
    #: Ignored server-side for a `SPEED` award — see `crud._set_speed_artwork_key`.
    artwork_key: str | None = None
    sort_order: int | None = None
    #: SPECIAL only; ignored (forced false) for SPEED — see
    #: `crud._clear_fields_of_other_kind`. Defaults on: most judged awards a
    #: pack adds are exactly the ones people vote for, and this is offered as
    #: a sensible starting point rather than the column's own off-by-default
    #: (#305), the same "form defaults on, storage defaults conservative"
    #: shape the weight limit uses (#205).
    votable: bool = True


@strawberry.type
class Intermission:
    """A race-scoped break, resolved (#592) — see `domain/intermission.py`.

    ``endsAt`` is carried through unresolved (an ISO 8601 timestamp, or null
    while paused or inactive) so a client computes its own live countdown
    from its own clock rather than polling; ``remainingSeconds`` is a
    snapshot at the moment this was resolved, for a caller with no interest
    in re-deriving it.
    """

    active: bool
    remaining_seconds: int
    paused: bool
    label: str | None
    ends_at: str | None


def _intermission_type(race: models.Race, now: datetime) -> Intermission:
    resolved = domain_intermission.resolve(
        domain_intermission.State(
            ends_at=race.intermission_ends_at,
            paused_remaining_seconds=race.intermission_paused_remaining_seconds,
            label=race.intermission_label,
        ),
        now,
    )
    return Intermission(
        active=resolved.active,
        remaining_seconds=resolved.remaining_seconds,
        paused=resolved.paused,
        label=resolved.label,
        ends_at=resolved.ends_at,
    )


@strawberry.type
class Race:
    """
    Represents a Race event, which contains multiple racers, racing groups, and rounds.
    """

    id: int
    name: str
    date_time: str | None
    location: str | None
    organization_id: int
    track_id: int | None
    car_numbering_strategy: str
    global_start_number: int
    championship_trophies: int
    scoring_strategy: str
    #: How a shared score is broken at a cut — advancement, an award's place
    #: (#540). `SHARED` means not resolved, today's behaviour made visible;
    #: see `domain.tiebreak` for what the other four values do.
    tiebreaker: str
    auto_advance_heat: bool
    # Null means the race does not check weights (#205).
    weight_limit_oz: float | None
    #: One interleaved running order across racing groups, rather than a
    #: block per group (#549 stage 2). Off by default; applying it is
    #: `applyMasterRunningOrder`, not this flag by itself — flipping it on
    #: does not reorder anything until that mutation runs.
    master_running_order: bool
    #: Whether a phone with no PIN may vote for a `SPECIAL` award right now
    #: (#305). An operator toggle, not tied to racing progress.
    voting_open: bool
    #: This race's raw terminology overrides, null where it inherits the
    #: organization's word (#496 stage 3) — what the race edit form reads
    #: back to populate its inputs, distinct from `terminology` below.
    racing_group_singular: str | None
    racing_group_plural: str | None
    organization_singular: str | None
    organization_plural: str | None
    #: This race's raw vehicle-word override, null where it inherits the
    #: organization's word (#551) — same distinction as the four fields
    #: above.
    vehicle_singular: str | None
    vehicle_plural: str | None
    #: This race's raw vehicle-artwork override, null where it inherits the
    #: organization's choice (#551, stage 4) — same distinction as the six
    #: fields above.
    vehicle_artwork_key: str | None
    #: How many of each racer's worst counted results are dropped before
    #: scoring (#547 stage 2) — a modifier over `scoringStrategy`, not a
    #: strategy of its own. `0` is the off state.
    drop_worst_runs: int
    #: Whether a decided championship round's winner(s) stop counting toward
    #: the standings of the round they qualified from (#548) — off by
    #: default. `services/scoring.get_leaderboard` reads this on every call
    #: rather than storing who is affected, so a corrected final-round time
    #: moves who is excluded.
    exclude_round_winners_from_qualifying_standings: bool
    #: This race's raw name-display override, null where it inherits the
    #: organization's setting (#552) — what the race edit form reads back to
    #: populate its picker, distinct from `resolvedNameDisplay` below.
    name_display: str | None
    #: Whether the race is locked against further edits (#585) — set from
    #: Race Control or the race edit form once an event has concluded.
    #: Enforced by `api.race_lock.RaceLockExtension`, not by anything a
    #: resolver checks; this is a plain field like any other.
    is_locked: bool
    #: At most one trophy per racer (#615) — off by default, so an upgraded
    #: install keeps resolving every award in isolation exactly as it
    #: always has. See `domain/roll_down.py` for the whole rule; `Award`'s
    #: `position`, `passedOver` and `duplicateOf` below carry its answer.
    one_trophy_per_racer: bool
    #: Custom call-to-action text for the `QRCODE` display view (#614), null
    #: or empty where the operator has not set one — the screen falls back
    #: to a default derived from what the code points at.
    qr_headline: str | None
    #: Optional venue Wi-Fi guidance for the `QRCODE` view (#614), shown
    #: under the code when set.
    qr_wifi_note: str | None

    @strawberry.field
    def intermission(self) -> Intermission:
        """Whether this race is on a break right now, and for how long
        (#592). Resolved against the current moment on every read — the
        same "computed on demand" rule the standings and awards follow — so
        a countdown that ran out is simply inactive with no cleanup step
        needed. See `domain/intermission.py`.
        """
        return _intermission_type(
            typing.cast(models.Race, self), datetime.now(timezone.utc)
        )

    @strawberry.field
    def resolved_name_display(self, info: Info) -> str:
        """How much of a racer's name this race's audience/printable/export
        surfaces may show, fully resolved (#552).

        A race override layered over the organization's own default,
        layered over `FULL` — see `domain.name_display.resolve_name_display`.
        Every abbreviating surface reads this (never the raw override
        fields) so the layering is computed in exactly one place, the same
        reasoning `Race.terminology` follows.
        """
        organization = _loaders(info).organization_by_id(self.organization_id)
        return domain_name_display.resolve_name_display(
            organization=organization.name_display if organization else None,
            race=self.name_display,
        )

    @strawberry.field
    def terminology(self, info: Info) -> Terminology:
        """The words this race should use, fully resolved (#496 stage 3).

        A race override layered over the organization's own default, layered
        over the built-in Scouting words — see
        `domain.terminology.resolve_terminology`. `RaceTerminologyGate` reads
        this for every `/race/:raceId` route and overrides the organization
        default `AppTerminologyProvider` seeded the app with, so a race page
        shows this race's own resolved terms.
        """
        organization = _loaders(info).organization_by_id(self.organization_id)
        return _terminology_type(
            domain_terminology.resolve_terminology(
                organization=_terminology_overrides(organization)
                if organization
                else None,
                race=_terminology_overrides(self),
            )
        )

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
    def racing_groups(self, info: Info) -> list[RacingGroup]:
        """Get all racing groups associated with this race."""
        return typing.cast(Any, _loaders(info).racing_groups_for_race(self.id))

    @strawberry.field
    def racers(self, info: Info) -> list[Racer]:
        """Get all racers registered for this race."""
        return typing.cast(Any, _loaders(info).racers_for_race(self.id))

    @strawberry.field
    def scheduled_racer_ids(self, info: Info) -> list[int]:
        """Get IDs of all racers scheduled in any official heats of this race."""
        return _loaders(info).scheduled_racer_ids(self.id)

    @strawberry.field
    def organization(self, info: Info) -> "Organization":
        """Get the organization that owns this race."""
        return typing.cast(Any, _loaders(info).organization_by_id(self.organization_id))

    @strawberry.field
    def rounds(self, info: Info) -> list[Round]:
        """Get all rounds for this race."""
        return typing.cast(Any, _loaders(info).rounds_for_race(self.id))

    @strawberry.field
    def heats(self, info: Info) -> list[Heat]:
        """Get all heats for this race."""
        return typing.cast(Any, _loaders(info).heats_for_race(self.id))

    @strawberry.field
    def run_off_heats(self, info: Info) -> list["RunOffHeat"]:
        """Every run-off heat on this race (#550), newest first is not
        guaranteed — the standings and schedule screens each filter by their
        own ``settlesRoundId`` and show what they need. Not batched through
        `RequestLoaders`: a race holds a handful of these at most, unlike the
        heats a whole schedule generates.
        """
        return typing.cast(
            Any, crud.run_off_heats_for_race(info.context["db"], self.id)
        )

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
    #: The timer's own lane 1 is wired to this track's highest lane — a fact
    #: about this venue's cable, not about the device model (#553).
    reverse_lanes: bool
    #: The vehicle-to-real-life ratio scale speed is computed against
    #: (#610) — see `domain.scale_speed.scale_mph`. A fact about this
    #: track's cars, not a global constant: `DEFAULT_SCALE` (1:25) is the
    #: standard BSA Pinewood Derby ratio, but a Space Derby or Raingutter
    #: Regatta track needs a different number.
    scale_ratio: float
    #: Whether scale speed is offered on this track's surfaces at all.
    #: Stage 4's renderers AND this with a positive `length_feet` — this
    #: flag alone does not promise a length exists to compute from.
    show_scale_speed: bool
    #: The colour painted on each physical lane, if any (#611). One hex
    #: string per lane, index 0 meaning lane 1 — see `domain.lane_colors`
    #: for the lookup rule, and that module's docstring for why no
    #: `reverse_lanes` translation belongs here. An empty list (every
    #: track before this column existed) means no lane has a configured
    #: colour; a renderer falls back to the plain numbered badge.
    lane_colors: list[str]

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
class Organization:
    """
    Represents an organization (e.g. 'Pack 123') that holds races.
    """

    id: int
    name: str
    #: This organization's raw terminology overrides, null where it has not
    #: renamed that word (#496 stage 3) — what the settings form reads back
    #: to populate its inputs, distinct from `terminology` below.
    racing_group_singular: str | None
    racing_group_plural: str | None
    organization_singular: str | None
    organization_plural: str | None
    #: This organization's raw vehicle-word override, null where it has not
    #: renamed "Car" (#551) — same distinction as the four fields above.
    vehicle_singular: str | None
    vehicle_plural: str | None
    #: This organization's raw vehicle-artwork override, null where it has
    #: not chosen one (#551, stage 4) — same distinction as the six fields
    #: above.
    vehicle_artwork_key: str | None
    #: This organization's raw name-display override, null where it has not
    #: changed it from `FULL` (#552) — same distinction as the seven fields
    #: above.
    name_display: str | None

    @strawberry.field
    def terminology(self) -> Terminology:
        """The install-wide default words, fully resolved (#496 stage 3).

        No race in play here — see `Race.terminology` for the layer on top.
        """
        return _terminology_type(
            domain_terminology.resolve_terminology(
                organization=_terminology_overrides(self)
            )
        )

    @strawberry.field
    def resolved_name_display(self) -> str:
        """The install-wide default for how much of a racer's name a public
        screen may show, fully resolved (#552).

        No race in play here — see `Race.resolvedNameDisplay` for the layer
        on top.
        """
        return domain_name_display.resolve_name_display(organization=self.name_display)

    @strawberry.field
    def races(self, info: Info) -> list[Race]:
        """Get all races organized by this organization."""
        return (
            info.context["db"]
            .query(models.Race)
            .filter(models.Race.organization_id == self.id)
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
class RunOffHeat:
    """A run-off heat, held to settle a tie without joining the score that
    produced it (#550).

    Backed by a ``Heat`` row with ``kind = RUN_OFF`` — the same "a flag on
    the one table, not a second table" shape #6 gave free heats. Its own
    type, for the same reason `FreeRaceHeat` is one: it has no round of
    generated heats around it (``round_id`` is null, just as a free heat's
    is), and the standings/schedule screens ask a different question of it
    — "is this settling anything, and what" — than the race-control screens
    ask of an ordinary `Heat`.
    """

    id: int
    race_id: int
    settles_round_id: int | None
    created_at: str | None

    @strawberry.field
    def lanes(self, info: Info) -> list[HeatLane]:
        """This heat's lanes, in lane order — the tied racers it holds."""
        return _heat_lanes(info, self, self.id)

    @strawberry.field
    def recorded(self, info: Info) -> bool:
        """Whether a result has been recorded. Same rule as
        `FreeRaceHeat.recorded`."""
        return lanes.has_results(
            _loaders(info).lane_values_for_heat(self.race_id, self.id)
        )

    @strawberry.field
    def placement(self, info: Info) -> int | None:
        """The standings rank this run-off is currently racing to decide —
        see `scoring.run_off_contested_rank` and `Heat.run_off_placement`,
        which answers the same question for a `Heat` returned from
        `onDeck`/`currentlyRacing`. ``None`` when the tie it was created for
        has since moved (#550, rule 4): a corrected time elsewhere in
        ``settlesRoundId``'s standings can dissolve it, and this heat then
        settles nothing until a fresh one is created for whatever the field
        looks like now.
        """
        db = info.context["db"]
        heat = db.query(models.Heat).filter(models.Heat.id == self.id).first()
        if heat is None:
            return None
        return scoring.run_off_contested_rank(db, self.race_id, heat)


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
    #: Three plain claims about the connected model, straight off the profile
    #: (#553) — GPRM's "Indicate Timing Started", "Count Down Clock" and
    #: "Photo Finish Trigger" columns. Unlike `can_remote_start` these need no
    #: track-side setting: there is no accessory to install, either the model
    #: has it or it does not. Datasheet claims, most of them never checked
    #: against real hardware — read them next to `device_provenance`.
    indicates_timing_started: bool = False
    has_countdown_clock: bool = False
    has_photo_finish_trigger: bool = False
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

#: How the `STANDINGS_ONLY` view gets through a list too long for one screen
#: (#663) — wrapped for the same reason as `DisplayViewEnum`.
ScrollBehaviorEnum = strawberry.enum(
    domain_displays.ScrollBehavior, name="ScrollBehavior"
)

#: Which page `QRCODE` points a phone at (#614) — wrapped for the same
#: reason as `DisplayViewEnum` above.
QRTargetEnum = strawberry.enum(domain_displays.QRTarget, name="QRTarget")


def _require_operator_role(info: Info) -> None:
    """Refuse anything but an operator.

    `RolePolicyExtension` guards *mutations*, and this is a query — the same
    gap `/api/backup` and `/ws/timer/{track_id}` each close for themselves.
    Shared by every operator-only query: the activity log, its `sourceIp`
    field, and the display-name reroll each matter for their own reason, but
    the check and its refusal are the same one.
    """
    if auth.resolve_role(info.context) is not auth.Role.OPERATOR:
        raise auth.PermissionDeniedError("This is operator-only")


def _audit_entry(row: models.AuditEntry) -> audit.Entry:
    """The domain `Entry` a stored audit row describes.

    `summary` and `noteworthy` each need one built from the row; sharing the
    construction is what keeps them in step if `Entry` grows a field — two
    independent copies is how one of them would quietly stop getting it.
    `noteworthy` reads neither `race_id` nor `details`, but there is no
    cheaper `Entry` to hand it than the real one.

    A free function rather than a method on `AuditLogEntry`: `self` inside a
    field resolver is the duck-typed ORM row, not this Strawberry type, so a
    method reached through `self.` is looked up on `models.AuditEntry` and
    fails there.
    """
    return audit.Entry(
        action=row.action,
        role=audit.ActorRole(row.role),
        at=row.at,
        outcome=audit.Outcome(row.outcome),
        race_id=row.race_id,
        details=json.loads(row.details) if row.details else {},
    )


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
        return audit.describe(_audit_entry(self))

    @strawberry.field
    def noteworthy(self) -> bool:
        """Whether this one deserves attention rather than merely a line."""
        return audit.is_noteworthy(_audit_entry(self))


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
    #: How `STANDINGS_ONLY` gets through a list too long for one screen
    #: (#663) — paging or a continuous scroll. Carried regardless of `view`,
    #: the same reasoning as `cycle_seconds`: a screen switched away from
    #: `STANDINGS_ONLY` and back keeps the choice it was given.
    scroll_behavior: ScrollBehaviorEnum  # type: ignore[valid-type]
    #: `CHECKIN`'s own rider (#612) — whether it lists every racer, checked
    #: in or not, or only the ones still pending. Carried regardless of
    #: `view`, the same reasoning as `scroll_behavior`.
    show_checked_in: bool
    #: `QRCODE`'s own rider (#614) — which page the code opens. Carried
    #: regardless of `view`, the same reasoning as `scroll_behavior` and
    #: `show_checked_in`.
    qr_target: QRTargetEnum  # type: ignore[valid-type]
    #: `OVERLAY`'s own rider (#616) — whether the broadcast overlay's
    #: compact top-5 ticker is shown alongside its lower-third bar. Carried
    #: regardless of `view`, the same reasoning as `scroll_behavior`,
    #: `show_checked_in` and `qr_target`.
    show_standings_ticker: bool
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
    #: The operator's last "flash your name" command, as a counter rather
    #: than a boolean (#495) — the same shape as `slide_seq` and for the same
    #: reason. `identifyOverlay.ts` applies the same `seen === null` rule as
    #: the ceremony's steps: the value a screen arrives holding, on connect
    #: or reconnect, is history rather than an instruction.
    identify_seq: int
    #: The organization's stored Display theme setting (#498, #586) —
    #: `"MATCH_APP"` or a `ThemeKey`, unresolved: the frontend already owns
    #: `resolveDisplayTheme`, and shipping the resolved tokens here as well
    #: would be a second copy of that vocabulary free to disagree with it.
    #:
    #: Only `displayAssignment` resolves this for real, because that is the
    #: one subscription a live screen holds open for the whole event (#174's
    #: "leash") — carrying the theme on it is what lets a change reach an
    #: already-open screen with no new socket. Every other place this type is
    #: built (the operator's own `displays` list and panel mutations) leaves
    #: the default: the operator's screen is not itself styled by the Display
    #: theme, and none of those documents select this field, so the default
    #: never reaches a client to disagree with the subscription's real value.
    display_theme_setting: str = "MATCH_APP"


def _display(
    display: displays_service.Display, display_theme_setting: str = "MATCH_APP"
) -> Display:
    return Display(
        display_id=display.display_id,
        name=display.name,
        race_id=display.race_id,
        view=display.assignment.view,
        cycle_seconds=display.assignment.cycle_seconds,
        scroll_behavior=display.assignment.scroll_behavior,
        show_checked_in=display.assignment.show_checked_in,
        qr_target=display.assignment.qr_target,
        show_standings_ticker=display.assignment.show_standings_ticker,
        connected=display.connected,
        assigned=display.assigned,
        description=domain_displays.describe(display.assignment),
        paced_by_a_person=domain_displays.is_paced_by_a_person(display.assignment.view),
        slide_seq=display.slide_seq,
        slide_delta=display.slide_delta,
        identify_seq=display.identify_seq,
        display_theme_setting=display_theme_setting,
    )


def _display_theme_setting(db: Session) -> str:
    """The organization's stored Display theme setting, or the default.

    Read fresh rather than cached: `display_assignment` holds its `db` open
    for the whole connection (#174), and a subscription that re-reads the
    database has to see a value another request just committed, not the one
    the session had cached from opening the socket.
    """
    organization = db.query(models.Organization).first()
    return organization.display_theme if organization else "MATCH_APP"


async def _publish_displays(race_id: int) -> None:
    """Tell the operator's list that something about a display changed."""
    await pubsub.publish(f"displays:{race_id}", None)


async def _broadcast_display_theme_change() -> None:
    """Nudge every connected display to re-read the Display theme (#586).

    `Organization.display_theme` is install-wide, not race-scoped (#498), so
    this is not `_publish_displays`'s job — that channel is per-race and
    tells the *operator's* list something changed, not a screen showing it.
    A theme change has to reach every screen currently open regardless of
    which race it happens to be pointed at, which is what
    `DisplayRegistry.all_ids` is for.

    Publishing `None` on each display's own `display_assignment:{id}` channel
    is enough: `display_assignment` re-reads the organization row on *every*
    event on that channel, whatever raised it, so this doubles as "you have
    mail" rather than needing to carry a payload of its own.
    """
    for display_id in displays_service.registry.all_ids():
        await pubsub.publish(f"display_assignment:{display_id}", None)


RACES_LIST_CHANNEL = "races_list"


async def _publish_races_list() -> None:
    """Tell every tab's navigation that the race list itself changed.

    Deliberately a signal on its own channel rather than a sentinel `race_id`
    on `race_state:{race_id}` (#300) — the navigation's race selector and the
    browser tab's title aren't scoped to one race the way everything else
    subscribed to `raceStateChanged` is, and overloading that channel would
    mean every existing subscriber filtering out an event meant for a screen
    that isn't there. The payload carries nothing: `racesChanged` is a nudge
    to re-run `GET_RACES_NAV`, not a copy of the list down the wire a second
    way that would have to be kept in step with the query.
    """
    await pubsub.publish(RACES_LIST_CHANNEL, None)


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
        indicates_timing_started=s.indicates_timing_started,
        has_countdown_clock=s.has_countdown_clock,
        has_photo_finish_trigger=s.has_photo_finish_trigger,
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
    def suggest_display_name(
        self, info: Info, display_id: str, avoid: str | None = None
    ) -> str:
        """A rerolled name suggestion for one display (#521).

        Operator-only, like the rest of the display panel's controls, and a
        query rather than a mutation because it changes nothing — the
        rerolled word only fills the rename form's draft input, the same way
        it did before this reached the server. Going through
        `DisplayRegistry.suggest_name` — which walks `whimsical_name` against
        the race's other display names — is the whole point: a suggestion
        drawn from a second, hand-copied word list on the frontend could not
        know what those names were and could hand back one already in use.
        """
        _require_operator_role(info)
        return displays_service.registry.suggest_name(display_id, avoid=avoid)

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
                # Clamped on both ends: unclamped, a negative limit reaches
                # SQLite as `LIMIT -1`, which SQLite reads as "no limit at
                # all" rather than "zero rows" — the opposite of what a
                # negative number should ever mean here.
                limit=max(0, min(limit, 500)),
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
    def practice_race(self, info: Info) -> Race | None:
        """The rehearsal already under way, if there is one (#588).

        Home reads this to decide whether its button should say "Resume
        practice race" instead of "Try a practice race", and whether it needs
        a second, smaller "Start new" action beside it — the same question
        `createPracticeRace` answers for itself before deciding whether to
        build anything. Answered once, here, rather than the frontend
        re-deriving the naming rule from the race list: two copies of a rule
        are two chances for them to disagree (#48).
        """
        return typing.cast(Any, crud.existing_practice_race(info.context["db"]))

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
    def network_addresses(self) -> list[str]:
        """Addresses this machine can be reached at from off itself (#414).

        For the voting page's share step: `window.location.origin` is
        `localhost` on the machine running Trusty Track, which a phone on the
        venue wifi cannot open. The frontend substitutes one of these in when
        that happens; an empty list means the backend could not find one, and
        the page has to say so rather than pretend `localhost` works.
        """
        return network.lan_addresses()

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
    def organizations(self, info: Info) -> list[Organization]:
        """Get all registered organizations."""
        return typing.cast(Any, info.context["db"].query(models.Organization).all())

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
            organization = db.query(models.Organization).first()
            race = db.query(models.Race).first()
            pin_required = bool(organization and organization.operator_pin_hash)
            return InitialConfigStatus(
                initialized=True,
                version=_version,
                demo_mode=demo_mode.enabled(),
                organization_name=organization.name if organization else None,
                debug_mode=organization.debug_mode if organization else False,
                tracks=typing.cast(Any, tracks),
                current_race_id=race.id if race else None,
                pin_required=pin_required,
                checkin_pin_set=bool(organization and organization.checkin_pin_hash),
                # Resolved here rather than left to the extension: this is a
                # *query*, so nothing has asked for a role yet, and the point is
                # to let the UI prompt before an action fails.
                is_operator=auth.resolve_role(info.context) is auth.Role.OPERATOR,
                display_theme=organization.display_theme
                if organization
                else "MATCH_APP",
                printables_theme=organization.printables_theme
                if organization
                else "MATCH_APP",
                **_terminology_status_kwargs(organization),
                **_name_display_status_kwargs(organization),
            )
        # Reported on the unconfigured branch too. A demo seeds itself before
        # it serves, so this is only reachable if seeding failed — and a first
        # -run wizard is the one screen that must not be idled out from under
        # somebody halfway through it.
        return InitialConfigStatus(
            initialized=False,
            version=_version,
            demo_mode=demo_mode.enabled(),
            **_terminology_status_kwargs(None),
            **_name_display_status_kwargs(None),
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
        self,
        info: Info,
        race_id: int,
        shuffle: int = 0,
        enabled_lanes: list[int] | None = None,
    ) -> list[FreeRaceLaneAssignment]:
        """
        Return a random lane assignment over the race's usable lanes, using
        only checked-in racers. Frontend can display this as a preview
        before the operator commits to starting the heat.

        ``shuffle`` counts the re-shuffles the operator has asked for, and it
        exists because the draw may be seeded (`demo_seed`): the public demo
        sets ``TRUSTYTRACK_DEMO_SEED``, so without it every call keyed on the
        race alone returned the identical draw and the Re-shuffle button did
        nothing at all. Counting the draws keys each one separately, so a
        re-shuffle really re-shuffles while the *first* draw a screen shows
        stays the fixed one the screenshots and the demo want.

        ``enabled_lanes`` narrows the draw to a subset of the race's usable
        lanes (#303) — the Free Race screen's per-lane toggle is session-only
        and lives entirely on the client, so this is how a temporarily
        disabled lane keeps out of the preview without ever being written
        anywhere. Absent means every usable lane; a lane out of service is
        never offered even if named here, since usability is still decided
        by ``usable_lanes_for_race`` rather than trusted from the caller.
        """
        db = info.context["db"]
        usable = crud.usable_lanes_for_race(db, race_id)
        lane_numbers = (
            [lane for lane in enabled_lanes if lane in usable]
            if enabled_lanes is not None
            else usable
        )
        assignments = crud.get_random_lane_assignments(
            db, race_id, lane_numbers, shuffle=shuffle
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

        # `compute_race_stats` returns a dict matching this type field-for-field
        # by design (see its docstring), so every nested list here is a
        # mechanical dict-to-dataclass conversion rather than a hand-copied
        # field list. `times_per_lane` is the one field that needs the same
        # treatment one level down.
        return RaceStats(
            race_id=data["race_id"],
            race_name=data["race_name"],
            scoring_strategy=data["scoring_strategy"],
            total_heats_scheduled=data["total_heats_scheduled"],
            total_heats_completed=data["total_heats_completed"],
            total_racers=data["total_racers"],
            lane_stats=[LaneTimeStat(**ls) for ls in data["lane_stats"]],
            racer_stats=[
                RacerStat(
                    **{
                        **rs,
                        "times_per_lane": [
                            TimesPerLane(**t) for t in rs["times_per_lane"]
                        ],
                    }
                )
                for rs in data["racer_stats"]
            ],
            highlights=[HeatHighlight(**hl) for hl in data["highlights"]],
            racing_group_stats=[
                RacingGroupStat(**ds) for ds in data["racing_group_stats"]
            ],
            heat_results=[HeatResultRow(**hr) for hr in data["heat_results"]],
            track_records=[TrackRecord(**tr) for tr in data["track_records"]],
            top_scale_mph=data["top_scale_mph"],
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


def _race_id_for_racers(db: Session, racer_ids: list[int]) -> int | None:
    """The race a bulk mutation's racers belong to, or ``None`` if there are none.

    Five bulk resolvers each re-derived this from ``racer_ids[0]`` — to know
    which race's state to publish — with three different null-guard styles
    for the same lookup. Naming it once ends the drift.
    """
    if not racer_ids:
        return None
    racer = db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first()
    return racer.race_id if racer else None


def _device_for(track: Any) -> TimerProfile:
    """The profile a track should run on.

    ``FAKE`` and ``NONE`` are each their own device — neither is ever probed
    or refined by anything a track's ``timer_profile`` names. Otherwise it is
    the model the operator picked, and ``DEFAULT_PROFILE`` only when they
    picked none — where it is an assumption a probe is expected to replace,
    not an answer (#143).

    A key that names nothing, or names the fake timer on a transport that needs
    a real port, falls back rather than failing: a stale setting should leave
    the track detecting, not leave it dead.
    """
    if track.timer_type == models.TimerType.FAKE:
        return FAKE
    if track.timer_type == models.TimerType.NONE:
        return NO_TIMER
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
        lane_count=track.lane_count,
        reverse_lanes=track.reverse_lanes,
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


def _apply_pins(organization: Any, config: "InitialConfigInput") -> None:
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
        setattr(organization, column, auth.hash_pin(value) if value else None)


def _apply_themes(organization: Any, config: "InitialConfigInput") -> None:
    """Store whichever Display/Printables theme the settings page sent (#498).

    Absent means *leave alone*, same shape as `_apply_pins` — but unlike a
    PIN or the weight limit, there is no bare-null "leave alone versus clear"
    ambiguity to resolve here: the column's own "off" state is the literal
    string `"MATCH_APP"`, not `None`, so an explicit `"MATCH_APP"` already
    means *reset to the default* and needs no companion clear flag.
    """
    for field in ("display_theme", "printables_theme"):
        value = getattr(config, field, None)
        if value is None:
            continue
        setattr(organization, field, value)


def _apply_name_display(organization: Any, config: "InitialConfigInput") -> None:
    """Store whichever install-wide name-display default the settings page
    sent (#552).

    Absent means *leave alone*, the same shape as `_apply_themes` — `FULL`
    is itself the non-null "off" state, so there is no clear flag here the
    way `_apply_terminology` needs one.
    """
    if config.name_display is not None:
        organization.name_display = config.name_display


_TERMINOLOGY_FIELDS = (
    "racing_group_singular",
    "racing_group_plural",
    "organization_singular",
    "organization_plural",
    "vehicle_singular",
    "vehicle_plural",
    "vehicle_artwork_key",
)


def _apply_terminology(organization: Any, config: "InitialConfigInput") -> None:
    """Store whichever custom terminology the settings page sent (#496 stage 3).

    Absent means *leave alone*, same shape as `_apply_pins` — but unlike
    `_apply_themes`, there is no non-null sentinel meaning "off": the built-in
    Scouting words *are* the null state, so `clearTerminology` is the explicit
    way back to it, the same trap `clear_weight_limit` (#205) and the PIN's
    removal control (#192) already solved.

    This is the one door the organization-level words go through —
    `InitialConfigInput` is a plain strawberry input with no validation of
    its own (unlike the per-race override, built through the pydantic
    `schemas.RaceUpdate`), so a blank word is checked right here rather than
    left to reach the database. `domain_terminology.reject_blank_word` is
    the same rule `schemas.py`'s validators call, shared so the two layers
    cannot silently disagree about what counts as blank (#704). Checked
    before anything is written, not field by field as it goes, so a blank
    fourth word does not leave the first three set on an `organization` this
    function's caller may still be about to abandon.
    """
    if config.clear_terminology:
        for field in _TERMINOLOGY_FIELDS:
            setattr(organization, field, None)
        return
    for field in domain_terminology.TERMINOLOGY_WORD_FIELDS:
        value = getattr(config, field, None)
        if value is not None:
            domain_terminology.reject_blank_word(field, value)
    for field in _TERMINOLOGY_FIELDS:
        value = getattr(config, field, None)
        if value is None:
            continue
        setattr(organization, field, value)


#: A GPRM database is a roster, not a photo library — GPRM keeps pictures as
#: separate files it never puts in the database (see `domain.gprm`'s own
#: docstring) — so even years of history stays a few megabytes. This is
#: headroom for an operator who hands over the wrong file, not a real budget;
#: `MAX_UPLOAD_BYTES` in `api/main.py` is the same idea for `POST /upload/`.
MAX_GPRM_IMPORT_BYTES = 64 * 1024 * 1024


@strawberry.type
class GprmImportGroup:
    """A racing group `domain.gprm.roster_from_tables` found, before it is written."""

    name: str
    division: str | None


@strawberry.type
class GprmImportRacer:
    """A racer `domain.gprm.roster_from_tables` found, before it is written."""

    first_name: str
    last_name: str
    car_number: int | None
    car_name: str | None
    car_weight: float | None
    passed_inspection: bool
    group: str | None
    excluded_from_standings: bool
    #: The other program's own id, so a problem naming this racer (below) can
    #: be matched back to the row it is about — see `ImportedRacer.source_id`.
    source_id: str | None


@strawberry.type
class GprmImportProblem:
    """One sentence about what will not import as the operator might expect."""

    message: str
    blocking: bool
    source_id: str | None


@strawberry.type
class GprmImportPreview:
    """Everything an uploaded GrandPrix Race Manager database would import
    (#618), without writing any of it.

    `confirmGprmImport` re-parses the same upload rather than trusting this
    value back from the client — there is no session on the server holding
    the file between the two calls, so what gets written can never drift
    from what this preview showed.
    """

    groups: list[GprmImportGroup]
    racers: list[GprmImportRacer]
    #: In-file duplicates (`domain.roster_import.duplicate_number_problems`)
    #: and collisions with a racer already on this race's roster
    #: (`domain.roster_import.existing_number_problems`) are both here,
    #: in that order — the reader has no reason to care which rule found it.
    problems: list[GprmImportProblem]
    can_import: bool


def _decode_upload(
    file_data: str, max_bytes: int, program_name: str = "GrandPrix Race Manager"
) -> bytes:
    """A base64 data URL — the same shape `uploadImage`'s `dataUrl` takes —
    to raw bytes, refusing anything absurdly large before it is written
    anywhere. Shared by every importer's preview and confirm so none of them
    can disagree about what counts as too big.

    `program_name` reaches the one message that names a program (#661) —
    the same reason `domain.gprm.roster_from_tables` takes it.
    """
    if "," not in file_data:
        raise ValueError("That file could not be read.")
    _, encoded = file_data.split(",", 1)
    try:
        raw = base64.b64decode(encoded)
    except (ValueError, binascii.Error) as error:
        raise ValueError("That file could not be read.") from error
    if len(raw) > max_bytes:
        raise ValueError(
            f"That file is larger than {program_name} writes for a roster "
            "database — it is probably not one."
        )
    return raw


def _race_vehicle_word(db: Session, race: models.Race) -> str:
    """This race's own resolved vehicle word (#551), for the parser's
    problem sentences — the same layering `Race.terminology` resolves,
    computed here because a mutation has no GraphQL field resolver to read
    it from.
    """
    organization = (
        db.query(models.Organization)
        .filter(models.Organization.id == race.organization_id)
        .first()
    )
    resolved = domain_terminology.resolve_terminology(
        organization=_terminology_overrides(organization) if organization else None,
        race=_terminology_overrides(race),
    )
    return resolved.vehicle_singular


def _parse_gprm_upload(
    db: Session, race: models.Race, file_data: str
) -> tuple[roster_import.ParsedRoster, str]:
    """Decode an uploaded GPRM database and parse it (#618).

    `sqlite3` opens files, not buffers (see `services/importers/gprm.py`), so
    the decoded bytes are written to a temporary file — removed in a
    `finally` — before `parse_gprm_database` ever sees them, the same shape
    `services/backup.py`'s restore uses for an uploaded archive. Raises
    `ValueError` rather than `RosterImportError`, so every failure reaching
    the operator through this mutation is the same shape as `importRacers`'
    own "Race not found": a GraphQL error carrying the sentence to show.
    """
    raw = _decode_upload(file_data, MAX_GPRM_IMPORT_BYTES)
    vehicle_word = _race_vehicle_word(db, race)
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as handle:
        handle.write(raw)
        temp_path = Path(handle.name)
    try:
        try:
            roster = parse_gprm_database(temp_path, vehicle_word=vehicle_word)
        except roster_import.RosterImportError as error:
            raise ValueError(str(error)) from error
        return roster, vehicle_word
    finally:
        os.unlink(temp_path)


def _gprm_import_preview(
    db: Session, race_id: int, roster: roster_import.ParsedRoster, vehicle_word: str
) -> GprmImportPreview:
    existing_holders = crud.existing_car_number_holders(db, race_id)
    extra_problems = roster_import.existing_number_problems(
        roster.racers, existing_holders, vehicle_word
    )
    problems = list(roster.problems) + extra_problems
    return GprmImportPreview(
        groups=[
            GprmImportGroup(name=group.name, division=group.division)
            for group in roster.groups
        ],
        racers=[
            GprmImportRacer(
                first_name=racer.first_name,
                last_name=racer.last_name,
                car_number=racer.car_number,
                car_name=racer.car_name,
                car_weight=racer.car_weight,
                passed_inspection=racer.passed_inspection,
                group=racer.group,
                excluded_from_standings=racer.excluded_from_standings,
                source_id=racer.source_id,
            )
            for racer in roster.racers
        ],
        problems=[
            GprmImportProblem(
                message=problem.message,
                blocking=problem.blocking,
                source_id=problem.source_id,
            )
            for problem in problems
        ],
        can_import=not any(problem.blocking for problem in problems),
    )


#: DerbyNet's own database is the same table family GPRM's is (see
#: `domain.derbynet`'s docstring), and keeps photographs as separate files
#: the same way GPRM does — so the same headroom applies for the same
#: reason `MAX_GPRM_IMPORT_BYTES` gives above.
MAX_DERBYNET_IMPORT_BYTES = MAX_GPRM_IMPORT_BYTES


@strawberry.type
class DerbynetImportGroup:
    """A racing group `domain.derbynet.roster_from_derbynet_tables` found,
    before it is written."""

    name: str
    division: str | None


@strawberry.type
class DerbynetImportRacer:
    """A racer `domain.derbynet.roster_from_derbynet_tables` found, before
    it is written."""

    first_name: str
    last_name: str
    car_number: int | None
    car_name: str | None
    car_weight: float | None
    passed_inspection: bool
    group: str | None
    excluded_from_standings: bool
    #: DerbyNet's own id, so a problem naming this racer (below) can be
    #: matched back to the row it is about — see `ImportedRacer.source_id`.
    source_id: str | None


@strawberry.type
class DerbynetImportProblem:
    """One sentence about what will not import as the operator might expect."""

    message: str
    blocking: bool
    source_id: str | None


@strawberry.type
class DerbynetImportPreview:
    """Everything an uploaded DerbyNet database would import (#661), without
    writing any of it.

    The same shape as `GprmImportPreview` — a sibling type rather than a
    shared one, so the schema names which program a caller is previewing
    rather than a caller reading `previewDerbynetImport: GprmImportPreview`
    and wondering whether that is a typo. `confirmDerbynetImport` re-parses
    the same upload rather than trusting this value back from the client,
    for the identical reason `GprmImportPreview`'s own docstring gives.
    """

    groups: list[DerbynetImportGroup]
    racers: list[DerbynetImportRacer]
    problems: list[DerbynetImportProblem]
    can_import: bool


def _parse_derbynet_upload(
    db: Session, race: models.Race, file_data: str
) -> tuple[roster_import.ParsedRoster, str]:
    """Decode an uploaded DerbyNet database and parse it (#661).

    The DerbyNet twin of `_parse_gprm_upload` — see its own docstring for
    why the bytes land in a temporary file rather than a buffer, and why a
    `RosterImportError` is re-raised as a plain `ValueError`.
    """
    raw = _decode_upload(file_data, MAX_DERBYNET_IMPORT_BYTES, program_name="DerbyNet")
    vehicle_word = _race_vehicle_word(db, race)
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as handle:
        handle.write(raw)
        temp_path = Path(handle.name)
    try:
        try:
            roster = parse_derbynet_database(temp_path, vehicle_word=vehicle_word)
        except roster_import.RosterImportError as error:
            raise ValueError(str(error)) from error
        return roster, vehicle_word
    finally:
        os.unlink(temp_path)


def _derbynet_import_preview(
    db: Session, race_id: int, roster: roster_import.ParsedRoster, vehicle_word: str
) -> DerbynetImportPreview:
    existing_holders = crud.existing_car_number_holders(db, race_id)
    extra_problems = roster_import.existing_number_problems(
        roster.racers, existing_holders, vehicle_word
    )
    problems = list(roster.problems) + extra_problems
    return DerbynetImportPreview(
        groups=[
            DerbynetImportGroup(name=group.name, division=group.division)
            for group in roster.groups
        ],
        racers=[
            DerbynetImportRacer(
                first_name=racer.first_name,
                last_name=racer.last_name,
                car_number=racer.car_number,
                car_name=racer.car_name,
                car_weight=racer.car_weight,
                passed_inspection=racer.passed_inspection,
                group=racer.group,
                excluded_from_standings=racer.excluded_from_standings,
                source_id=racer.source_id,
            )
            for racer in roster.racers
        ],
        problems=[
            DerbynetImportProblem(
                message=problem.message,
                blocking=problem.blocking,
                source_id=problem.source_id,
            )
            for problem in problems
        ],
        can_import=not any(problem.blocking for problem in problems),
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
        await _publish_race_state(new_race.id, kind=RaceChangeKind.RACE_SETTINGS)
        await _publish_races_list()
        return new_race

    @strawberry.mutation
    async def update_race(
        self, info: Info, id: int, race: RaceUpdateInput
    ) -> Race | None:
        """Update an existing race."""
        db = info.context["db"]
        data = strawberry.asdict(race)
        clear_weight_limit = data.pop("clear_weight_limit", False)
        clear_terminology = data.pop("clear_terminology", False)
        clear_name_display = data.pop("clear_name_display", False)
        filtered_data = {k: v for k, v in data.items() if v is not None}
        # Explicit removal beats an absent field, which means "leave alone"
        # here for every other column (#205, following #192).
        if clear_weight_limit:
            filtered_data["weight_limit_oz"] = None
        # Same trap, for the per-race terminology override (#496 stage 3):
        # absent already means "inherit whatever this race had", so getting
        # back to null needs its own explicit flag.
        if clear_terminology:
            for field in _TERMINOLOGY_FIELDS:
                filtered_data[field] = None
        # Same trap again, for the per-race name-display override (#552):
        # "FULL" here is a real override, not the inherit state, so getting
        # back to null needs its own explicit flag too.
        if clear_name_display:
            filtered_data["name_display"] = None
        race_update = schemas.RaceUpdate(**typing.cast(Any, filtered_data))
        updated = typing.cast(
            Any, crud.update_race(db, race_id=id, race_update=race_update)
        )
        if updated is not None:
            # A rename is what the browser tab's title reads (#300) — the
            # rest of `race` (dates, location…) is not shown in the nav, but
            # there is no cheap way to tell a rename from any other field
            # changing, and a signal nobody needed is far cheaper than one
            # that is missing.
            await _publish_races_list()
            # The race-scoped channel (#319): this is the mutation that
            # actually changes name, scoring_strategy, auto_advance_heat,
            # championship_trophies and the weight limit — exactly what
            # RACE_SETTINGS exists to announce. Without it, an audience
            # display's `leaderboard` subscription keeps showing standings
            # computed under the old scoring strategy until the next heat
            # result happens to fire the channel.
            await _publish_race_state(updated.id, kind=RaceChangeKind.RACE_SETTINGS)
        return updated

    @strawberry.mutation
    async def delete_race(self, info: Info, id: int) -> bool:
        """Delete a race."""
        db = info.context["db"]
        deleted = crud.delete_race(db, race_id=id)
        if deleted:
            # Removes every heat of both kinds, which can take the one just
            # armed with it — a shared track can be running a second race
            # (#309).
            await _revalidate_timers(info)
            await _publish_races_list()
        return deleted

    # Intermission Mutations (#592)
    #
    # All five publish `race_state:{race_id}` with `kind=INTERMISSION` and the
    # freshly resolved state, which is the display's own leash (see "Telling
    # an audience display what to show" in CLAUDE.md) — no new channel, and
    # the observation page merges the payload directly rather than treating
    # it as a signal to refetch. Refusals from `domain.intermission` (extend/
    # pause/resume against nothing active) surface as an ordinary GraphQL
    # error, the same shape `createRunOffHeat`'s validation takes.

    @strawberry.mutation
    async def start_intermission(
        self,
        info: Info,
        race_id: int,
        duration_seconds: int,
        label: str | None = None,
    ) -> Race:
        """Begin (or restart) a break.

        No precondition on the current state — a fresh click while one is
        already running restarts it with the new duration and label, which
        covers both an on-the-fly change of mind and the round-summary
        modal's "Take a break" row offering the same presets after a round
        finishes.
        """
        db = info.context["db"]
        race = crud.start_intermission(db, race_id, duration_seconds, label)
        await _publish_race_state(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def extend_intermission(self, info: Info, race_id: int, seconds: int) -> Race:
        """Add time to the break under way, running or paused."""
        db = info.context["db"]
        race = crud.extend_intermission(db, race_id, seconds)
        await _publish_race_state(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def pause_intermission(self, info: Info, race_id: int) -> Race:
        """Freeze the countdown where it stands."""
        db = info.context["db"]
        race = crud.pause_intermission(db, race_id)
        await _publish_race_state(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def resume_intermission(self, info: Info, race_id: int) -> Race:
        """Start the countdown again from wherever it was paused."""
        db = info.context["db"]
        race = crud.resume_intermission(db, race_id)
        await _publish_race_state(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def end_intermission(self, info: Info, race_id: int) -> Race:
        """End the break now. Idempotent — ending one that has already
        expired on its own is an ordinary click, not a race to catch."""
        db = info.context["db"]
        race = crud.end_intermission(db, race_id)
        await _publish_race_state(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    # Racer Mutations
    @strawberry.mutation
    async def assign_display(
        self,
        view: DisplayViewEnum,  # type: ignore[valid-type]
        display_id: str,
        cycle_seconds: int | None = None,
        scroll_behavior: ScrollBehaviorEnum | None = None,  # type: ignore[valid-type]
        show_checked_in: bool | None = None,
        qr_target: QRTargetEnum | None = None,  # type: ignore[valid-type]
        show_standings_ticker: bool | None = None,
    ) -> Display | None:
        """Tell an audience display what to show (#174).

        Operator-only, and the display is the thing being told: it never asks
        for this, it is handed the answer over the subscription it already
        holds. Returns null for a display nobody has seen, which is what the
        operator gets if a screen was forgotten between listing and clicking.
        """
        if cycle_seconds is not None and cycle_seconds < 1:
            raise ValueError("cycle_seconds must be at least 1")
        display = displays_service.registry.assign(
            display_id,
            view,
            cycle_seconds,
            scroll_behavior,
            show_checked_in,
            qr_target,
            show_standings_ticker,
        )
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
    async def identify_display(self, display_id: str) -> Display | None:
        """Flash a screen's own name across it, so the operator can tell which
        row on the list is which physical screen (#495).

        A memorable name is only half of it — somebody still has to learn
        which row is the projector at the back. Bumping the counter is the
        whole of it: the display is what shows the flash, the same split as
        `advanceDisplay`'s steps, and it is a **step**, not a state, for the
        same reason — see `services/displays.Display.identify_seq`.
        """
        display = displays_service.registry.identify(display_id)
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
            # `_vacate_lanes` can regenerate an unraced round underneath the
            # deleted racer's lanes, the same #50 risk every other re-fielding
            # path already guards (#309).
            await _revalidate_timers(info)
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
        # Absent means leave alone (#192/#205's convention): only a caller
        # that actually supplies a weight or a photo should overwrite one
        # already on file. Passing every kwarg to RacerUpdate unconditionally
        # would make `model_dump(exclude_unset=True)` treat an omitted value
        # as an explicit null and erase it — e.g. a photo `bulkAssignPhotos`
        # placed, on a check-in that doesn't re-supply it.
        update_fields: dict[str, Any] = {"car_passed_inspection": passed_inspection}
        if weight is not None:
            update_fields["car_weight"] = weight
        if racer_image_url is not None:
            update_fields["racer_image_url"] = racer_image_url
        if car_image_url is not None:
            update_fields["car_image_url"] = car_image_url
        racer_update = schemas.RacerUpdate(**update_fields)
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

    # RacingGroup Mutations
    @strawberry.mutation
    async def create_racing_group(
        self, info: Info, race_id: int, racing_group: RacingGroupInput
    ) -> RacingGroup:
        """Create a new racing group."""
        db = info.context["db"]
        racing_group_in = schemas.RacingGroupCreate(
            **typing.cast(Any, strawberry.asdict(racing_group))
        )
        new_racing_group = typing.cast(
            Any, crud.create_racing_group(db, racing_group_in, race_id=race_id)
        )
        await _publish_race_state(race_id)
        return new_racing_group

    @strawberry.mutation
    async def update_racing_group(
        self, info: Info, id: int, racing_group: RacingGroupInput
    ) -> RacingGroup | None:
        """Update an existing racing group."""
        db = info.context["db"]
        racing_group_update = schemas.RacingGroupUpdate(
            **typing.cast(Any, strawberry.asdict(racing_group))
        )
        updated = typing.cast(
            Any,
            crud.update_racing_group(
                db, racing_group_id=id, racing_group_update=racing_group_update
            ),
        )
        if updated:
            await _publish_race_state(updated.race_id)
        return updated

    @strawberry.mutation
    async def delete_racing_group(self, info: Info, id: int) -> bool:
        """Delete a racing group."""
        db = info.context["db"]
        racing_group = (
            db.query(models.RacingGroup).filter(models.RacingGroup.id == id).first()
        )
        race_id = racing_group.race_id if racing_group else None
        try:
            result = crud.delete_racing_group(db, racing_group_id=id) is not None
        except ValueError:
            return False
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

    @strawberry.mutation
    def cast_vote(
        self, info: Info, award_id: int, racer_id: int, ballot_key: str
    ) -> str | None:
        """Vote for a car on a `SPECIAL` award (#305).

        The one mutation a caller with no PIN — a phone in the room — may
        run (`api.auth.VOTE_MUTATIONS`); `crud.cast_vote` is what actually
        enforces `Race.voting_open` and `Award.votable`. Returns null on
        success, or a sentence saying why the vote was refused — the same
        shape as `releaseStartGate`, so the ballot screen has something to
        show rather than a raw GraphQL error.

        Not published to any subscription: the operator's tally screen reads
        it as an ordinary query and refetches, the same choice `auditLog`
        makes and for the same reason — a room full of phones voting is not
        an event the rest of the app needs to react to live.
        """
        db = info.context["db"]
        return crud.cast_vote(
            db, award_id=award_id, racer_id=racer_id, ballot_key=ballot_key
        )

    # Track Mutations
    @strawberry.mutation
    async def create_track(self, info: Info, track: TrackInput) -> Track:
        """Create a new track and its associated TimerManager."""
        db = info.context["db"]
        track_in = schemas.TrackCreate(**typing.cast(Any, strawberry.asdict(track)))
        new_track = typing.cast(Any, crud.create_track(db, track_in))

        # Handle TimerManager initialization
        timer_managers = info.context.get("timer_managers", {})
        if new_track.id not in timer_managers:
            mgr = _manager_for(new_track, info)
            timer_managers[new_track.id] = mgr
            # Same as `updateInitialConfig`'s new-track branch: a backend-direct
            # track left unstarted sits DISCONNECTED until something else
            # happens to kick it, which for a freshly created track is nothing.
            if new_track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                _start_backend_direct(mgr, new_track.serial_port)

        return new_track

    @strawberry.mutation
    async def update_track(
        self, info: Info, id: int, track: TrackInput
    ) -> Track | None:
        """Update an existing track.

        Shrinking `lane_count` is brought into line the same way `setLaneOutages`
        brings a newly out-of-service lane into line (#325): existing heats can
        hold racers on lanes that no longer exist, and nothing else notices.
        """
        db = info.context["db"]
        db_track = crud.get_track(db, id)
        if not db_track:
            return None

        old_timer_type = db_track.timer_type
        old_serial_port = db_track.serial_port
        old_profile = db_track.timer_profile
        old_lane_count = db_track.lane_count

        track_update = schemas.TrackBase(**typing.cast(Any, strawberry.asdict(track)))
        updated_track = typing.cast(Any, crud.update_track(db, db_track, track_update))

        if track.lane_count < old_lane_count:
            crud.apply_outages_to_scheduled_heats(db, id)
            # Regenerating a round replaces its heats, so anything armed
            # against the old ids has to be told (#50) — the same call
            # `setLaneOutages` makes for the same reason.
            await _revalidate_timers(info)
            for race in db.query(models.Race).filter(models.Race.track_id == id):
                await _publish_race_state(race.id)

        # Handle TimerManager updates
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(id)
        if mgr:
            await mgr.set_remote_start_installed(track.remote_start_installed)
            mgr.set_lane_translation(
                lane_count=track.lane_count, reverse_lanes=track.reverse_lanes
            )

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
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        existing_rounds = crud.get_rounds(db, race_id)
        if existing_rounds:
            raise ValueError("Cannot use wizard: rounds already exist for this race.")

        # Validated up front, before anything is created: a bad value partway
        # through would leave the earlier rounds needing the same rollback as
        # a scheduling failure, for a check that costs nothing to do first
        # (#321, mirroring `createRound`'s checks).
        if config.general_round.runs_per_lane < 1:
            raise ValueError("A round needs at least one run per lane.")
        for champ_cfg in config.championship_rounds:
            if champ_cfg.runs_per_lane < 1:
                raise ValueError("A round needs at least one run per lane.")
            if champ_cfg.num_top_racers < 1:
                raise ValueError("num_top_racers must be at least 1.")

        created_rounds = []
        current_round_number = 1

        try:
            # General Round
            if config.general_round.type == "ALL":
                round_obj = crud.create_round(
                    db,
                    race_id,
                    current_round_number,
                    models.SchedulingStrategy.PPC,
                    crud.default_general_round_name(db, race),
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
            elif config.general_round.type == "EACH_GROUP":
                racing_groups = crud.get_racing_groups(db, race_id)
                for racing_group in racing_groups:
                    racers = (
                        db.query(models.Racer)
                        .filter(models.Racer.racing_group_id == racing_group.id)
                        .all()
                    )
                    if not racers:
                        continue
                    round_obj = crud.create_round(
                        db,
                        race_id,
                        current_round_number,
                        models.SchedulingStrategy.PPC,
                        racing_group.name,
                        racing_group_id=racing_group.id,
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
                        # Fallback to ALL if no previous championship round exists
                        adv_source = "ALL"

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

    # Run-off heats (#550)
    @strawberry.mutation
    async def create_run_off_heat(
        self,
        info: Info,
        race_id: int,
        racer_ids: list[int],
        settles_round_id: int | None = None,
    ) -> RunOffHeat:
        """Create a run-off heat to settle a tie.

        Lanes are assigned automatically, one usable lane per racer in the
        order given — `crud.create_run_off_heat` raises if there are fewer
        than two racers or more racers than usable lanes, which reaches the
        caller as an ordinary GraphQL error, the same shape
        `updateHeatResult`'s own validation takes.

        The heat comes back armable and recordable through the ordinary
        timer path (`prepareHeat`/`updateHeatResult`) exactly like any other
        heat, by heat id — it needs no special-casing there because neither
        mutation reads `kind`.

        Publishes on `race_state:{race_id}` so the standings and schedule
        screens see it without a manual refetch, and `onDeck`/
        `currentlyRacing` pick it up once it is armed.
        """
        db = info.context["db"]
        heat = crud.create_run_off_heat(db, race_id, settles_round_id, racer_ids)
        await _publish_race_state(race_id)
        return typing.cast(Any, heat)

    @strawberry.mutation
    async def delete_run_off_heat(self, info: Info, heat_id: int) -> bool:
        """Delete a run-off heat that has not been run yet.

        The operator's undo for one created by mistake — mirrors
        `deleteFreeRaceHeat`. Calls `_revalidate_timers` for the same
        reason `deleteHeat` does: the operator may have armed it and then
        changed their mind rather than running it, and an armed heat must
        not be swapped underneath them (#50).
        """
        db = info.context["db"]
        heat = crud.get_run_off_heat(db, heat_id)
        race_id = heat.race_id if heat else None
        try:
            result = crud.delete_run_off_heat(db, heat_id)
        except ValueError:
            return False
        await _revalidate_timers(info)
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
        """Send the force-results command to the timer device (e.g. RA for MicroWizard),
        briefly wait for its answer, then record whatever results have been
        collected.

        No-op for timer types that do not support this command (e.g. FAKE),
        but still forces recording of any pending results.
        Returns False if no manager exists for the track.
        """
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return False

        await mgr.force_results()

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
        if track.timer_type == models.TimerType.NONE:
            # A bench test exercises the device's own commands (#235) — there
            # is no device on a track configured this way (#490).
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

        found = _heat_and_manager(
            db, timer_managers, heat_id, is_free_race=is_free_race
        )
        if found is None:
            return False
        _heat, _race, mgr = found
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

        Refused while a *different* heat is running or its results are
        overdue (#337): cars are on the track and the finish-line results
        still to arrive belong to that heat. Arming another one instead
        would swap ``_active_heat_id`` out from under them, and the
        ARMED→RUNNING transition `LaneResult` handling exists for (needed for
        timers with no start signal) would then read the old run's times as
        the new heat's own — the staleness guard in `_record_results` cannot
        catch it, because the new heat's lanes really do match what it was
        armed with. Re-preparing the *same* heat is untouched — that is
        "Reset Heat", the operator's deliberate way to abandon a stuck run
        and retry it, and preparing while merely ARMED or READY is untouched
        too: nothing is pending yet, so switching the operator's choice
        before the gate opens is the ordinary "wrong heat selected"
        correction.
        """
        timer_managers = info.context.get("timer_managers", {})
        db = info.context["db"]

        found = _heat_and_manager(db, timer_managers, heat_id)
        if found is None:
            return False
        heat, race, mgr = found
        track = crud.get_track(db, race.track_id)
        if track is not None and track.timer_type == models.TimerType.NONE:
            # There is nothing to arm (#490): this track has no timer, and
            # hand entry through the Override/Edit modal is how every result
            # gets recorded. `raceFlow.ts` already knows not to call this for
            # a no-timer track; refusing here is what protects every other
            # caller, present and future (#48).
            return False
        if (
            mgr._state in (TimerState.RUNNING, TimerState.RESULTS_OVERDUE)
            and mgr._active_heat_id != heat_id
        ):
            return False

        lane_mask = 0
        racer_by_lane: dict[int, int | None] = {}
        stored = _stored_lanes(db, heat)
        for lane in stored:
            if lane.racer_id is not None:
                lane_mask |= 1 << (lane.lane - 1)
                racer_by_lane[lane.lane] = lane.racer_id

        if lane_mask == 0 and heat.kind is models.HeatKind.FREE:
            # A free heat with nobody assigned arms every lane the heat itself
            # holds — anonymous mode, or manual/random left entirely empty —
            # the point of an exhibition run is to time whatever is on it.
            # Reading the stored rows rather than `track.lane_count` (#303) is
            # what makes this honour a lane out of service and the Free Race
            # screen's temporary per-lane toggle: neither ever gets a row, so
            # neither is in `stored`. Fall back to the race's usable lanes
            # only if the heat somehow holds no rows at all.
            stored_lane_numbers = {lane.lane for lane in stored}
            if not stored_lane_numbers:
                stored_lane_numbers = set(crud.usable_lanes_for_race(db, race.id))
            for lane_num in stored_lane_numbers:
                lane_mask |= 1 << (lane_num - 1)

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

        found = _heat_and_manager(db, timer_managers, heat_id)
        if found is None:
            return False
        heat, race, mgr = found
        if mgr._state != TimerState.RUNNING or mgr._active_heat_id != heat_id:
            return False

        stored = _stored_lanes(db, heat)
        occupied = [lane.lane for lane in stored if lane.racer_id is not None]
        if not occupied:
            # If no racers are assigned (e.g., anonymous free race), generate
            # results for every lane the heat holds — which already excludes
            # anything out of service or temporarily disabled (#303), since
            # neither ever got a row. Fall back to the race's usable lanes
            # only if the heat somehow holds no rows at all.
            occupied = sorted(
                {lane.lane for lane in stored}
            ) or crud.usable_lanes_for_race(db, race.id)

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
        # This is the boundary a client's malformed input actually crosses
        # (#307): an empty list, a partial lane set, a duplicate lane number
        # or a racer from another race used to reach `crud.set_heat_lanes`
        # untouched.
        problem = crud.validate_lane_replacement(db, heat, results)
        if problem:
            raise ValueError(problem)
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
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return 0
        count = crud.auto_number_racers(db, race_id, racer_ids)
        await _publish_race_state(race_id, kind=RaceChangeKind.RACER)
        return count

    @strawberry.mutation
    async def bulk_clear_numbers(self, info: Info, racer_ids: list[int]) -> bool:
        """Bulk clear car numbers."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        crud.bulk_clear_car_numbers(db, racer_ids)
        if race_id is not None:
            await _publish_race_state(race_id, kind=RaceChangeKind.RACER)
        return True

    @strawberry.mutation
    async def bulk_check_in(
        self, info: Info, racer_ids: list[int], passed_inspection: bool = True
    ) -> bool:
        """Bulk check-in racers."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return False
        crud.bulk_check_in_racers(db, racer_ids, passed_inspection)
        # Once for the batch, not once per racer: both directions are
        # idempotent and look at everybody, so a per-racer call would
        # regenerate an unraced round sixty times over a desk queue. Runs for
        # un-checks too — that is how a bulk withdrawal reaches the schedule
        # (#228).
        await _admit_late_racers(info, race_id)
        await _publish_race_state(race_id, kind=RaceChangeKind.RACER)
        return True

    @strawberry.mutation
    async def bulk_set_excluded_from_standings(
        self, info: Info, racer_ids: list[int], excluded: bool = True
    ) -> bool:
        """Bulk set whether racers race but are not ranked (#548).

        Check-in is unchanged — a sibling or parent's car set here still
        fields in heats exactly as before, and still shows on the audience
        display. Only `services/scoring.get_leaderboard` reads the flag, so
        nothing here touches the schedule; no `_admit_late_racers` or
        `_revalidate_timers` call, unlike `bulk_check_in` beside it.
        """
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return False
        crud.bulk_set_excluded_from_standings(db, racer_ids, excluded)
        await _publish_race_state(race_id, kind=RaceChangeKind.RACER)
        return True

    @strawberry.mutation
    async def bulk_move_to_racing_group(
        self, info: Info, racer_ids: list[int], racing_group_id: int | None
    ) -> bool:
        """Bulk move racers to a racing group."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        crud.bulk_move_racers_to_racing_group(db, racer_ids, racing_group_id)
        if race_id is not None:
            await _publish_race_state(race_id, kind=RaceChangeKind.ROSTER)
        return True

    @strawberry.mutation
    async def bulk_delete_racers(self, info: Info, racer_ids: list[int]) -> bool:
        """Bulk delete racers."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        crud.bulk_delete_racers(db, racer_ids)
        if race_id is not None:
            # Same #50 risk as a single delete, and this is the desk's bulk
            # path onto it (#309).
            await _revalidate_timers(info)
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
        """Initialize the system with organization name and tracks."""
        db = info.context["db"]
        if crud.get_tracks(db):
            raise ValueError("System already initialized")

        config_dict = strawberry.asdict(config)
        config_in = schemas.InitialConfigCreate(**config_dict)
        organization, tracks = crud.create_initial_config(db, config_in)
        _apply_pins(organization, config)
        _apply_terminology(organization, config)
        db.commit()
        db.refresh(organization)

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
            organization_name=organization.name,
            debug_mode=organization.debug_mode,
            tracks=typing.cast(Any, tracks),
            pin_required=bool(organization.operator_pin_hash),
            checkin_pin_set=bool(organization.checkin_pin_hash),
            # The caller who just set the PIN keeps the role they had for this
            # response; the next request resolves it from what they send.
            is_operator=True,
            display_theme=organization.display_theme,
            printables_theme=organization.printables_theme,
            **_terminology_status_kwargs(organization),
            **_name_display_status_kwargs(organization),
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
        organization = db.query(models.Organization).first()
        if organization and (
            organization.name != config.organization_name
            or organization.debug_mode != config.debug_mode
        ):
            if organization.name != config.organization_name:
                existing = crud.get_organization_by_name(db, config.organization_name)
                if existing:
                    raise ValueError(
                        f"Organization '{config.organization_name}' already exists"
                    )
            crud.update_organization(
                db, organization, config.organization_name, config.debug_mode
            )
            db.refresh(organization)

        if organization:
            previous_display_theme = organization.display_theme
            _apply_pins(organization, config)
            _apply_themes(organization, config)
            _apply_terminology(organization, config)
            _apply_name_display(organization, config)
            db.commit()
            if organization.display_theme != previous_display_theme:
                await _broadcast_display_theme_change()

        # Tracks are matched to database rows by id, not by list position
        # (#318): the form can reorder or remove a track from the middle of
        # the list, and matching by index would then update the wrong row —
        # renaming and reconfiguring it into whichever track happened to
        # follow, and deleting the track actually meant to survive.
        db_tracks = crud.get_tracks(db)
        db_tracks_by_id = {t.id: t for t in db_tracks}
        input_tracks = config.tracks
        timer_managers = info.context.get("timer_managers", {})

        matched_ids: set[int] = set()

        for input_track in input_tracks:
            if input_track.id is None:
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
                continue

            db_track = db_tracks_by_id.get(input_track.id)
            if db_track is None:
                raise ValueError(
                    f"Track {input_track.id} no longer exists; reload the page "
                    "and try again."
                )
            matched_ids.add(db_track.id)

            # Update existing track inline
            old_timer_type = db_track.timer_type
            old_serial_port = db_track.serial_port
            old_profile = db_track.timer_profile
            track_update = schemas.TrackBase(
                **typing.cast(Any, strawberry.asdict(input_track))
            )
            crud.update_track(db, db_track, track_update)
            mgr = timer_managers.get(db_track.id)
            if mgr:
                await mgr.set_remote_start_installed(input_track.remote_start_installed)
                mgr.set_lane_translation(
                    lane_count=input_track.lane_count,
                    reverse_lanes=input_track.reverse_lanes,
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

        # Delete tracks the operator removed from the list. The manager is
        # stopped only once `crud.delete_track` actually succeeds — stopping
        # it first left a track that survived a refused delete (it has races
        # against it) with no running TimerManager until the server
        # restarted, while the mutation reported success either way.
        delete_failures: list[str] = []
        for db_track in db_tracks:
            if db_track.id in matched_ids:
                continue
            try:
                crud.delete_track(db, db_track.id)
            except ValueError:
                delete_failures.append(db_track.name)
                continue
            mgr = timer_managers.pop(db_track.id, None)
            if mgr:
                await mgr.stop()

        if delete_failures:
            names = ", ".join(f'"{name}"' for name in delete_failures)
            raise ValueError(
                f"Could not remove {names}: still has races recorded against it."
            )

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
            organization_name=organization.name if organization else None,
            debug_mode=organization.debug_mode if organization else False,
            tracks=typing.cast(Any, tracks),
            pin_required=bool(organization and organization.operator_pin_hash),
            checkin_pin_set=bool(organization and organization.checkin_pin_hash),
            is_operator=True,
            display_theme=organization.display_theme if organization else "MATCH_APP",
            printables_theme=organization.printables_theme
            if organization
            else "MATCH_APP",
            **_terminology_status_kwargs(organization),
            **_name_display_status_kwargs(organization),
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
            assign_racing_groups=config.assign_racing_groups,
            check_in=config.check_in,
        )
        await _publish_race_state(race_id)
        return f"Populated race {race_id} with {config.count} racers"

    @strawberry.mutation
    async def create_practice_race(self, info: Info, start_new: bool = False) -> Race:
        """A whole event on a fake timer, ready to run (#201).

        Resumes the most recent rehearsal rather than building another one
        (#588): a double click, or simply visiting Home a second time, must
        not leave cruft in the races list. `startNew` is the deliberate
        override for an operator who really does want to start over — it
        gets a fresh race, counted up the usual way, rather than reopening
        one they are done with.

        One mutation rather than the five round trips a client would need —
        race, racing groups, roster, check-in, rounds — because a rehearsal that fails
        half way leaves the operator with a broken race to tidy up, which is
        the opposite of the confidence this exists to give.
        """
        db = info.context["db"]
        existing = None if start_new else crud.existing_practice_race(db)
        if existing is not None:
            return typing.cast(Any, existing)
        new_race = typing.cast(Any, crud.create_practice_race(db))
        # Inserts a race the same as createRace, and #300's signal is a rule
        # about every insert into `races`, not just the ones reached through
        # the ordinary form.
        await _publish_races_list()
        return new_race

    @strawberry.mutation
    async def import_racers(self, info: Info, race_id: int, csv_data: str) -> int:
        """Import racers from a CSV data string."""
        db = info.context["db"]
        # Verification: ensure race exists
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        # Excel writes a UTF-8 BOM on every "CSV UTF-8" save. Left in place it
        # sticks to the first header (`﻿first_name`), which never matches
        # `first_name` in `get_val` below, so every row is silently skipped
        # and the mutation returns 0 with no error.
        f = io.StringIO(csv_data.lstrip("﻿"))
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
            racing_group_id = None
            racing_group_val = get_val(row, "racing_group")
            if racing_group_val:
                racing_group_name = racing_group_val.strip()
                db_racing_group = (
                    db.query(models.RacingGroup)
                    .filter(
                        models.RacingGroup.race_id == race_id,
                        models.RacingGroup.name == racing_group_name,
                    )
                    .first()
                )
                if not db_racing_group:
                    db_racing_group = crud.create_racing_group(
                        db,
                        schemas.RacingGroupCreate(
                            name=racing_group_name, color="#808080"
                        ),
                        race_id,
                    )
                racing_group_id = db_racing_group.id

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
                racing_group_id=racing_group_id,
                race_id=race_id,
            )
            crud.create_racer(db, racer_in)
            count += 1

        # A row can arrive already checked in (the canonical CSV carries
        # passed_inspection), which is exactly the arrival #172 admits for —
        # once for the batch, the same reason bulkCheckIn calls it once.
        await _admit_late_racers(info, race_id)
        # An import creates racers, so the roster list changed.
        await _publish_race_state(race_id, kind=RaceChangeKind.ROSTER)
        return count

    @strawberry.mutation
    async def preview_gprm_import(
        self, info: Info, race_id: int, file_data: str
    ) -> GprmImportPreview:
        """Parse an uploaded GrandPrix Race Manager database without writing
        anything (#618, stage 3).

        The upload-preview-confirm shape the issue asked for: this call
        writes nothing, and `confirmGprmImport` is the only door that does.
        `GprmImportPreview.canImport` mirrors `ParsedRoster.can_import` —
        false only were a *blocking* problem to appear, which nothing this
        parser produces today does (a row problem here is always a warning,
        the racer is simply skipped or a field left blank) — kept anyway so
        a future blocking rule needs no frontend change to be honoured.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, vehicle_word = _parse_gprm_upload(db, race, file_data)
        return _gprm_import_preview(db, race_id, roster, vehicle_word)

    @strawberry.mutation
    async def confirm_gprm_import(
        self, info: Info, race_id: int, file_data: str
    ) -> int:
        """Write the roster from a GrandPrix Race Manager database (#618,
        stage 3).

        Re-parses `fileData` rather than trusting a preview handed back from
        the client — there is no session on the server holding the earlier
        upload, so what gets written can never drift from what the preview
        showed. Returns the number of racers created, the same contract
        `importRacers` (CSV) already has.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, _ = _parse_gprm_upload(db, race, file_data)
        count = crud.write_imported_roster(db, race_id, roster)

        # Same arrival #343 fixed for the CSV path: a GPRM roster can carry
        # already-checked-in racers (`PassedInspection`), and admission is
        # the batch's job, once, not per racer.
        await _admit_late_racers(info, race_id)
        await _publish_race_state(race_id, kind=RaceChangeKind.ROSTER)
        return count

    @strawberry.mutation
    async def preview_derbynet_import(
        self, info: Info, race_id: int, file_data: str
    ) -> DerbynetImportPreview:
        """Parse an uploaded DerbyNet database without writing anything (#661).

        The DerbyNet twin of `previewGprmImport` — a sibling mutation rather
        than the same one taking a source argument, so that renaming an
        already-shipped, documented mutation is not the cost of adding a
        second importer (see `domain.derbynet`'s own docstring for why the
        parser itself needed almost nothing DerbyNet-specific; this pair is
        the "almost").
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, vehicle_word = _parse_derbynet_upload(db, race, file_data)
        return _derbynet_import_preview(db, race_id, roster, vehicle_word)

    @strawberry.mutation
    async def confirm_derbynet_import(
        self, info: Info, race_id: int, file_data: str
    ) -> int:
        """Write the roster from a DerbyNet database (#661).

        Re-parses `fileData` rather than trusting a preview handed back from
        the client, the same reason `confirmGprmImport` does. Returns the
        number of racers created, the same contract every importer here has.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, _ = _parse_derbynet_upload(db, race, file_data)
        count = crud.write_imported_roster(db, race_id, roster)

        # Same arrival #343 fixed for the CSV and GPRM paths: a DerbyNet
        # roster can carry already-checked-in racers (`passedinspection`),
        # and admission is the batch's job, once, not per racer.
        await _admit_late_racers(info, race_id)
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

        round_obj: models.Round | None = None
        try:
            # `runs_per_lane` becomes `HeatPlan` heats: zero or negative
            # schedules nothing and a championship round with no heats is
            # stuck `NOT_READY` with no rebuild path out (#321).
            if round_data.runs_per_lane < 1:
                raise ValueError("A round needs at least one run per lane.")

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
                # Only reached for a general round with no name typed —
                # otherwise this would be a query the operator's own choice
                # makes unnecessary on every round they name themselves.
                round_name = round_data.name or (
                    "Elimination Round"
                    if is_elimination
                    else "Balanced Round"
                    if is_balanced
                    else crud.default_general_round_name(db, race)
                )
                round_obj = crud.create_round(
                    db,
                    race_id,
                    next_round_number,
                    strategy,
                    round_name,
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
                if (
                    round_data.advancement_num_racers is not None
                    and round_data.advancement_num_racers < 1
                ):
                    # `ordered[:num_racers]` with a negative is Python's "all
                    # but the last N", which silently advances the wrong end
                    # of the standings and disagrees with `field_size` — the
                    # round's heats and its advancing field cannot agree
                    # (#321).
                    raise ValueError("advancement_num_racers must be at least 1.")
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
        except ValueError:
            # `create_round` commits immediately (backend/db/crud.py), so a
            # round joins the rollback the moment its row exists — the
            # wizard's rule (#249), applied to its single-round sibling
            # (#415): a failure in heat generation must not leave a
            # committed, heat-less round behind.
            if round_obj is not None:
                crud.delete_round(db, round_obj.id)
            raise

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

    @strawberry.mutation
    async def apply_master_running_order(
        self, info: Info, race_id: int
    ) -> HeatReorderResponse:
        """Interleave the race's current rounds into one running order (#549).

        Every heat some other generator already scheduled — PPC, balanced,
        elimination — stays exactly as scheduled; this only decides the
        *sequence* they run in, across rounds rather than one block per
        racing group. `domain/running_order.py` computes the order and this
        writes it through `_write_heat_numbers`, the same door `reorderHeats`
        uses, so a heat is never written a second way.

        Only pending heats move. A heat that already holds a result keeps
        its `heatNumber` — `recorded_at` is the record of when it ran (#59),
        and an announcer who already called it must find it unchanged.
        Nothing here regenerates a heat or reassigns its lanes, so an armed
        heat's own identity survives exactly as `reorderHeats`'s drag-to-
        reorder already leaves it.
        """
        db = info.context["db"]
        updated_heats = crud.apply_master_running_order(db, race_id)
        if updated_heats:
            await _publish_race_state(race_id, kind=RaceChangeKind.SCHEDULE)
        return HeatReorderResponse(
            updated_count=len(updated_heats), heats=typing.cast(Any, updated_heats)
        )

    # Free Race Mutations
    @strawberry.mutation
    async def start_free_race_heat(
        self,
        info: Info,
        race_id: int,
        lane_assignments: list[FreeRaceLaneAssignmentInput],
    ) -> FreeRaceHeat:
        """
        Persist a free race heat with the given lane assignments.
        Returns the created FreeRaceHeat (results will be null until recorded).

        Publishes on `race_state:{race_id}` — `activeFreeRaceHeat` and
        `freeRaceHeat` watch only that channel, and without this the audience
        display learned of a run only once its result landed (#317).
        """
        db = info.context["db"]
        assignments = [
            lanes.Lane(lane=a.lane, racer_id=a.racer_id) for a in lane_assignments
        ]
        heat = crud.create_free_race_heat(db, race_id, assignments)
        await _publish_race_state(race_id)
        return typing.cast(Any, heat)

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
        # Same guard, same reason as `update_heat_result` (#307).
        problem = crud.validate_lane_replacement(db, heat, lane_results)
        if problem:
            raise ValueError(problem)
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
    #: does *not* change which racers exist or which racing group they are in, so a
    #: normalized client cache can merge the payload without refetching a list.
    RACER = "RACER"
    #: Racers were added or removed, or moved between racing groups. ``Race.racers`` and
    #: ``RacingGroup.racers`` membership changed, which no payload can express — a
    #: client has to re-read the list.
    ROSTER = "ROSTER"
    #: Heats or rounds were created, regenerated, reordered, or deleted. The
    #: shape of the schedule changed, so a refetch is genuinely warranted.
    SCHEDULE = "SCHEDULE"
    #: Race-level settings changed — name, scoring strategy, trophies.
    RACE_SETTINGS = "RACE_SETTINGS"
    #: A break started, was extended, paused, resumed or ended (#592).
    #: Carries ``intermission``, the fully resolved current state — a
    #: subscriber applies it directly rather than re-querying `Race`.
    INTERMISSION = "INTERMISSION"
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
        "racing_group_id",
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
    #: The fully resolved current state, for ``INTERMISSION`` (#592) — the
    #: same shape ``Race.intermission`` reads, so a subscriber applies it
    #: directly rather than treating this as a signal to refetch.
    intermission: Intermission | None = None


@strawberry.type
class TimingStatsLane:
    """Represents a single lane's result for the Timing Stats observation view."""

    lane_number: int
    racer_name: str
    car_name: str | None
    time: float | None
    place: int | None
    racer_image_url: str | None
    #: The scale speed this lane's time converts to (#610), or null when the
    #: track has scale speed turned off, has no configured length, or this
    #: lane has no time to convert. See `domain.scale_speed.scale_mph`.
    scale_mph: float | None


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
    #: When this result was saved. `heat_id` alone is not enough to notice a
    #: re-recorded heat on the observation display (#335) — the id is the
    #: same heat both times, and only this changes.
    recorded_at: str | None


async def _publish_race_state(
    race_id: int,
    kind: RaceChangeKind = RaceChangeKind.OTHER,
    heat: models.Heat | None = None,
    racer: models.Racer | None = None,
    round_id: int | None = None,
    intermission_race: models.Race | None = None,
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
        intermission_race: The race row to resolve `Intermission` from, for
            ``INTERMISSION`` (#592) — resolved at the same instant as
            ``changed_at`` so the two never disagree.
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
            intermission=(
                _intermission_type(intermission_race, datetime.now(timezone.utc))
                if intermission_race is not None
                else None
            ),
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
    async def races_changed(self) -> AsyncGenerator[bool, None]:
        """A nudge that the race list itself changed elsewhere (#300).

        Argument-free, unlike every other subscription here: the navigation's
        race selector and the browser tab's title aren't scoped to one race.
        The payload is a bare `True` rather than the new list, because the
        client already holds `GET_RACES_NAV` — re-executing it network-only
        is simpler than shipping the list down the socket a second way that
        would have to be kept in step with the query. No initial value: the
        query's own fetch on mount is the first answer.
        """
        async with pubsub.subscribe(RACES_LIST_CHANNEL) as stream:
            async for _ in stream:
                yield True

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
        self, info: Info, display_id: str, race_id: int, name: str | None = None
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

        **Also carries the Display surface's theme (#586).** This is the one
        subscription a live screen holds open for the whole event — the
        "leash" `Observation.tsx`'s own comment names — so it is also the
        seam that lets an operator changing the theme in System Settings
        reach a screen that is already open, with no new socket and no
        polling. `updateInitialConfig` publishes to every connected display's
        own channel when `display_theme` changes; on every event on this
        channel (a real assignment or that nudge) the current organization
        row is re-read, so a screen that was merely renamed picks up a theme
        changed a moment earlier for free, and vice versa.
        """
        db = info.context["db"]
        async with pubsub.subscribe(f"display_assignment:{display_id}") as stream:
            display = displays_service.registry.connect(display_id, race_id, name)
            await _publish_displays(race_id)
            try:
                yield _display(display, _display_theme_setting(db))
                async for _ in stream:
                    current = displays_service.registry.get(display_id)
                    if current is not None:
                        db.expire_all()
                        _loaders(info).clear()
                        yield _display(current, _display_theme_setting(db))
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
                # One door for the running order (#549): under a master
                # running order the next heat is usually another round's,
                # and this display is the one staging depends on.
                sorted_heats = crud.heats_in_running_order(db, race_id)
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
                # Same door as `on_deck` (#549) — the two displays must
                # agree about where the race is up to.
                sorted_heats = crud.heats_in_running_order(db, race_id)
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
                # A run-off heat (#550) has no `round_id` either, the same
                # as a free heat — it belongs to no generated round, only to
                # the round its own `settles_round_id` names. Anything below
                # that dereferences `target_heat.round` has to treat the two
                # alike; only the record-break gate (further down) tells
                # them apart, since a run-off is a real run and a free heat
                # is not.
                has_no_round = target_heat.round_id is None

                heat_lanes = _stored_lanes(db, target_heat)
                racer_ids = lanes.real_racer_ids(heat_lanes)
                racers = (
                    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).all()
                )
                racer_map = {r.id: r for r in racers}

                # This subscription composes its own name strings rather
                # than handing back first/last for the client to format
                # (#552) — the results overlay and the record-break banner
                # are both audience surfaces, so `format_display_name` is
                # applied here, once, rather than at each of the two spots
                # below that build one.
                race_row = crud.get_race(db, race_id)
                organization_row = (
                    _loaders(info).organization_by_id(race_row.organization_id)
                    if race_row
                    else None
                )
                resolved_name_display = domain_name_display.resolve_name_display(
                    organization=organization_row.name_display
                    if organization_row
                    else None,
                    race=race_row.name_display if race_row else None,
                )

                # Loaded once, through the same per-operation cache the
                # record-break baseline's `race_row.track_id` lookup could
                # have used — a lane count's worth of tracks is one query,
                # not one per lane (#610, `test_query_counts.py`).
                track_row = (
                    _loaders(info).track_by_id(race_row.track_id)
                    if race_row and race_row.track_id
                    else None
                )

                def _scale_mph(seconds: float | None) -> float | None:
                    if track_row is None or not track_row.show_scale_speed:
                        return None
                    return domain_scale_mph(
                        track_row.length_feet, seconds, track_row.scale_ratio
                    )

                lane_stats = []
                for lane in heat_lanes:
                    racer = racer_map.get(lane.racer_id)
                    lane_stats.append(
                        TimingStatsLane(
                            lane_number=lane.lane,
                            racer_name=domain_name_display.format_display_name(
                                resolved_name_display,
                                racer.first_name,
                                racer.last_name,
                            )
                            if racer
                            else "Unknown",
                            car_name=racer.car_name if racer else None,
                            time=lane.seconds,
                            place=lane.place,
                            scale_mph=_scale_mph(lane.seconds),
                            racer_image_url=racer.racer_image_url if racer else None,
                        )
                    )

                if has_no_round:
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
                # record, so it cannot break one either — and never for a
                # run-off (#550): its result is scoped to the cut it
                # settles, which is what keeps it out of a track record's
                # population in the first place (see `services.records`).
                record_break = None
                if (
                    target_heat.kind
                    not in (models.HeatKind.FREE, models.HeatKind.RUN_OFF)
                    and race_row
                    and race_row.track_id
                ):
                    baseline = records_service.track_records(
                        db, race_row.track_id, limit=1, exclude_race_id=race_id
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
                            new_holder=domain_name_display.format_display_name(
                                resolved_name_display,
                                breaker.first_name,
                                breaker.last_name,
                            )
                            if breaker
                            else "Unknown",
                            previous_seconds=previous.time_seconds,
                            previous_holder=previous.racer_name,
                            previous_race_name=previous.race_name,
                        )

                if is_free:
                    round_name = "Exhibition"
                elif target_heat.kind is models.HeatKind.RUN_OFF:
                    round_name = "Run-off"
                else:
                    round_name = target_heat.round.name

                return TimingStats(
                    heat_id=target_heat.id,
                    round_name=round_name,
                    heat_number=0 if has_no_round else target_heat.heat_number,
                    global_heat_number=global_num,
                    lanes=lane_stats,
                    record_break=record_break,
                    recorded_at=target_heat.recorded_at,
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
    # earlier one, so `AuditExtension` has to come last to see the
    # `PermissionDeniedError` any of the three policies raise — otherwise a
    # refused mutation is turned away with nothing recorded, which is the line
    # the log most wants (#219). Measured rather than assumed; the first draft
    # had these the other way round and recorded no refusals at all.
    # `test_audit_log.py::TestRefusals` fails if they are swapped back.
    # `DemoPolicyExtension` sits between the role policy and the audit log,
    # and both neighbours matter: before `AuditExtension` so a demo refusal is
    # recorded like any other, and after `RolePolicyExtension` so it runs
    # *first* — on a demo no PIN is set, so every caller is `OPERATOR` and the
    # role policy would have allowed the mutation and reported the wrong
    # reason. Inert unless `TRUSTYTRACK_DEMO_MODE` is set; see
    # `api/demo_policy.py`.
    # `RaceLockExtension` sits at the *other* end, innermost of all four — it
    # runs last, immediately before the real resolver, so `test_race_lock.py`
    # and #585's own reasoning both depend on the role policy having already
    # let the mutation through: a `VIEWER` denied `updateHeatResult` outright
    # should hear that, not that the race happens to be locked. Still inside
    # `AuditExtension`'s wrap, so a lock refusal is recorded exactly like any
    # other. See `api/race_lock.py` for the allowed-while-locked list.
    extensions=[
        RaceLockExtension,
        RolePolicyExtension,
        DemoPolicyExtension,
        AuditExtension,
    ],
)
