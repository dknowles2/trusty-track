from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend import models
from backend.main import app, get_db
import uuid
import json

# Use in-memory SQLite for testing

client = TestClient(app)


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"

def test_create_round_with_name():
    # Setup
    group_name = get_unique_name("Round Name Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Round Name Race")
    resp_race = client.post(
        "/races/",
        json={"name": race_name, "group_id": group_id, "car_numbering_strategy": "MANUAL"},
    )
    race_id = resp_race.json()["id"]

    # Add racers so heat generation doesn't fail
    for i in range(2):
        client.post("/racers/", json={
            "first_name": f"Racer{i}",
            "last_name": "Test",
            "car_number": 10 + i,
            "race_id": race_id
        })

    resp_round1 = client.post(
        f"/races/{race_id}/rounds",
        json={"race_id": race_id, "round_number": 1, "scheduling_strategy": "PPC"}
    )
    assert resp_round1.status_code == 200
    rounds1 = resp_round1.json()
    assert isinstance(rounds1, list)
    assert rounds1[0]["name"] == "All Pack" # Default name for PACK

    resp_round2 = client.post(
        f"/races/{race_id}/rounds",
        json={"race_id": race_id, "round_number": 2, "scheduling_strategy": "PPC", "name": "Semi-Finals"}
    )
    assert resp_round2.status_code == 200
    rounds2 = resp_round2.json()
    assert rounds2[0]["name"] == "Semi-Finals"

    # Verify endpoint returns it
    resp_get = client.get(f"/races/{race_id}/rounds")
    rounds = resp_get.json()
    assert len(rounds) == 2
    assert rounds[1]["name"] == "Semi-Finals"

def test_create_championship_round_fails_without_general():
    # Setup
    group_name = get_unique_name("Champ Fail Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Champ Fail Race")
    resp_race = client.post(
        "/races/",
        json={"name": race_name, "group_id": group_id, "car_numbering_strategy": "MANUAL"},
    )
    race_id = resp_race.json()["id"]

    # Try to create championship round immediately
    resp = client.post(
        f"/races/{race_id}/rounds",
        json={
            "race_id": race_id,
            "advancement_source": "PACK",
            "advancement_num_racers": 3
        }
    )
    assert resp.status_code == 400
    assert "no general rounds exist" in resp.json()["detail"]

def test_delete_round_restriction_with_results():
    """Test that a round cannot be deleted if it has heats with results."""
    # 1. Create a group then a race
    group_name = get_unique_name("Deletion Test Group")
    group = client.post("/groups/", json={"name": group_name}).json()
    group_id = group["id"]
    
    race_data = {"name": "Deletion Test Race", "lane_count": 4, "group_id": group_id}
    race = client.post("/races/", json=race_data).json()
    race_id = race["id"]
    
    # 2. Add racers
    for i in range(1, 5):
        resp = client.post("/racers/", json={
            "first_name": f"Racer{i}",
            "last_name": "Test",
            "car_number": i,
            "race_id": race_id,
            "den_id": None
        })
        assert resp.status_code == 200, f"Racer creation failed: {resp.json()}"

    # 3. Add a round
    round_data = {"name": "Test Round", "runs_per_lane": 1, "general_type": "PACK", "race_id": race_id}
    resp = client.post(f"/races/{race_id}/rounds", json=round_data)
    round_list = resp.json()
    assert resp.status_code == 200, f"Round creation failed: {round_list}"
    round_id = round_list[0]["id"]
    
    # 4. Get heats and add result to one
    heats = client.get(f"/races/{race_id}/heats").json()
    heat_id = heats[0]["id"]
    resp = client.put(f"/heats/{heat_id}", json={
        "id": heat_id,
        "race_id": race_id,
        "round_id": round_id,
        "heat_number": 1,
        "round_number": 1,
        "lane_results": json.dumps([{"lane": 1, "racer_id": 1, "time": 3.45}]),
        "total_participants": len(heats) # Just for completeness
    })
    assert resp.status_code == 200, f"Heat update failed: {resp.json()}"
    
    # 5. Try to delete the round - should fail
    resp = client.delete(f"/rounds/{round_id}")
    assert resp.status_code == 400
    assert "has heats with results" in resp.json()["detail"]
    
    # 6. Clear result and try again - should succeed
    resp = client.put(f"/heats/{heat_id}", json={
        "id": heat_id,
        "race_id": race_id,
        "round_id": round_id,
        "heat_number": 1,
        "round_number": 1,
        "lane_results": json.dumps([{"lane": 1, "racer_id": 1, "time": None}]),
        "total_participants": len(heats)
    })
    assert resp.status_code == 200, f"Heat clear failed: {resp.json()}"
    
    resp = client.delete(f"/rounds/{round_id}")
    assert resp.status_code == 200
    assert resp.json()["message"] == "Round deleted"

def test_delete_round_restriction_with_championship():
    """Test that a general round cannot be deleted if a championship round exists."""
    # 1. Setup race and racers
    group_name = get_unique_name("Champ Deletion Group")
    group = client.post("/groups/", json={"name": group_name}).json()
    race_id = client.post("/races/", json={"name": "Champ Race", "lane_count": 4, "group_id": group["id"]}).json()["id"]
    for i in range(1, 5):
        client.post("/racers/", json={"first_name": f"R{i}", "last_name": "T", "car_number": i, "race_id": race_id, "den_id": None})

    # 2. Add General Round
    round_data = {"name": "General", "runs_per_lane": 1, "general_type": "PACK", "race_id": race_id}
    gen_round_id = client.post(f"/races/{race_id}/rounds", json=round_data).json()[0]["id"]
    
    # 3. Add Championship Round
    champ_data = {
        "name": "Finals", 
        "runs_per_lane": 1, 
        "advancement_source": "PACK", 
        "advancement_num_racers": 3,
        "race_id": race_id,
        "scheduling_strategy": "PPC"
    }
    client.post(f"/races/{race_id}/rounds", json=champ_data)
    
    # 4. Try to delete general round - should fail
    resp = client.delete(f"/rounds/{gen_round_id}")
    assert resp.status_code == 400
    assert "championship rounds are already scheduled" in resp.json()["detail"]

