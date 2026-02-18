import uuid

from fastapi.testclient import TestClient

from backend.main import app

# client = TestClient(app) # Remove global client to use fixture


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def create_race_context(client, track_id: int):
    # Helper to create a race and return its ID
    group_name = get_unique_name("Test Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Test Race")
    resp_race = client.post(
        "/races/",
        json={"name": race_name, "group_id": group_id, "track_id": track_id},
    )
    return resp_race.json()["id"]


def test_delete_den_logic(client, default_track):
    race_id = create_race_context(client, default_track)

    # 1. Create a Den
    print("Creating Den...")
    den_name = get_unique_name("DeleteMe")
    response = client.post(
        f"/races/{race_id}/dens/",
        json={"name": den_name, "color": "#000000", "rank": "LION"},
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
            "race_id": race_id,
            "car_number": 999,
            "car_passed_inspection": True,
        },
    )

    assert response.status_code == 200
    racer_id = response.json()["id"]
    assert response.json()["den_id"] == den_id

    # 3. Delete the Den (Global endpoint based on main.py check)
    print("Deleting Den...")
    # Assuming delete is still /dens/{id} or /races/{race_id}/dens/{id}?
    # I need to check main.py. If I haven't changed it, it is likely /dens/{id}.
    # But usually REST follows hierarchy.
    # Let's assume global for ID-based ops unless I verify otherwise.
    # The previous test used /dens/{id}.
    response = client.delete(f"/dens/{den_id}")
    assert response.status_code == 200

    # 4. Verify Den is gone from the list
    response = client.get(f"/races/{race_id}/dens/")
    dens = response.json()
    assert not any(d["id"] == den_id for d in dens)

    # 5. Verify Racer is still there but den_id is None
    response = client.get(f"/racers/?race_id={race_id}")
    racers = response.json()
    target_racer = next((r for r in racers if r["id"] == racer_id), None)

    assert target_racer is not None
    assert target_racer["den_id"] is None


def test_edit_den_logic(client, default_track):
    race_id = create_race_context(client, default_track)

    # 1. Create a Den
    den_name = get_unique_name("EditMe")
    response = client.post(
        f"/races/{race_id}/dens/",
        json={"name": den_name, "color": "#111111", "rank": "WOLF"},
    )
    assert response.status_code == 200
    den_id = response.json()["id"]

    # 2. Update Den (Global endpoint?)
    new_name = get_unique_name("EditedDen")
    # Assuming PUT is /dens/{id} or /races/{race_id}/dens/{id}
    # Main.py check needed.
    response = client.put(
        f"/dens/{den_id}",
        json={"name": new_name, "color": "#222222"},  # Rank unchanged
    )
    if response.status_code == 404:
        # Maybe it moved to /races/... ?
        # Or I haven't implemented PUT properly for new schema?
        pass

    assert response.status_code == 200
    updated_den = response.json()
    assert updated_den["name"] == new_name
    assert updated_den["color"] == "#222222"
    assert updated_den["rank"] == "WOLF"

    # 3. Verify changes persist
    response = client.get(f"/races/{race_id}/dens/")
    dens = response.json()
    target_den = next((d for d in dens if d["id"] == den_id), None)
    assert target_den["name"] == new_name
