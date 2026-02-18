import json

from backend.main import app


def test_populate_race(client, default_track):
    """Test the populateRace mutation."""
    # Setup
    group_resp = client.post("/groups/", json={"name": "Populate Group"})
    group_id = group_resp.json()["id"]

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{name: "Populate Race", groupId: {group_id}, trackId: {default_track}}}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # 1. Populate Race
    mutation_populate = f"""
    mutation {{
        populateRace(raceId: {race_id}, config: {{
            count: 5,
            addRacerPhotos: false,
            addCarPhotos: false,
            assignDens: true,
            checkIn: true
        }})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_populate})
    assert response.status_code == 200
    assert "Populated race" in response.json()["data"]["populateRace"]

    # Verify racers created
    query_racers = f"""
    query {{
        racers(raceId: {race_id}) {{
            id
            carPassedInspection
        }}
    }}
    """
    racers = client.post("/graphql", json={"query": query_racers}).json()["data"][
        "racers"
    ]
    assert len(racers) == 5
    assert racers[0]["carPassedInspection"] is True


def test_import_racers(client, default_track):
    """Test the importRacers mutation."""
    # Setup
    group_resp = client.post("/groups/", json={"name": "Import Group"})
    group_id = group_resp.json()["id"]

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{name: "Import Race", groupId: {group_id}, trackId: {default_track}}}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    csv_content = "first_name,last_name,car_number,den\nAlice,Smith,101,Lions\nBob,Jones,102,Tigers"

    # 1. Import Racers
    mutation_import = f"""
    mutation {{
        importRacers(raceId: {race_id}, csvData: {json.dumps(csv_content)})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_import})
    assert response.status_code == 200
    assert response.json()["data"]["importRacers"] == 2

    # Verify racers and dens
    query_race = f"""
    query {{
        race(raceId: {race_id}) {{
            racers {{ id firstName denId }}
            dens {{ id name }}
        }}
    }}
    """
    data = client.post("/graphql", json={"query": query_race}).json()["data"]["race"]
    assert len(data["racers"]) == 2
    assert len(data["dens"]) == 2
    names = [d["name"] for d in data["dens"]]
    assert "Lions" in names
    assert "Tigers" in names


def test_create_round_regular(client, default_track):
    """Test the createRound mutation."""
    # Setup
    group_resp = client.post("/groups/", json={"name": "Round Group"})
    group_id = group_resp.json()["id"]

    race_id = client.post(
        "/graphql",
        json={
            "query": f"""
    mutation {{
        createRace(race: {{name: "Round Race", groupId: {group_id}, trackId: {default_track}}}) {{ id }}
    }}
    """
        },
    ).json()["data"]["createRace"]["id"]

    # Populate some racers
    client.post(
        "/graphql",
        json={
            "query": f"""
    mutation {{
        populateRace(raceId: {race_id}, config: {{count: 4}})
    }}
    """
        },
    )

    # 1. Create General Round
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            schedulingStrategy: "PPC",
            name: "Qualifying",
            runsPerLane: 1
        }}) {{
            id
            name
            roundNumber
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_round})
    assert response.status_code == 200
    rounds = response.json()["data"]["createRound"]
    assert len(rounds) == 1
    assert rounds[0]["name"] == "Qualifying"

    # Verify heats generated
    query_heats = f"""
    query {{
        race(raceId: {race_id}) {{
            heats {{ id }}
        }}
    }}
    """
    heats = client.post("/graphql", json={"query": query_heats}).json()["data"]["race"][
        "heats"
    ]
    assert len(heats) > 0