def test_read_main():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"Hello": "World"}

def test_create_group():
    # Use unique name
    name = get_unique_name("Pack")
    response = client.post(
        "/groups/",
        json={"name": name},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == name
    assert "id" in data

def test_create_race():
    # Create unique group
    group_name = get_unique_name("Pack Race Test")
    resp_group = client.post("/groups/", json={"name": group_name})
    if resp_group.status_code == 400:
        # If it exists, try to find it (though unique name avoids this usually)
        # But for robustness, just assert we got a group
         assert resp_group.status_code == 200
    
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Pinewood Derby")
    response = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL"
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == race_name
    assert data["group_id"] == group_id

def test_create_den_and_racer():
    # Create a Race first
    group_name = get_unique_name("Pack Racer Test")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Den Test Race")
    resp_race = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL"
        },
    )
    race_id = resp_race.json()["id"]

    # Create a Den
    den_name = get_unique_name("Lion")
    # New API: /races/{race_id}/dens/
    response = client.post(
        f"/races/{race_id}/dens/",
        json={"name": den_name, "color": "#FFD700", "rank": "LION"}
    )
    assert response.status_code == 200
    den_data = response.json()
    assert den_data["name"] == den_name
    den_id = den_data["id"] 
    # Ensure race_id is in response
    assert den_data["race_id"] == race_id

    response = client.post(
        "/racers/",
        json={
            "first_name": "Johnny",
            "last_name": "Bravo",
            "den_id": den_id,
            "race_id": race_id, # Added race_id here as it's required generally
            "car_number": 101,
            "car_passed_inspection": True
        }
    )
    assert response.status_code == 200
    racer_data = response.json()
    assert racer_data["first_name"] == "Johnny"
    assert racer_data["den_id"] == den_id


def test_delete_race():
    # Setup: Create Group and Race
    group_name = get_unique_name("Delete Test Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Delete Test Race")
    resp_race = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL"
        },
    )
    assert resp_race.status_code == 200
    race_id = resp_race.json()["id"]

    # Verify race exists
    resp_get = client.get(f"/races/{race_id}")
    assert resp_get.status_code == 200

    # Delete Race
    resp_delete = client.delete(f"/races/{race_id}")
    assert resp_delete.status_code == 200
    assert resp_delete.json()["message"] == "Race deleted successfully"

    # Verify race is gone
    resp_get_after = client.get(f"/races/{race_id}")
    assert resp_get_after.status_code == 404


def test_round_advancement_from_successor():
    """
    Test that a round with no advancement source (General) will show advancement info
    if a subsequent round depends on it.
    """
    # 1. Setup Race
    group_name = get_unique_name("Adv Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group = resp_group.json()
    resp_race = client.post("/races/", json={"name": get_unique_name("Adv Race"), "group_id": group["id"]})
    race = resp_race.json()
    race_id = race["id"]
    
    # 2. Add Racers
    r1 = client.post("/racers/", json={"first_name": "Fast", "last_name": "Racer", "car_number": 1, "race_id": race_id}).json()
    r2 = client.post("/racers/", json={"first_name": "Slow", "last_name": "Racer", "car_number": 2, "race_id": race_id}).json()
    
    # 3. Create Rounds
    # Round 1: General (source=None)
    r1_resp = client.post(f"/races/{race_id}/rounds", json={"race_id": race_id, "round_number": 1, "name": "General"})
    round1_id = r1_resp.json()[0]["id"]
    
    # Round 2: Championship (source="PACK", num=1)
    r2_data = {
        "race_id": race_id, 
        "round_number": 2, 
        "name": "Championship", 
        "advancement_source": "PACK", 
        "advancement_num_racers": 1
    }
    client.post(f"/races/{race_id}/rounds", json=r2_data)
    
    # 4. Create Heat & Results for Round 1
    client.post(f"/rounds/{round1_id}/generate_heats")
    heats = client.get(f"/races/{race_id}/heats").json()
    # Filter for round 1
    heat1 = next(h for h in heats if h["round_id"] == round1_id)
    
    # Update results: Racer 1 wins
    lane_results = [
        {"lane": 1, "racer_id": r1["id"], "time": 3.0},
        {"lane": 2, "racer_id": r2["id"], "time": 4.0}
    ]
    client.put(f"/heats/{heat1['id']}", json={
        "id": heat1["id"],
        "race_id": race_id,
        "round_id": round1_id,
        "heat_number": heat1["heat_number"],
        "round_number": 1,
        "lane_results": json.dumps(lane_results),
        "total_participants": 2
    })
    
    # 5. Check Advancement Status
    resp = client.get(f"/races/{race_id}/rounds/{round1_id}/advancement_status")
    assert resp.status_code == 200
    status = resp.json()
    
    # Verify that it picked up Round 2's rules
    assert status["requires_advancement"] == True
    assert status["source"] == "PACK"
    assert status["num_racers"] == 1
    
    adv_racers = status["advancing_racers"]
    # Find racer 1
    winner = next(r for r in adv_racers if r["racer_id"] == r1["id"])
    assert winner["is_advancing"] == True
    
    loser = next(r for r in adv_racers if r["racer_id"] == r2["id"])
    assert loser["is_advancing"] == False

