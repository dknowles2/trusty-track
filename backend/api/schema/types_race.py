import typing
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Optional

import strawberry
from pydantic import ValidationError
from sqlalchemy.orm import Session
from strawberry.types import Info

from backend.db import crud, models, schemas
from backend.domain import advancement, lanes
from backend.domain import elimination as domain_elimination
from backend.domain import intermission as domain_intermission
from backend.domain import name_display as domain_name_display
from backend.domain import round_plan as domain_round_plan
from backend.domain import scoring as domain_scoring
from backend.domain import terminology as domain_terminology
from backend.domain import theme as domain_theme
from backend.domain.scale_speed import DEFAULT_SCALE
from backend.services import scoring
from backend.services.timer.manager import TimerManager

from .common import (
    Terminology,
    _loaders,
    _terminology_overrides,
    _terminology_type,
    _validation_sentence,
)
from .types_display import ReplayClip, _order_replay_clips, _stored_replay_clip


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
    def replays(self, info: Info) -> list["ReplayClip"]:
        """This heat's stored replay clips (#177 stage 2 —
        `Organization.keepReplays`), oldest first.

        Empty whether the setting is off or nothing has been uploaded
        yet for this heat — see `models.HeatReplay`'s own docstring for
        why those are the same fact told two ways, so the Schedule tab's
        ▶ needs no separate read of the setting. Off the same batched
        loader `lanes` above uses (`_loaders(info).replays_for_heat`), so
        a page of heats pays one extra query, not one per heat
        (`test_query_counts.py`).

        Sorted by the operator's own camera order (#177 stage 4,
        `_order_replay_clips`) rather than upload order — an in-memory
        registry lookup per clip, not a query, so this costs nothing extra
        against the count above.
        """
        return _order_replay_clips(
            [
                _stored_replay_clip(row)
                for row in _loaders(info).replays_for_heat(self.race_id, self.id)
            ]
        )

    @strawberry.field
    def round_number(self) -> int:
        # `self` is the ORM Heat; the round is eagerly loaded by the resolvers
        # that return heats, so this costs nothing.
        orm_heat = typing.cast(models.Heat, self)
        return orm_heat.round.round_number if orm_heat.round else 0

    @strawberry.field
    def round_name(self) -> str | None:
        orm_heat = typing.cast(models.Heat, self)
        return orm_heat.round.name if orm_heat.round else None

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
        orm_heat = typing.cast(models.Heat, self)
        if orm_heat.kind != models.HeatKind.RUN_OFF:
            return None
        return scoring.run_off_contested_rank(
            info.context["db"], self.race_id, orm_heat
        )


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
    #: The field was chosen by hand (#711) — `Round.fieldPinned`, carried
    #: here too so a screen reading this status alone can tell "these four
    #: were picked" from "these four are the current top four". When set,
    #: `advancingRacers.isAdvancing` marks the *picked* field rather than the
    #: computed one, and `fieldIsStale` and `contestedCut` are both false:
    #: a hand-picked field is meant to differ from the standings, and the
    #: operator settled any tie by picking.
    field_is_pinned: bool = False


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
    # The round whose field this status describes — this one, or the next
    # championship round when a general round previews who is on track.
    fielded_round = round_obj

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
            fielded_round = next_round

    winner_ids: set[int] = set()
    contested_cut = False
    field_is_pinned = bool(fielded_round.field_pinned)
    if field_is_pinned:
        # A hand-picked field (#711): who advances is who was picked, read
        # off the round's own lanes — not the standings, which it is meant
        # to be free to differ from. Off the loaders' existing per-race
        # batch, so this costs no query the computed path does not.
        winner_ids = {
            lane.racer_id
            for heat in loaders.heats_for_round(race_id, fielded_round.id)
            for lane in loaders.lane_values_for_heat(race_id, heat.id)
            if lane.racer_id is not None
        }
    elif requires_advancement and adv_source is not None:
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
    if (
        round_obj.advancement_source is not None
        and not round_obj.field_pinned
        and already_advanced
        and winner_ids
    ):
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
        field_is_pinned=field_is_pinned,
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
    #: The line-up was chosen by hand and the cascade leaves it alone (#711).
    #: `pinRoundField` sets it; `unpinRoundField` hands the round back to
    #: the standings. Always false for a general round.
    field_pinned: bool
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
    #: How many heats a car races per lane (#1088). Null for a round created
    #: before this column existed — `domain.round_plan.plan_from_rounds`
    #: treats that the same as `1`, the wizard's own default.
    runs_per_lane: int | None

    @strawberry.field
    def algorithm(self) -> str:
        """How this round's ``GENERAL``-format schedule is built (#1090).

        `"PPC"` or `"ROTATION"` — see `domain/schedulers`. The stored
        column is nullable and null means `PPC`; this resolver is what
        applies that default (`crud.round_algorithm`'s own rule, restated
        here since a Strawberry field resolver's `self` is the ORM row,
        not the mapper `crud` reads through — CLAUDE.md's "Strawberry
        types are duck-typed shells"), so nothing downstream of the schema
        has to know the column can be null. Meaningless for
        ``ELIMINATION``/``BALANCED`` rounds, which build their own
        schedules and never read it.
        """
        orm_round = typing.cast(models.Round, self)
        value = orm_round.algorithm  # the ORM row's column, not this method itself
        return value.value if value else models.SchedulingAlgorithm.PPC.value

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

        Null for every other scheduling strategy: general and balanced rounds
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
    #: The photo `racer_image_url`/`car_image_url` was cropped from, if any
    #: (#1241) — same "absent means leave alone" shape as everything else
    #: on this input. Null for a racer with no crop history yet.
    racer_image_original_url: str | None = None
    car_image_original_url: str | None = None
    #: JSON the server never interprets — see `models.Racer.
    #: racer_image_edit`'s own docstring for the shape (#1241).
    racer_image_edit: str | None = None
    car_image_edit: str | None = None
    race_id: int | None = None
    #: Races, but is not ranked (#548) — a sibling or parent's car, an
    #: outlaw-class entry, a demonstration run. Read in exactly one place,
    #: `services/scoring.get_leaderboard`.
    excluded_from_standings: bool = False
    #: A racer's own unit — "Pack 12" (#1076, stage 1), distinct from
    #: `racing_group_id` (the rank they race within). Free text; cleared by
    #: `clear_home_unit` below, the same shape as `car_name`.
    home_unit: str | None = None
    #: `updateRacer` used to drop an explicit `null` the same way it dropped
    #: an absent field (#747) — both arrived as Python `None` off this same
    #: `None`-defaulted input, so a screen could never tell the server "clear
    #: this" instead of "I have nothing to say about this." The fix follows
    #: this codebase's own precedent for the identical trap rather than
    #: switching to `strawberry.UNSET`: `RaceUpdateInput.clearWeightLimit`
    #: (#205), `clearTerminology` (#496) and `clearNameDisplay` (#552) all
    #: keep "absent means leave alone" and add one explicit boolean per
    #: field (or per cluster of fields sharing one on/off state) that needs
    #: a way back to null. `RacerInput` is shared by `createRacer` too,
    #: where these six have nothing to mean — a racer being created has
    #: nothing set yet to clear — so `create_racer`'s resolver discards them
    #: unread, the same way `RaceInput` (create) simply has no clear flags
    #: at all.
    clear_racing_group: bool = False
    clear_car_number: bool = False
    clear_car_name: bool = False
    clear_car_weight: bool = False
    clear_racer_image: bool = False
    clear_car_image: bool = False
    #: `home_unit`'s own clear flag (#1076, stage 1) — same shape as
    #: `clear_car_name` above.
    clear_home_unit: bool = False


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
    #: Set only by the race setup wizard's copy step (#722) — the id this
    #: group was copied from, in the *previous* race. `crud.create_race`
    #: uses it to map a copied award's `racing_group_id` from the old race to
    #: this one; it is not a column and is never stored.
    copied_from_id: int | None = None


