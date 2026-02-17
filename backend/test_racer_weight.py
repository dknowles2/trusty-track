from fastapi.testclient import TestClient
from .main import app
import uuid


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def test_update_racer_weight(client, default_track):
    # Setup: Create Group, Race, and Racer
    group_name = get_unique_name("Weight Test Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Weight Test Race")
    resp_race = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL",
            "track_id": default_track,
        },
    )
    race_id = resp_race.json()["id"]

    resp_racer = client.post(
        "/racers/",
        json={
            "first_name": "Weight",
            "last_name": "Tester",
            "race_id": race_id,
            "car_number": 99,
            "car_weight": 4.5,
        },
    )
    assert resp_racer.status_code == 200
    racer = resp_racer.json()
    racer_id = racer["id"]
    assert racer["car_weight"] == 4.5

    # Update Weight
    resp_update = client.put(
        f"/racers/{racer_id}",
        json={"first_name": "Weight", "last_name": "Tester", "car_weight": 5.0},
    )
    assert resp_update.status_code == 200
    updated_racer = resp_update.json()
    assert updated_racer["car_weight"] == 5.0

    # Verify via list GET
    resp_list = client.get(f"/racers/?race_id={race_id}")
    assert resp_list.status_code == 200
    racers = resp_list.json()
    racer_in_list = next(r for r in racers if r["id"] == racer_id)
    assert racer_in_list["car_weight"] == 5.0
