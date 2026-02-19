import json

from backend import crud, models, schemas


def test_populate_race(client, db):
    """Test the populateRace mutation."""
    # Setup
    group = crud.create_group(db, schemas.GroupCreate(name="Populate Group"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Populate Track", lane_count=4)
    )

    mutation_create = f"""
    mutation {{
        createRace(race: {{name: "Populate Race", groupId: {group.id}, trackId: {track.id}}}) {{
            id
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    race_id = resp.json()["data"]["createRace"]["id"]

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
    racers = crud.get_racers(db, race_id=race_id)
    assert len(racers) == 5
    assert racers[0].car_passed_inspection is True


def test_import_racers(client, db):
    """Test the importRacers mutation."""
    # Setup
    group = crud.create_group(db, schemas.GroupCreate(name="Import Group"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Import Track", lane_count=4)
    )
    race = crud.create_race(
        db, schemas.RaceCreate(name="Import Race", group_id=group.id, track_id=track.id)
    )
    race_id = race.id

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
    racers = crud.get_racers(db, race_id=race_id)
    assert len(racers) == 2
    dens = db.query(models.Den).filter(models.Den.race_id == race_id).all()
    assert len(dens) == 2
    names = [d.name for d in dens]
    assert "Lions" in names
    assert "Tigers" in names


def test_create_round_regular(client, db):
    """Test the createRound mutation."""
    # Setup
    group = crud.create_group(db, schemas.GroupCreate(name="Round Group"))
    track = crud.create_track(db, schemas.TrackCreate(name="Round Track", lane_count=4))
    race = crud.create_race(
        db, schemas.RaceCreate(name="Round Race", group_id=group.id, track_id=track.id)
    )
    race_id = race.id

    # Populate
    mutation_populate = f"""
    mutation {{
        populateRace(raceId: {race_id}, config: {{count: 4, checkIn: true}})
    }}
    """
    client.post("/graphql", json={"query": mutation_populate})

    # 1. Create General Round
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            schedulingStrategy: "PPC",
            name: "Qualifying",
            runsPerLane: 1,
            generalType: "PACK"
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
    heats = crud.get_heats(db, race_id)
    assert len(heats) > 0
