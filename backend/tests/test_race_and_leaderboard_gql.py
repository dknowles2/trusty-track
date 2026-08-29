from backend.db import crud, models, schemas
from backend.tests.helpers import record_heat_result


def _full_results(db, heat_id: int, overrides: dict[int, dict]) -> list[dict]:
    """A heat's whole lane set, with a result filled in for some of them.

    `updateHeatResult` replaces a heat's entire lane set (#307): a two-racer
    PPC schedule on a four-lane track leaves two lanes of every heat empty,
    and sending results for only the raced lanes would now be refused as a
    partial write. Every real client resends the lanes it did not touch
    unchanged, which is what this does too.
    """
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).one()
    results = []
    for lane in crud.heat_lanes_of(db, heat):
        if lane.lane in overrides:
            results.append({"lane": lane.lane, **overrides[lane.lane]})
        else:
            results.append({"lane": lane.lane, "racer_id": lane.racer_id})
    return results


def test_race_mutations_and_leaderboard(client, db):
    # 1. Setup: Organization and Track
    group_in = schemas.OrganizationCreate(name="Race Mutation Organization")
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="Mutation Track", lane_count=4)
    track = crud.create_track(db, track_in)

    # 2. Create Race
    mutation_create_race = f"""
    mutation {{
        createRace(race: {{
            name: "Original Race", organizationId: {group.id}, trackId: {track.id}
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
                type: "ALL",
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
    results_data = _full_results(
        db,
        heat_id,
        {
            1: {"racer_id": racer_ids[0], "time": 3.45, "place": 1},
            2: {"racer_id": racer_ids[1], "time": 3.50, "place": 2},
        },
    )
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


def test_leaderboard_racing_group_division(client, db):
    """A racing group's category rides along on the leaderboard as
    `racingGroupDivision` (#298, #496 stage 2).

    Named to avoid colliding with the standings' own `rank` field, which is a
    racer's finishing position rather than their racing group's category.
    """
    group_in = schemas.OrganizationCreate(name="RacingGroup Division Organization")
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="RacingGroup Division Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{
            name: "RacingGroup Division Race"
            organizationId: {group.id}
            trackId: {track.id}
        }}) {{ id }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    mutation_create_den = f"""
    mutation {{
        createRacingGroup(
            raceId: {race_id}
            racingGroup: {{ name: "Wolves", division: "Wolf" }}
        ) {{
            id
        }}
    }}
    """
    racing_group_id = client.post(
        "/graphql", json={"query": mutation_create_den}
    ).json()["data"]["createRacingGroup"]["id"]

    mutation_create_racer = f"""
    mutation {{
        createRacer(racer: {{
            firstName: "Ranked",
            lastName: "Racer",
            racingGroupId: {racing_group_id},
            raceId: {race_id},
            carPassedInspection: true
        }}) {{ id }}
    }}
    """
    racer_id = client.post("/graphql", json={"query": mutation_create_racer}).json()[
        "data"
    ]["createRacer"]["id"]

    mutation_create_unranked_racer = f"""
    mutation {{
        createRacer(racer: {{
            firstName: "Unranked",
            lastName: "Racer",
            raceId: {race_id},
            carPassedInspection: true
        }}) {{ id }}
    }}
    """
    unranked_racer_id = client.post(
        "/graphql", json={"query": mutation_create_unranked_racer}
    ).json()["data"]["createRacer"]["id"]

    mutation_wizard = f"""
    mutation {{
        createRoundWizard(raceId: {race_id}, config: {{
            generalRound: {{ type: "ALL", runsPerLane: 1 }},
            championshipRounds: []
        }}) {{ id }}
    }}
    """
    assert client.post("/graphql", json={"query": mutation_wizard}).status_code == 200

    query_heats = f"""
    query {{
        race(raceId: {race_id}) {{ heats {{ id }} }}
    }}
    """
    heat_id = client.post("/graphql", json={"query": query_heats}).json()["data"][
        "race"
    ]["heats"][0]["id"]

    results_data = _full_results(
        db,
        heat_id,
        {
            1: {"racer_id": racer_id, "time": 3.45, "place": 1},
            2: {"racer_id": unranked_racer_id, "time": 3.50, "place": 2},
        },
    )
    record_heat_result(client, heat_id, results_data)

    query_leaderboard = f"""
    query {{
        race(raceId: {race_id}) {{
            leaderboard {{
                racerId
                racingGroupName
                racingGroupDivision
            }}
        }}
    }}
    """
    response = client.post("/graphql", json={"query": query_leaderboard})
    assert response.status_code == 200
    lb = response.json()["data"]["race"]["leaderboard"]
    assert len(lb) == 2

    ranked = next(r for r in lb if r["racerId"] == racer_id)
    assert ranked["racingGroupName"] == "Wolves"
    assert ranked["racingGroupDivision"] == "Wolf"

    unranked = next(r for r in lb if r["racerId"] == unranked_racer_id)
    assert unranked["racingGroupName"] == "Unknown"
    assert unranked["racingGroupDivision"] is None


def test_bulk_move_to_den_null(client, db):
    # Setup
    group_in = schemas.OrganizationCreate(name="Bulk RacingGroup Organization")
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="Bulk RacingGroup Track", lane_count=4)
    track = crud.create_track(db, track_in)

    mutation_create_race = f"""
    mutation {{
        createRace(race: {{
            name: "Bulk RacingGroup Race"
            organizationId: {group.id}
            trackId: {track.id}
        }}) {{
            id
        }}
    }}
    """
    race_id = client.post("/graphql", json={"query": mutation_create_race}).json()[
        "data"
    ]["createRace"]["id"]

    # Create RacingGroup
    mutation_create_den = f"""
    mutation {{
        createRacingGroup(raceId: {race_id}, racingGroup: {{ name: "Lions" }}) {{ id }}
    }}
    """
    racing_group_id = client.post(
        "/graphql", json={"query": mutation_create_den}
    ).json()["data"]["createRacingGroup"]["id"]

    # Create Racer in RacingGroup
    mutation_create_racer = f"""
    mutation {{
        createRacer(racer: {{
            firstName: "RacingGroup",
            lastName: "Racer",
            racingGroupId: {racing_group_id},
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
        bulkMoveToRacingGroup(racerIds: [{racer_id}], racingGroupId: null)
    }}
    """
    response = client.post("/graphql", json={"query": mutation_move_null})
    assert response.json()["data"]["bulkMoveToRacingGroup"] is True

    # Verify unassigned
    query_racer = f"""
    query {{
        racer(racerId: {racer_id}) {{
            racingGroupId
        }}
    }}
    """
    response = client.post("/graphql", json={"query": query_racer})
    assert response.json()["data"]["racer"]["racingGroupId"] is None