@strawberry.input
class AwardCopyInput:
    """One award definition carried over by the race setup wizard's copy
    step (#722) — see `schemas.AwardCopyCreate`, which this maps onto
    directly. No `racer_id` field exists here at all, so a `SPECIAL` award's
    chosen winner has nowhere to ride along even by mistake (#170).
    """

    name: str
    kind: str = "SPECIAL"
    source: str | None = None
    place: int | None = None
    from_bottom: bool = False
    racing_group_id: int | None = None
    artwork_key: str | None = None
    sort_order: int | None = None
    votable: bool = False
    #: The previous race's round id this award's `source` named (#1088) —
    #: see `schemas.AwardCopyCreate.copied_from_round_id`, which this maps
    #: onto directly.
    copied_from_round_id: int | None = None


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
    #: Award definitions to create alongside the race (#722) — the setup
    #: wizard's copy step, carrying a previous race's trophies over with no
    #: recipient attached (#170). Empty (the default) creates none, which is
    #: what a `RaceForm` submission with no copy step sends.
    awards: list[AwardCopyInput] = strawberry.field(default_factory=list)
    #: The round wizard's answer, applied in the same transaction once the
    #: race and its racing groups exist (#1088) — the setup wizard's copy
    #: step, carrying a previous race's round structure over. Null (the
    #: default) creates no rounds, exactly what every caller before this
    #: field existed got. See `schemas.RaceCreate.round_plan`.
    round_plan: "WizardConfigurationInput | None" = None
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
    #: A per-race override of the organization's Display/Printables themes
    #: (#1081). Absent means leave alone; `"MATCH_APP"` here is a real
    #: override (Field Uniform, pinned to this race), distinct from
    #: inheriting — so, like `name_display` above, there is a `clear...`
    #: flag to get back to null rather than `"MATCH_APP"` doubling as both.
    display_theme: str | None = None
    printables_theme: str | None = None
    #: The explicit way back to "inherit the install's setting", for the
    #: same reason `clear_name_display` exists.
    clear_display_theme: bool = False
    clear_printables_theme: bool = False
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
    scheduling_strategy: str | None = None
    #: Ladderless elimination only: losses before a car is out. Defaults to
    #: 3, the same as `RoundCreateInput.elimination_losses`, when the
    #: strategy is ``ELIMINATION`` and this is not supplied.
    elimination_losses: int | None = None
    #: Balanced racing only: how many phases to run. Defaults to the
    #: track's lane count, the same as `RoundCreateInput.balanced_phases`,
    #: when the strategy is ``BALANCED`` and this is not supplied.
    balanced_phases: int | None = None
    #: How the round's schedule is built (#1090) — `"PPC"` or `"ROTATION"`.
    #: `None` means `PPC`, matching `RoundCreateInput.algorithm`. Not yet
    #: offered by the wizard's own UI (part D of #1090); settable here so
    #: a caller that wants something other than PPC can ask for it.
    algorithm: str | None = None


