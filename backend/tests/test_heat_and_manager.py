"""Pins ``_heat_and_manager`` (#431), the shared heat/race/manager lookup.

``fake_timer_start``, ``prepare_heat`` and ``fake_timer_finish`` each used to
re-derive this by hand: load the Heat (or free-race heat), load its Race,
bail if ``race.track_id`` is None, look the manager up in ``timer_managers``,
bail if absent. These tests exercise the extracted helper directly against
every branch that used to live at three call sites, and the GraphQL-level
tests at the bottom cover a case none of the existing suites did — a heat
whose track has no ``TimerManager`` registered — across all three mutations.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.main import TIMER_MANAGERS, app
from backend.api.schema import _heat_and_manager
from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.manager import TimerManager

client = TestClient(app)


@pytest.fixture(autouse=True)
def registered_manager():
    """Own `TIMER_MANAGERS` for the module — it is a process-wide dict."""
    saved = dict(TIMER_MANAGERS)
    TIMER_MANAGERS.clear()
    yield
    TIMER_MANAGERS.clear()
    TIMER_MANAGERS.update(saved)


def _race_and_track(db: Session, *, with_track: bool = True):
    group = crud.create_group(db, schemas.GroupCreate(name="HAM Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="HAM Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="HAM Race",
            group_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    if not with_track:
        # `RaceCreate.track_id` is required and `update_race` treats a null
        # as "leave alone" (CLAUDE.md), so a track-less race is reached only
        # by writing the column directly, the way a track's own deletion
        # (`ON DELETE SET NULL`, #125) would leave it.
        race.track_id = None
        db.commit()
        db.refresh(race)
    return race, track


def _official_heat(db: Session, race) -> models.Heat:
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
    db.add(heat)
    db.flush()
    db.commit()
    return heat


def _free_heat(db: Session, race) -> models.Heat:
    return crud.create_free_race_heat(db, race.id, [])


class TestHeatAndManagerHelper:
    def test_missing_heat_returns_none(self, db: Session):
        assert _heat_and_manager(db, {}, 999_999) is None

    def test_race_with_no_track_returns_none(self, db: Session):
        race, _track = _race_and_track(db, with_track=False)
        heat = _official_heat(db, race)
        assert _heat_and_manager(db, {}, heat.id) is None

    def test_no_registered_manager_returns_none(self, db: Session):
        race, track = _race_and_track(db)
        heat = _official_heat(db, race)
        # `timer_managers` is empty — nothing registered for this track.
        assert _heat_and_manager(db, {}, heat.id) is None
        # Sanity: a manager registered for a *different* track still misses.
        other_mgr = object()
        assert _heat_and_manager(db, {track.id + 1: other_mgr}, heat.id) is None

    async def test_success_returns_heat_race_and_manager(
        self, db: Session, timer_session_factory
    ):
        race, track = _race_and_track(db)
        heat = _official_heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        found = _heat_and_manager(db, {track.id: mgr}, heat.id)
        assert found is not None
        found_heat, found_race, found_mgr = found
        assert found_heat.id == heat.id
        assert found_race.id == race.id
        assert found_mgr is mgr

    async def test_is_free_race_narrows_to_free_heats(
        self, db: Session, timer_session_factory
    ):
        """Only ``fake_timer_start`` passes ``is_free_race`` — it must refuse
        an official heat id the way ``crud.get_free_race_heat`` always has,
        rather than silently falling back to the plain lookup."""
        race, track = _race_and_track(db)
        official = _official_heat(db, race)
        free = _free_heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        timer_managers = {track.id: mgr}

        assert (
            _heat_and_manager(db, timer_managers, official.id, is_free_race=True)
            is None
        )
        found = _heat_and_manager(db, timer_managers, free.id, is_free_race=True)
        assert found is not None
        assert found[0].id == free.id

    async def test_is_free_race_false_reads_either_kind(
        self, db: Session, timer_session_factory
    ):
        """``prepare_heat`` and ``fake_timer_finish`` never pass
        ``is_free_race`` — heat ids are unique across both kinds since #6, so
        they read the kind off the row and this must find a free heat too."""
        race, track = _race_and_track(db)
        free = _free_heat(db, race)
        mgr = TimerManager(
            track_id=track.id, device=FAKE, session_factory=timer_session_factory
        )
        found = _heat_and_manager(db, {track.id: mgr}, free.id)
        assert found is not None
        assert found[0].id == free.id


class TestNoManagerRegisteredOverGraphQL:
    """A heat whose track has a real, saved track row but no live
    ``TimerManager`` (never registered, or the process restarted) must fail
    closed on all three mutations rather than raising."""

    def test_prepare_heat_refuses(self, db: Session):
        race, _track = _race_and_track(db)
        heat = _official_heat(db, race)
        resp = client.post(
            "/graphql",
            json={
                "query": "mutation($heatId: Int!) { prepareHeat(heatId: $heatId) }",
                "variables": {"heatId": heat.id},
            },
        )
        body = resp.json()
        assert "errors" not in body, body.get("errors")
        assert body["data"]["prepareHeat"] is False

    def test_fake_timer_start_refuses(self, db: Session):
        race, _track = _race_and_track(db)
        heat = _official_heat(db, race)
        resp = client.post(
            "/graphql",
            json={
                "query": (
                    "mutation($heatId: Int!) { fakeTimerStart(heatId: $heatId) }"
                ),
                "variables": {"heatId": heat.id},
            },
        )
        body = resp.json()
        assert "errors" not in body, body.get("errors")
        assert body["data"]["fakeTimerStart"] is False

    def test_fake_timer_finish_refuses(self, db: Session):
        race, _track = _race_and_track(db)
        heat = _official_heat(db, race)
        resp = client.post(
            "/graphql",
            json={
                "query": (
                    "mutation($heatId: Int!) { fakeTimerFinish(heatId: $heatId) }"
                ),
                "variables": {"heatId": heat.id},
            },
        )
        body = resp.json()
        assert "errors" not in body, body.get("errors")
        assert body["data"]["fakeTimerFinish"] is False
