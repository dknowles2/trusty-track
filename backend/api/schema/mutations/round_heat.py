import typing
from typing import Annotated, Any

import strawberry
from pydantic import ValidationError
from strawberry.types import Info

from backend.db import crud, models, schemas
from backend.domain import audit, lanes
from backend.services import scoring

from ..common import (
    _device_for,
    _manager_for,
    _publish_race_state_pkg,
    _revalidate_timers,
    _start_backend_direct_pkg,
    _validation_sentence,
)
from ..enums import RaceChangeKind
from ..pubsub_helpers import _purge_older_replays
from ..types_race import (
    FreeRaceHeat,
    FreeRaceLaneAssignmentInput,
    Heat,
    HeatLaneInput,
    HeatReorderItemInput,
    HeatReorderResponse,
    Round,
    RoundCreateInput,
    RunOffHeat,
    Track,
    TrackInput,
    WizardConfigurationInput,
    _lanes_from_input,
)


@strawberry.type
class TrackLaneMutations:
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

        Refused, before any outage row is written, if it would leave an
        unraced elimination or balanced round with fewer than two usable
        lanes — those formats need an opponent, and `crud.set_lane_outages`
        raises naming the round rather than the change being committed and
        the "nobody has raced it" case above raising three calls later with
        the outages already in place and nothing to say why (#877).
        """
        db = info.context["db"]
        outages = crud.set_lane_outages(db, track_id, lanes)
        crud.apply_outages_to_scheduled_heats(db, track_id)
        # Regenerating a round replaces its heats, so anything armed against the
        # old ids has to be told (#50). Same reason `updateHeatResult` and
        # `regenerateRound` call it.
        await _revalidate_timers(info)
        for race in db.query(models.Race).filter(models.Race.track_id == track_id):
            await _publish_race_state_pkg(race.id)
        return outages


@strawberry.type
class RoundHeatMutations:
    # Track Mutations
    @strawberry.mutation
    async def create_track(self, info: Info, track: TrackInput) -> Track:
        """Create a new track and its associated TimerManager."""
        db = info.context["db"]
        try:
            track_in = schemas.TrackCreate(**typing.cast(Any, strawberry.asdict(track)))
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
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
                _start_backend_direct_pkg(mgr, new_track.serial_port)

        return new_track

    @strawberry.mutation
    async def update_track(
        self, info: Info, id: int, track: TrackInput
    ) -> Track | None:
        """Update an existing track.

        Shrinking `lane_count` is brought into line the same way `setLaneOutages`
        brings a newly out-of-service lane into line (#325): existing heats can
        hold racers on lanes that no longer exist, and nothing else notices.

        Refuses the whole update — before anything is written — if shrinking
        would leave an unraced elimination or balanced round with fewer than
        two usable lanes; see `crud.guard_against_stranding_a_round` (#877).
        Checked ahead of `crud.update_track` rather than after, so a refusal
        leaves the track's row untouched instead of landing with the new
        `lane_count` already committed and only the schedule left stale.
        """
        db = info.context["db"]
        db_track = crud.get_track(db, id)
        if not db_track:
            return None

        old_timer_type = db_track.timer_type
        old_serial_port = db_track.serial_port
        old_profile = db_track.timer_profile
        old_lane_count = db_track.lane_count

        if track.lane_count < old_lane_count:
            crud.guard_against_stranding_a_round(
                db,
                id,
                lane_count=track.lane_count,
                out_of_service=crud.lane_outages_for_track(db, id),
            )

        try:
            track_update = schemas.TrackBase(
                **typing.cast(Any, strawberry.asdict(track))
            )
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
        updated_track = typing.cast(Any, crud.update_track(db, db_track, track_update))

        if track.lane_count < old_lane_count:
            crud.apply_outages_to_scheduled_heats(db, id)
            # Regenerating a round replaces its heats, so anything armed
            # against the old ids has to be told (#50) — the same call
            # `setLaneOutages` makes for the same reason.
            await _revalidate_timers(info)
            for race in db.query(models.Race).filter(models.Race.track_id == id):
                await _publish_race_state_pkg(race.id)

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
                    _start_backend_direct_pkg(
                        mgr,
                        track.serial_port,
                        device if track.timer_profile else None,
                    )
            elif old_timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                # Stopped being backend-direct, ensure it's closed
                await mgr.stop()

        return updated_track

    @strawberry.mutation
    async def delete_track(self, info: Info, id: int) -> bool:
        """Delete a track."""
        db = info.context["db"]
        try:
            deleted = crud.delete_track(db, track_id=id)
        except ValueError:
            return False
        if deleted:
            timer_managers = info.context.get("timer_managers")
            if timer_managers is None:
                from backend.api.main import TIMER_MANAGERS

                timer_managers = TIMER_MANAGERS
            mgr = timer_managers.pop(id, None)
            if mgr:
                await mgr.stop()
        return deleted

    # Round / Schedule Mutations
    @strawberry.mutation
    async def create_round_wizard(
        self, info: Info, race_id: int, config: WizardConfigurationInput
    ) -> list[Round]:
        """Create rounds using the wizard logic.

        A thin wrapper over `crud.create_rounds_from_plan` (#1088) — that
        function is this mutation's own body, factored out so `createRace`'s
        copy step can build a copied round plan's rounds too, in the same
        transaction as the race itself. Behaviour here is unchanged; the
        wizard's own tests are the proof.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        existing_rounds = crud.get_rounds(db, race_id)
        if existing_rounds:
            raise ValueError("Cannot use wizard: rounds already exist for this race.")

        plan = schemas.WizardConfigurationCreate(
            **typing.cast(Any, strawberry.asdict(config))
        )
        created_rounds: list[models.Round] = []
        try:
            created_rounds, _ = crud.create_rounds_from_plan(db, race, plan)
            # Championship trophies (#1082): the moment a final exists to
            # point them at, seed one SPEED award per place. Presence —
            # `seed_championship_awards`' own guard — is what keeps this
            # from ever adding a second set, not whether the wizard has run
            # before; `created_rounds[-1]` is the last championship round
            # just built above, matching #862's "the last championship
            # round" convention rather than `ALL`.
            if config.championship_rounds:
                crud.seed_championship_awards(
                    db,
                    created_rounds[-1],
                    also_seed_overall_award=config.championship_rounds[
                        -1
                    ].also_seed_overall_award,
                )
        except ValueError as e:
            # `create_rounds_from_plan` already rolls back anything it
            # created on its own failure, leaving `created_rounds` at its
            # initial `[]` — this covers the (practically unreachable)
            # case of the seeding call above failing after a successful
            # plan, the same defensive backstop the wizard always had.
            for r in reversed(created_rounds):
                crud.delete_round(db, r.id)
            raise e

        db.commit()
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.SCHEDULE)
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

        # (#1016) With its own heats gone, a championship round falls back
        # to placeholders — `_participant_ids_for_round` only finds "already
        # advanced" racers by reading the heats that regeneration just
        # deleted. Nothing then refills it until some *other* round's result
        # happens to trigger the cascade. `populate_round_if_decided` is the
        # one asker (#248): it asks about the state of the race *now*, the
        # same question `createRound` already asks right after generating a
        # championship round's placeholder heats, above.
        if round_obj.advancement_source and crud.populate_round_if_decided(
            db, round_obj
        ):
            # A short field (#48) rebuilds the round's heats rather than
            # filling placeholders in place — re-read them so the mutation's
            # own return value is not the deleted, placeholder-holding rows
            # `generate_heats_for_round` returned above.
            heats = crud.get_heats(db, round_obj.race_id, round_id)

        await _revalidate_timers(info)
        await _publish_race_state_pkg(
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
            await _publish_race_state_pkg(race_id, kind=RaceChangeKind.SCHEDULE)
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
            await _publish_race_state_pkg(race_id, kind=RaceChangeKind.SCHEDULE)
        return result

    @strawberry.mutation
    async def delete_free_race_heat(self, info: Info, heat_id: int) -> bool:
        """Delete a single free race heat.

        Calls `_revalidate_timers` for the same reason `deleteHeat` and
        `deleteRunOffHeat` do (#887): the operator may have armed this heat
        and then changed their mind rather than running it, and without this
        the manager stayed `ARMED` on a heat row that no longer existed —
        discovered only after the cars ran, through `_record_results`'
        `_abandon_run`, holding times the operator then had to key in by
        hand (#50).
        """
        db = info.context["db"]
        heat = crud.get_free_race_heat(db, heat_id)
        race_id = heat.race_id if heat else None
        try:
            result = crud.delete_free_race_heat(db, heat_id)
        except ValueError:
            return False
        await _revalidate_timers(info)
        if race_id:
            await _publish_race_state_pkg(race_id)
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
        await _publish_race_state_pkg(race_id)
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
            await _publish_race_state_pkg(race_id)
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
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.SCHEDULE, round_id=round_id
        )
        return len(winner_ids)

    @strawberry.mutation
    async def pin_round_field(
        self, info: Info, race_id: int, round_id: int, racer_ids: list[int]
    ) -> Round:
        """Choose a championship round's line-up by hand, and keep it (#711).

        The round is rebuilt for exactly these racers and pinned, so the
        recorded-result cascade — which otherwise re-fields every unraced
        championship round on every result — leaves it alone. Refused for a
        general round, for a round already raced, and for a pick
        `domain.advancement.hand_pick_problem` rejects (fewer than two, a
        duplicate, a racer not checked in), each reaching the caller as an
        ordinary GraphQL error carrying the sentence, the same shape
        `createRunOffHeat` takes.

        Timers are revalidated because this re-fields heats an operator may
        have armed (#50).
        """
        db = info.context["db"]
        round_obj = crud.pin_round_field(db, round_id, racer_ids)
        await _revalidate_timers(info)
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.SCHEDULE, round_id=round_id
        )
        return typing.cast(Any, round_obj)

    @strawberry.mutation
    async def unpin_round_field(self, info: Info, race_id: int, round_id: int) -> Round:
        """Hand a hand-picked line-up back to the standings (#711).

        An unraced round is re-fielded from the standings as they stand now;
        a raced one only loses the pin, and shows **Line-up out of date** if
        the picked field differs from who would advance today.
        """
        db = info.context["db"]
        round_obj = crud.unpin_round_field(db, round_id)
        await _revalidate_timers(info)
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.SCHEDULE, round_id=round_id
        )
        return typing.cast(Any, round_obj)


@strawberry.type
class RoundScheduleMutations:
    @strawberry.mutation
    async def create_round(
        self, info: Info, race_id: int, round_data: RoundCreateInput
    ) -> list[Round]:
        """Create a new round and generate heats."""
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        # Every round created below is committed the moment `create_round`
        # makes it, so a failure partway through — heat generation on a
        # second den's round, say — must roll every round made so far back,
        # not just the last one (#249, #1013/#1025): "By {group}" can now
        # hand this single mutation back more than one round in one call.
        created_rounds: list[models.Round] = []
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

            if round_data.advancement_source is None:
                # General Round(s) — one call, whichever format was asked
                # for. Before #1013 this branch never read `general_type` at
                # all, so choosing "By {group}" from the Add Round dialog
                # silently built one mixed round instead of one per group;
                # `crud.create_general_round` is now the one copy of that
                # loop, shared with `createRoundWizard`.
                strategy = models.SchedulingStrategy(round_data.scheduling_strategy)
                is_elimination = strategy == models.SchedulingStrategy.ELIMINATION
                is_balanced = strategy == models.SchedulingStrategy.BALANCED
                if (is_elimination or is_balanced) and len(
                    crud.usable_lanes_for_race(db, race_id)
                ) < 2:
                    raise ValueError(
                        "An elimination or balanced round requires at least"
                        " two usable lanes."
                    )
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
                # "By {group}" is offered only alongside "Everyone races in
                # every lane" (`RoundConfigModal` hides the Format picker for
                # the other two styles) — so a non-`GENERAL` general round is
                # always "ALL", whatever the caller sent, matching the
                # wizard's own belt-and-braces rule.
                general_type = (
                    round_data.general_type
                    if strategy == models.SchedulingStrategy.GENERAL
                    else "ALL"
                )
                # Only reached for a general round with no name typed —
                # otherwise this would be a query the operator's own choice
                # makes unnecessary on every round they name themselves. Not
                # read at all for "EACH_GROUP": each round there is named
                # after its own racing group (`create_general_round`).
                round_name = round_data.name or (
                    "Elimination Round"
                    if is_elimination
                    else "Balanced Round"
                    if is_balanced
                    else None
                )
                general_rounds = crud.create_general_round(
                    db,
                    race,
                    next_round_number,
                    strategy,
                    general_type,
                    name=round_name,
                    runs_per_lane=round_data.runs_per_lane,
                    elimination_losses=losses,
                    balanced_phases=phases,
                    algorithm=round_data.algorithm,
                )
                created_rounds.extend(general_rounds)
                await _publish_race_state_pkg(race_id, kind=RaceChangeKind.SCHEDULE)
                return typing.cast(Any, general_rounds)
            else:
                # Championship Round (Placeholder)
                crud.validate_advancement_source(
                    db, race_id, round_data.advancement_source
                )
                # "ALL"/"EACH_GROUP" has no candidate to ever fill it when
                # the race's own qualifying round is an Elimination round
                # (#1054) — `createRoundWizard` already protects itself
                # against this (#1012); this door shares the same rule
                # through `crud.resolve_championship_source_for_race` rather
                # than growing a second, unwired copy of it (CLAUDE.md's
                # #48). Resolved after validation, not instead of it: the
                # requested source still has to be real vocabulary before
                # anything asks what it should actually mean.
                resolved_source = crud.resolve_championship_source_for_race(
                    db, race_id, round_data.advancement_source
                )
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
                    advancement_source=resolved_source,
                    advancement_num_racers=round_data.advancement_num_racers,
                    advancement_from_bottom=round_data.advancement_from_bottom,
                    runs_per_lane=round_data.runs_per_lane,
                    algorithm=round_data.algorithm,
                )
                created_rounds.append(round_obj)

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
                # Championship trophies (#1082): a championship round added
                # through this door — the Add Round dialog, after the wizard
                # already ran or was skipped entirely — is exactly as much
                # "a final exists to point trophies at" as the wizard's own.
                # `seed_championship_awards` is the one guard against
                # seeding a race that already has a SPEED award, so this is
                # unconditional rather than checked here too (CLAUDE.md's
                # #48: one rule, not a second copy of when it applies).
                crud.seed_championship_awards(db, round_obj)
                await _publish_race_state_pkg(race_id, kind=RaceChangeKind.SCHEDULE)
                return [typing.cast(Any, round_obj)]
        except ValueError:
            # `create_round` commits immediately (backend/db/crud.py), so a
            # round joins the rollback the moment its row exists — the
            # wizard's rule (#249), applied to its single-round sibling
            # (#415) and now, since "By {group}" can create several rounds
            # in one call, in the same reverse order the wizard itself uses.
            for r in reversed(created_rounds):
                crud.delete_round(db, r.id)
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
            await _publish_race_state_pkg(
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
            await _publish_race_state_pkg(race_id, kind=RaceChangeKind.SCHEDULE)
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
        await _publish_race_state_pkg(race_id)
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
            await _purge_older_replays(db, updated.race_id, heat_id)
            await _publish_race_state_pkg(updated.race_id)
        return updated
