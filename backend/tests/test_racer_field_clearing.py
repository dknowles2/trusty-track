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
    racerImageOriginalUrl
    carImageOriginalUrl
    racerImageEdit
    carImageEdit
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


def test_clearing_the_racer_photo_also_clears_its_original_and_edit(client, db):
    """`clearRacerImage` nulls all three fields for that side (#1241) — a
    stray original left behind would let a later Rotate / Recrop reopen on
    a photo the operator just cleared."""
    race = _race(db, "ClearRacerPhotoWithHistoryRace")
    racer = _racer(
        db,
        race,
        racer_image_url="/static/racer-cropped.png",
        racer_image_original_url="/static/racer-original.png",
        racer_image_edit='{"rotation":90,"crop":{"x":1,"y":2,"width":3,"height":4}}',
    )

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
                    # Sent explicitly and non-null, so this exercises
                    # `clear_racer_image`'s own override specifically —
                    # without these two, an *absent* original/edit would
                    # already come out null through the ordinary "these two
                    # fields are always sent in full" handling below, and
                    # the test would pass even if the clear flag's own
                    # override of them were deleted.
                    "racerImageOriginalUrl": "/static/sneaked-in-original.png",
                    "racerImageEdit": (
                        '{"rotation":270,"crop":{"x":9,"y":9,"width":9,"height":9}}'
                    ),
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    updated = body["data"]["updateRacer"]
    assert updated["racerImageUrl"] is None
    assert updated["racerImageOriginalUrl"] is None
    assert updated["racerImageEdit"] is None


def test_clearing_the_car_photo_also_clears_its_original_and_edit(client, db):
    race = _race(db, "ClearCarPhotoWithHistoryRace")
    racer = _racer(
        db,
        race,
        car_image_url="/static/car-cropped.png",
        car_image_original_url="/static/car-original.png",
        car_image_edit='{"rotation":0,"crop":{"x":0,"y":0,"width":10,"height":10}}',
    )

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
    updated = body["data"]["updateRacer"]
    assert updated["carImageUrl"] is None
    assert updated["carImageOriginalUrl"] is None
    assert updated["carImageEdit"] is None


def test_a_recrop_stores_the_new_original_and_edit(client, db):
    """The ordinary (non-clearing) shape `RacerForm`'s Rotate / Recrop sends
    (#1241) — a new derived image, the kept-or-promoted original, and the
    edit that produced it, all three landing exactly as sent."""
    race = _race(db, "RecropRace")
    racer = _racer(db, race, racer_image_url="/static/racer-original.png")

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "racerImageUrl": "/static/racer-recropped.png",
                    # The image the modal opened on becomes the original,
                    # since there was none on file yet — the promotion rule
                    # `RacerForm.tsx`'s `recropUpload` applies client-side.
                    "racerImageOriginalUrl": "/static/racer-original.png",
                    "racerImageEdit": (
                        '{"rotation":90,"crop":{"x":0,"y":0,"width":50,"height":50}}'
                    ),
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    updated = body["data"]["updateRacer"]
    assert updated["racerImageUrl"] == "/static/racer-recropped.png"
    assert updated["racerImageOriginalUrl"] == "/static/racer-original.png"
    assert (
        updated["racerImageEdit"]
        == '{"rotation":90,"crop":{"x":0,"y":0,"width":50,"height":50}}'
    )


def test_a_car_recrop_stores_the_new_original_and_edit(client, db):
    """The car-side twin of the test above — `_photo_field_updates` is
    called once per side, and only one of the two calls was exercised."""
    race = _race(db, "CarRecropRace")
    racer = _racer(db, race, car_image_url="/static/car-original.png")

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carImageUrl": "/static/car-recropped.png",
                    "carImageOriginalUrl": "/static/car-original.png",
                    "carImageEdit": (
                        '{"rotation":180,"crop":{"x":1,"y":1,"width":9,"height":9}}'
                    ),
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    updated = body["data"]["updateRacer"]
    assert updated["carImageUrl"] == "/static/car-recropped.png"
    assert updated["carImageOriginalUrl"] == "/static/car-original.png"
    assert (
        updated["carImageEdit"]
        == '{"rotation":180,"crop":{"x":1,"y":1,"width":9,"height":9}}'
    )


def test_a_new_racer_photo_with_no_original_or_edit_clears_stale_history(client, db):
    """A plain file-from-disk upload (#1241): `racerImageUrl` alone, with
    no `racerImageOriginalUrl`/`racerImageEdit` in the payload at all — the
    shape `RacerForm.tsx`'s `uploadFile` sends. The *stale* original and
    edit, left over from whatever this racer's photo used to be, must be
    nulled rather than left pointing at an unrelated picture — the same
    rule `bulk_assign_racer_photos` already applies to an assigned photo."""
    race = _race(db, "FreshRacerPhotoRace")
    racer = _racer(
        db,
        race,
        racer_image_url="/static/racer-old-cropped.png",
        racer_image_original_url="/static/racer-old-original.png",
        racer_image_edit='{"rotation":90,"crop":{"x":0,"y":0,"width":1,"height":1}}',
    )

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "racerImageUrl": "/static/racer-fresh.png",
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    updated = body["data"]["updateRacer"]
    assert updated["racerImageUrl"] == "/static/racer-fresh.png"
    assert updated["racerImageOriginalUrl"] is None
    assert updated["racerImageEdit"] is None


