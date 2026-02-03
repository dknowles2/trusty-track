from fastapi.testclient import TestClient
from backend.main import app
import uuid

client = TestClient(app)

def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"

def test_verification_scenario():
    """
    Replicates setup_verification.py logic in a test.
    1. Initialize config
    2. Create two races
    """
    # 1. Initialize system
    # This might fail if already initialized, so we catch or inspect status
    # But for a test running against a fresh DB (if setup properly), it should work.
    # However, since we are running against the dev DB potentially, we should check status first.
    
    # Just try to init, ignore 400 if already done
    client.post("/config/initial", json={
        "group_name": "Scouts Test Verification",
        "lane_count": 4,
        "timer_type": "FAKE"
    })

    # Ensure we can get a group ID (assuming id=1 exists or we make one)
    # Let's clean up by creating a fresh group for this test run to be safe
    group_name = get_unique_name("Verification Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    assert resp_group.status_code == 200
    group_id = resp_group.json()["id"]

    # 2. Create Race A
    race_a_name = get_unique_name("Race A")
    resp_a = client.post("/races/", json={
        "name": race_a_name,
        "group_id": group_id,
        "date_time": "2023-10-27T10:00",
        "location": "Test Location A"
    })
    assert resp_a.status_code == 200
    race_a_id = resp_a.json()["id"]
    print(f"Created Race A: {race_a_id}")

    # 3. Create Race B
    race_b_name = get_unique_name("Race B")
    resp_b = client.post("/races/", json={
        "name": race_b_name,
        "group_id": group_id,
        "date_time": "2023-10-28T10:00",
        "location": "Test Location B"
    })
    assert resp_b.status_code == 200
    race_b_id = resp_b.json()["id"]
    print(f"Created Race B: {race_b_id}")

    assert race_a_id != race_b_id
