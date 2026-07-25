"""Regression tests for heat-id collisions between official and free-race heats.

``heats`` and ``free_race_heats`` are separate tables with independent
autoincrement sequences, so their ids overlap from the first row. Anything
holding a bare heat id must also carry the kind. Previously the TimerManager
inferred the kind by looking the id up in ``heats`` first and falling back to
``free_race_heats``, which meant a free-race run wrote its times into whichever
official heat happened to share its id.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.db import crud, models, schemas
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.devices.fake import FakeTimerDevice
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


def _mock_session(db):
    """A SessionLocal stand-in that reuses the test session and ignores close()."""
    session = MagicMock()
    session.query = db.query
    session.add = db.add
    session.commit = db.commit
    session.refresh = db.refresh
    session.close = MagicMock()
    return session


def _build_race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Collision Group"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Collision Track", lane_count=2, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Collision Race", group_id=group.id, track_id=track.id),
    )
    return group, track, race


@pytest.mark.anyio
async def test_free_race_run_does_not_touch_colliding_official_heat(db):
    """A free-race heat must not write into an official heat with the same id."""
    _, track, race = _build_race(db)

    official_racers = [
        crud.create_racer(
            db,
            schemas.RacerCreate(first_name=n, last_name="Official", race_id=race.id),
        )
        for n in ("Ava", "Ben")
    ]
    free_racers = [
        crud.create_racer(
            db, schemas.RacerCreate(first_name=n, last_name="Free", race_id=race.id)
        )
        for n in ("Cal", "Dee")
    ]

    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    official = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [
                {
                    "lane": 1,
                    "racer_id": official_racers[0].id,
                    "time": None,
                    "place": None,
                },
                {
                    "lane": 2,
                    "racer_id": official_racers[1].id,
                    "time": None,
                    "place": None,
                },
            ]
        ),
    )
    db.add(official)
    db.commit()

    free = crud.create_free_race_heat(
        db,
        race.id,
        [
            {"lane": 1, "racer_id": free_racers[0].id},
            {"lane": 2, "racer_id": free_racers[1].id},
        ],
    )

    # The precondition this test exists for: the ids actually collide.
    assert official.id == free.id, (
        "expected the two tables' autoincrement sequences to collide; "
        "if this stops being true the test needs different fixture data"
    )
    heat_id = free.id

    manager = TimerManager(track_id=track.id, device=FakeTimerDevice())
    await manager.prepare_heat(
        heat_id=heat_id, kind=models.HeatKind.FREE, lane_mask=0b11
    )

    with (
        patch("backend.api.schema._publish_race_state", new_callable=AsyncMock),
        patch(
            "backend.services.timer.manager.SessionLocal",
            return_value=_mock_session(db),
        ),
    ):
        await manager.inject_event(RaceStarted())
        await manager.inject_event(LaneResult(lane=1, time_seconds=3.111, place=1))
        await manager.inject_event(LaneResult(lane=2, time_seconds=3.222, place=2))

    assert manager._state == TimerState.IDLE
    db.expire_all()

    # The free heat got the results.
    recorded_free = (
        db.query(models.FreeRaceHeat).filter(models.FreeRaceHeat.id == heat_id).first()
    )
    assert recorded_free.lane_results is not None
    free_results = json.loads(recorded_free.lane_results)
    assert [r["time"] for r in free_results] == [3.111, 3.222]

    # The official heat with the same id was untouched.
    untouched = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    official_results = json.loads(untouched.lane_results)
    assert all(r["time"] is None for r in official_results), (
        f"free-race results leaked into an official heat: {untouched.lane_results}"
    )
    assert all(r["place"] is None for r in official_results)


@pytest.mark.anyio
async def test_official_run_does_not_touch_colliding_free_heat(db):
    """The mirror case: an official heat must not write into a free heat."""
    _, track, race = _build_race(db)

    racers = [
        crud.create_racer(
            db, schemas.RacerCreate(first_name=n, last_name="R", race_id=race.id)
        )
        for n in ("Eve", "Fay")
    ]

    free = crud.create_free_race_heat(
        db, race.id, [{"lane": 1, "racer_id": racers[0].id}]
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    official = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [
                {"lane": 1, "racer_id": racers[0].id, "time": None, "place": None},
                {"lane": 2, "racer_id": racers[1].id, "time": None, "place": None},
            ]
        ),
    )
    db.add(official)
    db.commit()

    assert official.id == free.id
    heat_id = official.id

    manager = TimerManager(track_id=track.id, device=FakeTimerDevice())
    await manager.prepare_heat(
        heat_id=heat_id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )

    with (
        patch("backend.api.schema._publish_race_state", new_callable=AsyncMock),
        patch(
            "backend.services.timer.manager.SessionLocal",
            return_value=_mock_session(db),
        ),
    ):
        await manager.inject_event(RaceStarted())
        await manager.inject_event(LaneResult(lane=1, time_seconds=4.0, place=1))
        await manager.inject_event(LaneResult(lane=2, time_seconds=4.5, place=2))

    db.expire_all()
    recorded = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    assert [r["time"] for r in json.loads(recorded.lane_results)] == [4.0, 4.5]

    untouched_free = (
        db.query(models.FreeRaceHeat).filter(models.FreeRaceHeat.id == heat_id).first()
    )
    assert untouched_free.lane_results is None


@pytest.mark.anyio
async def test_record_results_refuses_to_guess_without_a_kind(db):
    """With no kind set, recording must abort rather than fall back to a lookup."""
    _, track, race = _build_race(db)
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    official = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [{"lane": 1, "racer_id": None, "time": None, "place": None}]
        ),
    )
    db.add(official)
    db.commit()

    manager = TimerManager(track_id=track.id, device=FakeTimerDevice())
    # Simulate legacy/corrupt state: an id with no kind alongside it.
    manager._active_heat_id = official.id
    manager._active_heat_kind = None
    manager._pending_results = {1: LaneResult(lane=1, time_seconds=3.0, place=1)}

    with patch(
        "backend.services.timer.manager.SessionLocal",
        return_value=_mock_session(db),
    ):
        await manager._record_results()

    db.expire_all()
    unchanged = db.query(models.Heat).filter(models.Heat.id == official.id).first()
    assert json.loads(unchanged.lane_results)[0]["time"] is None
