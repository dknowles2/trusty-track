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

    # 2. Add 1 Racer
    racer_data = {
        "first_name": "Lonely",
        "last_name": "Racer",
        "car_number": 99,
        "race_id": 1
    }
    
    races_resp = client.get("/races/")
    races = races_resp.json()
    
    if not races:
        client.post("/racers/", json=racer_data)
        races = client.get("/races/").json()
        
    race_id = races[0]["id"]
    
    # Check racer count - ensure exactly 1
    current_racers = client.get(f"/racers/?race_id={race_id}").json()
    if len(current_racers) < 1:
         client.post("/racers/", json=racer_data)
    
    # 3. Try to create a round - Should FAIL because it tries to generate heats
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 1,
        "scheduling_strategy": "PPC"
    })
    assert round_response.status_code == 400
    assert "not enough racers" in round_response.json()["detail"].lower()

def test_generate_schedule_success_with_min_racers():
    # Setup - ensure we have at least 2 racers
    races = client.get("/races/").json()
    race_id = races[0]["id"]
    
    # Ensure 2 racers
    current_racers = client.get(f"/racers/?race_id={race_id}").json()
    while len(current_racers) < 2:
        client.post("/racers/", json={
            "first_name": f"Racer{len(current_racers)}",
            "last_name": "Test",
            "car_number": 100 + len(current_racers),
            "race_id": race_id
        })
        current_racers = client.get(f"/racers/?race_id={race_id}").json()
    
    # Create a round - Should SUCCEED and generate heats
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 1,
        "scheduling_strategy": "PPC"
    })
    assert round_response.status_code == 200
    rounds = round_response.json()
    assert len(rounds) > 0
    round_id = rounds[0]["id"]
    
    # Verify heats exist
    response = client.get(f"/races/{race_id}/heats")
    assert response.status_code == 200
    all_heats = response.json()
    round_heats = [h for h in all_heats if h["round_id"] == round_id]
    assert len(round_heats) == 2

def test_generate_ppc_schedule():
    # Setup - ensure we have at least 2 racers
    races = client.get("/races/").json()
    race_id = races[0]["id"]
    
    # Create another round
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 2,
        "scheduling_strategy": "PPC",
        "name": "PPC Round"
    })
    assert round_response.status_code == 200
    rounds = round_response.json()
    round_id = rounds[0]["id"]
    
    # Verify heats exist
    response = client.get(f"/races/{race_id}/heats")
    all_heats = response.json()
    round_heats = [h for h in all_heats if h["round_id"] == round_id]
    assert len(round_heats) == 2


