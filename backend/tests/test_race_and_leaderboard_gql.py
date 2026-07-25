from backend.db import crud, schemas
from backend.tests.helpers import record_heat_result


def test_race_mutations_and_leaderboard(client, db):
    # 1. Setup: Group and Track
    group_in = schemas.GroupCreate(name="Race Mutation Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Mutation Track", lane_count=4)
    track = crud.create_track(db, track_in)

    # 2. Create Race
    mutation_create_race = f"""
    mutation {{
        createRace(race: {{
            name: "Original Race", groupId: {group.id}, trackId: {track.id}
        }}) {{
            id
            name
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_create_race})
    assert response.status_code == 200
    race_id = response.json()["data"]["createRace"]["id"]
    assert response.json()["data"]["createRace"]["name"] == "Original Race"

    # 3. Update Race
    mutation_update_race = f"""
    mutation {{
        updateRace(
            id: {race_id}, race: {{name: "Updated Race", location: "Stadium"}}
        ) {{
            name
            location
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_update_race})
    assert response.status_code == 200
    data = response.json()["data"]["updateRace"]
    assert data["name"] == "Updated Race"
    assert data["location"] == "Stadium"

    # 4. Setup Leaderboard: Add Racers and results
    racer_ids = []
    for i in range(2):
        mutation_create_racer = f"""
        mutation {{
            createRacer(racer: {{
                firstName: "Racer",
                lastName: "{i}",
                raceId: {race_id},
                carPassedInspection: true
            }}) {{ id }}
        }}
        """
        resp = client.post("/graphql", json={"query": mutation_create_racer})
        racer_ids.append(resp.json()["data"]["createRacer"]["id"])

    # Create a heat and record results
    mutation_wizard = f"""
    mutation {{
        createRoundWizard(raceId: {race_id}, config: {{
            generalRound: {{
                type: "PACK",
                runsPerLane: 1
            }},
            championshipRounds: []
        }}) {{ id }}
    }}
    """
    wizard_resp = client.post("/graphql", json={"query": mutation_wizard})
    assert wizard_resp.status_code == 200

    # Get the heat
    query_heats = f"""
    query {{
        race(raceId: {race_id}) {{
            heats {{
                id
            }}
        }}
    }}
    """
    heat_id = client.post("/graphql", json={"query": query_heats}).json()["data"][
        "race"
    ]["heats"][0]["id"]

    # Record results (TIMED strategy by default)
    results_data = [
        {"lane": 1, "racer_id": racer_ids[0], "time": 3.45, "place": 1},
        {"lane": 2, "racer_id": racer_ids[1], "time": 3.50, "place": 2},
    ]
    record_heat_result(client, heat_id, results_data)

    # 5. Query Leaderboard
    query_leaderboard = f"""
    query {{
        race(raceId: {race_id}) {{
            leaderboard {{
                racerId
                firstName
                rank
                score
            }}
        }}
    }}
    """
    response = client.post("/graphql", json={"query": query_leaderboard})
    assert response.status_code == 200
    lb = response.json()["data"]["race"]["leaderboard"]
    assert len(lb) == 2
    # Sort or find
    r1 = next(r for r in lb if r["racerId"] == racer_ids[0])
    assert r1["rank"] == 1
    assert r1["score"] == 3.45

    # 6. Delete Race
    mutation_delete = f"""
    mutation {{
        deleteRace(id: {race_id})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_delete})
    assert response.json()["data"]["deleteRace"] is True

    # Verify deleted
    query_race = f"""
    query {{
        race(raceId: {race_id}) {{ id }}
    }}
    """
    response = client.post("/graphql", json={"query": query_race})
    assert response.json()["data"]["race"] is None


def test_bulk_move_to_den_null(client, db):
    # Setup
    group_in = schemas.GroupCreate(name="Bulk Den Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Bulk Den Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{
            name: "Bulk Den Race", groupId: {group.id}, trackId: {track.id}
        }}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # Create Den
    mutation_create_den = f"""
    mutation {{
        createDen(raceId: {race_id}, den: {{ name: "Lions" }}) {{ id }}
    }}
    """
    den_id = client.post("/graphql", json={"query": mutation_create_den}).json()[
        "data"
    ]["createDen"]["id"]

    # Create Racer in Den
    mutation_create_racer = f"""
    mutation {{
        createRacer(racer: {{
            firstName: "Den",
            lastName: "Racer",
            denId: {den_id},
            raceId: {race_id}
        }}) {{ id }}
    }}
    """
    racer_id = client.post("/graphql", json={"query": mutation_create_racer}).json()[
        "data"
    ]["createRacer"]["id"]

    # Bulk Move to Unassigned (null)
    # GraphQL null is null, no quotes
    mutation_move_null = f"""
    mutation {{
        bulkMoveToDen(racerIds: [{racer_id}], denId: null)
    }}
    """
    response = client.post("/graphql", json={"query": mutation_move_null})
    assert response.json()["data"]["bulkMoveToDen"] is True

    # Verify unassigned
    query_racer = f"""
    query {{
        racer(racerId: {racer_id}) {{
            denId
        }}
    }}
    """
    response = client.post("/graphql", json={"query": query_racer})
    assert response.json()["data"]["racer"]["denId"] is None
