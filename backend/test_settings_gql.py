from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from . import models
from .main import app

client = TestClient(app)


def test_initial_config_query(db: Session):
    """Test getting initial config when system is NOT initialized."""
    # Ensure no tracks exist
    db.query(models.Track).delete()
    db.commit()

    query = """
    query {
        initialConfig {
            initialized
            groupName
            tracks {
                id
                name
            }
        }
    }
    """
    response = client.post("/graphql", json={"query": query})
    assert response.status_code == 200
    data = response.json()["data"]["initialConfig"]
    assert data["initialized"] is False
    assert data["groupName"] is None
    assert data["tracks"] == []


def test_create_initial_config_mutation(db: Session):
    """Test initializing the system via GraphQL."""
    # Ensure no tracks exist
    db.query(models.Track).delete()
    db.query(models.Group).delete()
    db.commit()

    mutation = """
    mutation($config: InitialConfigInput!) {
        createInitialConfig(config: $config) {
            initialized
            groupName
            tracks {
                name
                laneCount
            }
        }
    }
    """
    variables = {
        "config": {
            "groupName": "Test Pack",
            "tracks": [
                {
                    "name": "Main Track",
                    "laneCount": 4,
                    "lengthFeet": 40,
                    "timerType": "FAKE",
                }
            ],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    assert response.status_code == 200
    res_data = response.json()
    assert "errors" not in res_data
    data = res_data["data"]["createInitialConfig"]
    assert data["initialized"] is True
    assert data["groupName"] == "Test Pack"
    assert len(data["tracks"]) == 1
    assert data["tracks"][0]["name"] == "Main Track"


def test_update_initial_config_mutation(db: Session):
    """Test updating group name via GraphQL."""
    # Ensure system is initialized
    db.query(models.Track).delete()
    db.query(models.Group).delete()
    db.commit()

    group = models.Group(name="Old Name")
    db.add(group)
    track = models.Track(name="T1", lane_count=4)
    db.add(track)
    db.commit()

    mutation = """
    mutation($config: InitialConfigInput!) {
        updateInitialConfig(config: $config) {
            groupName
        }
    }
    """
    variables = {
        "config": {
            "groupName": "New Name",
            "tracks": [],  # tracks are ignored in update for now as per implementation
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    assert response.status_code == 200
    data = response.json()["data"]["updateInitialConfig"]
    assert data["groupName"] == "New Name"