def test_a_new_car_photo_with_no_original_or_edit_clears_stale_history(client, db):
    """The car-side twin of the test above."""
    race = _race(db, "FreshCarPhotoRace")
    racer = _racer(
        db,
        race,
        car_image_url="/static/car-old-cropped.png",
        car_image_original_url="/static/car-old-original.png",
        car_image_edit='{"rotation":90,"crop":{"x":0,"y":0,"width":1,"height":1}}',
    )

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carImageUrl": "/static/car-fresh.png",
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    updated = body["data"]["updateRacer"]
    assert updated["carImageUrl"] == "/static/car-fresh.png"
    assert updated["carImageOriginalUrl"] is None
    assert updated["carImageEdit"] is None


def test_updating_unrelated_fields_leaves_the_racer_photo_history_alone(client, db):
    """The reviewer's exact scenario, verbatim: an `updateRacer` payload
    naming only `firstName`/`lastName`/`carWeight` — an ordinary check-in
    weight edit with nothing to do with the photo — must not touch a
    racer's crop history at all (#1241). A first version of this feature
    nulled both fields here, because it reapplied them unconditionally
    rather than treating an absent `racerImageUrl` as "leave alone" the
    way every other field on this input already does."""
    race = _race(db, "WeightOnlyEditRace")
    racer = _racer(
        db,
        race,
        racer_image_url="/static/racer-cropped.png",
        racer_image_original_url="/static/racer-original.png",
        racer_image_edit='{"rotation":90,"crop":{"x":0,"y":0,"width":50,"height":50}}',
    )

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carWeight": 5.0,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    updated = body["data"]["updateRacer"]
    assert updated["carWeight"] == 5.0
    assert updated["racerImageUrl"] == "/static/racer-cropped.png"
    assert updated["racerImageOriginalUrl"] == "/static/racer-original.png"
    assert (
        updated["racerImageEdit"]
        == '{"rotation":90,"crop":{"x":0,"y":0,"width":50,"height":50}}'
    )


def test_updating_unrelated_fields_leaves_the_car_photo_history_alone(client, db):
    """The car-side twin of the test above."""
    race = _race(db, "WeightOnlyEditCarRace")
    racer = _racer(
        db,
        race,
        car_image_url="/static/car-cropped.png",
        car_image_original_url="/static/car-original.png",
        car_image_edit='{"rotation":180,"crop":{"x":0,"y":0,"width":9,"height":9}}',
    )

    body = client.post(
        "/graphql",
        json={
            "query": UPDATE_RACER,
            "variables": {
                "id": racer.id,
                "racer": {
                    "firstName": racer.first_name,
                    "lastName": racer.last_name,
                    "carWeight": 5.0,
                },
            },
        },
    ).json()

    assert not body.get("errors"), body
    updated = body["data"]["updateRacer"]
    assert updated["carWeight"] == 5.0
    assert updated["carImageUrl"] == "/static/car-cropped.png"
    assert updated["carImageOriginalUrl"] == "/static/car-original.png"
    assert (
        updated["carImageEdit"]
        == '{"rotation":180,"crop":{"x":0,"y":0,"width":9,"height":9}}'
    )


def test_an_absent_field_still_leaves_the_stored_value_alone(client, db):
    """The behaviour the explicit clear flags exist to preserve — a screen
    that does not offer a field must not wipe it out just by omitting it.
    Covers the photo-history pair too (#1241) — this is the test that
    should have caught the reviewer's finding, and didn't, because it
    checked every other field but these two."""
    race = _race(db, "LeaveAloneRace")
    group = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Bears"), race.id
    )
    racer = _racer(
        db,
        race,
        racing_group_id=group.id,
        car_number=7,
        car_name="Speedy",
        racer_image_url="/static/racer-cropped.png",
        racer_image_original_url="/static/racer-original.png",
        racer_image_edit='{"rotation":90,"crop":{"x":0,"y":0,"width":50,"height":50}}',
        car_image_url="/static/car-cropped.png",
        car_image_original_url="/static/car-original.png",
        car_image_edit='{"rotation":180,"crop":{"x":0,"y":0,"width":9,"height":9}}',
    )

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
    updated = body["data"]["updateRacer"]
    assert updated["racingGroupId"] == group.id
    assert updated["carNumber"] == 7
    assert updated["carName"] == "Speedy"
    assert updated["racerImageUrl"] == "/static/racer-cropped.png"
    assert updated["racerImageOriginalUrl"] == "/static/racer-original.png"
    assert (
        updated["racerImageEdit"]
        == '{"rotation":90,"crop":{"x":0,"y":0,"width":50,"height":50}}'
    )
    assert updated["carImageUrl"] == "/static/car-cropped.png"
    assert updated["carImageOriginalUrl"] == "/static/car-original.png"
    assert (
        updated["carImageEdit"]
        == '{"rotation":180,"crop":{"x":0,"y":0,"width":9,"height":9}}'
    )
