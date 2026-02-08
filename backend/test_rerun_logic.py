
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend import models
from backend.main import app, get_db
import uuid
import json
import pytest

# Use in-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_rerun.db"

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

def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"

def test_rerun_last_heat_clears_next_round():
    # 1. Setup Race
    group_name = get_unique_name("Rerun Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]
    
    race_name = get_unique_name("Rerun Race")
    resp_race = client.post("/races/", json={"name": race_name, "group_id": group_id})
    race_id = resp_race.json()["id"]
    
    # 2. Add Racers
    racers = []
    for i in range(4):
         r = client.post("/racers/", json={"first_name": f"R{i}", "last_name": "T", "car_number": i, "race_id": race_id}).json()
         racers.append(r)
         
    # 3. Create General Round
    client.post(f"/races/{race_id}/rounds", json={"race_id": race_id, "round_number": 1, "name": "General"})
    # It autogenerates heats? Wizard does, creating round manual might not efficiently.
    # Check test_main.py: test_create_round_with_name creates round but doesn't mention heats.
    # main.py create_round calls generate_heats_for_round internally.
    
    rounds = client.get(f"/races/{race_id}/rounds").json()
    gen_round_id = rounds[0]["id"]
    
    # 4. Create Championship Round
    client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id, 
        "round_number": 2, 
        "name": "Championship", 
        "advancement_source": "PACK", 
        "advancement_num_racers": 2
    })
    rounds = client.get(f"/races/{race_id}/rounds").json()
    champ_round_id = rounds[1]["id"]
    
    # 5. Run General Round Heats
    heats = client.get(f"/races/{race_id}/heats").json()
    gen_heats = [h for h in heats if h["round_id"] == gen_round_id]
    
    # Fill results
    for heat in gen_heats:
        results = []
        lane_assignment = json.loads(heat["lane_results"])
        for i, lane in enumerate(lane_assignment):
            lane['time'] = 1.0 + (i * 0.1) 
            results.append(lane)
        
        client.put(f"/heats/{heat['id']}", json={
            "id": heat["id"],
            "race_id": race_id,
            "round_id": heat["round_id"],
            "heat_number": heat["heat_number"],
            "lane_results": json.dumps(results)
        })
        
    # 6. Verify Championship Round is Populated
    # Fetch heats again
    heats = client.get(f"/races/{race_id}/heats").json()
    champ_heats = [h for h in heats if h["round_id"] == champ_round_id]
    
    first_heat_results = json.loads(champ_heats[0]["lane_results"])
    # Should have real racer IDs (positive)
    assert any(r['racer_id'] > 0 for r in first_heat_results), "Championship round should be populated after general round finishes"
    
    # 7. Rerun Last Heat of General Round
    last_heat = gen_heats[-1]
    results = json.loads(last_heat["lane_results"])
    for r in results:
        r['time'] = None # Clear times
        
    client.put(f"/heats/{last_heat['id']}", json={
        "id": last_heat["id"],
        "race_id": race_id,
        "round_id": last_heat["round_id"],
        "heat_number": last_heat["heat_number"],
        "lane_results": json.dumps(results)
    })
    
    # 8. Assert Championship Round is Cleared
    heats = client.get(f"/races/{race_id}/heats").json()
    champ_heats_after = [h for h in heats if h["round_id"] == champ_round_id]
    first_heat_results_after = json.loads(champ_heats_after[0]["lane_results"])
    
    # Check if we have positive racer IDs (meaning populated)
    # If successful, should be placeholders (negative) or empty (None)
    has_actual_racers = any(r['racer_id'] is not None and r['racer_id'] > 0 for r in first_heat_results_after)
    
    assert not has_actual_racers, "Championship round should be cleared (reverted to placeholders) after rerunning last heat"

