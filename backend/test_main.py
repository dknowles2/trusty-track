from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_read_main():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"Hello": "World"}

def test_create_group():
    response = client.post(
        "/groups/",
        json={"name": "Pack 123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Pack 123"
    assert "id" in data

def test_create_race():
    # First create a group
    client.post("/groups/", json={"name": "Pack 456"})
    group_response = client.get("/groups/1") # Assuming ID 1 if test DB is fresh, but safer to query or rely on flow
    # Actually this relies on persistent DB if we don't tear down.
    # For now let's just use a known group ID from the previous test or new one.
    
    # We need to get the group ID we just created
    response = client.post("/groups/", json={"name": "Pack 789"})
    group_id = response.json()["id"]

    response = client.post(
        "/races/",
        json={
            "name": "Pinewood Derby 2024",
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL"
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Pinewood Derby 2024"
    assert data["group_id"] == group_id

