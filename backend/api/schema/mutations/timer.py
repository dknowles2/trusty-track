import typing
from typing import Annotated, Any

import strawberry
from sqlalchemy.orm import Session
from strawberry.types import Info

from backend.db import crud, models
from backend.domain import audit
from backend.services.timer.devices import fake as fake_timer
from backend.services.timer.devices.base import (
    LaneResult as TimerLaneResult,
)
from backend.services.timer.devices.base import RaceStarted
from backend.services.timer.state_machine import TimerState

from ..common import (
    _publish_race_state_pkg,
    _revalidate_timers,
    _start_backend_direct_pkg,
)
from ..enums import RaceChangeKind
from ..pubsub_helpers import _purge_older_replays
from ..types_race import (
    Heat,
    HeatLaneInput,
    _heat_and_manager,
    _lanes_from_input,
    _stored_lanes,
)


@strawberry.type
class TimerMutations:
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
        _start_backend_direct_pkg(mgr, track.serial_port)
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
        track = crud.get_track(db, race.track_id) if race.track_id is not None else None
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

        # This heat is now the one that might get a replay clip; the heat
        # that just finished has had its turn (#177 stage 1a).
        await _purge_older_replays(db, race.id, heat_id)

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
            # An earlier heat's replay clip is now stale (#177 stage 1a).
            # This heat's own clip has not been uploaded yet — it arrives a
            # second or two after this returns — so it is never what this
            # call removes.
            await _purge_older_replays(db, updated_heat.race_id, heat_id)
            await _publish_race_state_pkg(
                updated_heat.race_id,
                kind=RaceChangeKind.HEAT_RESULT,
                heat=updated_heat,
                round_id=updated_heat.round_id,
            )
        return updated_heat
