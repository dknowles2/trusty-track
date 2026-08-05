"""TimerManager records results through an injected session factory.

Recording happens on a background task rather than in a request, so the manager
cannot use the request's session. It used to reach for the process-wide
`SessionLocal` directly, which meant test writes landed in a separate,
file-backed database that the test's own session could not see — and which had
to be created up front by a session-scoped fixture.
"""

import json

import pytest

from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager, initialize_timer_managers


def _seed(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Injection Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Injection Track", lane_count=2, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Injection Race", group_id=group.id, track_id=track.id),
    )
    return group, track, race


def test_manager_defaults_to_the_module_session_factory():
    """Omitting the factory binds the module-level one, so callers need not pass it.

    Note the autouse conftest fixture has swapped `manager.SessionLocal` for the
    test factory, so this asserts the binding, not the production value.
    """
    from backend.services.timer import manager as manager_module

    mgr = TimerManager(track_id=1, device=FAKE)
    assert mgr._session_factory is manager_module.SessionLocal


def test_injected_factory_is_used_instead():
    sentinel = object()
    mgr = TimerManager(track_id=1, device=FAKE, session_factory=lambda: sentinel)
    assert mgr._session_factory() is sentinel


@pytest.mark.anyio
async def test_results_land_in_the_injected_database(db, timer_session_factory):
    """The write must be visible to the test's own session, with no patching.

    This is the behaviour the second test database existed to work around.
    """
    _, track, race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Nia", last_name="R", race_id=race.id)
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [{"lane": 1, "racer_id": racer.id, "time": None, "place": None}]
        ),
    )
    db.add(heat)
    db.commit()

    mgr = TimerManager(
        track_id=track.id,
        device=FAKE,
        session_factory=timer_session_factory,
    )
    await mgr.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b01
    )
    await mgr.inject_event(RaceStarted())
    await mgr.inject_event(LaneResult(lane=1, time_seconds=3.25, place=1))

    db.expire_all()
    recorded = db.query(models.Heat).filter(models.Heat.id == heat.id).first()
    assert json.loads(recorded.lane_results)[0]["time"] == 3.25


@pytest.mark.anyio
async def test_initialize_timer_managers_propagates_the_factory(
    db, timer_session_factory
):
    """Managers built at startup inherit the factory they were given."""
    _seed(db)
    registry: dict[int, TimerManager] = {}
    await initialize_timer_managers(registry, session_factory=timer_session_factory)

    assert registry, "expected a manager per track"
    for mgr in registry.values():
        assert mgr._session_factory is timer_session_factory
