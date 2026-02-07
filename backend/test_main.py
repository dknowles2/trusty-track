from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend import models
from backend.main import app, get_db
import uuid

# Use in-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_main.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

def setup_module(module):
    models.Base.metadata.create_all(bind=engine)

def teardown_module(module):
    models.Base.metadata.drop_all(bind=engine)

def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"

def test_create_round_with_name():
    # Setup
    group_name = get_unique_name("Round Name Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Round Name Race")
    resp_race = client.post(
        "/races/",
        json={"name": race_name, "group_id": group_id, "car_numbering_strategy": "MANUAL"},
    )
    race_id = resp_race.json()["id"]

    resp_round1 = client.post(
        f"/races/{race_id}/rounds",
        json={"race_id": race_id, "round_number": 1, "scheduling_strategy": "PPC"}
    )
    assert resp_round1.status_code == 200
    assert resp_round1.json()["name"] is None

    resp_round2 = client.post(
        f"/races/{race_id}/rounds",
        json={"race_id": race_id, "round_number": 2, "scheduling_strategy": "PPC", "name": "Semi-Finals"}
    )
    assert resp_round2.status_code == 200
    assert resp_round2.json()["name"] == "Semi-Finals"

    # Verify endpoint returns it
    resp_get = client.get(f"/races/{race_id}/rounds")
    rounds = resp_get.json()
    assert len(rounds) == 2
    assert rounds[1]["name"] == "Semi-Finals"

def test_read_main():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"Hello": "World"}

def test_create_group():
    # Use unique name
    name = get_unique_name("Pack")
    response = client.post(
        "/groups/",
        json={"name": name},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == name
    assert "id" in data

def test_create_race():
    # Create unique group
    group_name = get_unique_name("Pack Race Test")
    resp_group = client.post("/groups/", json={"name": group_name})
    if resp_group.status_code == 400:
        # If it exists, try to find it (though unique name avoids this usually)
        # But for robustness, just assert we got a group
         assert resp_group.status_code == 200
    
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Pinewood Derby")
    response = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL"
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == race_name
    assert data["group_id"] == group_id

def test_create_den_and_racer():
    # Create a Race first
    group_name = get_unique_name("Pack Racer Test")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Den Test Race")
    resp_race = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL"
        },
    )
    race_id = resp_race.json()["id"]

    # Create a Den
    den_name = get_unique_name("Lion")
    # New API: /races/{race_id}/dens/
    response = client.post(
        f"/races/{race_id}/dens/",
        json={"name": den_name, "color": "#FFD700", "rank": "LION"}
    )
    assert response.status_code == 200
    den_data = response.json()
    assert den_data["name"] == den_name
    den_id = den_data["id"] 
    # Ensure race_id is in response
    assert den_data["race_id"] == race_id

    response = client.post(
        "/racers/",
        json={
            "first_name": "Johnny",
            "last_name": "Bravo",
            "den_id": den_id,
            "race_id": race_id, # Added race_id here as it's required generally
            "car_number": 101,
            "car_passed_inspection": True
        }
    )
    assert response.status_code == 200
    racer_data = response.json()
    assert racer_data["first_name"] == "Johnny"
    assert racer_data["den_id"] == den_id


def test_delete_race():
    # Setup: Create Group and Race
    group_name = get_unique_name("Delete Test Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    race_name = get_unique_name("Delete Test Race")
    resp_race = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL"
        },
    )
    assert resp_race.status_code == 200
    race_id = resp_race.json()["id"]

    # Verify race exists
    resp_get = client.get(f"/races/{race_id}")
    assert resp_get.status_code == 200

    # Delete Race
    resp_delete = client.delete(f"/races/{race_id}")
    assert resp_delete.status_code == 200
    assert resp_delete.json()["message"] == "Race deleted successfully"

    # Verify race is gone
    resp_get_after = client.get(f"/races/{race_id}")
    assert resp_get_after.status_code == 404

