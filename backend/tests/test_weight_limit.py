"""The pack's weight limit on a race (#205).

The rule itself — over, under, or not weighed — is the frontend's, because it
is a warning shown while somebody types rather than something the server
refuses. What the backend owes is storage that can express all three states,
including turning the check back off.
"""

from backend.db import crud, models, schemas


def _race(db, name: str) -> models.Race:
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{name} Organization")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{name} Track", lane_count=4)
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(name=name, organization_id=group.id, track_id=track.id),
    )


def test_a_race_created_without_one_does_not_check_weights(client, db):
    """Which is every race that existed before this column did."""
    race = _race(db, "No Limit Race")

    response = client.post(
        "/graphql",
        json={"query": f"{{ race(raceId: {race.id}) {{ weightLimitOz }} }}"},
    )

    assert response.json()["data"]["race"]["weightLimitOz"] is None


def test_a_limit_can_be_set_when_the_race_is_created(client, db):
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="Created Limit Organization")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name="Created Limit Track", lane_count=4)
    )

    response = client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                createRace(race: {{
                    name: "Created With Limit",
                    organizationId: {group.id},
                    trackId: {track.id},
                    weightLimitOz: 5.0
                }}) {{ weightLimitOz }}
            }}
            """
        },
    )

    assert response.json()["data"]["createRace"]["weightLimitOz"] == 5.0


def test_a_limit_can_be_changed(client, db):
    race = _race(db, "Changed Limit Race")

    response = client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                updateRace(id: {race.id}, race: {{weightLimitOz: 5.25}}) {{
                    weightLimitOz
                }}
            }}
            """
        },
    )

    assert response.json()["data"]["updateRace"]["weightLimitOz"] == 5.25


def test_the_check_can_be_turned_back_off(client, db):
    """The reason `clearWeightLimit` exists at all.

    `updateRace` drops every null from its payload, so absent means "leave
    alone" — which is what lets a settings screen re-submit a whole race
    without wiping the fields it does not offer. Without an explicit removal
    the weight check could be switched on and never off again. Same shape as
    the PIN's removal control (#192).
    """
    race = _race(db, "Cleared Limit Race")
    client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                updateRace(id: {race.id}, race: {{weightLimitOz: 5.0}}) {{ id }}
            }}
            """
        },
    )

    response = client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                updateRace(id: {race.id}, race: {{clearWeightLimit: true}}) {{
                    weightLimitOz
                }}
            }}
            """
        },
    )

    assert response.json()["data"]["updateRace"]["weightLimitOz"] is None


def test_an_absent_limit_leaves_the_stored_one_alone(client, db):
    """The behaviour the explicit control exists to preserve."""
    race = _race(db, "Untouched Limit Race")
    client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                updateRace(id: {race.id}, race: {{weightLimitOz: 5.0}}) {{ id }}
            }}
            """
        },
    )

    response = client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                updateRace(id: {race.id}, race: {{location: "The gym"}}) {{
                    location
                    weightLimitOz
                }}
            }}
            """
        },
    )

    data = response.json()["data"]["updateRace"]
    assert data["location"] == "The gym"
    assert data["weightLimitOz"] == 5.0
