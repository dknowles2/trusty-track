import uuid

from backend.db import crud, schemas


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def create_race_context(db):
    # Helper to create a race and return its ID
    group_in = schemas.GroupCreate(name=get_unique_name("Test Group"))
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Den Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name=get_unique_name("Test Race"), group_id=group.id, track_id=track.id
    )
    race = crud.create_race(db, race_in)
    return race.id


def test_delete_den_logic(client, db):
    race_id = create_race_context(db)

    # 1. Create a Den
    print("Creating Den...")
    den_name = get_unique_name("DeleteMe")
    mutation_create = f"""
    mutation {{
        createDen(
            den: {{name: "{den_name}", color: "#000000", rank: "LION"}}
            raceId: {race_id}
        ) {{
            id
            name
            raceId
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    assert resp.status_code == 200
    den_data = resp.json()["data"]["createDen"]
    den_id = den_data["id"]

    # 2. Create a Racer in that Den
    print("Creating Racer...")
    r_in = schemas.RacerCreate(
        first_name="Gone",
        last_name="Soon",
        den_id=den_id,
        race_id=race_id,
        car_number=999,
    )
    racer = crud.create_racer(db, r_in)
    racer_id = racer.id
    assert racer.den_id == int(den_id)

    # 3. Delete the Den
    print("Deleting Den...")
    mutation_delete = f"""
    mutation {{
        deleteDen(id: {den_id})
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_delete})
    assert resp.json()["data"]["deleteDen"] is True

    # 4. Verify Den is gone from the list
    den = crud.get_den(db, den_id)
    assert den is None

    # 5. Verify Racer is still there but den_id is None
    db.expire_all()
    racer = db.query(crud.models.Racer).get(racer_id)
    assert racer is not None
    assert racer.den_id is None


def test_delete_den_refused_when_round_is_scoped_to_it(client, db):
    """#312: a den-scoped round's FK must refuse the delete, not crash it."""
    race_id = create_race_context(db)

    den_name = get_unique_name("ScopedDen")
    mutation_create = f"""
    mutation {{
        createDen(
            den: {{name: "{den_name}", color: "#000000", rank: "LION"}}
            raceId: {race_id}
        ) {{
            id
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    assert resp.status_code == 200
    den_id = resp.json()["data"]["createDen"]["id"]

    crud.create_round(db, race_id=race_id, round_number=1, den_id=int(den_id))

    mutation_delete = f"""
    mutation {{
        deleteDen(id: {den_id})
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_delete})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("errors") is None
    assert body["data"]["deleteDen"] is False

    # The den survives the refused delete.
    assert crud.get_den(db, int(den_id)) is not None


def test_edit_den_logic(client, db):
    race_id = create_race_context(db)

    # 1. Create a Den
    den_name = get_unique_name("EditMe")
    mutation_create = f"""
    mutation {{
        createDen(
            den: {{name: "{den_name}", color: "#111111", rank: "WOLF"}}
            raceId: {race_id}
        ) {{
            id
            name
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    den_id = resp.json()["data"]["createDen"]["id"]

    # 2. Update Den
    new_name = get_unique_name("EditedDen")
    mutation_update = f"""
    mutation {{
        updateDen(
            id: {den_id}
            den: {{name: "{new_name}", color: "#222222", rank: "WOLF"}}
        ) {{
            name
            color
            rank
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_update})
    updated_den = resp.json()["data"]["updateDen"]
    assert updated_den["name"] == new_name
    assert updated_den["color"] == "#222222"
    assert updated_den["rank"] == "WOLF"

    # 3. Verify changes persist
    den = crud.get_den(db, den_id)
    assert den.name == new_name
