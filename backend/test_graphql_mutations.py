def test_racer_mutations(client):
    # Setup: Group, Track, Race
    group_resp = client.post("/groups/", json={"name": "Racer Test Group"})
    group_id = group_resp.json()["id"]
    track_resp = client.post("/tracks/", json={"name": "Racer Track", "lane_count": 4})
    track_id = track_resp.json()["id"]

    mutation_create_race = f"""
    mutation {{
        createRace(name: "Racer Race", groupId: {group_id}, trackId: {track_id}) {{
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


def test_den_mutations(client):
    # Setup
    group_resp = client.post("/groups/", json={"name": "Den Test Group"})
    group_id = group_resp.json()["id"]
    track_resp = client.post("/tracks/", json={"name": "Den Track", "lane_count": 4})
    track_id = track_resp.json()["id"]
    mutation_create_race = f"""
    mutation {{
        createRace(name: "Den Race", groupId: {group_id}, trackId: {track_id}) {{
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


def test_round_wizard_and_advance(client):
    # Setup
    group_resp = client.post("/groups/", json={"name": "Wizard Test Group"})
    group_id = group_resp.json()["id"]
    track_resp = client.post("/tracks/", json={"name": "Wizard Track", "lane_count": 4})
    track_id = track_resp.json()["id"]
    mutation_create_race = f"""
    mutation {{
        createRace(name: "Wizard Race", groupId: {group_id}, trackId: {track_id}) {{
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


def test_bulk_mutations(client):
    # Setup
    group_resp = client.post("/groups/", json={"name": "Bulk Test Group"})
    group_id = group_resp.json()["id"]
    track_resp = client.post("/tracks/", json={"name": "Bulk Track", "lane_count": 4})
    track_id = track_resp.json()["id"]
    mutation_create_race = f"""
    mutation {{
        createRace(name: "Bulk Race", groupId: {group_id}, trackId: {track_id}) {{
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
    client.put(f"/races/{race_id}", json={"car_numbering_strategy": "GLOBAL"})

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
