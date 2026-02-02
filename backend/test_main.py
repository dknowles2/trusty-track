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

def test_create_den_and_racer():
    # Create a Den
    response = client.post(
        "/dens/",
        json={"name": "Lion", "color": "#FFD700", "rank": "LION"}
    )
    assert response.status_code == 200
    den_data = response.json()
    assert den_data["name"] == "Lion"
    den_id = den_data["id"]

    # Create a Racer in that Den
    # We need a race first. We can rely on the previous tests having created one or create one here.
    # To be safe and independent, let's create a group and race.
    client.post("/groups/", json={"name": "Pack Test Den"})
    g_res = client.get("/groups/1") # ID might vary, but let's assume auto-increment or just fetch all
    # Actually, simpler to just get the first race if it exists or create new
    
    # Let's just try creating a racer, letting the backend handle race creation if needed (it does fallback)
    # But crud.create_racer logic needing a race might fail if no race exists and no group exists.
    # We created groups in previous tests.
    
    response = client.post(
        "/racers/",
        json={
            "first_name": "Johnny",
            "last_name": "Bravo",
            "den_id": den_id,
            "car_number": 101,
            "car_passed_inspection": True
        }
    )
    assert response.status_code == 200
    racer_data = response.json()
    assert racer_data["first_name"] == "Johnny"
    assert racer_data["den_id"] == den_id

