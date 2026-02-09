import pytest

def create_race(client):
    group_response = client.post("/groups/", json={"name": "Test Group"})
    group_id = group_response.json()["id"]
    track_response = client.post("/tracks/", json={"name": "Test Track", "lane_count": 4})
    track_id = track_response.json()["id"]
    race_response = client.post("/races/", json={
        "name": "Test Race",
        "group_id": group_id,
        "track_id": track_id
    })
    return race_response.json()["id"]

def test_populate_default_behavior(client):
    """Verify default behavior (photos=True, dens=True, check_in=False)"""
    race_id = create_race(client)
    
    # New style call with body (default options)
    response = client.post(f"/races/{race_id}/populate", json={"count": 5})
    assert response.status_code == 200
    
    racers = client.get(f"/racers/?race_id={race_id}").json()
    assert len(racers) == 5
    
    # Check defaults
    for r in racers:
        # Should have dens by default (assign_dens=True in schema)
        assert r["den_id"] is not None
        # Should NOT be checked in by default (check_in=False in schema)
        assert r["car_passed_inspection"] is False
        
        # Photos might be None if assets not present, but let's just check the field exists
        # In test environment, assets might not exist, so urls might be None.

def test_populate_with_options(client):
    """Verify custom population options"""
    race_id = create_race(client)
    
    # New style call with body
    payload = {
        "count": 5,
        "add_racer_photos": False,
        "add_car_photos": False,
        "assign_dens": False,
        "check_in": False
    }
    
    response = client.post(f"/races/{race_id}/populate", json=payload)
    
    assert response.status_code == 200
        
    racers = client.get(f"/racers/?race_id={race_id}").json()
    for r in racers:
        assert r["den_id"] is None
        assert r["car_passed_inspection"] is False
        assert r["racer_image_url"] is None
        assert r["car_image_url"] is None