@strawberry.input
class WizardChampionshipRoundInput:
    """
    Configuration for a championship racing round in the wizard.
    """

    name: str = "Championship Round"
    source: str = "ALL"  # "ALL" (Overall) or "EACH_GROUP" (Each RacingGroup)
    num_top_racers: int = 3
    runs_per_lane: int = 1
    #: Draw the field from the bottom of the standings — a Slowest Race
    #: bracket. See `RoundCreateInput.advancement_from_bottom`.
    advancement_from_bottom: bool = False
    #: Set only when this plan came from `Race.roundPlan` for a race
    #: setup wizard's copy step (#1088) — the id of the *previous* race's
    #: championship round this entry was derived from. Not a round field;
    #: `crud.create_rounds_from_plan` reads it only to build the
    #: old-round-id-to-new-round-id map `createRace` uses to re-point a
    #: copied `ROUND:<id>` award at its own new round. Null (the ordinary
    #: case, every plan the round wizard itself builds by hand) means this
    #: entry has no previous round to remap.
    source_round_id: int | None = None
    #: "Also give one overall trophy" (#1076 stage 3) — meaningful only
    #: alongside ``source == "EACH_GROUP"``; ignored otherwise. Off by
    #: default, so an ordinary `EACH_GROUP` final (a pack's own by-den
    #: championship, not only a district's) seeds exactly the per-group set
    #: it always has unless the operator opts in. See `domain.awards.
    #: championship_award_seed`'s own `also_seed_overall` for what it adds.
    also_seed_overall_award: bool = False


