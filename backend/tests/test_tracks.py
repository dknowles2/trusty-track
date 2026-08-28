import uuid

from backend.db import crud, schemas


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def test_track_crud(client, db):
    # 1. Create a track
    mutation_create = """
    mutation {
        createTrack(track: {
            name: "Track A",
            laneCount: 4,
            timerType: "FAKE"
        }) {
            id
            name
            laneCount
        }
    }
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    assert resp.status_code == 200
    track_a = resp.json()["data"]["createTrack"]
    track_a_id = track_a["id"]
    assert track_a["name"] == "Track A"

    # 2. Add another track
    mutation_create_b = """
    mutation {
        createTrack(track: {
            name: "Track B",
            laneCount: 6,
            timerType: "FAKE"
        }) {
            id
            name
        }
    }
    """
    resp = client.post("/graphql", json={"query": mutation_create_b})
    track_b = resp.json()["data"]["createTrack"]
    track_b_id = track_b["id"]

    # 3. List tracks
    query_tracks = """
    query {
        tracks {
            id
            name
        }
    }
    """
    resp = client.post("/graphql", json={"query": query_tracks})
    tracks = resp.json()["data"]["tracks"]
    # There might be default tracks from other tests if DB persists
    # (it shouldn't in memory)
    # But just let's check our tracks are there
    t_ids = [int(t["id"]) for t in tracks]
    assert int(track_a_id) in t_ids
    assert int(track_b_id) in t_ids

    # 4. Update track
    mutation_update = f"""
    mutation {{
        updateTrack(
            id: {track_a_id}
            track: {{name: "Updated Track A", laneCount: 2}}
        ) {{
            name
            laneCount
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_update})
    assert resp.json()["data"]["updateTrack"]["name"] == "Updated Track A"

    # 5. Create race on Track B
    group_in = schemas.GroupCreate(name=get_unique_name("Race Group"))
    group = crud.create_group(db, group_in)

    mutation_create_race = f"""
    mutation {{
        createRace(
            race: {{
                name: "Race on Track B"
                groupId: {group.id}
                trackId: {track_b_id}
            }}
        ) {{
            id
            trackId
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create_race})
    race_b = resp.json()["data"]["createRace"]
    assert race_b["trackId"] == int(track_b_id)

    # 6. Delete track B (should fail if race associated)
    mutation_delete = f"""
    mutation {{
        deleteTrack(id: {track_b_id})
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_delete})
    # The mutation returns boolean, but might raise error if handled by strawberry?
    # Or return error in "errors" field.
    # CRUD raises HTTPException(400) which Strawberry converts to error.
    assert resp.json()["data"]["deleteTrack"] is False

    # Delete unused track A
    mutation_delete_a = f"""
    mutation {{
        deleteTrack(id: {track_a_id})
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_delete_a})
    assert "data" in resp.json()
    assert resp.json()["data"]["deleteTrack"] is True


def test_race_track_association_update(client, db):
    # Setup
    track_in_1 = schemas.TrackCreate(name="T1", lane_count=4)
    t1 = crud.create_track(db, track_in_1)

    track_in_2 = schemas.TrackCreate(name="T2", lane_count=6)
    t2 = crud.create_track(db, track_in_2)

    group_in = schemas.GroupCreate(name=get_unique_name("Update Group"))
    group = crud.create_group(db, group_in)

    mutation_create_race = f"""
    mutation {{
        createRace(
            race: {{name: "Update Race", groupId: {group.id}, trackId: {t1.id}}}
        ) {{
            id
            trackId
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create_race})
    race_id = resp.json()["data"]["createRace"]["id"]

    # Update track_id via updateRace
    mutation_update = f"""
    mutation {{
        updateRace(id: {race_id}, race: {{trackId: {t2.id}}}) {{
            trackId
            track {{
                name
            }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_update})
    assert resp.status_code == 200
    data = resp.json()["data"]["updateRace"]
    assert data["trackId"] == int(t2.id)
    assert data["track"]["name"] == "T2"


def test_update_track_serial_port(client):
    # 1. Create a track
    mutation_create = """
    mutation {
        createTrack(track: {
            name: "Direct Track",
            laneCount: 4,
            timerType: "FAKE"
        }) {
            id
        }
    }
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    track_id = resp.json()["data"]["createTrack"]["id"]

    # 2. Update to AUTO_DETECT_BACKEND with serial port
    mutation_update = f"""
    mutation {{
        updateTrack(id: {track_id}, track: {{
            timerType: "AUTO_DETECT_BACKEND",
            serialPort: "/dev/ttyUSB99"
        }}) {{
            timerType
            serialPort
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_update})
    data = resp.json()["data"]["updateTrack"]
    assert data["timerType"] == "AUTO_DETECT_BACKEND"
    assert data["serialPort"] == "/dev/ttyUSB99"


class TestLaneCountBounds:
    """#320: a lane count nothing downstream can act on is refused at the edge.

    Zero silently schedules no heats; negative crashes ``prepare_heat`` and
    ``startTimerTest``'s ``(1 << lane_count) - 1`` lane mask with a "negative
    shift count" ``ValueError`` — an unhandled 500 far from the mistake.
    """

    def test_create_track_refuses_zero_lanes(self, client, db):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "Bad Track", laneCount: 0}) {
                        id
                    }
                }
                """
            },
        ).json()
        assert "errors" in resp
        assert crud.get_tracks(db) == []

    def test_create_track_refuses_negative_lanes(self, client, db):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "Bad Track", laneCount: -3}) {
                        id
                    }
                }
                """
            },
        ).json()
        assert "errors" in resp
        assert crud.get_tracks(db) == []

    def test_create_track_refuses_too_many_lanes(self, client, db):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "Bad Track", laneCount: 9}) {
                        id
                    }
                }
                """
            },
        ).json()
        assert "errors" in resp
        assert crud.get_tracks(db) == []

    def test_update_track_refuses_zero_lanes(self, client, db):
        track = crud.create_track(db, schemas.TrackCreate(name="Good Track"))

        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateTrack(id: {track.id}, track: {{laneCount: 0}}) {{
                        laneCount
                    }}
                }}
                """
            },
        ).json()
        assert "errors" in resp
        db.refresh(track)
        assert track.lane_count == 4

    def test_update_track_refuses_negative_lanes(self, client, db):
        track = crud.create_track(db, schemas.TrackCreate(name="Good Track"))

        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateTrack(id: {track.id}, track: {{laneCount: -3}}) {{
                        laneCount
                    }}
                }}
                """
            },
        ).json()
        assert "errors" in resp
        db.refresh(track)
        assert track.lane_count == 4
