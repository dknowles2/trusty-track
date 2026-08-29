from backend.db import crud, schemas


def test_bulk_move_to_den(client, db):
    # Setup
    group_in = schemas.OrganizationCreate(name="Bulk Move Organization")
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="Bulk Move Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(
            race: {{
                name: "Bulk Move Race"
                organizationId: {group.id}
                trackId: {track.id}
            }}
        ) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # Create Racers
    racer_ids = []
    for i in range(3):
        resp = client.post(
            "/graphql",
            json={
                "query": f"""
            mutation {{
                createRacer(
                    racer: {{firstName: "R{i}", lastName: "T", raceId: {race_id}}}
                ) {{ id }}
            }}
        """
            },
        )
        racer_ids.append(resp.json()["data"]["createRacer"]["id"])

    # Create RacingGroup
    mutation_create_den = f"""
    mutation {{
        createRacingGroup(
            raceId: {race_id}
            racingGroup: {{name: "New RacingGroup", color: "#FF0000"}}
        ) {{
            id
        }}
    }}
    """
    racing_group_id = client.post(
        "/graphql", json={"query": mutation_create_den}
    ).json()["data"]["createRacingGroup"]["id"]

    # Bulk Move
    mutation_move = f"""
    mutation {{
        bulkMoveToRacingGroup(racerIds: {racer_ids}, racingGroupId: {racing_group_id})
    }}
    """
    response = client.post("/graphql", json={"query": mutation_move})
    assert response.json()["data"]["bulkMoveToRacingGroup"] is True

    # Verify
    for rid in racer_ids:
        query = f"""
        query {{
            racer(racerId: {rid}) {{
                racingGroupId
            }}
        }}
        """
        data = client.post("/graphql", json={"query": query}).json()["data"]["racer"]
        assert data["racingGroupId"] == int(racing_group_id)


def test_reorder_heats(client, db):
    # Setup Race & Round
    group_in = schemas.OrganizationCreate(name="Reorder Organization")
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="Reorder Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(
            race: {{
                name: "Reorder Race"
                organizationId: {group.id}
                trackId: {track.id}
            }}
        ) {{ id }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # Create Racers
    for i in range(4):
        client.post(
            "/graphql",
            json={
                "query": f"""
            mutation {{
                createRacer(racer: {{
                    firstName: "R{i}"
                    lastName: "T"
                    carNumber: {100 + i}
                    raceId: {race_id}
                    carPassedInspection: true
                }}) {{ id }}
            }}
        """
            },
        )

    # Create Round & Heats
    mutation_create_round = f"""
    mutation {{
        createRound(
            raceId: {race_id}
            roundData: {{name: "R1", runsPerLane: 1, generalType: "ALL" }}
        ) {{
            id
            heats {{ id heatNumber }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create_round})
    round_data = resp.json()["data"]["createRound"][0]
    heats = round_data["heats"]
    assert len(heats) > 1

    heat1 = heats[0]
    heat2 = heats[1]
    assert heat1["heatNumber"] == 1
    assert heat2["heatNumber"] == 2

    # Reorder swap 1 and 2
    mutation_reorder = f"""
    mutation {{
        reorderHeats(heatUpdates: [
            {{heatId: {heat1["id"]}, newHeatNumber: 2}},
            {{heatId: {heat2["id"]}, newHeatNumber: 1}}
        ]) {{
            updatedCount
            heats {{ id heatNumber }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_reorder})
    data = resp.json()["data"]["reorderHeats"]
    assert data["updatedCount"] == 2

    # Verify new order in response
    new_heats = data["heats"]
    h1 = next(h for h in new_heats if float(h["id"]) == float(heat1["id"]))
    h2 = next(h for h in new_heats if float(h["id"]) == float(heat2["id"]))

    assert h1["heatNumber"] == 2
    assert h2["heatNumber"] == 1


def test_wizard_graphql_flow(client, db):
    # Setup
    group_in = schemas.OrganizationCreate(name="Wizard GQL Organization")
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="Wizard GQL Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(
            race: {{
                name: "Wizard GQL Race"
                organizationId: {group.id}
                trackId: {track.id}
            }}
        ) {{ id }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # Add Racers
    for i in range(8):
        client.post(
            "/graphql",
            json={
                "query": f"""
            mutation {{
                createRacer(racer: {{
                    firstName: "R{i}"
                    lastName: "T"
                    carNumber: {100 + i}
                    raceId: {race_id}
                    carPassedInspection: true
                }}) {{ id }}
            }}
        """
            },
        )

    # Call Wizard
    mutation_wizard = f"""
    mutation {{
        createRoundWizard(raceId: {race_id}, config: {{
            generalRound: {{ type: "ALL", runsPerLane: 1 }},
            championshipRounds: [
                {{ name: "Finals", source: "ALL", numTopRacers: 3, runsPerLane: 1 }}
            ]
        }}) {{
            id
            name
            roundNumber
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_wizard})
    rounds = resp.json()["data"]["createRoundWizard"]
    assert len(rounds) == 2
    assert rounds[0]["name"] == "All Pack"
    assert rounds[1]["name"] == "Finals"
