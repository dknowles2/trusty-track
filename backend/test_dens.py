from fastapi.testclient import TestClient
from backend.main import app
import uuid

client = TestClient(app)

def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"

def test_delete_den_logic():
    # 1. Create a Den
    print("Creating Den...")
    den_name = get_unique_name("DeleteMe")
    response = client.post(
        "/dens/",
        json={"name": den_name, "color": "#000000", "rank": "LION"}
    )
    assert response.status_code == 200
    den_id = response.json()["id"]

    # 2. Create a Racer in that Den
    print("Creating Racer...")
    response = client.post(
        "/racers/",
        json={
            "first_name": "Gone",
            "last_name": "Soon",
            "den_id": den_id,
            "car_number": 999,
            "car_passed_inspection": True
        }
    )
    if response.status_code != 200:
        # Maybe race missing, try creating group/race first
        client.post("/groups/", json={"name": get_unique_name("Delete Test Group")})
        
        # Retry
        response = client.post(
             "/racers/",
             json={
                 "first_name": "Gone",
                 "last_name": "Soon",
                 "den_id": den_id,
                 "car_number": 999,
                 "car_passed_inspection": True
             }
         )
         
    assert response.status_code == 200
    racer_id = response.json()["id"]
    assert response.json()["den_id"] == den_id

    # 3. Delete the Den
    print("Deleting Den...")
    response = client.delete(f"/dens/{den_id}")
    assert response.status_code == 200

    # 4. Verify Den is gone
    response = client.get("/dens/")
    dens = response.json()
    assert not any(d["id"] == den_id for d in dens)

    # 5. Verify Racer is still there but den_id is None
    response = client.get("/racers/")
    racers = response.json()
    target_racer = next((r for r in racers if r["id"] == racer_id), None)
    
    assert target_racer is not None
    assert target_racer["den_id"] is None

def test_edit_den_logic():
    # 1. Create a Den
    den_name = get_unique_name("EditMe")
    response = client.post(
        "/dens/",
        json={"name": den_name, "color": "#111111", "rank": "WOLF"}
    )
    assert response.status_code == 200
    den_id = response.json()["id"]

    # 2. Update Den
    new_name = get_unique_name("EditedDen")
    response = client.put(
        f"/dens/{den_id}",
        json={"name": new_name, "color": "#222222"} # Rank unchanged
    )
    assert response.status_code == 200
    updated_den = response.json()
    assert updated_den["name"] == new_name
    assert updated_den["color"] == "#222222"
    assert updated_den["rank"] == "WOLF"

    # 3. Verify changes persist
    response = client.get("/dens/")
    dens = response.json()
    target_den = next((d for d in dens if d["id"] == den_id), None)
    assert target_den["name"] == new_name