@strawberry.input
class WizardConfigurationInput:
    """
    Full configuration for the race scheduling wizard.
    """

    general_round: WizardGeneralRoundInput
    championship_rounds: list[WizardChampionshipRoundInput]


@strawberry.type
class WizardGeneralRound:
    """Mirrors `WizardGeneralRoundInput` — see `WizardConfiguration`."""

    type: str
    scheduling_strategy: str
    runs_per_lane: int
    elimination_losses: int | None
    balanced_phases: int | None
    #: How the round's schedule is built (#1090) — see `Round.algorithm`.
    algorithm: str


@strawberry.type
class WizardChampionshipRound:
    """Mirrors `WizardChampionshipRoundInput`, plus `source_round_id` — see
    `WizardConfiguration`."""

    name: str
    source: str
    num_top_racers: int
    runs_per_lane: int
    advancement_from_bottom: bool
    #: This championship round's own id, in the race `Race.roundPlan` was
    #: read off of (#1088) — an *output* field, unlike the identically
    #: named field on `WizardChampionshipRoundInput`, which is an input a
    #: caller sets. `raceSetup.copyableAwards` reads this to build a copied
    #: award's `copiedFromRoundId`, and a resubmitted `RaceInput.roundPlan`
    #: carries it straight back as that input field — the round trip is
    #: the whole reason the two fields share a name.
    source_round_id: int


@strawberry.type
class WizardConfiguration:
    """Mirrors `WizardConfigurationInput` — the round wizard's answer,
    derived back out of a race's existing rounds (#1088). See
    `domain.round_plan.plan_from_rounds`, which this is a thin Strawberry
    shell over. Strawberry does not let an `@strawberry.input` double as an
    `@strawberry.type`, hence the separate (but field-for-field identical,
    barring `source_round_id`) output types above."""

    general_round: WizardGeneralRound
    championship_rounds: list[WizardChampionshipRound]


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
        raise ValueError(_validation_sentence(exc)) from exc


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
    #: Whether this race has ever recorded a time on any official heat
    #: (#1329) — `backend.domain.scoring.has_any_recorded_time`, over every
    #: lane this payload's own heats cover. A pure `POINTS` race with no
    #: timer at all is a supported configuration (see `.claude/rules/
    #: scoring.md`), and this is the one fact the Stats page (Lane
    #: Fairness, Top Moments) and the Displays panel (`Race.hasRecordedTimes`
    #: — the same predicate, the same loader) both ask rather than each
    #: guessing from a different signal.
    has_recorded_times: bool


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
    #: A racer's own unit — "Pack 12" (#1076, stage 1). `None` on every
    #: racer at an ordinary single-pack race.
    home_unit: str | None
    score: float
    heats_completed: int
    #: How many of `heatsCompleted` were an actual DNF rather than a genuine
    #: slow finish (#898). `TIMED`/`CUMULATIVE_TIME` substitute the DNF
    #: penalty for the missing time before `score` is ever computed, so a
    #: real DNF and a genuine 9.999s-or-slower finish reach this field as
    #: the identical number — carried here rather than guessed from `score`,
    #: which #873/#897 settled a display must never do. Populated under
    #: every strategy, including `POINTS` (where a DNF is already scored as
    #: last place in its heat, #225) — the frontend's `dnfAnnotation` is what
    #: decides `POINTS` has nothing worth adding to an already-accurate
    #: score. Always `0` for an elimination round's own leaderboard, which
    #: scores survival rather than calling `domain.scoring.score_heats` at
    #: all.
    dnf_count: int
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

    scheduling_strategy: str = "GENERAL"
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
    #: How a ``GENERAL`` round's schedule is built (#1090) — `"PPC"` or
    #: `"ROTATION"`. `None` means `PPC`, the default and the only algorithm
    #: every round created before this field existed used. Meaningless for
    #: ``ELIMINATION``/``BALANCED``, which build their own schedules.
    algorithm: str | None = None


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
    #: The photo `racer_image_url`/`car_image_url` was cropped from, if any
    #: (#1241). Null for every racer until the first Rotate / Recrop,
    #: camera capture, or bulk photo assignment on that side.
    racer_image_original_url: str | None
    car_image_original_url: str | None
    #: JSON the server never interprets — see `models.Racer.
    #: racer_image_edit`'s own docstring for the shape (#1241).
    racer_image_edit: str | None
    car_image_edit: str | None
    racing_group_id: int | None
    race_id: int
    #: Races, but is not ranked (#548). `services/scoring.get_leaderboard`
    #: drops this racer before ranking; heat generation, admission,
    #: withdrawal and the live heat view are untouched and still read
    #: check-in — this is not a second way to say "not racing".
    excluded_from_standings: bool
    #: A racer's own unit — "Pack 12" (#1076, stage 1). `None` on every
    #: racer until an operator sets one, which is every racer at a single-
    #: pack race — nothing here reads it except a surface that already
    #: checks it is non-empty before rendering anything.
    home_unit: str | None

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
    #: Whether this break is showing the current round's stored replay
    #: clips instead of the ordinary next-up preview (#177 stage 3) — see
    #: `startIntermission`'s own docstring for how it gets set, and
    #: `.claude/rules/displays.md`'s "Intermission highlights" for what a
    #: display does with it.
    highlights: bool = False


