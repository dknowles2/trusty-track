"""Creating or renaming a race to a name already in use must return a
readable sentence, not a raw SQL statement (#748).

`Race.name` is `unique=True` and neither `crud.create_race`/`crud.update_race`
nor their resolvers caught the resulting `IntegrityError`, so the mutation's
GraphQL error carried the literal SQL and its bound parameters — and left the
session mid-transaction, which is also why `AuditExtension` then failed to
record the refusal (`PendingRollbackError`). `crud.create_scene`/`rename_scene`
already solved the identical shape for a scene name; this follows the same
"readable sentence, not a raw constraint" rule, and a race created or
renamed successfully right afterwards proves the session recovered.

Related, same audit: `create_racer` used to dereference `crud.create_racer`'s
`Racer | None` with no check, so a call against a database with no
`Organization` row raised `'NoneType' object has no attribute
'car_passed_inspection'` instead of a sentence.
"""

from backend.db import crud, models, schemas


def _org_and_track(db, label: str) -> tuple[models.Organization, models.Track]:
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{label} Org"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{label} Track", lane_count=4)
    )
    return org, track


CREATE_RACE = """
mutation($race: RaceInput!) {
  createRace(race: $race) { id name }
}
"""

UPDATE_RACE = """
mutation($id: Int!, $race: RaceUpdateInput!) {
  updateRace(id: $id, race: $race) { id name }
}
"""


def test_creating_a_race_with_a_duplicate_name_returns_a_readable_sentence(client, db):
    org, track = _org_and_track(db, "DupCreate")
    first = client.post(
        "/graphql",
        json={
            "query": CREATE_RACE,
            "variables": {
                "race": {
                    "name": "QA Second Race",
                    "organizationId": org.id,
                    "trackId": track.id,
                }
            },
        },
    ).json()
    assert not first.get("errors"), first

    body = client.post(
        "/graphql",
        json={
            "query": CREATE_RACE,
            "variables": {
                "race": {
                    "name": "QA Second Race",
                    "organizationId": org.id,
                    "trackId": track.id,
                }
            },
        },
    ).json()

    assert body.get("errors")
    message = body["errors"][0]["message"]
    assert "SELECT" not in message and "INSERT" not in message
    assert "QA Second Race" in message
    assert (
        db.query(models.Race).filter(models.Race.name == "QA Second Race").count() == 1
    )


def test_the_session_still_works_after_a_refused_duplicate_create(client, db):
    """The second-order failure the issue calls out: a session left mid
    transaction after an uncaught `IntegrityError` breaks the very next
    thing that tries to use it, including `AuditExtension`'s own attempt to
    record the refusal. A race created right after the refusal is the
    proof."""
    org, track = _org_and_track(db, "SessionRecovers")
    client.post(
        "/graphql",
        json={
            "query": CREATE_RACE,
            "variables": {
                "race": {
                    "name": "Recover Race",
                    "organizationId": org.id,
                    "trackId": track.id,
                }
            },
        },
    )
    refused = client.post(
        "/graphql",
        json={
            "query": CREATE_RACE,
            "variables": {
                "race": {
                    "name": "Recover Race",
                    "organizationId": org.id,
                    "trackId": track.id,
                }
            },
        },
    ).json()
    assert refused.get("errors")

    ok = client.post(
        "/graphql",
        json={
            "query": CREATE_RACE,
            "variables": {
                "race": {
                    "name": "Recover Race Two",
                    "organizationId": org.id,
                    "trackId": track.id,
                }
            },
        },
    ).json()

    assert not ok.get("errors"), ok
    assert ok["data"]["createRace"]["name"] == "Recover Race Two"


def test_renaming_a_race_to_an_existing_name_returns_a_readable_sentence(client, db):
    org, track = _org_and_track(db, "DupRename")
    crud.create_race(
        db,
        schemas.RaceCreate(
            name="Taken Name", organization_id=org.id, track_id=track.id
        ),
    )
    to_rename = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Renamable Race", organization_id=org.id, track_id=track.id
        ),
    )

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACE,
            "variables": {"id": to_rename.id, "race": {"name": "Taken Name"}},
        },
    ).json()

    assert body.get("errors")
    message = body["errors"][0]["message"]
    assert "SELECT" not in message and "UPDATE" not in message
    assert "Taken Name" in message
    db.expire_all()
    assert db.get(models.Race, to_rename.id).name == "Renamable Race"


def test_renaming_a_race_to_its_own_current_name_is_not_a_conflict(client, db):
    org, track = _org_and_track(db, "SelfRename")
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Same Name Race", organization_id=org.id, track_id=track.id
        ),
    )

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACE,
            "variables": {
                "id": race.id,
                "race": {"name": "Same Name Race", "location": "Gym"},
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRace"]["name"] == "Same Name Race"


def test_creating_a_racer_with_no_organization_configured_returns_a_sentence(client):
    """The related null-check bug: `create_racer` used to return `None` when
    no `Organization` exists yet, and the resolver dereferenced it anyway."""
    body = client.post(
        "/graphql",
        json={
            "query": """
            mutation {
              createRacer(racer: { firstName: "New", lastName: "Comer" }) { id }
            }
            """
        },
    ).json()

    assert body.get("errors")
    message = body["errors"][0]["message"]
    assert "NoneType" not in message
