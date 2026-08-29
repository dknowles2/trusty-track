"""Arming a different heat mid-run must not swap the active heat (#337).

``TimerManager.prepare_heat`` had no state guard: while heat A was RUNNING
(cars on the track), preparing heat B unconditionally swapped
``_active_heat_id``, cleared ``_pending_results`` and transitioned to ARMED.
Heat A's finish-line results then arrived; the ``LaneResult`` handler treats
ARMED→RUNNING as a legitimate start (needed for timers with no start signal),
collected them, and wrote them into heat B. The staleness guard in
``_record_results`` passed, because heat B's lanes genuinely matched what heat
B was armed with — the times just belonged to different cars.

These go through the GraphQL layer, the same way ``test_timer_panic_mutations``
and ``test_timer_stale_heat``'s ``TestProactiveDisarm`` do — the guard lives in
the ``prepareHeat`` resolver, not in ``TimerManager.prepare_heat`` itself,
which stays the low-level primitive several unit tests re-arm directly (e.g.
switching heats while merely ARMED, in ``test_timer_gate_watcher.py``).
"""

import pytest
from fastapi.testclient import TestClient

from backend.api.main import TIMER_MANAGERS, app
from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState
from backend.tests.helpers import as_lanes, lane_dicts

client = TestClient(app)

PREPARE_HEAT = """
    mutation($heatId: Int!) { prepareHeat(heatId: $heatId) }
"""


@pytest.fixture(autouse=True)
def registered_manager():
    """Own `TIMER_MANAGERS` for the module — it is a process-wide dict."""
    saved = dict(TIMER_MANAGERS)
    TIMER_MANAGERS.clear()
    yield
    TIMER_MANAGERS.clear()
    TIMER_MANAGERS.update(saved)


def _race(db):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Guard Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Guard Track", lane_count=2, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Guard Race",
            organization_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    return race, track


def _heat(db, race, heat_number):
    round_obj = crud.get_rounds(db, race.id)
    if not round_obj:
        round_obj = [crud.create_round(db, race_id=race.id, round_number=1)]
    heat = models.Heat(
        race_id=race.id, round_id=round_obj[0].id, heat_number=heat_number
    )
    db.add(heat)
    db.flush()
    a = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=f"A{heat_number}", last_name="R", race_id=race.id
        ),
    )
    b = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=f"B{heat_number}", last_name="R", race_id=race.id
        ),
    )
    crud.set_heat_lanes(
        heat,
        as_lanes(
            [
                {"lane": 1, "racer_id": a.id, "time": None, "place": None},
                {"lane": 2, "racer_id": b.id, "time": None, "place": None},
            ]
        ),
    )
    db.commit()
    return heat


def _mutate(query, variables):
    resp = client.post("/graphql", json={"query": query, "variables": variables})
    assert resp.status_code == 200
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    return body["data"]


class TestPrepareHeatGuard:
    async def _arm_and_start(self, db, mgr, heat):
        racer_by_lane = {
            lane.lane: lane.racer_id
            for lane in crud.heat_lanes_of(db, heat)
            if lane.racer_id is not None
        }
        mask = 0
        for lane_no in racer_by_lane:
            mask |= 1 << (lane_no - 1)
        await mgr.prepare_heat(
            heat.id,
            models.HeatKind.OFFICIAL,
            lane_mask=mask,
            racer_by_lane=racer_by_lane,
        )
        await mgr.inject_event(RaceStarted())
        assert mgr._state is TimerState.RUNNING

    async def test_preparing_a_different_heat_while_running_is_refused(
        self, db, timer_session_factory
    ):
        race, track = _race(db)
        heat_a = _heat(db, race, 1)
        heat_b = _heat(db, race, 2)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await self._arm_and_start(db, mgr, heat_a)

        result = _mutate(PREPARE_HEAT, {"heatId": heat_b.id})

        assert result["prepareHeat"] is False
        assert mgr._state is TimerState.RUNNING
        assert mgr._active_heat_id == heat_a.id

        # Heat A's own finish-line results still arrive, and must still land
        # on heat A rather than the heat B the refused mutation left alone.
        await mgr.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))
        await mgr.inject_event(LaneResult(lane=2, time_seconds=3.2, place=2))

        db.expire_all()
        recorded_a = db.query(models.Heat).filter(models.Heat.id == heat_a.id).one()
        assert [r["time"] for r in lane_dicts(db, recorded_a)] == [3.1, 3.2]

        untouched_b = db.query(models.Heat).filter(models.Heat.id == heat_b.id).one()
        assert all(r.get("time") is None for r in lane_dicts(db, untouched_b)), (
            "a refused prepareHeat must not leave heat B holding heat A's times"
        )

    async def test_preparing_the_same_heat_while_running_is_still_allowed(
        self, db, timer_session_factory
    ):
        """ "Reset Heat" on the operator screen re-arms the *active* heat while
        it is running, to abandon a stuck run and retry it. The guard must not
        catch this — only a switch to a different heat.
        """
        race, track = _race(db)
        heat = _heat(db, race, 1)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await self._arm_and_start(db, mgr, heat)

        result = _mutate(PREPARE_HEAT, {"heatId": heat.id})

        assert result["prepareHeat"] is True
        assert mgr._state is TimerState.ARMED
        assert mgr._active_heat_id == heat.id
        assert mgr._pending_results == {}

    async def test_preparing_a_different_heat_while_merely_armed_still_works(
        self, db, timer_session_factory
    ):
        """Switching before the gate opens is the ordinary "wrong heat
        selected" correction, and must stay unaffected."""
        race, track = _race(db)
        heat_a = _heat(db, race, 1)
        heat_b = _heat(db, race, 2)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        racer_by_lane = {
            lane.lane: lane.racer_id
            for lane in crud.heat_lanes_of(db, heat_a)
            if lane.racer_id is not None
        }
        await mgr.prepare_heat(
            heat_a.id,
            models.HeatKind.OFFICIAL,
            lane_mask=0b11,
            racer_by_lane=racer_by_lane,
        )
        assert mgr._state is TimerState.ARMED

        result = _mutate(PREPARE_HEAT, {"heatId": heat_b.id})

        assert result["prepareHeat"] is True
        assert mgr._state is TimerState.ARMED
        assert mgr._active_heat_id == heat_b.id

    async def test_preparing_a_different_heat_while_results_are_overdue_is_refused(
        self, db, timer_session_factory
    ):
        race, track = _race(db)
        heat_a = _heat(db, race, 1)
        heat_b = _heat(db, race, 2)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await self._arm_and_start(db, mgr, heat_a)
        # The watchdog gives up waiting and the device is asked to flush what
        # it has, rather than actually waiting out the real timeout here.
        mgr._state = TimerState.RESULTS_OVERDUE

        result = _mutate(PREPARE_HEAT, {"heatId": heat_b.id})

        assert result["prepareHeat"] is False
        assert mgr._state is TimerState.RESULTS_OVERDUE
        assert mgr._active_heat_id == heat_a.id
