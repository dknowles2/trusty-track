from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from . import models
from .main import app, get_db

# Use in-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_schedules.db"

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

def setup_module(module):
    models.Base.metadata.create_all(bind=engine)

def teardown_module(module):
    models.Base.metadata.drop_all(bind=engine)

def test_generate_schedule_not_enough_racers():
    # 1. Setup Config
    client.post("/config/initial", json={
        "group_name": "Schedule Validation Group",
        "lane_count": 4,
        "length_feet": 40,
        "timer_type": "FAKE"
    })
    # If config already exists from other tests (db file persistence), it might return 400, which is fine
    # But usually we drop tables in teardown. 
    # However, if reusing DB file in parallel tests, could be issue. 
    # Using specific DB file name helps isolation if running manually.

    # 2. Add 1 Racer
    racer_data = {
        "first_name": "Lonely",
        "last_name": "Racer",
        "car_number": 99,
        "race_id": 1 # Assuming ID 1 if fresh DB
    }
    # Note: create_racer creates race if missing.
    
    # We need to know the race_id.
    # Get races.
    races_resp = client.get("/races/")
    races = races_resp.json()
    
    if not races:
        # Create racer to fetch race
        client.post("/racers/", json=racer_data)
        races = client.get("/races/").json()
        
    race_id = races[0]["id"]
    
    # Ensure only 1 racer in this race for the test
    # (Clean DB so should be 1 if we just added one, or 0 if we didn't)
    # Let's delete all racers first to be safe?
    # No, teardown setup should handle it.
    
    # Check racer count
    current_racers = client.get(f"/racers/?race_id={race_id}").json()
    if len(current_racers) < 1:
         client.post("/racers/", json=racer_data)
         current_racers = client.get(f"/racers/?race_id={race_id}").json()
    
    # If we have more than 1 (from other tests?), we should maybe clean up.
    # But for a unit test with setup/teardown it should be clean.
    
    # 3. Try to create a round and generate heats - Should FAIL
    # First create a round
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 1,
        "scheduling_strategy": "PPC"
    })
    assert round_response.status_code == 200
    round_id = round_response.json()["id"]
    
    # Try to generate heats for the round
    response = client.post(f"/rounds/{round_id}/generate_heats")
    
    assert response.status_code == 400
    assert "not enough racers" in response.json()["detail"].lower()

def test_generate_schedule_success_with_min_racers():
    # Setup - ensure we have at least 2 racers
    # Get race ID
    races = client.get("/races/").json()
    race_id = races[0]["id"]
    
    # Add second racer
    client.post("/racers/", json={
        "first_name": "Second",
        "last_name": "Racer",
        "car_number": 100,
        "race_id": race_id
    })
    
    # Create a round with Lane Rotation strategy
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 1,
        "scheduling_strategy": "PPC"
    })
    assert round_response.status_code == 200
    round_id = round_response.json()["id"]
    
    # Generate heats for the round - Should SUCCEED
    response = client.post(f"/rounds/{round_id}/generate_heats")
    assert response.status_code == 200
    heats = response.json()
    assert len(heats) > 0
    # For 2 racers, Lane Rotation should generate 2 heats
    assert len(heats) == 2

def test_generate_ppc_schedule():
    # Setup - ensure we have at least 2 racers
    races = client.get("/races/").json()
    race_id = races[0]["id"]
    
    # Create a round with PPC strategy
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 1,
        "scheduling_strategy": "PPC"
    })
    assert round_response.status_code == 200
    round_id = round_response.json()["id"]
    
    # Generate heats for the round
    response = client.post(f"/rounds/{round_id}/generate_heats")
    assert response.status_code == 200
    heats = response.json()
    # For 2 racers, PPC should also generate 2 heats
    assert len(heats) == 2


