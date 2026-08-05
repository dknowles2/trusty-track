"""Heat ids are unique across official and free race heats.

Once upon a time (#4) they were not. ``heats`` and ``free_race_heats`` were
separate tables with independent autoincrement sequences, so their ids
overlapped from the first row, and the TimerManager inferred which one an id
meant by looking it up in ``heats`` first and falling back to the other. A
free-race run therefore wrote its times into whichever official heat happened to
share its id.

The fix at the time was to carry a `HeatKind` alongside every bare heat id. #6
removed the need for that: one table, one sequence, so an id is unambiguous.
These tests hold the invariant that made the class of bug impossible, rather
than the workaround that made it survivable.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.devices.base import LaneResult, RaceStarted
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


def _official_heat(db, race, racers):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
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
    db.add(heat)
    db.commit()
    return heat


def _racers(db, race, *names):
    return [
        crud.create_racer(
            db, schemas.RacerCreate(first_name=n, last_name="R", race_id=race.id)
        )
        for n in names
    ]


def test_an_official_and_a_free_heat_never_share_an_id(db):
    """The structural fix. Two tables meant two sequences; one table cannot
    issue the same id twice."""
    _, _, race = _build_race(db)
    racers = _racers(db, race, "Ava", "Ben")

    official = _official_heat(db, race, racers)
    free = crud.create_free_race_heat(
        db, race.id, [{"lane": 1, "racer_id": racers[0].id}]
    )

    assert official.id != free.id
    assert official.kind is models.HeatKind.OFFICIAL
    assert free.kind is models.HeatKind.FREE


@pytest.mark.anyio
async def test_a_free_race_run_leaves_official_heats_alone(db):
    """The user-visible guarantee, still worth stating even though it is now
    hard to break: an exhibition run records nowhere but itself."""
    _, track, race = _build_race(db)
    official_racers = _racers(db, race, "Ava", "Ben")
    free_racers = _racers(db, race, "Cal", "Dee")

    official = _official_heat(db, race, official_racers)
    free = crud.create_free_race_heat(
        db,
        race.id,
        [
            {"lane": 1, "racer_id": free_racers[0].id},
            {"lane": 2, "racer_id": free_racers[1].id},
        ],
    )

    manager = TimerManager(track_id=track.id, device=FAKE)
    await manager.prepare_heat(
        heat_id=free.id, kind=models.HeatKind.FREE, lane_mask=0b11
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

    recorded = db.query(models.Heat).filter(models.Heat.id == free.id).first()
    assert [r["time"] for r in json.loads(recorded.lane_results)] == [3.111, 3.222]

    untouched = db.query(models.Heat).filter(models.Heat.id == official.id).first()
    results = json.loads(untouched.lane_results)
    assert all(r["time"] is None for r in results), (
        f"free-race results leaked into an official heat: {untouched.lane_results}"
    )


@pytest.mark.anyio
async def test_an_official_run_leaves_free_heats_alone(db):
    """The mirror case."""
    _, track, race = _build_race(db)
    racers = _racers(db, race, "Eve", "Fay")

    free = crud.create_free_race_heat(
        db, race.id, [{"lane": 1, "racer_id": racers[0].id}]
    )
    official = _official_heat(db, race, racers)

    manager = TimerManager(track_id=track.id, device=FAKE)
    await manager.prepare_heat(
        heat_id=official.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
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
    recorded = db.query(models.Heat).filter(models.Heat.id == official.id).first()
    assert [r["time"] for r in json.loads(recorded.lane_results)] == [4.0, 4.5]

    untouched = db.query(models.Heat).filter(models.Heat.id == free.id).first()
    # An unrun free heat holds only its schedule, with no time key at all.
    assert all(r.get("time") is None for r in json.loads(untouched.lane_results))


@pytest.mark.anyio
async def test_recording_reads_the_kind_off_the_heat(db):
    """Not from whatever the caller said.

    The old failure was the manager *guessing* the kind from an ambiguous id.
    It no longer guesses or asks: a free heat records as a free heat even if the
    caller armed the timer claiming otherwise, which is what stops a
    mislabelled call re-running championship advancement.
    """
    _, track, race = _build_race(db)
    racers = _racers(db, race, "Gus", "Hal")
    free = crud.create_free_race_heat(
        db, race.id, [{"lane": 1, "racer_id": racers[0].id}]
    )

    manager = TimerManager(track_id=track.id, device=FAKE)
    # Deliberately the wrong kind.
    await manager.prepare_heat(
        heat_id=free.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b1
    )

    with (
        patch("backend.api.schema._publish_race_state", new_callable=AsyncMock),
        patch(
            "backend.services.timer.manager.SessionLocal",
            return_value=_mock_session(db),
        ),
        patch("backend.db.crud.record_heat_result") as official_path,
    ):
        await manager.inject_event(RaceStarted())
        await manager.inject_event(LaneResult(lane=1, time_seconds=3.0, place=1))

    official_path.assert_not_called()
    db.expire_all()
    recorded = db.query(models.Heat).filter(models.Heat.id == free.id).first()
    assert json.loads(recorded.lane_results)[0]["time"] == 3.0
