"""The bench test: a timer exercised with no race behind it (#235).

Every profile ships with the caveat that no heat has run through it on real
hardware, and the docs ask owners to report back. This is the machinery that
makes that possible without asking a volunteer to read serial logs: arm every
lane with no heat, capture the run, and package it as a report.

The property that matters most is the second test — a test run writes
*nothing*. A bench exercise that leaked into the heats table would be scored,
displayed and audited as racing.
"""

import pytest

from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


def _seed(db):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Bench Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Bench Track", lane_count=2, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Bench Race", organization_id=group.id, track_id=track.id
        ),
    )
    return group, track, race


@pytest.fixture
def mgr(db, timer_session_factory):
    _, track, _ = _seed(db)
    return TimerManager(
        track_id=track.id, device=FAKE, session_factory=timer_session_factory
    )


async def _run_test_heat(mgr):
    await mgr.prepare_test_heat(lane_count=2)
    await mgr.inject_event(RaceStarted())
    await mgr.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))
    await mgr.inject_event(LaneResult(lane=2, time_seconds=3.4, place=2))


class TestTheRun:
    async def test_arms_every_lane_and_finishes_idle(self, mgr):
        await _run_test_heat(mgr)

        assert mgr._state is TimerState.IDLE

    async def test_writes_nothing_anywhere(self, db, mgr):
        """The property the feature stands on: a bench exercise is not racing."""
        await _run_test_heat(mgr)

        assert db.query(models.Heat).count() == 0
        assert db.query(models.HeatLane).count() == 0
        assert db.query(models.AuditEntry).count() == 0

    async def test_the_results_stay_on_screen(self, mgr):
        await _run_test_heat(mgr)

        status = mgr.status()
        assert status.test_run is True
        assert sorted(r["lane"] for r in status.pending_results) == [1, 2]

    async def test_a_partial_run_can_be_forced_finished(self, mgr):
        """A lane whose sensor never fires is exactly what a report is for."""
        await mgr.prepare_test_heat(lane_count=2)
        await mgr.inject_event(RaceStarted())
        await mgr.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))

        await mgr.force_record()

        assert mgr._state is TimerState.IDLE
        assert len(mgr.status().pending_results) == 1

    async def test_arming_a_real_heat_clears_the_test(self, mgr):
        await _run_test_heat(mgr)

        await mgr.prepare_heat(heat_id=999, kind=models.HeatKind.OFFICIAL, lane_mask=1)

        assert mgr.status().test_run is False

    async def test_revalidation_does_not_disarm_a_test(self, db, mgr):
        """`_revalidate_timers` runs after schedule changes; a bench test has
        no heat to have gone stale."""
        await mgr.prepare_test_heat(lane_count=2)

        assert await mgr.revalidate_armed_heat(db) is None
        assert mgr._state is TimerState.ARMED


class TestTheReport:
    async def test_carries_the_conversation_and_the_context(self, mgr):
        await _run_test_heat(mgr)

        report = mgr.test_report()

        assert report["timer"]["profile_key"] == FAKE.key
        assert report["timer"]["baud_rate"] == FAKE.baud_rate
        assert report["state"] == "IDLE"
        assert len(report["pending_results"]) == 2
        # The serial log is the payload. The fake timer writes no bytes, so
        # here it is empty — the shape is what this pins.
        assert isinstance(report["serial_log"], list)


class TestTheMutation:
    def test_starts_a_test(self, client, db):
        _, track, _ = _seed(db)
        from backend.api import main as main_module

        mgr = TimerManager(track_id=track.id, device=FAKE)
        main_module.TIMER_MANAGERS[track.id] = mgr
        try:
            response = client.post(
                "/graphql",
                json={"query": f"mutation {{ startTimerTest(trackId: {track.id}) }}"},
            )
            assert response.json()["data"]["startTimerTest"] is True
            assert mgr._state is TimerState.ARMED
            assert mgr.status().test_run is True
        finally:
            main_module.TIMER_MANAGERS.pop(track.id, None)

    async def test_refuses_while_a_real_heat_is_armed(self, client, db):
        """A bench test must not disarm race day."""
        _, track, _ = _seed(db)
        from backend.api import main as main_module

        mgr = TimerManager(track_id=track.id, device=FAKE)
        await mgr.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=1)
        main_module.TIMER_MANAGERS[track.id] = mgr
        try:
            response = client.post(
                "/graphql",
                json={"query": f"mutation {{ startTimerTest(trackId: {track.id}) }}"},
            )
            assert response.json()["data"]["startTimerTest"] is False
            assert mgr._active_heat_id == 1
        finally:
            main_module.TIMER_MANAGERS.pop(track.id, None)


class TestTheReportEndpoint:
    def test_downloads_as_a_named_file(self, client, db):
        _, track, _ = _seed(db)
        from backend.api import main as main_module

        main_module.TIMER_MANAGERS[track.id] = TimerManager(
            track_id=track.id, device=FAKE
        )
        try:
            response = client.get(f"/api/timer-test/{track.id}/report")

            assert response.status_code == 200
            assert "attachment" in response.headers["content-disposition"]
            report = response.json()
            assert report["track"]["name"] == "Bench Track"
            assert report["timer"]["profile_key"] == FAKE.key
            assert "app_version" in report
        finally:
            main_module.TIMER_MANAGERS.pop(track.id, None)

    def test_a_missing_track_is_a_404(self, client):
        assert client.get("/api/timer-test/424242/report").status_code == 404

    def test_the_download_is_operator_only(self, client):
        """Same self-guarding as the backup endpoints: REST is outside the
        role policy, and the report carries the whole serial conversation.

        No ``_seed`` here — ``createInitialConfig`` refuses an initialized
        system, and the refusal must fire before the track lookup, so a bare
        install is exactly the right shape.
        """
        client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createInitialConfig(config: {
                        organizationName: "Locked Bench Pack",
                        operatorPin: "1111",
                        tracks: [{name: "Locked Bench Track", laneCount: 2}]
                    }) { initialized }
                }
                """
            },
        )

        refused = client.get("/api/timer-test/1/report")

        assert refused.status_code == 403
