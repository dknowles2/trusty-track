from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_delete_den_logic():
    # 1. Create a Den
    print("Creating Den...")
    response = client.post(
        "/dens/",
        json={"name": "DeleteMe", "color": "#000000", "rank": "LION"}
    )
    assert response.status_code == 200
    den_id = response.json()["id"]

    # 2. Create a Racer in that Den
    # Need a race first. Assuming race setup from other flows or flexible.
    # We will just try creating a racer.
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
        client.post("/groups/", json={"name": "Delete Test Group"})
        # We rely on crud.create_racer auto-creating race if missing group/race exists but maybe not enough
        # Just ensure a race exists
        # Actually create_racer creates a race if none exists if group exists.
        
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
    response = client.get(f"/racers/?race_id={response.json()[0]['race_id']}" if 'race_id' in response.json() else "/racers/") # Hacky, fetching all racers is safer
    # Actually just use list endpoint, it filters by race_id optionally.
    
    # We don't have get_racer by ID exposed, but we have list.
    response = client.get("/racers/")
    racers = response.json()
    target_racer = next((r for r in racers if r["id"] == racer_id), None)
    
    
    assert target_racer is not None
    assert target_racer["den_id"] is None

def test_edit_den_logic():
    # 1. Create a Den
    response = client.post(
        "/dens/",
        json={"name": "EditMe", "color": "#111111", "rank": "WOLF"}
    )
    assert response.status_code == 200
    den_id = response.json()["id"]

    # 2. Update Den
    response = client.put(
        f"/dens/{den_id}",
        json={"name": "EditedDen", "color": "#222222"} # Rank unchanged
    )
    assert response.status_code == 200
    updated_den = response.json()
    assert updated_den["name"] == "EditedDen"
    assert updated_den["color"] == "#222222"
    assert updated_den["rank"] == "WOLF"

    # 3. Verify changes persist
    response = client.get("/dens/")
    dens = response.json()
    target_den = next((d for d in dens if d["id"] == den_id), None)
    assert target_den["name"] == "EditedDen"
