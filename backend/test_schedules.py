
from backend import crud, schemas


def create_test_race(db):
    group_in = schemas.GroupCreate(name="Schedule Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Schedule Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name="Schedule Race", group_id=group.id, track_id=track.id
    )
    race = crud.create_race(db, race_in)
    return race.id


def test_generate_schedule_not_enough_racers(client, db):
    race_id = create_test_race(db)

    # 2. Add 1 Racer
    r_in = schemas.RacerCreate(
        first_name="Lonely", last_name="Racer", car_number=99, race_id=race_id
    )
    crud.create_racer(db, r_in)

    # 3. Try to create a round - Should FAIL
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "R1",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})
    # GraphQL returns data:null and errors
    assert "errors" in resp.json()
    assert "not enough racers" in resp.json()["errors"][0]["message"].lower()


def test_generate_schedule_success_with_min_racers(client, db):
    race_id = create_test_race(db)

    # Ensure 2 racers
    for i in range(2):
        r_in = schemas.RacerCreate(
            first_name=f"Racer{i}",
            last_name="Test",
            car_number=100 + i,
            race_id=race_id,
        )
        crud.create_racer(db, r_in)

    # Create a round - Should SUCCEED
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "R1",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
            heats {{ id }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})
    assert "data" in resp.json()
    assert resp.json()["data"]["createRound"] is not None
    rounds_data = resp.json()["data"]["createRound"]
    assert len(rounds_data) > 0

    # Check heats count.
    heats = rounds_data[0]["heats"]
    assert len(heats) > 0


def test_generate_ppc_schedule(client, db):
    race_id = create_test_race(db)

    # Ensure 2 racers
    for i in range(2):
        r_in = schemas.RacerCreate(
            first_name=f"PPC_Racer{i}",
            last_name="Test",
            car_number=200 + i,
            race_id=race_id,
        )
        crud.create_racer(db, r_in)

    # Create a round
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "PPC Round",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
            heats {{ id }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})
    assert "data" in resp.json()
    rounds = resp.json()["data"]["createRound"]
    assert len(rounds) > 0
    assert len(rounds[0]["heats"]) > 0
