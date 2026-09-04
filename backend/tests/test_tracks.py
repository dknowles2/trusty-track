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
    group_in = schemas.OrganizationCreate(name=get_unique_name("Race Organization"))
    group = crud.create_organization(db, group_in)

    mutation_create_race = f"""
    mutation {{
        createRace(
            race: {{
                name: "Race on Track B"
                organizationId: {group.id}
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

    group_in = schemas.OrganizationCreate(name=get_unique_name("Update Organization"))
    group = crud.create_organization(db, group_in)

    mutation_create_race = f"""
    mutation {{
        createRace(
            race: {{name: "Update Race", organizationId: {group.id}, trackId: {t1.id}}}
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


class TestScaleSpeed:
    """#610 stage 2: `scaleRatio` and `showScaleSpeed` round-trip on a track."""

    def test_create_track_defaults(self, client):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "Default Scale Track"}) {
                        scaleRatio
                        showScaleSpeed
                    }
                }
                """
            },
        ).json()
        assert "errors" not in resp, resp
        data = resp["data"]["createTrack"]
        assert data["scaleRatio"] == 25
        assert data["showScaleSpeed"] is True

    def test_create_and_update_round_trip(self, client):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {
                        name: "Space Derby Track",
                        scaleRatio: 100,
                        showScaleSpeed: false
                    }) {
                        id
                        scaleRatio
                        showScaleSpeed
                    }
                }
                """
            },
        ).json()
        assert "errors" not in resp, resp
        created = resp["data"]["createTrack"]
        assert created["scaleRatio"] == 100
        assert created["showScaleSpeed"] is False
        track_id = created["id"]

        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateTrack(id: {track_id}, track: {{
                        name: "Space Derby Track",
                        scaleRatio: 12.5,
                        showScaleSpeed: true
                    }}) {{
                        scaleRatio
                        showScaleSpeed
                    }}
                }}
                """
            },
        ).json()
        assert "errors" not in resp, resp
        updated = resp["data"]["updateTrack"]
        assert updated["scaleRatio"] == 12.5
        assert updated["showScaleSpeed"] is True

        # Reading back through the query path agrees with what the mutation
        # returned — the two must not disagree about what was stored.
        resp = client.post(
            "/graphql",
            json={
                "query": """
                query {
                    tracks {
                        id
                        scaleRatio
                        showScaleSpeed
                    }
                }
                """
            },
        ).json()
        row = next(t for t in resp["data"]["tracks"] if int(t["id"]) == int(track_id))
        assert row["scaleRatio"] == 12.5
        assert row["showScaleSpeed"] is True

    def test_create_track_refuses_zero_scale_ratio(self, client, db):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "Bad Ratio", scaleRatio: 0}) {
                        id
                    }
                }
                """
            },
        ).json()
        assert "errors" in resp
        assert "scale ratio must be greater than zero" in str(resp["errors"])
        assert crud.get_tracks(db) == []

    def test_create_track_refuses_negative_scale_ratio(self, client, db):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "Bad Ratio", scaleRatio: -5}) {
                        id
                    }
                }
                """
            },
        ).json()
        assert "errors" in resp
        assert crud.get_tracks(db) == []

    def test_update_track_refuses_zero_scale_ratio(self, client, db):
        track = crud.create_track(db, schemas.TrackCreate(name="Good Track"))

        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateTrack(id: {track.id}, track: {{scaleRatio: 0}}) {{
                        scaleRatio
                    }}
                }}
                """
            },
        ).json()
        assert "errors" in resp
        db.refresh(track)
        assert track.scale_ratio == 25


class TestLaneColors:
    """#611 stage 2: `laneColors` round-trips on a track and is validated."""

    def test_create_track_defaults_to_no_colors(self, client):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "No Colors Track"}) {
                        laneColors
                    }
                }
                """
            },
        ).json()
        assert "errors" not in resp, resp
        assert resp["data"]["createTrack"]["laneColors"] == []

    def test_create_and_update_round_trip(self, client):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {
                        name: "Painted Track",
                        laneCount: 4,
                        laneColors: ["#E53935", "#FAFAFA", "#1E88E5", "#FDD835"]
                    }) {
                        id
                        laneColors
                    }
                }
                """
            },
        ).json()
        assert "errors" not in resp, resp
        created = resp["data"]["createTrack"]
        assert created["laneColors"] == ["#E53935", "#FAFAFA", "#1E88E5", "#FDD835"]
        track_id = created["id"]

        # A blank entry means "not configured for this lane", not an error
        # (see `domain.lane_colors.color_for_lane`) — clearing one lane's
        # colour while keeping the rest is an ordinary update.
        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateTrack(id: {track_id}, track: {{
                        name: "Painted Track",
                        laneColors: ["#E53935", "", "#1E88E5", "#FDD835"]
                    }}) {{
                        laneColors
                    }}
                }}
                """
            },
        ).json()
        assert "errors" not in resp, resp
        assert resp["data"]["updateTrack"]["laneColors"] == [
            "#E53935",
            "",
            "#1E88E5",
            "#FDD835",
        ]

        # Reading back through the query path agrees with what the mutation
        # returned — the two must not disagree about what was stored.
        resp = client.post(
            "/graphql",
            json={"query": "query { tracks { id laneColors } }"},
        ).json()
        row = next(t for t in resp["data"]["tracks"] if int(t["id"]) == int(track_id))
        assert row["laneColors"] == ["#E53935", "", "#1E88E5", "#FDD835"]

    def test_create_track_refuses_an_invalid_color(self, client, db):
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {
                        name: "Bad Color Track",
                        laneColors: ["not-a-color"]
                    }) {
                        id
                    }
                }
                """
            },
        ).json()
        assert "errors" in resp
        assert "hex value" in str(resp["errors"])
        assert crud.get_tracks(db) == []

    def test_create_track_refuses_a_named_css_color(self, client, db):
        # Deliberately not accepted — see `is_valid_lane_color`'s own test
        # for why a preset's *name* is not a storable value.
        resp = client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createTrack(track: {name: "Bad Color Track", laneColors: ["red"]}) {
                        id
                    }
                }
                """
            },
        ).json()
        assert "errors" in resp
        assert crud.get_tracks(db) == []

    def test_update_track_refuses_an_invalid_color(self, client, db):
        track = crud.create_track(db, schemas.TrackCreate(name="Good Track"))

        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateTrack(id: {track.id}, track: {{laneColors: ["#zzz"]}}) {{
                        laneColors
                    }}
                }}
                """
            },
        ).json()
        assert "errors" in resp
        db.refresh(track)
        assert track.lane_colors == []


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
