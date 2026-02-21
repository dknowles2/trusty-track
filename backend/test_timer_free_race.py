import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from . import crud, models, schemas
from .timer.manager import TimerManager
from .timer.devices.fake import FakeTimerDevice
from .timer.state_machine import TimerState
from .timer.devices.base import LaneResult, RaceStarted

@pytest.mark.anyio
async def test_free_race_heat_recording_in_manager(db):
    # Setup: Create race and free race heat
    group = crud.create_group(db, schemas.GroupCreate(name="Timer Test Group"))
    track = crud.create_track(db, schemas.TrackCreate(name="Timer Track", lane_count=4, timer_type="FAKE"))
    race = crud.create_race(db, schemas.RaceCreate(
        name="Timer Race", group_id=group.id, track_id=track.id
    ))
    # Capture IDs before session close
    race_id = race.id
    
    r1 = crud.create_racer(db, schemas.RacerCreate(first_name="Alice", last_name="Test", race_id=race.id))
    heat = crud.create_free_race_heat(db, race.id, [{"lane": 1, "racer_id": r1.id}, {"lane": 2, "racer_id": None}])
    heat_id = heat.id
    
    device = FakeTimerDevice()
    manager = TimerManager(track_id=track.id, device=device)
    
    # Arm for the free race heat
    await manager.prepare_heat(heat_id=heat_id, lane_mask=0b01)
    
    # Mock SessionLocal to return 'db' but ignore close()
    mock_session = MagicMock()
    mock_session.query = db.query
    mock_session.add = db.add
    mock_session.commit = db.commit
    mock_session.refresh = db.refresh
    mock_session.close = MagicMock() # Do nothing
    
    with patch("backend.schema._publish_race_state", new_callable=AsyncMock) as mock_publish, \
         patch("backend.timer.manager.SessionLocal", return_value=mock_session):
        await manager.inject_event(RaceStarted())
        await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
        
        # Verify transition back to IDLE
        assert manager._state == TimerState.IDLE
        
        # Verify DB update
        db.expire_all()
        updated_heat = db.query(models.FreeRaceHeat).filter(models.FreeRaceHeat.id == heat_id).first()
        assert updated_heat.lane_results is not None
        results = json.loads(updated_heat.lane_results)
        assert results[0]["lane"] == 1
        assert results[0]["time"] == 3.5
        assert results[0]["place"] == 1
        
        mock_publish.assert_awaited_once_with(race_id)

@pytest.mark.anyio
async def test_official_heat_recording_in_manager(db):
    # Setup: Create race and official heat
    group = crud.create_group(db, schemas.GroupCreate(name="Official Test Group"))
    track = crud.create_track(db, schemas.TrackCreate(name="Official Track", lane_count=4, timer_type="FAKE"))
    race = crud.create_race(db, schemas.RaceCreate(
        name="Official Race", group_id=group.id, track_id=track.id
    ))
    race_id = race.id
    
    round_obj = crud.create_round(db, race.id, 1, name="Round 1")
    r1 = crud.create_racer(db, schemas.RacerCreate(first_name="Bob", last_name="Official", race_id=race.id))
    
    heat_data = [{"lane": 1, "racer_id": r1.id, "time": None, "place": None}]
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(heat_data)
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)
    heat_id = heat.id
    
    device = FakeTimerDevice()
    manager = TimerManager(track_id=track.id, device=device)
    
    await manager.prepare_heat(heat_id=heat_id, lane_mask=0b01)
    
    mock_session = MagicMock()
    mock_session.query = db.query
    mock_session.add = db.add
    mock_session.commit = db.commit
    mock_session.refresh = db.refresh
    mock_session.close = MagicMock()
    
    with patch("backend.schema._publish_race_state", new_callable=AsyncMock) as mock_publish, \
         patch("backend.timer.manager.SessionLocal", return_value=mock_session):
        await manager.inject_event(RaceStarted())
        await manager.inject_event(LaneResult(lane=1, time_seconds=3.6, place=1))
        
        assert manager._state == TimerState.IDLE
        
        db.expire_all()
        updated_heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
        assert updated_heat.lane_results is not None
        results = json.loads(updated_heat.lane_results)
        assert results[0]["time"] == 3.6
        assert results[0]["place"] == 1
        
        mock_publish.assert_awaited_once_with(race_id)
