import json
import uuid

def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"

def test_bulk_operations(client, default_track):
    # 1. Setup Race and Racers
    group_name = get_unique_name("Bulk Group")
    group = client.post("/groups/", json={"name": group_name}).json()
    race_name = get_unique_name("Bulk Race")
    race = client.post("/races/", json={
        "name": race_name, 
        "group_id": group["id"], 
        "track_id": default_track,
        "car_numbering_strategy": "GLOBAL"
    }).json()
    race_id = race["id"]

    racer_ids = []
    for i in range(5):
        r = client.post("/racers/", json={
            "first_name": f"Racer{i}",
            "last_name": "Test",
            "race_id": race_id
        }).json()
        racer_ids.append(r["id"])

    # 2. Test Bulk Auto-Number
    resp = client.post("/racers/bulk_auto_number", json={"racer_ids": racer_ids})
    assert resp.status_code == 200
    assert resp.json()["updated_count"] == 5

    # Verify numbers assigned
    for rid in racer_ids:
        r = client.get(f"/racers/").json()
        # Find this racer
        racer = next(item for item in r if item["id"] == rid)
        assert racer["car_number"] is not None

    # 3. Test Bulk Clear Numbers
    resp = client.post("/racers/bulk_clear_numbers", json={"racer_ids": racer_ids})
    assert resp.status_code == 200
    
    for rid in racer_ids:
        r = client.get(f"/racers/").json()
        racer = next(item for item in r if item["id"] == rid)
        assert racer["car_number"] is None

    # 4. Test Bulk Move to Den
    den = client.post(f"/races/{race_id}/dens/", json={"name": "Bulk Den", "color": "#123456"}).json()
    den_id = den["id"]
    
    resp = client.post("/racers/bulk_move_to_den", json={"racer_ids": racer_ids, "den_id": den_id})
    assert resp.status_code == 200
    
    for rid in racer_ids:
        # We need a way to get a single racer or check the list
        r = client.get(f"/racers/").json()
        racer = next(item for item in r if item["id"] == rid)
        assert racer["den_id"] == den_id

    # 5. Test Bulk Delete
    resp = client.post("/racers/bulk_delete", json={"racer_ids": racer_ids})
    assert resp.status_code == 200
    
    r = client.get(f"/racers/?race_id={race_id}").json()
    assert len(r) == 0
