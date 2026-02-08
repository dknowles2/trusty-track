"""Tests for heat reordering functionality."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.database import Base
from backend.main import app, get_db
from backend import models, crud, schemas



client = TestClient(app)




@pytest.fixture
def test_race(db):
    """Create a test race with racers and heats."""
    # Create group
    group = models.Group(name="Test Group")
    db.add(group)
    db.commit()
    db.refresh(group)
    
    # Create race
    race = models.Race(
        group_id=group.id,
        name="Test Race",
        car_numbering_strategy=models.CarNumberingStrategy.MANUAL
    )
    db.add(race)
    db.commit()
    db.refresh(race)
    
    # Create racers
    racers = []
    for i in range(4):
        racer = models.Racer(
            race_id=race.id,
            first_name=f"Racer{i}",
            last_name=f"Test{i}",
            car_number=i + 1
        )
        db.add(racer)
        racers.append(racer)
    db.commit()
    
    # Create round
    round_obj = models.Round(
        race_id=race.id,
        round_number=1,
        scheduling_strategy=models.SchedulingStrategy.PPC
    )
    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    
    # Create heats
    heats = []
    for i in range(3):
        heat = models.Heat(
            race_id=race.id,
            round_id=round_obj.id,
            heat_number=i + 1,
            lane_results=None
        )
        db.add(heat)
        heats.append(heat)
    db.commit()
    
    for heat in heats:
        db.refresh(heat)
    
    return {
        "race": race,
        "round": round_obj,
        "heats": heats,
        "racers": racers
    }


def test_reorder_heats_success(db, test_race):
    """Test successful heat reordering within a round."""
    heats = test_race["heats"]
    
    # Verify initial order
    assert heats[0].heat_number == 1
    assert heats[1].heat_number == 2
    assert heats[2].heat_number == 3
    
    # Reorder: swap heat 1 and heat 3
    heat_updates = [
        {"heat_id": heats[0].id, "new_heat_number": 3},
        {"heat_id": heats[1].id, "new_heat_number": 2},
        {"heat_id": heats[2].id, "new_heat_number": 1},
    ]
    
    response = client.put("/heats/reorder", json={"heat_updates": heat_updates})
    
    if response.status_code != 200:
        print(f"Reorder failed: {response.json()}")

    assert response.status_code == 200
    data = response.json()
    assert data["updated_count"] == 3
    assert len(data["heats"]) == 3
    
    # Verify new order
    db.refresh(heats[0])
    db.refresh(heats[1])
    db.refresh(heats[2])
    
    assert heats[0].heat_number == 3
    assert heats[1].heat_number == 2
    assert heats[2].heat_number == 1


def test_reorder_heats_different_rounds_error(db, test_race):
    """Test that reordering heats from different rounds fails."""
    race = test_race["race"]
    
    # Create a second round with heats
    round2 = models.Round(
        race_id=race.id,
        round_number=2,
        scheduling_strategy=models.SchedulingStrategy.PPC
    )
    db.add(round2)
    db.commit()
    db.refresh(round2)
    
    heat_round2 = models.Heat(
        race_id=race.id,
        round_id=round2.id,
        heat_number=1,
        lane_results=None
    )
    db.add(heat_round2)
    db.commit()
    db.refresh(heat_round2)
    
    # Try to reorder heats from different rounds
    heats = test_race["heats"]
    heat_updates = [
        {"heat_id": heats[0].id, "new_heat_number": 2},
        {"heat_id": heat_round2.id, "new_heat_number": 1},
    ]
    
    response = client.put("/heats/reorder", json={"heat_updates": heat_updates})
    
    assert response.status_code == 400
    assert "different rounds" in response.json()["detail"].lower()


def test_reorder_heats_invalid_heat_id(db, test_race):
    """Test that reordering with invalid heat ID fails."""
    heat_updates = [
        {"heat_id": 99999, "new_heat_number": 1},
    ]
    
    response = client.put("/heats/reorder", json={"heat_updates": heat_updates})
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_reorder_heats_empty_list(db, test_race):
    """Test that reordering with empty list returns empty result."""
    response = client.put("/heats/reorder", json={"heat_updates": []})
    
    assert response.status_code == 200
    data = response.json()
    assert data["updated_count"] == 0
    assert len(data["heats"]) == 0


def test_reorder_heats_persistence(db, test_race):
    """Test that heat reordering persists in the database."""
    heats = test_race["heats"]
    
    # Reorder heats
    heat_updates = [
        {"heat_id": heats[0].id, "new_heat_number": 2},
        {"heat_id": heats[1].id, "new_heat_number": 1},
    ]
    
    response = client.put("/heats/reorder", json={"heat_updates": heat_updates})
    assert response.status_code == 200
    
    # Query database directly to verify persistence
    db.expire_all()  # Clear session cache
    heat1 = db.query(models.Heat).filter(models.Heat.id == heats[0].id).first()
    heat2 = db.query(models.Heat).filter(models.Heat.id == heats[1].id).first()
    
    assert heat1.heat_number == 2
    assert heat2.heat_number == 1


def test_reorder_heats_with_results(db, test_race):
    """Test that heats with results can still be reordered."""
    heats = test_race["heats"]
    racers = test_race["racers"]
    
    # Add results to first heat
    heats[0].lane_results = f'[{{"lane": 1, "racer_id": {racers[0].id}, "time": 3.45}}]'
    db.commit()
    
    # Reorder heats
    heat_updates = [
        {"heat_id": heats[0].id, "new_heat_number": 2},
        {"heat_id": heats[1].id, "new_heat_number": 1},
    ]
    
    response = client.put("/heats/reorder", json={"heat_updates": heat_updates})
    
    assert response.status_code == 200
    data = response.json()
    assert data["updated_count"] == 2
    
    # Verify the heat with results was reordered
    db.refresh(heats[0])
    assert heats[0].heat_number == 2
    assert heats[0].lane_results is not None


def test_crud_reorder_heats_function(db, test_race):
    """Test the CRUD reorder_heats function directly."""
    heats = test_race["heats"]
    
    heat_updates = [
        {"heat_id": heats[0].id, "new_heat_number": 3},
        {"heat_id": heats[1].id, "new_heat_number": 1},
        {"heat_id": heats[2].id, "new_heat_number": 2},
    ]
    
    updated_heats = crud.reorder_heats(db, heat_updates)
    
    assert len(updated_heats) == 3
    # Should be sorted by heat_number
    assert updated_heats[0].heat_number == 1
    assert updated_heats[1].heat_number == 2
    assert updated_heats[2].heat_number == 3
    
    # Verify the actual heats were updated
    assert updated_heats[0].id == heats[1].id
    assert updated_heats[1].id == heats[2].id
    assert updated_heats[2].id == heats[0].id