@strawberry.type
class HighlightsSummary:
    """What Race Control's intermission card names while a highlights break
    runs — "Highlights: 8 clips from Round 2" (#177 stage 3).

    Deliberately a **separate**, much smaller implementation from
    `features/observation/highlights.ts`'s own `highlightRoundId` —
    ordering, captions and which camera to use all stay frontend-only, pure
    and unit-tested there; this only has to name *which* round and *how
    many* clips, the two facts `IntermissionControl.tsx` shows before a
    break even has a reel to play. Re-deriving that from a full
    heats+lanes+replays query in three separate `IntermissionControl`
    mounts (`RaceExecution.tsx` renders one per screen state) was measured
    against this and rejected — the same "a rule split across two
    languages has no single file either can import" tradeoff
    `domain.name_display.format_display_name` documents for its own
    Python/TypeScript split, applied to a much smaller rule than that one.
    """

    clip_count: int
    round_number: int
    round_name: str | None


def _highlights_summary(info: Info, race_id: int) -> HighlightsSummary | None:
    """The round-selection half of `highlightRoundId` (the current round is
    the last recorded heat's round, or — nothing recorded yet — the latest
    round with any stored clip), plus a count of that round's heats that
    hold one. `None` when nothing in the race has a clip. Off the same
    batched `heats_for_race`/`replays_for_heat` loaders `Heat.replays` and
    `Race.replayCount` already use, so this costs no extra query beyond
    whichever of those a caller reaches first.
    """
    loaders = _loaders(info)
    heats = loaders.heats_for_race(race_id)
    if not heats:
        return None

    recorded = [h for h in heats if h.recorded_at is not None]
    target: models.Heat | None
    if recorded:
        target = max(recorded, key=lambda h: h.recorded_at or "")
    else:
        with_clips = [
            h for h in heats if loaders.replays_for_heat(race_id, h.id) and h.round
        ]
        target = (
            max(with_clips, key=lambda h: h.round.round_number if h.round else 0)
            if with_clips
            else None
        )
    if target is None or target.round is None:
        return None

    clip_count = sum(
        1
        for h in heats
        if h.round_id == target.round_id and loaders.replays_for_heat(race_id, h.id)
    )
    if clip_count == 0:
        return None
    return HighlightsSummary(
        clip_count=clip_count,
        round_number=target.round.round_number,
        round_name=target.round.name,
    )


