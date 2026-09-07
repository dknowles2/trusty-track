import uuid

from backend.db import crud, models, schemas


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def create_race_context(db):
    # Helper to create a race and return its ID
    group_in = schemas.OrganizationCreate(name=get_unique_name("Test Organization"))
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="RacingGroup Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name=get_unique_name("Test Race"), organization_id=group.id, track_id=track.id
    )
    race = crud.create_race(db, race_in)
    return race.id


def test_delete_racing_group_logic(client, db):
    race_id = create_race_context(db)

    # 1. Create a RacingGroup
    print("Creating RacingGroup...")
    racing_group_name = get_unique_name("DeleteMe")
    mutation_create = f"""
    mutation {{
        createRacingGroup(
            racingGroup: {{
                name: "{racing_group_name}", color: "#000000", division: "Lion"
            }}
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
    racing_group_data = resp.json()["data"]["createRacingGroup"]
    racing_group_id = racing_group_data["id"]

    # 2. Create a Racer in that RacingGroup
    print("Creating Racer...")
    r_in = schemas.RacerCreate(
        first_name="Gone",
        last_name="Soon",
        racing_group_id=racing_group_id,
        race_id=race_id,
        car_number=999,
    )
    racer = crud.create_racer(db, r_in)
    racer_id = racer.id
    assert racer.racing_group_id == int(racing_group_id)

    # 3. Delete the RacingGroup
    print("Deleting RacingGroup...")
    mutation_delete = f"""
    mutation {{
        deleteRacingGroup(id: {racing_group_id})
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_delete})
    assert resp.json()["data"]["deleteRacingGroup"] is True

    # 4. Verify RacingGroup is gone from the list
    racing_group = crud.get_racing_group(db, racing_group_id)
    assert racing_group is None

    # 5. Verify Racer is still there but racing_group_id is None
    db.expire_all()
    racer = db.query(crud.models.Racer).get(racer_id)
    assert racer is not None
    assert racer.racing_group_id is None


def test_delete_den_refused_when_round_is_scoped_to_it(client, db):
    """#312: a racing-group-scoped round's FK must refuse the delete, not crash it.

    #823: the refusal used to be a bare `false` with no message reaching the
    client at all (`deleteRacingGroup` caught the `ValueError` and swallowed
    it) — the operator saw "a round or an award" with no way to tell which.
    The mutation now lets the `ValueError` through as an ordinary GraphQL
    error, naming the round that is blocking the delete, the same shape
    `createRunOffHeat`'s own validation already takes.
    """
    race_id = create_race_context(db)

    racing_group_name = get_unique_name("ScopedDen")
    mutation_create = f"""
    mutation {{
        createRacingGroup(
            racingGroup: {{
                name: "{racing_group_name}", color: "#000000", division: "Lion"
            }}
            raceId: {race_id}
        ) {{
            id
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    assert resp.status_code == 200
    racing_group_id = resp.json()["data"]["createRacingGroup"]["id"]

    crud.create_round(
        db,
        race_id=race_id,
        round_number=1,
        name="Wolves Prelims",
        racing_group_id=int(racing_group_id),
    )

    mutation_delete = f"""
    mutation {{
        deleteRacingGroup(id: {racing_group_id})
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_delete})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("errors"), "expected the refusal to reach the client as an error"
    assert any("Wolves Prelims" in err["message"] for err in body["errors"]), body[
        "errors"
    ]
    # A non-null field's resolver raising propagates all the way to the root.
    assert body.get("data") is None

    # The racing_group survives the refused delete.
    assert crud.get_racing_group(db, int(racing_group_id)) is not None


def test_delete_den_refused_when_award_is_scoped_to_it(client, db):
    """#755: `Award.racing_group_id` used to cascade — deleting a den that a
    "Fastest Wolf" award named silently destroyed the award (and any votes
    under it). Refuse the same way the round-scoped case does, rather than
    losing a trophy on race morning with one confirm click.

    #823: `crud.delete_racing_group` already named the award in its
    `ValueError` message — the mutation just discarded it. This pins that
    the message now reaches the client.
    """
    race_id = create_race_context(db)

    racing_group_name = get_unique_name("AwardedDen")
    mutation_create = f"""
    mutation {{
        createRacingGroup(
            racingGroup: {{
                name: "{racing_group_name}", color: "#000000", division: "Wolf"
            }}
            raceId: {race_id}
        ) {{
            id
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    assert resp.status_code == 200
    racing_group_id = int(resp.json()["data"]["createRacingGroup"]["id"])

    award = crud.create_award(
        db,
        race_id,
        schemas.AwardCreate(
            name="Fastest Wolf",
            kind=models.AwardKind.SPEED,
            source="ALL",
            place=1,
            racing_group_id=racing_group_id,
        ),
    )
    award_id = award.id

    mutation_delete = f"""
    mutation {{
        deleteRacingGroup(id: {racing_group_id})
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_delete})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("errors"), "expected the refusal to reach the client as an error"
    assert any("Fastest Wolf" in err["message"] for err in body["errors"]), body[
        "errors"
    ]
    assert body.get("data") is None

    # The den, and the award scoped to it, both survive the refused delete.
    assert crud.get_racing_group(db, racing_group_id) is not None
    db.expire_all()
    surviving_award = db.query(models.Award).filter(models.Award.id == award_id).first()
    assert surviving_award is not None
    assert surviving_award.racing_group_id == racing_group_id


def test_edit_den_logic(client, db):
    race_id = create_race_context(db)

    # 1. Create a RacingGroup
    racing_group_name = get_unique_name("EditMe")
    mutation_create = f"""
    mutation {{
        createRacingGroup(
            racingGroup: {{
                name: "{racing_group_name}", color: "#111111", division: "Wolf"
            }}
            raceId: {race_id}
        ) {{
            id
            name
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_create})
    racing_group_id = resp.json()["data"]["createRacingGroup"]["id"]

    # 2. Update RacingGroup
    new_name = get_unique_name("EditedDen")
    mutation_update = f"""
    mutation {{
        updateRacingGroup(
            id: {racing_group_id}
            racingGroup: {{
                name: "{new_name}", color: "#222222", division: "Wolf"
            }}
        ) {{
            name
            color
            division
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_update})
    updated_den = resp.json()["data"]["updateRacingGroup"]
    assert updated_den["name"] == new_name
    assert updated_den["color"] == "#222222"
    assert updated_den["division"] == "Wolf"

    # 3. Verify changes persist
    racing_group = crud.get_racing_group(db, racing_group_id)
    assert racing_group.name == new_name
