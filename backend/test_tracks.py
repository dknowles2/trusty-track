from fastapi.testclient import TestClient
from backend.main import app
import uuid

client = TestClient(app)


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def test_track_crud():
    # 1. Initial Setup with multiple tracks
    group_name = get_unique_name("Track Test Group")
    init_data = {
        "group_name": group_name,
        "tracks": [
            {
                "name": "Track A",
                "lane_count": 4,
                "length_feet": 40,
                "timer_type": "FAKE",
            },
            {
                "name": "Track B",
                "lane_count": 6,
                "length_feet": 50,
                "timer_type": "FAKE",
            },
        ],
    }
    resp = client.post("/config/initial", json=init_data)
    assert resp.status_code == 200
    data = resp.json()
    assert data["initialized"] == True
    assert len(data["tracks"]) == 2
    assert data["tracks"][0]["name"] == "Track A"
    assert data["tracks"][1]["name"] == "Track B"

    track_a_id = data["tracks"][0]["id"]
    track_b_id = data["tracks"][1]["id"]

    # 2. Add another track
    resp = client.post(
        "/tracks/", json={"name": "Track C", "lane_count": 8, "timer_type": "FAKE"}
    )
    assert resp.status_code == 200
    track_c = resp.json()
    assert track_c["name"] == "Track C"
    track_c_id = track_c["id"]

    # 3. List tracks
    resp = client.get("/tracks/")
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 3

    # 4. Update track
    resp = client.put(
        f"/tracks/{track_c_id}", json={"name": "Updated Track C", "lane_count": 2}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Track C"

    # 5. Create races on different tracks
    resp_group = client.post("/groups/", json={"name": get_unique_name("Race Group")})
    group_id = resp_group.json()["id"]

    race_a_resp = client.post(
        "/races/",
        json={
            "name": get_unique_name("Race A"),
            "group_id": group_id,
            "track_id": track_a_id,
        },
    )
    assert race_a_resp.status_code == 200
    race_a = race_a_resp.json()
    assert race_a["track_id"] == track_a_id

    race_b_resp = client.post(
        "/races/",
        json={
            "name": get_unique_name("Race B"),
            "group_id": group_id,
            "track_id": track_b_id,
        },
    )
    assert race_b_resp.status_code == 200
    race_b = race_b_resp.json()
    assert race_b["track_id"] == track_b_id

    # 6. Delete track (should fail if race associated)
    resp = client.delete(f"/tracks/{track_a_id}")
    assert resp.status_code == 400
    assert "associated with one or more races" in resp.json()["detail"]

    # Delete unused track
    resp = client.delete(f"/tracks/{track_c_id}")
    assert resp.status_code == 200
    assert resp.json()["ok"] == True


def test_race_track_association_update():
    # Setup
    group_name = get_unique_name("Update Test Group")
    init_data = {
        "group_name": group_name,
        "tracks": [{"name": "T1", "lane_count": 4}, {"name": "T2", "lane_count": 6}],
    }
    client.post("/config/initial", json=init_data)

    resp_tracks = client.get("/tracks/")
    t1_id = resp_tracks.json()[0]["id"]
    t2_id = resp_tracks.json()[1]["id"]

    resp_group = client.post("/groups/", json={"name": get_unique_name("Update Group")})
    group_id = resp_group.json()["id"]

    race_resp = client.post(
        "/races/",
        json={
            "name": get_unique_name("Update Race"),
            "group_id": group_id,
            "track_id": t1_id,
        },
    )
    race = race_resp.json()
    race_id = race["id"]

    # Update track_id
    resp = client.put(f"/races/{race_id}", json={"track_id": t2_id})
    assert resp.status_code == 200
    assert resp.json()["track_id"] == t2_id