def _intermission_type(race: models.Race, now: datetime) -> Intermission:
    resolved = domain_intermission.resolve(
        domain_intermission.State(
            ends_at=race.intermission_ends_at,
            paused_remaining_seconds=race.intermission_paused_remaining_seconds,
            label=race.intermission_label,
            highlights=race.intermission_highlights,
        ),
        now,
    )
    return Intermission(
        active=resolved.active,
        remaining_seconds=resolved.remaining_seconds,
        paused=resolved.paused,
        label=resolved.label,
        ends_at=resolved.ends_at,
        highlights=resolved.highlights,
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
    #: This race's raw Display/Printables theme overrides (#1081), null
    #: where it inherits the install's setting from System Settings — what
    #: the race edit form's pickers read back, distinct from
    #: `resolvedPrintablesTheme` below. There is no `resolvedDisplayTheme`
    #: here: the one real consumer of a race's resolved *Display* theme is
    #: the `displayAssignment` subscription, which already carries a race id
    #: and resolves against the database row directly rather than through
    #: this type — see `_display_theme_setting`.
    display_theme: str | None
    printables_theme: str | None
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
    def replay_count(self, info: Info) -> int:
        """How many stored replay clips this race holds in total (#177
        stage 3) — what `IntermissionControl.tsx` reads, alongside
        `initialConfig.keepReplays`, to decide whether "Show replay
        highlights" is worth offering at all. Batched the same way
        `Heat.replays` is (`RequestLoaders.replay_count_for_race`), so
        asking this alongside a page of heats costs one query, not one
        per heat.
        """
        return _loaders(info).replay_count_for_race(self.id)

    @strawberry.field
    def highlights_summary(self, info: Info) -> HighlightsSummary | None:
        """ "Highlights: 8 clips from Round 2" — what `IntermissionControl.tsx`
        shows in the intermission card while a highlights break runs. See
        `_highlights_summary`.
        """
        return _highlights_summary(info, self.id)

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
    def resolved_printables_theme(self, info: Info) -> str:
        """Which Printables theme this race's pit passes, licences, heat
        sheets and certificates actually print in, fully resolved (#1081).

        A race override layered over the organization's install-wide
        setting — see `domain.theme.resolve_theme_setting`. Every printed
        page reads this (never the raw `printablesTheme` override, and
        never `initialConfig.printablesTheme`) so the layering happens in
        exactly one place, the same reasoning `resolvedNameDisplay` and
        `terminology` above follow — an organization row a printable's own
        query never otherwise touches, loaded through the same per-operation
        loader those two already prime.
        """
        organization = _loaders(info).organization_by_id(self.organization_id)
        return domain_theme.resolve_theme_setting(
            organization_setting=organization.printables_theme
            if organization
            else "MATCH_APP",
            race_override=self.printables_theme,
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
    def home_unit_label(self, info: Info) -> str:
        """What to call a racer's own unit — "Home Pack" (#1076, stage 1).

        Deliberately **not** `terminology` above: that field is this race's
        own resolved organization word, which at a district event is
        overridden to "District" — the word the *event* is called by. A
        racer's home unit is the *ordinary* organization word instead, so
        this resolves terminology against the organization layer only,
        never this race's own override, the one place in the app that reads
        `resolve_terminology` with `race=None` on purpose. No new
        terminology column: an operator who wants a different word for this
        (a council running "Home Troop" for a combined event) renames the
        *organization's* own word in System Settings, same as every other
        install-wide default.
        """
        organization = _loaders(info).organization_by_id(self.organization_id)
        resolved = domain_terminology.resolve_terminology(
            organization=_terminology_overrides(organization) if organization else None
        )
        return f"Home {resolved.organization_singular}"

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
        """Get the number of registered racers.

        Through `RequestLoaders.racer_counts_for_race` (#749) — `Query.races`
        primes every race's counts in one grouped query before this runs, so
        the Home page's list does not scale with how many races the install
        has ever run.
        """
        return _loaders(info).racer_counts_for_race(self.id)[0]

    @strawberry.field
    def checked_in_count(self, info: Info) -> int:
        """Get the number of checked-in racers. See `registered_count`."""
        return _loaders(info).racer_counts_for_race(self.id)[1]

    @strawberry.field
    def status(self, info: Info) -> str:
        """Whether this race's schedule has been run yet — ``NOT_STARTED``,
        ``IN_PROGRESS`` or ``FINISHED`` (#847), for Home's per-race badge.

        Computed on demand from the race's official heats, never stored —
        the same rule the standings (#17), a `SPEED` award's recipient
        (#170) and the track records all follow, so a corrected or deleted
        result cannot leave a stale word on screen. See
        `domain.race_status` for which of the three heat predicates this
        reuses and why the other two answer a different question; batched
        through `RequestLoaders.prime_race_status` for the same reason
        `registered_count`/`checked_in_count` are (#749) — see
        `.claude/rules/roster.md`'s "The Home page race list".
        """
        return _loaders(info).race_status_for_race(self.id)

    @strawberry.field
    def has_recorded_times(self, info: Info) -> bool:
        """Whether this race has ever recorded a time on any official heat
        (#1329) — the same predicate and the same loader `RaceStats.
        hasRecordedTimes` reads, exposed here too since the Displays panel
        does not query `raceStats` at all. See `RequestLoaders.
        has_recorded_time_for_race`.
        """
        return _loaders(info).has_recorded_time_for_race(self.id)

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
    def round_plan(self, info: Info) -> WizardConfiguration | None:
        """The round wizard's answer that would have built this race's
        rounds (#1088) — `domain.round_plan.plan_from_rounds`, reading off
        the same per-race batch `rounds` above serves from, so asking for
        this costs nothing beyond that query. `None` for a race with no
        rounds yet, the same as a race whose wizard was never run.

        This is what the race setup wizard's copy step reads to build a
        new race's own `RaceInput.roundPlan`, and what `raceSetup.
        copyableAwards` reads `championshipRounds[].sourceRoundId` off of
        to remap a copied `ROUND:<id>` award.
        """
        rounds = _loaders(info).rounds_for_race(self.id)
        facts = [
            domain_round_plan.RoundFact(
                id=r.id,
                round_number=r.round_number,
                name=r.name,
                scheduling_strategy=r.scheduling_strategy,
                advancement_source=r.advancement_source,
                advancement_num_racers=r.advancement_num_racers,
                advancement_from_bottom=r.advancement_from_bottom,
                elimination_losses=r.elimination_losses,
                balanced_phases=r.balanced_phases,
                runs_per_lane=r.runs_per_lane,
                algorithm=(
                    r.algorithm.value
                    if r.algorithm
                    else models.SchedulingAlgorithm.PPC.value
                ),
            )
            for r in rounds
        ]
        plan = domain_round_plan.plan_from_rounds(facts)
        if plan is None:
            return None
        return WizardConfiguration(
            general_round=WizardGeneralRound(
                type=plan.general_round.type,
                scheduling_strategy=plan.general_round.scheduling_strategy,
                runs_per_lane=plan.general_round.runs_per_lane,
                elimination_losses=plan.general_round.elimination_losses,
                balanced_phases=plan.general_round.balanced_phases,
                algorithm=plan.general_round.algorithm,
            ),
            championship_rounds=[
                WizardChampionshipRound(
                    name=c.name,
                    source=c.source,
                    num_top_racers=c.num_top_racers,
                    runs_per_lane=c.runs_per_lane,
                    advancement_from_bottom=c.advancement_from_bottom,
                    source_round_id=c.source_round_id,
                )
                for c in plan.championship_rounds
            ],
        )

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
