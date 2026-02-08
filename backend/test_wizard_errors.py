from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .database import Base
from .main import app, get_db
from . import models
import pytest

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_wizard_crash.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

def test_wizard_crash_repro(db):
    # 1. Create a Race
    race_data = {
        "name": "Test Race",
        "group_id": 1  # Assuming this isn't strictly checked for existence in this minimal repro
    }
    # We might need a group first if foreign keys are enforced?
    # Let's check models.py... yes, ForeginKey("racing_groups.id")
    # Create a dummy group associated with a race? 
    # Actually models.RacingGroup has race_id which is NOT NULL.
    # But models.Race has group_id? Circular dependency or I'm misremembering.
    # Let's check models.py
    
    # Checking models.py logic from memory: 
    # Race has group_id (ForeignKey("racing_groups.id"))
    # RacingGroup has race_id (ForeignKey("races.id"))
    # This circular dependency makes creation hard.
    # Usually we create race first with group_id=None, then group, then update race.
    
    # Correct dependency order:
    # 1. Group
    # 2. Race (needs group_id)
    # 3. RacingGroup (needs race_id)
    
    group_obj = models.Group(name="Test Group")
    db.add(group_obj)
    db.commit()
    db.refresh(group_obj)
    
    race = models.Race(name="Test Race", group_id=group_obj.id)
    db.add(race)
    db.commit()
    db.refresh(race)

    racing_group = models.RacingGroup(name="Test Racing Group", race_id=race.id)
    db.add(racing_group)
    db.commit()
    db.refresh(racing_group)
    
    # 2. Add some racers (just in case logic depends on them)
    # create den
    den = models.Den(name="Den 1", race_id=race.id)
    db.add(den)
    db.commit()
    db.refresh(den)
    
    racer = models.Racer(first_name="John", last_name="Doe", race_id=race.id, den_id=den.id)
    db.add(racer)
    db.commit()
    
    # 3. Call Wizard with NO championship rounds (just general)
    # This should fail if we only have 1 racer (ValueError from crud.py)
    payload_no_champ = {
        "general_round": {
            "type": "PACK",
            "runs_per_lane": 1
        },
        "championship_rounds": []
    }
    
    # We expect this to raise a 400 Bad Request now
    try:
        response = client.post(f"/races/{race.id}/wizard", json=payload_no_champ)
        print(f"\nResponse (No Champ, 1 racer): {response.status_code} - {response.text}")
        assert response.status_code == 400
        assert "Not enough racers" in response.text
    except Exception as e:
        print(f"caught exception: {e}")
        # If the client raises an exception for 400, catch it. 
        # But TestClient usually returns response for 400.
    
    # Reset for next attempt (rounds exist now, so wizard would block)
    race2 = models.Race(name="Test Race 2", group_id=group_obj.id)
    db.add(race2)
    db.commit()
    db.refresh(race2)

    # Add racers to race2 so it succeeds
    den2 = models.Den(name="Den 2", race_id=race2.id)
    db.add(den2)
    db.commit()
    db.refresh(den2)
    
    racer2a = models.Racer(first_name="Jane", last_name="Doe", race_id=race2.id, den_id=den2.id)
    racer2b = models.Racer(first_name="Jack", last_name="Smith", race_id=race2.id, den_id=den2.id)
    db.add(racer2a)
    db.add(racer2b)
    db.commit()
    
    # 4. Call Wizard WITH championship rounds
    payload_with_champ = {
        "general_round": {
            "type": "PACK",
            "runs_per_lane": 1
        },
        "championship_rounds": [
            {
                "name": "Finals",
                "source": "PACK",
                "num_top_racers": 3,
                "runs_per_lane": 1
            }
        ]
    }
    
    response = client.post(f"/races/{race2.id}/wizard", json=payload_with_champ)
    print(f"\nResponse (With Champ): {response.status_code} - {response.text}")
    assert response.status_code == 200

    # 5. Call Wizard with BAD PAYLOAD (e.g. missing fields)
    race3 = models.Race(name="Test Race 3", group_id=group_obj.id)
    db.add(race3)
    db.commit()

    payload_bad = {
        "general_round": {
            "type": "PACK",
            "runs_per_lane": "not_an_integer"
        },
        "championship_rounds": []
    }
    # This should fail 422 validation, not 500
    response = client.post(f"/races/{race3.id}/wizard", json=payload_bad)
    print(f"\nResponse (Bad Payload): {response.status_code} - {response.text}")
    assert response.status_code == 422
