import json

from backend import crud, models, schemas


def test_racer_mutations(client, db):
    # Setup: Group, Track, Race
    group_in = schemas.GroupCreate(name="Racer Test Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Racer Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{name: "Racer Race", groupId: {group.id}, trackId: {track.id}}}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # 1. Create Racer
    mutation_create_racer = f"""
    mutation {{
        createRacer(racer: {{
            firstName: "John",
            lastName: "Doe",
            carNumber: 101,
            raceId: {race_id}
        }}) {{
            id
            firstName
            lastName
            carNumber
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_create_racer})
    assert response.status_code == 200
    data = response.json()["data"]["createRacer"]
    assert data["firstName"] == "John"
    racer_id = data["id"]

    # 2. Update Racer
    mutation_update_racer = f"""
    mutation {{
        updateRacer(id: {racer_id}, racer: {{
            firstName: "Johnny",
            lastName: "Doe",
            carNumber: 102
        }}) {{
            firstName
            carNumber
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_update_racer})
    data = response.json()["data"]["updateRacer"]
    assert data["firstName"] == "Johnny"
    assert data["carNumber"] == 102

    # 3. Check-in Racer
    mutation_check_in = f"""
    mutation {{
        checkInRacer(id: {racer_id}, passedInspection: true, weight: 5.0) {{
            carPassedInspection
            carWeight
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_check_in})
    data = response.json()["data"]["checkInRacer"]
    assert data["carPassedInspection"] is True
    assert data["carWeight"] == 5.0

    # 4. Delete Racer
    mutation_delete = f"""
    mutation {{
        deleteRacer(id: {racer_id})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_delete})
    assert response.json()["data"]["deleteRacer"] is True


def _setup_race_with_heat(db, lane_count=4):
    """Create a race with two racers and a heat whose lane_results reference them."""
    group = crud.create_group(db, schemas.GroupCreate(name="Heat Test Group"))
    track = crud.create_track(db, schemas.TrackCreate(name="Heat Track", lane_count=lane_count))
    race = crud.create_race(db, schemas.RaceCreate(name="Heat Race", group_id=group.id, track_id=track.id))

    racer_a = crud.create_racer(db, schemas.RacerCreate(first_name="Alice", last_name="A", car_number=1, race_id=race.id))
    racer_b = crud.create_racer(db, schemas.RacerCreate(first_name="Bob", last_name="B", car_number=2, race_id=race.id))

    round_ = models.Round(race_id=race.id, round_number=1, name="Round 1", scheduling_strategy="PPC")
    db.add(round_)
    db.flush()

    lane_results = [
        {"lane": 1, "racer_id": racer_a.id, "time": 3.1, "place": 1},
        {"lane": 2, "racer_id": racer_b.id, "time": 3.5, "place": 2},
    ]
    heat = models.Heat(race_id=race.id, round_id=round_.id, heat_number=1, lane_results=json.dumps(lane_results))
    db.add(heat)
    db.commit()

    return race.id, racer_a.id, racer_b.id, heat.id


def test_delete_racer_clears_from_heats(client, db):
    race_id, racer_a_id, racer_b_id, heat_id = _setup_race_with_heat(db)

    mutation = f"mutation {{ deleteRacer(id: {racer_a_id}) }}"
    resp = client.post("/graphql", json={"query": mutation})
    assert resp.json()["data"]["deleteRacer"] is True

    db.expire_all()
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    results = json.loads(heat.lane_results)

    lane1 = next(r for r in results if r["lane"] == 1)
    assert lane1["racer_id"] is None
    assert lane1["time"] is None
    assert lane1["place"] is None

    # Racer B's lane must be untouched
    lane2 = next(r for r in results if r["lane"] == 2)
    assert lane2["racer_id"] == racer_b_id
    assert lane2["time"] == 3.5
    assert lane2["place"] == 2


def test_bulk_delete_racers_clears_from_heats(client, db):
    race_id, racer_a_id, racer_b_id, heat_id = _setup_race_with_heat(db)

    mutation = f"mutation {{ bulkDeleteRacers(racerIds: [{racer_a_id}, {racer_b_id}]) }}"
    resp = client.post("/graphql", json={"query": mutation})
    assert resp.json()["data"]["bulkDeleteRacers"] is True

    db.expire_all()
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    results = json.loads(heat.lane_results)

    for lane in results:
        assert lane["racer_id"] is None
        assert lane["time"] is None
        assert lane["place"] is None


def test_den_mutations(client, db):
    # Setup
    group_in = schemas.GroupCreate(name="Den Test Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Den Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{name: "Den Race", groupId: {group.id}, trackId: {track.id}}}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # 1. Create Den
    mutation_create_den = f"""
    mutation {{
        createDen(raceId: {race_id}, den: {{
            name: "Lions",
            color: "#FF0000"
        }}) {{
            id
            name
            color
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_create_den})
    data = response.json()["data"]["createDen"]
    assert data["name"] == "Lions"
    den_id = data["id"]

    # 2. Update Den
    mutation_update_den = f"""
    mutation {{
        updateDen(id: {den_id}, den: {{
            name: "Lions Updated",
            color: "#00FF00"
        }}) {{
            name
            color
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_update_den})
    data = response.json()["data"]["updateDen"]
    assert data["name"] == "Lions Updated"

    # 3. Delete Den
    mutation_delete = f"""
    mutation {{
        deleteDen(id: {den_id})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_delete})
    assert response.json()["data"]["deleteDen"] is True


def test_track_mutations(client):
    # 1. Create Track
    mutation_create = """
    mutation {
        createTrack(track: {
            name: "GraphQL Track",
            laneCount: 6,
            timerType: "FAKE"
        }) {
            id
            name
            laneCount
        }
    }
    """
    response = client.post("/graphql", json={"query": mutation_create})
    data = response.json()["data"]["createTrack"]
    assert data["name"] == "GraphQL Track"
    assert data["laneCount"] == 6
    track_id = data["id"]

    # 2. Update Track
    mutation_update = f"""
    mutation {{
        updateTrack(id: {track_id}, track: {{
            name: "GraphQL Track Updated",
            laneCount: 8
        }}) {{
            name
            laneCount
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_update})
    data = response.json()["data"]["updateTrack"]
    assert data["name"] == "GraphQL Track Updated"
    assert data["laneCount"] == 8

    # 3. Delete Track
    mutation_delete = f"""
    mutation {{
        deleteTrack(id: {track_id})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_delete})
    assert response.json()["data"]["deleteTrack"] is True


def test_round_wizard_and_advance(client, db):
    # Setup
    group_in = schemas.GroupCreate(name="Wizard Test Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Wizard Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{name: "Wizard Race", groupId: {group.id}, trackId: {track.id}}}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # Populate some racers
    for i in range(10):
        client.post(
            "/graphql",
            json={
                "query": f"""
        mutation {{
            createRacer(racer: {{
                firstName: "Racer",
                lastName: "{i}",
                raceId: {race_id}
            }}) {{ id }}
        }}
        """
            },
        )

    # 1. Create Round Wizard
    mutation_wizard = f"""
    mutation {{
        createRoundWizard(raceId: {race_id}, config: {{
            generalRound: {{
                type: "PACK",
                runsPerLane: 1
            }},
            championshipRounds: [{{
                name: "Finals",
                source: "PACK",
                numTopRacers: 3,
                runsPerLane: 1
            }}]
        }}) {{
            id
            name
            roundNumber
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_wizard})
    assert response.status_code == 200
    data = response.json()["data"]["createRoundWizard"]
    assert len(data) == 2
    round2_id = data[1]["id"]

    # 2. Query Advancement Status (should not be ready)
    query_status = f"""
    query {{
        advancementStatus(raceId: {race_id}, roundId: {round2_id}) {{
            isReady
            requiresAdvancement
            alreadyAdvanced
        }}
    }}
    """
    response = client.post("/graphql", json={"query": query_status})
    data = response.json()["data"]["advancementStatus"]
    assert data["isReady"] is False

    # 3. Delete Round
    mutation_delete = f"""
    mutation {{
        deleteRound(roundId: {round2_id})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_delete})
    assert response.json()["data"]["deleteRound"] is True


def test_bulk_mutations(client, db):
    # Setup
    group_in = schemas.GroupCreate(name="Bulk Test Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Bulk Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{name: "Bulk Race", groupId: {group.id}, trackId: {track.id}}}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    racer_ids = []
    for i in range(5):
        resp = client.post(
            "/graphql",
            json={
                "query": f"""
        mutation {{
            createRacer(racer: {{
                firstName: "Racer",
                lastName: "{i}",
                raceId: {race_id}
            }}) {{ id }}
        }}
        """
            },
        )
        racer_ids.append(resp.json()["data"]["createRacer"]["id"])

    # 1. Bulk Auto-Number (Need to set strategy first)
    # Use GraphQL updateRace instead of REST PUT
    mutation_update_race = f"""
    mutation {{
        updateRace(id: {race_id}, race: {{carNumberingStrategy: "GLOBAL"}}) {{
            id
        }}
    }}
    """
    client.post("/graphql", json={"query": mutation_update_race})

    mutation_auto_number = f"""
    mutation {{
        bulkAutoNumber(racerIds: {racer_ids})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_auto_number})
    assert response.json()["data"]["bulkAutoNumber"] == 5

    # 2. Bulk Clear Numbers
    mutation_clear = f"""
    mutation {{
        bulkClearNumbers(racerIds: {racer_ids})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_clear})
    assert response.json()["data"]["bulkClearNumbers"] is True

    # 3. Bulk Delete
    mutation_delete = f"""
    mutation {{
        bulkDeleteRacers(racerIds: {racer_ids})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_delete})
    assert response.json()["data"]["bulkDeleteRacers"] is True


def test_bulk_mutations_with_variables(client, db):
    """
    Verify that all bulk racer mutations accept GraphQL named variables with the
    correct type declarations ([Int!]!).  The frontend sends variables this way,
    so a mismatch between the client-declared type and the schema type produces a
    GraphQL validation error that only surfaces at runtime — not in the inline-
    value tests above.
    """
    group_in = schemas.GroupCreate(name="Bulk Vars Test Group")
    group = crud.create_group(db, group_in)
    track_in = schemas.TrackCreate(name="Bulk Vars Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_resp = client.post(
        "/graphql",
        json={
            "query": """
            mutation CreateRace($race: RaceInput!) { createRace(race: $race) { id } }
            """,
            "variables": {
                "race": {"name": "Bulk Vars Race", "groupId": group.id, "trackId": track.id}
            },
        },
    )
    race_id = race_resp.json()["data"]["createRace"]["id"]

    racer_ids = []
    for i in range(3):
        r = client.post(
            "/graphql",
            json={
                "query": """
                mutation CreateRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }
                """,
                "variables": {"racer": {"firstName": "Racer", "lastName": str(i), "raceId": race_id}},
            },
        )
        racer_ids.append(r.json()["data"]["createRacer"]["id"])

    # Update race to GLOBAL numbering so auto-number works
    client.post(
        "/graphql",
        json={
            "query": """
            mutation UpdateRace($id: Int!, $race: RaceUpdateInput!) { updateRace(id: $id, race: $race) { id } }
            """,
            "variables": {"id": race_id, "race": {"carNumberingStrategy": "GLOBAL"}},
        },
    )

    # -- bulkAutoNumber --
    resp = client.post(
        "/graphql",
        json={
            "query": "mutation BulkAutoNumber($racerIds: [Int!]!) { bulkAutoNumber(racerIds: $racerIds) }",
            "variables": {"racerIds": racer_ids},
        },
    )
    assert "errors" not in resp.json(), f"bulkAutoNumber failed: {resp.json()}"
    assert resp.json()["data"]["bulkAutoNumber"] == len(racer_ids)

    # -- bulkClearNumbers --
    resp = client.post(
        "/graphql",
        json={
            "query": "mutation BulkClearNumbers($racerIds: [Int!]!) { bulkClearNumbers(racerIds: $racerIds) }",
            "variables": {"racerIds": racer_ids},
        },
    )
    assert "errors" not in resp.json(), f"bulkClearNumbers failed: {resp.json()}"
    assert resp.json()["data"]["bulkClearNumbers"] is True

    # -- bulkMoveToDen --
    den_resp = client.post(
        "/graphql",
        json={
            "query": """
            mutation CreateDen($raceId: Int!, $den: DenInput!) { createDen(raceId: $raceId, den: $den) { id } }
            """,
            "variables": {"raceId": race_id, "den": {"name": "Test Den", "color": "#ff0000"}},
        },
    )
    den_id = den_resp.json()["data"]["createDen"]["id"]

    resp = client.post(
        "/graphql",
        json={
            "query": "mutation BulkMoveToDen($racerIds: [Int!]!, $denId: Int) { bulkMoveToDen(racerIds: $racerIds, denId: $denId) }",
            "variables": {"racerIds": racer_ids, "denId": den_id},
        },
    )
    assert "errors" not in resp.json(), f"bulkMoveToDen failed: {resp.json()}"
    assert resp.json()["data"]["bulkMoveToDen"] is True

    # -- bulkDeleteRacers --
    resp = client.post(
        "/graphql",
        json={
            "query": "mutation BulkDeleteRacers($racerIds: [Int!]!) { bulkDeleteRacers(racerIds: $racerIds) }",
            "variables": {"racerIds": racer_ids},
        },
    )
    assert "errors" not in resp.json(), f"bulkDeleteRacers failed: {resp.json()}"
    assert resp.json()["data"]["bulkDeleteRacers"] is True


def test_upload_image_mutation(client):
    """Test that uploadImage mutation saves a Base64 image and returns a static URL."""
    import base64
    import os

    # Create a minimal 1x1 PNG as Base64
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    encoded = base64.b64encode(png_bytes).decode()
    data_url = f"data:image/png;base64,{encoded}"

    mutation = f"""
    mutation {{
        uploadImage(dataUrl: "{data_url}")
    }}
    """
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200
    result = response.json()
    assert "errors" not in result
    url = result["data"]["uploadImage"]
    assert url.startswith("/static/")
    assert url.endswith(".png")

    # Verify the file was actually saved
    filename = url.split("/static/")[1]
    file_path = os.path.join("backend/uploads", filename)
    assert os.path.exists(file_path)

    # Cleanup
    os.remove(file_path)
