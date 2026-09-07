"""`updateRacer` must be able to clear a racer's den, car number, car name,
weight or photos, not just set them (#747).

`RacerInput`'s optional fields default to `None`, so an explicit `null` and
an omitted field were indistinguishable in `Mutation.update_racer` — both
were dropped by `{k: v for k, v in data.items() if v is not None}` before
`schemas.RacerUpdate` ever saw them. The fix follows the codebase's own
precedent for this exact trap: `RaceUpdateInput.clearWeightLimit` (#205),
`clearTerminology` and `clearNameDisplay` (#496/#552) all solve "absent
must mean leave alone, but there still has to be a way back to null" with an
explicit boolean per field (or per cluster of fields) rather than switching
to `strawberry.UNSET`. `RacerInput` gets the same shape: `clearRacingGroup`,
`clearCarNumber`, `clearCarName`, `clearCarWeight`, `clearRacerImage`,
`clearCarImage`.
"""

from backend.db import crud, models, schemas


def _race(db, name: str) -> models.Race:
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{name} Org"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{name} Track", lane_count=4)
    )
    return crud.create_race(
        db, schemas.RaceCreate(name=name, organization_id=org.id, track_id=track.id)
    )


def _racer(db, race: models.Race, **overrides) -> models.Racer:
    defaults = {
        "first_name": "Ozzie",
        "last_name": "Driver",
        "race_id": race.id,
        "car_passed_inspection": True,
    }
    defaults.update(overrides)
    return crud.create_racer(db, schemas.RacerCreate(**defaults))


UPDATE_RACER = """
mutation($id: Int!, $racer: RacerInput!) {
  updateRacer(id: $id, racer: $racer) {
    id
    racingGroupId
    carNumber
    carName
    carWeight
    racerImageUrl
    carImageUrl
  }
}
"""


def test_racing_group_can_be_cleared(client, db):
    race = _race(db, "ClearDenRace")
    group = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race.id
    )
    racer = _racer(db, race, racing_group_id=group.id)

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "racingGroupId": None,
                    "clearRacingGroup": True,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRacer"]["racingGroupId"] is None


def test_car_number_can_be_cleared(client, db):
    race = _race(db, "ClearNumberRace")
    racer = _racer(db, race, car_number=42)

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carNumber": None,
                    "clearCarNumber": True,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRacer"]["carNumber"] is None


def test_car_name_can_be_cleared(client, db):
    race = _race(db, "ClearCarNameRace")
    racer = _racer(db, race, car_name="The Beast")

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carName": None,
                    "clearCarName": True,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRacer"]["carName"] is None


def test_car_weight_can_be_cleared(client, db):
    race = _race(db, "ClearWeightRace")
    racer = _racer(db, race, car_weight=5.0)

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carWeight": None,
                    "clearCarWeight": True,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRacer"]["carWeight"] is None


def test_racer_photo_can_be_cleared(client, db):
    race = _race(db, "ClearRacerPhotoRace")
    racer = _racer(db, race, racer_image_url="/static/racer.png")

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "racerImageUrl": None,
                    "clearRacerImage": True,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRacer"]["racerImageUrl"] is None


def test_car_photo_can_be_cleared(client, db):
    race = _race(db, "ClearCarPhotoRace")
    racer = _racer(db, race, car_image_url="/static/car.png")

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carImageUrl": None,
                    "clearCarImage": True,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRacer"]["carImageUrl"] is None


def test_an_absent_field_still_leaves_the_stored_value_alone(client, db):
    """The behaviour the explicit clear flags exist to preserve — a screen
    that does not offer a field must not wipe it out just by omitting it."""
    race = _race(db, "LeaveAloneRace")
    group = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Bears"), race.id
    )
    racer = _racer(db, race, racing_group_id=group.id, car_number=7, car_name="Speedy")

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": "Newname",
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["updateRacer"]["racingGroupId"] == group.id
    assert body["data"]["updateRacer"]["carNumber"] == 7
    assert body["data"]["updateRacer"]["carName"] == "Speedy"
