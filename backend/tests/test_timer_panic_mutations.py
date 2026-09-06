"""The operator's timer panic buttons (#347).

`reconnectTimer`, `abortHeat`, `forceResults` and `resetTimer` are pressed only
when hardware is already misbehaving mid-event — the worst time to discover a
regression — and until now none of them had a test. `forceResults` in
particular calls `TimerManager.force_results()`, which itself reaches into
private device API (``self._send_commands(self._device.force_results_commands())``),
so a rename of either would break it silently (#341 moved that call from the
resolver into the manager, so the wait for the device's answer could hold
`_event_lock` the way every other manager method does).

These go through the GraphQL layer rather than calling `TimerManager` methods
directly, the same way `test_heat_session_gql.py` does: the resolvers do more
than forward the call (looking the track up, checking its timer type, reading
`info.context`), and that wiring is exactly what has no other test.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.api.main import TIMER_MANAGERS, app
from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE, MICROWIZARD
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState
from backend.tests.helpers import as_lanes

client = TestClient(app)


@pytest.fixture(autouse=True)
def registered_manager():
    """Own `TIMER_MANAGERS` for the module, the same way `test_heat_session_gql.py`
    does — it is a process-wide dict populated at startup and left populated
    by other tests, and track ids restart at 1 on every in-memory database.
    """
    saved = dict(TIMER_MANAGERS)
    TIMER_MANAGERS.clear()
    yield
    TIMER_MANAGERS.clear()
    TIMER_MANAGERS.update(saved)


def _race(db, *, timer_type="FAKE"):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Panic Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Panic Track", lane_count=2, timer_type=timer_type),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Panic Race",
            organization_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    return race, track


def _heat(db, race):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
    db.add(heat)
    db.flush()
    ava = crud.create_racer(
        db, schemas.RacerCreate(first_name="Ava", last_name="R", race_id=race.id)
    )
    ben = crud.create_racer(
        db, schemas.RacerCreate(first_name="Ben", last_name="R", race_id=race.id)
    )
    crud.set_heat_lanes(
        heat,
        as_lanes(
            [
                {"lane": 1, "racer_id": ava.id, "time": None, "place": None},
                {"lane": 2, "racer_id": ben.id, "time": None, "place": None},
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


class TestReconnectTimer:
    MUTATION = "mutation($trackId: Int!) { reconnectTimer(trackId: $trackId) }"

    def test_no_manager_for_the_track_returns_false(self, db):  # noqa: ARG002 - the db fixture isolates this test
        assert _mutate(self.MUTATION, {"trackId": 999})["reconnectTimer"] is False

    def test_a_fake_timer_is_a_no_op(self, db, timer_session_factory):
        """Only AUTO_DETECT_BACKEND tracks have a serial connection to retry."""
        _, track = _race(db, timer_type="FAKE")
        TIMER_MANAGERS[track.id] = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )

        assert _mutate(self.MUTATION, {"trackId": track.id})["reconnectTimer"] is False

    def test_a_backend_direct_track_starts_reconnecting(
        self, db, timer_session_factory, monkeypatch
    ):
        _, track = _race(db, timer_type="AUTO_DETECT_BACKEND")
        mgr = TimerManager(
            track_id=track.id, device=MICROWIZARD, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr

        called = {}

        def fake_start_backend_direct(manager, serial_port):
            called["manager"] = manager
            called["serial_port"] = serial_port

        monkeypatch.setattr(
            "backend.api.schema._start_backend_direct", fake_start_backend_direct
        )

        result = _mutate(self.MUTATION, {"trackId": track.id})

        assert result["reconnectTimer"] is True
        assert called["manager"] is mgr
        assert called["serial_port"] is None


class TestAbortHeat:
    MUTATION = "mutation($trackId: Int!) { abortHeat(trackId: $trackId) }"

    def test_no_manager_for_the_track_returns_false(self, db):  # noqa: ARG002 - the db fixture isolates this test
        assert _mutate(self.MUTATION, {"trackId": 999})["abortHeat"] is False

    async def test_an_armed_heat_returns_to_idle_with_nothing_recorded(
        self, db, timer_session_factory
    ):
        race, track = _race(db)
        heat = _heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await mgr.prepare_heat(heat.id, models.HeatKind.OFFICIAL, lane_mask=0b11)
        assert mgr._state is TimerState.ARMED

        result = _mutate(self.MUTATION, {"trackId": track.id})

        assert result["abortHeat"] is True
        assert mgr._state is TimerState.IDLE
        assert mgr._active_heat_id is None
        lanes = {lane.lane: lane for lane in crud.heat_lanes_of(db, heat)}
        assert lanes[1].time is None
        assert lanes[2].time is None


class TestForceResults:
    MUTATION = "mutation($trackId: Int!) { forceResults(trackId: $trackId) }"

    def test_no_manager_for_the_track_returns_false(self, db):  # noqa: ARG002 - the db fixture isolates this test
        assert _mutate(self.MUTATION, {"trackId": 999})["forceResults"] is False

    async def test_sends_the_devices_force_results_command(
        self, db, timer_session_factory, monkeypatch
    ):
        """Pins the private call the issue calls out by name: a rename of
        either `_send_commands` or `force_results_commands` breaks this."""
        import backend.services.timer.manager as manager_module

        # No answer ever comes on this test's fake wire, so force_results()
        # would otherwise sit out its full wait for one.
        monkeypatch.setattr(manager_module, "FORCE_RESULTS_WAIT_SECONDS", 0.05)
        monkeypatch.setattr(manager_module, "FORCE_RESULTS_POLL_SECONDS", 0.01)

        race, track = _race(db, timer_type="AUTO_DETECT_BACKEND")
        heat = _heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=MICROWIZARD, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await mgr.prepare_heat(heat.id, models.HeatKind.OFFICIAL, lane_mask=0b11)
        log_before = len(mgr._serial_log)

        result = _mutate(self.MUTATION, {"trackId": track.id})

        assert result["forceResults"] is True
        tx_after = [
            entry
            for entry in list(mgr._serial_log)[log_before:]
            if entry.direction == "TX"
        ]
        # MICROWIZARD.force_results is (b"RA",) — see devices/microwizard.py.
        assert any("RA" in entry.data for entry in tx_after)

    async def test_records_whatever_arrived_before_the_button_was_pressed(
        self, db, timer_session_factory
    ):
        """The other half of the button: force_record() persists a partial
        result rather than only sending the device command."""
        race, track = _race(db, timer_type="FAKE")
        heat = _heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await mgr.prepare_heat(heat.id, models.HeatKind.OFFICIAL, lane_mask=0b11)
        await mgr.inject_event(RaceStarted())
        await mgr.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))
        # Lane 2's sensor never fires — the case the button exists for.

        result = _mutate(self.MUTATION, {"trackId": track.id})

        assert result["forceResults"] is True
        assert mgr._state is TimerState.IDLE
        assert mgr._active_heat_id is None
        lanes = {lane.lane: lane for lane in crud.heat_lanes_of(db, heat)}
        assert lanes[1].time == pytest.approx(3.1)
        assert lanes[1].place == 1
        assert lanes[2].time is None

    async def test_a_late_arriving_report_is_not_dropped(
        self, db, timer_session_factory, monkeypatch
    ):
        """The device's answer to the force command it was just sent can
        arrive after force_record() would otherwise already have recorded
        and gone IDLE (#341). Without the wait this pins, `_handle_event`
        drops the late `LaneResult` — state has already left
        RUNNING/ARMED/READY/RESULTS_OVERDUE — and the recorded heat is
        missing the stuck lane's time rather than holding the 0.000 DNF the
        device reported."""
        import asyncio

        import backend.services.timer.manager as manager_module

        monkeypatch.setattr(manager_module, "FORCE_RESULTS_WAIT_SECONDS", 0.3)
        monkeypatch.setattr(manager_module, "FORCE_RESULTS_POLL_SECONDS", 0.01)

        race, track = _race(db, timer_type="AUTO_DETECT_BACKEND")
        heat = _heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=MICROWIZARD, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await mgr.prepare_heat(heat.id, models.HeatKind.OFFICIAL, lane_mask=0b11)
        await mgr.inject_event(RaceStarted())
        await mgr.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))
        # Lane 2 never fires on its own — the case the button exists for.

        async def _the_devices_answer() -> None:
            # Stands in for the wire: the report the force command asked for
            # arrives a moment later, the way it would from real hardware.
            await asyncio.sleep(0.05)
            await mgr.inject_event(LaneResult(lane=2, time_seconds=0.0, place=0))

        answer = asyncio.create_task(_the_devices_answer())
        await mgr.force_results()
        await answer

        lanes = {lane.lane: lane for lane in crud.heat_lanes_of(db, heat)}
        assert lanes[1].time == pytest.approx(3.1)
        assert lanes[1].place == 1
        # The device's answer: a recorded 0.0 is the DNF marker, not a blank.
        assert lanes[2].time == pytest.approx(0.0)


class TestResetTimer:
    MUTATION = "mutation($trackId: Int!) { resetTimer(trackId: $trackId) }"

    def test_no_manager_for_the_track_returns_false(self, db):  # noqa: ARG002 - the db fixture isolates this test
        assert _mutate(self.MUTATION, {"trackId": 999})["resetTimer"] is False

    async def test_clears_an_armed_heat_back_to_idle(self, db, timer_session_factory):
        race, track = _race(db)
        heat = _heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await mgr.prepare_heat(heat.id, models.HeatKind.OFFICIAL, lane_mask=0b11)

        result = _mutate(self.MUTATION, {"trackId": track.id})

        assert result["resetTimer"] is True
        assert mgr._state is TimerState.IDLE
        assert mgr._active_heat_id is None
        assert mgr._pending_results == {}

    async def test_stops_gate_poll_task(
        self, db: Any, timer_session_factory: Any
    ) -> None:
        """resetTimer must stop any running gate-polling task (#762)."""
        from backend.services.timer.devices.derbynet import DERBY_TIMER

        race, track = _race(db)
        heat = _heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=DERBY_TIMER, session_factory=timer_session_factory
        )
        TIMER_MANAGERS[track.id] = mgr
        await mgr.prepare_heat(heat.id, models.HeatKind.OFFICIAL, lane_mask=0b11)

        assert mgr._gate_poll_task is not None
        assert not mgr._gate_poll_task.done()

        result = _mutate(self.MUTATION, {"trackId": track.id})

        assert result["resetTimer"] is True
        assert mgr._state is TimerState.IDLE
        assert mgr._gate_poll_task is None

    async def test_manager_reset_stops_gate_poll_task(
        self, db: Any, timer_session_factory: Any
    ) -> None:
        """TimerManager.reset() must cancel and clear the gate-poll task (#762)."""
        from backend.services.timer.devices.derbynet import DERBY_TIMER

        race, track = _race(db)
        heat = _heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=DERBY_TIMER, session_factory=timer_session_factory
        )
        await mgr.prepare_heat(heat.id, models.HeatKind.OFFICIAL, lane_mask=0b11)

        assert mgr._gate_poll_task is not None
        assert not mgr._gate_poll_task.done()

        await mgr.reset()

        assert mgr._state is TimerState.IDLE
        assert mgr._gate_poll_task is None
