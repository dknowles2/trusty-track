from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from . import models
from .main import app, get_db


def create_test_race(client):
    resp = client.post("/groups/", json={"name": "Schedule Group"})
    assert resp.status_code == 200, f"Create group failed: {resp.text}"
    group = resp.json()
    group_id = group["id"]
    
    resp_race = client.post("/races/", json={
        "name": "Schedule Race",
        "group_id": group_id,
        "car_numbering_strategy": "MANUAL"
    })
    assert resp_race.status_code == 200, f"Create race failed: {resp_race.text}"
    
    races = client.get("/races/").json()
    if not races:
         # Fallback if racing logic is weird
         pass
    return races[0]["id"]

def test_generate_schedule_not_enough_racers(client):
    race_id = create_test_race(client)
    
    # 2. Add 1 Racer
    racer_data = {
        "first_name": "Lonely",
        "last_name": "Racer",
        "car_number": 99,
        "race_id": race_id
    }
    client.post("/racers/", json=racer_data)
    
    # 3. Try to create a round - Should FAIL because it tries to generate heats
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 1,
        "scheduling_strategy": "PPC"
    })
    assert round_response.status_code == 400
    assert "not enough racers" in round_response.json()["detail"].lower()

def test_generate_schedule_success_with_min_racers(client):
    race_id = create_test_race(client)
    
    # Ensure 2 racers
    for i in range(2):
        client.post("/racers/", json={
            "first_name": f"Racer{i}",
            "last_name": "Test",
            "car_number": 100 + i,
            "race_id": race_id
        })
    
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

def test_generate_ppc_schedule(client):
    race_id = create_test_race(client)
    
    # Ensure 2 racers
    for i in range(2):
        client.post("/racers/", json={
            "first_name": f"PPC_Racer{i}",
            "last_name": "Test",
            "car_number": 200 + i,
            "race_id": race_id
        })
        
    # Create a round
    round_response = client.post(f"/races/{race_id}/rounds", json={
        "race_id": race_id,
        "round_number": 1,
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


