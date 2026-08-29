from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.main import app
from backend.db import crud, models, schemas

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
            organizationName
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
    assert data["organizationName"] is None
    assert data["tracks"] == []


def test_create_initial_config_mutation(db: Session):
    """Test initializing the system via GraphQL."""
    # Ensure no tracks exist
    db.query(models.Track).delete()
    db.query(models.Organization).delete()
    db.commit()

    mutation = """
    mutation($config: InitialConfigInput!) {
        createInitialConfig(config: $config) {
            initialized
            organizationName
            tracks {
                name
                laneCount
            }
        }
    }
    """
    variables = {
        "config": {
            "organizationName": "Test Pack",
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
    assert data["organizationName"] == "Test Pack"
    assert len(data["tracks"]) == 1
    assert data["tracks"][0]["name"] == "Main Track"


def test_update_initial_config_mutation(db: Session):
    """Test updating group name via GraphQL."""
    # Ensure system is initialized
    db.query(models.Track).delete()
    db.query(models.Organization).delete()
    db.commit()

    group = models.Organization(name="Old Name")
    db.add(group)
    track = models.Track(name="T1", lane_count=4)
    db.add(track)
    db.commit()

    mutation = """
    mutation($config: InitialConfigInput!) {
        updateInitialConfig(config: $config) {
            organizationName
        }
    }
    """
    variables = {
        "config": {
            "organizationName": "New Name",
            "tracks": [],  # tracks are ignored in update for now as per implementation
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    assert response.status_code == 200
    data = response.json()["data"]["updateInitialConfig"]
    assert data["organizationName"] == "New Name"


def test_update_initial_config_matches_tracks_by_id_not_position(db: Session):
    """Removing a track from the middle of the list must not reassign the
    identity of the ones that follow it (#318).

    Tracks [A, B, C]; the operator removes B and saves. Matching by list
    position updates row B in place with C's fields (renaming and
    reconfiguring it into "C") and then deletes what was row C — destroying
    its history and leaving two rows both called "C" in spirit. Matching by
    id must instead leave A and C exactly as they were and delete B.
    """
    db.query(models.Track).delete()
    db.query(models.Organization).delete()
    db.commit()

    group = models.Organization(name="Pack")
    db.add(group)
    track_a = models.Track(name="Track A", lane_count=4)
    track_b = models.Track(name="Track B", lane_count=3)
    track_c = models.Track(name="Track C", lane_count=2)
    db.add_all([track_a, track_b, track_c])
    db.commit()
    db.refresh(track_a)
    db.refresh(track_b)
    db.refresh(track_c)
    a_id, b_id, c_id = track_a.id, track_b.id, track_c.id

    mutation = """
    mutation($config: InitialConfigInput!) {
        updateInitialConfig(config: $config) {
            tracks { id name laneCount }
        }
    }
    """
    variables = {
        "config": {
            "organizationName": "Pack",
            "tracks": [
                {
                    "id": a_id,
                    "name": "Track A",
                    "laneCount": 4,
                    "lengthFeet": 40,
                    "timerType": "FAKE",
                },
                {
                    "id": c_id,
                    "name": "Track C",
                    "laneCount": 2,
                    "lengthFeet": 40,
                    "timerType": "FAKE",
                },
            ],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" not in res_data, res_data

    remaining = {t.id: (t.name, t.lane_count) for t in db.query(models.Track).all()}
    assert remaining == {a_id: ("Track A", 4), c_id: ("Track C", 2)}
    assert b_id not in remaining


def test_update_initial_config_surfaces_a_refused_track_delete(db: Session):
    """A track dropped from the list that still has races against it must be
    reported to the operator rather than silently kept with its
    `TimerManager` gone (#318).

    Stopping the manager before attempting the delete left the track
    reachable but untimed until the server restarted, with the mutation
    reporting success either way.
    """
    db.query(models.Track).delete()
    db.query(models.Organization).delete()
    db.commit()

    group = crud.create_organization(db, schemas.OrganizationCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track A", lane_count=4, timer_type="FAKE")
    )
    crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby Day", organization_id=group.id, track_id=track.id
        ),
    )

    from backend.api import main as main_module
    from backend.services.timer.devices import FAKE
    from backend.services.timer.manager import TimerManager

    mgr = TimerManager(track_id=track.id, device=FAKE)
    main_module.TIMER_MANAGERS[track.id] = mgr
    try:
        mutation = """
        mutation($config: InitialConfigInput!) {
            updateInitialConfig(config: $config) {
                tracks { id name }
            }
        }
        """
        variables = {"config": {"organizationName": "Pack", "tracks": []}}
        response = client.post(
            "/graphql", json={"query": mutation, "variables": variables}
        )
        res_data = response.json()

        assert "errors" in res_data, res_data
        assert "Track A" in res_data["errors"][0]["message"]

        # The track survives the refused delete, and so must its manager.
        assert db.query(models.Track).filter(models.Track.id == track.id).count() == 1
        assert main_module.TIMER_MANAGERS.get(track.id) is mgr
    finally:
        main_module.TIMER_MANAGERS.pop(track.id, None)
