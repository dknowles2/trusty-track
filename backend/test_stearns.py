"""
Tests for Stearns scheduling algorithm.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend import models, crud
import json


# Use in-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def db() -> Session:
    """Create a fresh database for each test."""
    models.Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        models.Base.metadata.drop_all(bind=engine)


@pytest.fixture
def setup_race_with_round1(db: Session):
    """
    Create a race with Round 1 completed and timing data.
    Returns (race_id, racer_ids sorted by time).
    """
    # Create group
    group = models.Group(name="Test Group")
    db.add(group)
    db.commit()
    
    # Create track
    track = models.Track(lane_count=3, length_feet=40, timer_type=models.TimerType.FAKE)
    db.add(track)
    db.commit()
    
    # Create race
    race = models.Race(
        name="Test Race",
        date_time="2024-01-01T10:00:00",
        location="Test Location",
        group_id=group.id,
        scoring_strategy=models.ScoringStrategy.TIMED,
        car_numbering_strategy=models.CarNumberingStrategy.MANUAL,
        global_start_number=1,
        championship_trophies=3
    )
    db.add(race)
    db.commit()
    
    # Create 12 racers with predictable times
    racer_times = [3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0, 4.1, 4.2]
    racers = []
    for i, time in enumerate(racer_times):
        racer = models.Racer(
            first_name=f"Racer",
            last_name=f"{i+1}",
            car_number=i+1,
            race_id=race.id
        )
        db.add(racer)
        racers.append(racer)
    db.commit()
    
    # Create Round 1
    round1 = models.Round(
        race_id=race.id,
        round_number=1,
        scheduling_strategy=models.SchedulingStrategy.LANE_ROTATION
    )
    db.add(round1)
    db.commit()
    
    # Create heats for Round 1 with timing data
    # We'll create 4 heats with 3 racers each
    heat_num = 1
    for i in range(0, 12, 3):
        lane_results = []
        for lane_idx in range(3):
            racer_idx = i + lane_idx
            if racer_idx < len(racers):
                lane_results.append({
                    "lane": lane_idx + 1,
                    "racer_id": racers[racer_idx].id,
                    "time": racer_times[racer_idx],
                    "place": lane_idx + 1
                })
        
        heat = models.Heat(
            race_id=race.id,
            round_id=round1.id,
            heat_number=heat_num,
            lane_results=json.dumps(lane_results)
        )
        db.add(heat)
        heat_num += 1
    
    db.commit()
    
    # Return race_id and racer_ids sorted by time (fastest first)
    racer_ids_by_speed = [r.id for r in racers]
    return race.id, racer_ids_by_speed


def test_stearns_basic_distribution(db: Session, setup_race_with_round1):
    """Test that Stearns creates balanced heats with snake distribution."""
    race_id, racer_ids_by_speed = setup_race_with_round1
    
    # Create Round 2 with Stearns
    round2 = models.Round(
        race_id=race_id,
        round_number=2,
        scheduling_strategy=models.SchedulingStrategy.STEARNS
    )
    db.add(round2)
    db.commit()
    
    # Generate heats
    heats = crud.generate_heats_for_round(db, round2.id)
    
    # Should create 4 heats (12 racers / 3 lanes)
    assert len(heats) == 4
    
    # Extract racer assignments per heat
    heat_racers = []
    for heat in sorted(heats, key=lambda h: h.heat_number):
        results = json.loads(heat.lane_results)
        racer_ids_in_heat = [r["racer_id"] for r in results]
        heat_racers.append(racer_ids_in_heat)
    
    # Verify snake distribution
    # Expected pattern with 12 racers (IDs 1-12, sorted by speed):
    # Column 0 (racers 0-3): heats 0,1,2,3
    # Column 1 (racers 4-7): heats 3,2,1,0
    # Column 2 (racers 8-11): heats 0,1,2,3
    # 
    # Heat 0: racers[0], racers[7], racers[8]  = IDs 1, 8, 9
    # Heat 1: racers[1], racers[6], racers[9]  = IDs 2, 7, 10
    # Heat 2: racers[2], racers[5], racers[10] = IDs 3, 6, 11
    # Heat 3: racers[3], racers[4], racers[11] = IDs 4, 5, 12
    
    expected_heat_0 = {racer_ids_by_speed[0], racer_ids_by_speed[7], racer_ids_by_speed[8]}
    expected_heat_1 = {racer_ids_by_speed[1], racer_ids_by_speed[6], racer_ids_by_speed[9]}
    expected_heat_2 = {racer_ids_by_speed[2], racer_ids_by_speed[5], racer_ids_by_speed[10]}
    expected_heat_3 = {racer_ids_by_speed[3], racer_ids_by_speed[4], racer_ids_by_speed[11]}
    
    assert set(heat_racers[0]) == expected_heat_0, f"Heat 1 mismatch: got {heat_racers[0]}, expected {expected_heat_0}"
    assert set(heat_racers[1]) == expected_heat_1, f"Heat 2 mismatch: got {heat_racers[1]}, expected {expected_heat_1}"
    assert set(heat_racers[2]) == expected_heat_2, f"Heat 3 mismatch: got {heat_racers[2]}, expected {expected_heat_2}"
    assert set(heat_racers[3]) == expected_heat_3, f"Heat 4 mismatch: got {heat_racers[3]}, expected {expected_heat_3}"


def test_stearns_requires_previous_round(db: Session):
    """Test that Stearns fails when there's no previous round."""
    # Create minimal setup
    group = models.Group(name="Test Group")
    db.add(group)
    db.commit()
    
    track = models.Track(lane_count=3, length_feet=40, timer_type=models.TimerType.FAKE)
    db.add(track)
    db.commit()
    
    race = models.Race(
        name="Test Race",
        date_time="2024-01-01T10:00:00",
        location="Test",
        group_id=group.id,
        scoring_strategy=models.ScoringStrategy.TIMED,
        car_numbering_strategy=models.CarNumberingStrategy.MANUAL,
        global_start_number=1,
        championship_trophies=3
    )
    db.add(race)
    db.commit()
    
    # Add racers
    for i in range(6):
        racer = models.Racer(
            first_name=f"Racer",
            last_name=f"{i+1}",
            car_number=i+1,
            race_id=race.id
        )
        db.add(racer)
    db.commit()
    
    # Try to create Round 1 with Stearns (should fail)
    round1 = models.Round(
        race_id=race.id,
        round_number=1,
        scheduling_strategy=models.SchedulingStrategy.STEARNS
    )
    db.add(round1)
    db.commit()
    
    # Should raise ValueError
    with pytest.raises(ValueError, match="requires timing data from previous rounds"):
        crud.generate_heats_for_round(db, round1.id)


def test_stearns_insufficient_timing_data(db: Session, setup_race_with_round1):
    """Test that Stearns fails when less than 50% of racers have times."""
    # Create race with Round 1
    race_id, _ = setup_race_with_round1
    
    # Add more racers without times
    # Current setup_race_with_round1 adds 12 racers.
    # To drop below 50% threshold (12/X < 0.5), we need total racers > 24.
    for i in range(12, 30):  # Add 18 more racers (total 30, only 12 have times = 40%)
        racer = models.Racer(
            first_name=f"New",
            last_name=f"Racer{i}",
            car_number=i+1,
            race_id=race_id
        )
        db.add(racer)
    db.commit()
    
    # Create Round 2 with Stearns
    round2 = models.Round(
        race_id=race_id,
        round_number=2,
        scheduling_strategy=models.SchedulingStrategy.STEARNS
    )
    db.add(round2)
    db.commit()
    
    # Should raise ValueError about insufficient data
    with pytest.raises(ValueError, match="Insufficient timing data"):
        crud.generate_heats_for_round(db, round2.id)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
