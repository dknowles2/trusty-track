"""A mutation must refuse an id belonging to a different race than the one
it names (#743, #746, #759).

Three call sites shared one failure shape before this file: a mutation that
names a race explicitly (or resolves one from a batch of ids) went on to
accept a *second* id — a racer, a racing group, a photo URL standing in for
an upload — with no check that it belonged there. `_race_id_for_racers` in
`api/schema.py` already existed to find *a* race for a bulk racer mutation to
publish state against; #743 is that it trusted `racer_ids[0]` alone, so a
locked race's racer could be edited by hiding its id behind one from any
unlocked race. #759 is the identical shape one level up the schema, for an
award's own `racing_group_id`/`racer_id`. #746 is not a cross-race id at all,
but the same "an id-shaped field was trusted with no check" family: a photo
URL field is rendered on public, unauthenticated audience surfaces, and only
`uploadImage`'s own `/static/...` shape belongs there.
"""

import pytest

from backend.api import demo_policy
from backend.db import crud, models, schemas


def _org_track_race(db, label: str) -> models.Race:
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{label} Pack")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{label} Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Derby", organization_id=group.id, track_id=track.id
        ),
    )


def _racer(db, race: models.Race, **overrides) -> models.Racer:
    defaults = {
        "first_name": "A",
        "last_name": "Racer",
        "race_id": race.id,
        "car_passed_inspection": True,
    }
    defaults.update(overrides)
    return crud.create_racer(db, schemas.RacerCreate(**defaults))


def _post(client, query: str, variables: dict | None = None):
    return client.post("/graphql", json={"query": query, "variables": variables or {}})


# --------------------------------------------------------------------------- #
# #743 — bulk racer mutations must not span two races                          #
# --------------------------------------------------------------------------- #

BULK_SET_EXCLUDED = """
mutation($racerIds: [Int!]!, $excluded: Boolean!) {
  bulkSetExcludedFromStandings(racerIds: $racerIds, excluded: $excluded)
}
"""

BULK_CHECK_IN = """
mutation($racerIds: [Int!]!) { bulkCheckIn(racerIds: $racerIds) }
"""

BULK_CLEAR_NUMBERS = """
mutation($racerIds: [Int!]!) { bulkClearNumbers(racerIds: $racerIds) }
"""

BULK_DELETE = """
mutation($racerIds: [Int!]!) { bulkDeleteRacers(racerIds: $racerIds) }
"""

BULK_MOVE = """
mutation($racerIds: [Int!]!, $racingGroupId: Int) {
  bulkMoveToRacingGroup(racerIds: $racerIds, racingGroupId: $racingGroupId)
}
"""


def test_bulk_set_excluded_refuses_ids_spanning_two_races(client, db):
    race_a = _org_track_race(db, "SetExcludedA")
    race_b = _org_track_race(db, "SetExcludedB")
    racer_a = _racer(db, race_a)
    racer_b = _racer(db, race_b)

    body = _post(
        client,
        BULK_SET_EXCLUDED,
        {"racerIds": [racer_a.id, racer_b.id], "excluded": True},
    ).json()

    assert body.get("errors"), "a mixed-race id list should be refused outright"
    db.expire_all()
    assert db.get(models.Racer, racer_a.id).excluded_from_standings is False
    assert db.get(models.Racer, racer_b.id).excluded_from_standings is False


def test_bulk_check_in_refuses_ids_spanning_two_races(client, db):
    race_a = _org_track_race(db, "CheckInA")
    race_b = _org_track_race(db, "CheckInB")
    racer_a = _racer(db, race_a, car_passed_inspection=False)
    racer_b = _racer(db, race_b, car_passed_inspection=False)

    body = _post(client, BULK_CHECK_IN, {"racerIds": [racer_a.id, racer_b.id]}).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer_a.id).car_passed_inspection is False
    assert db.get(models.Racer, racer_b.id).car_passed_inspection is False


def test_bulk_clear_numbers_refuses_ids_spanning_two_races(client, db):
    race_a = _org_track_race(db, "ClearNumA")
    race_b = _org_track_race(db, "ClearNumB")
    racer_a = _racer(db, race_a, car_number=7)
    racer_b = _racer(db, race_b, car_number=9)

    body = _post(
        client, BULK_CLEAR_NUMBERS, {"racerIds": [racer_a.id, racer_b.id]}
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer_a.id).car_number == 7
    assert db.get(models.Racer, racer_b.id).car_number == 9


def test_bulk_delete_refuses_ids_spanning_two_races(client, db):
    race_a = _org_track_race(db, "DeleteA")
    race_b = _org_track_race(db, "DeleteB")
    racer_a = _racer(db, race_a)
    racer_b = _racer(db, race_b)

    body = _post(client, BULK_DELETE, {"racerIds": [racer_a.id, racer_b.id]}).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer_a.id) is not None
    assert db.get(models.Racer, racer_b.id) is not None


def test_bulk_move_to_racing_group_refuses_ids_spanning_two_races(client, db):
    race_a = _org_track_race(db, "MoveA")
    race_b = _org_track_race(db, "MoveB")
    racer_a = _racer(db, race_a)
    racer_b = _racer(db, race_b)
    group_a = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race_a.id
    )

    body = _post(
        client,
        BULK_MOVE,
        {"racerIds": [racer_a.id, racer_b.id], "racingGroupId": group_a.id},
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer_a.id).racing_group_id is None
    assert db.get(models.Racer, racer_b.id).racing_group_id is None


def test_a_locked_race_racer_cannot_be_edited_by_hiding_it_behind_an_unlocked_one(
    client, db
):
    """The exact reproduction from #743: a locked race's racer must not
    become editable by including one id from any unlocked race first."""
    locked_race = _org_track_race(db, "Locked")
    other_race = _org_track_race(db, "Unlocked")
    locked_racer = _racer(db, locked_race)
    other_racer = _racer(db, other_race)

    db_locked_race = (
        db.query(models.Race).filter(models.Race.id == locked_race.id).first()
    )
    db_locked_race.is_locked = True
    db.commit()

    body = _post(
        client,
        BULK_SET_EXCLUDED,
        {"racerIds": [other_racer.id, locked_racer.id], "excluded": True},
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, locked_racer.id).excluded_from_standings is False
    assert db.get(models.Racer, other_racer.id).excluded_from_standings is False


def test_crud_bulk_functions_treat_a_stray_id_from_another_race_as_a_no_op(db):
    """Defense in depth for a caller that reaches `crud` directly: each bulk
    function is scoped to the race it is told, so an id belonging to a
    different race is simply not among the rows it touches."""
    race_a = _org_track_race(db, "ScopeA")
    race_b = _org_track_race(db, "ScopeB")
    racer_a = _racer(db, race_a, car_passed_inspection=False, car_number=1)
    racer_b = _racer(db, race_b, car_passed_inspection=False, car_number=2)

    crud.bulk_check_in_racers(db, race_a.id, [racer_a.id, racer_b.id])
    db.refresh(racer_a)
    db.refresh(racer_b)
    assert racer_a.car_passed_inspection is True
    assert racer_b.car_passed_inspection is False

    crud.bulk_clear_car_numbers(db, race_a.id, [racer_a.id, racer_b.id])
    db.refresh(racer_a)
    db.refresh(racer_b)
    assert racer_a.car_number is None
    assert racer_b.car_number == 2

    crud.bulk_set_excluded_from_standings(db, race_a.id, [racer_a.id, racer_b.id], True)
    db.refresh(racer_a)
    db.refresh(racer_b)
    assert racer_a.excluded_from_standings is True
    assert racer_b.excluded_from_standings is False

    group_a = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Bears"), race_a.id
    )
    crud.bulk_move_racers_to_racing_group(
        db, race_a.id, [racer_a.id, racer_b.id], group_a.id
    )
    db.refresh(racer_a)
    db.refresh(racer_b)
    assert racer_a.racing_group_id == group_a.id
    assert racer_b.racing_group_id is None

    racer_a_id, racer_b_id = racer_a.id, racer_b.id
    crud.bulk_delete_racers(db, race_a.id, [racer_a_id, racer_b_id])
    db.expire_all()
    assert db.get(models.Racer, racer_a_id) is None
    assert db.get(models.Racer, racer_b_id) is not None


# --------------------------------------------------------------------------- #
# #746 — a racer's photo fields must be `uploadImage`'s own shape              #
# --------------------------------------------------------------------------- #

CREATE_RACER = """
mutation($racer: RacerInput!) {
  createRacer(racer: $racer) { id racerImageUrl carImageUrl }
}
"""

UPDATE_RACER = """
mutation($id: Int!, $racer: RacerInput!) {
  updateRacer(id: $id, racer: $racer) { id racerImageUrl }
}
"""


def test_create_racer_refuses_an_external_image_url(client, db):
    race = _org_track_race(db, "PhotoCreate")

    body = _post(
        client,
        CREATE_RACER,
        {
            "racer": {
                "firstName": "New",
                "lastName": "Comer",
                "raceId": race.id,
                "racerImageUrl": "https://evil.example.com/child.png",
            }
        },
    ).json()

    assert body.get("errors")
    assert (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race.id, models.Racer.last_name == "Comer")
        .first()
        is None
    )


def test_create_racer_refuses_a_protocol_relative_url(client, db):
    race = _org_track_race(db, "PhotoProtoRel")

    body = _post(
        client,
        CREATE_RACER,
        {
            "racer": {
                "firstName": "New",
                "lastName": "Comer",
                "raceId": race.id,
                "carImageUrl": "//evil.example.com/car.png",
            }
        },
    ).json()

    assert body.get("errors")


def test_create_racer_accepts_an_uploaded_photo_path(client, db):
    race = _org_track_race(db, "PhotoOk")

    body = _post(
        client,
        CREATE_RACER,
        {
            "racer": {
                "firstName": "New",
                "lastName": "Comer",
                "raceId": race.id,
                "racerImageUrl": "/static/abc123.png",
            }
        },
    ).json()

    assert not body.get("errors"), body
    assert body["data"]["createRacer"]["racerImageUrl"] == "/static/abc123.png"


def test_update_racer_refuses_an_external_image_url(client, db):
    race = _org_track_race(db, "PhotoUpdate")
    racer = _racer(db, race)

    body = _post(
        client,
        UPDATE_RACER,
        {
            "id": racer.id,
            "racer": {
                "firstName": racer.first_name,
                "lastName": racer.last_name,
                "racerImageUrl": "http://example.com/anything.jpg",
            },
        },
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer.id).racer_image_url is None


def test_bulk_assign_photos_skips_an_external_url_without_crashing(db):
    race = _org_track_race(db, "PhotoBulk")
    racer = _racer(db, race)

    count = crud.bulk_assign_racer_photos(
        db, [{"racer_id": racer.id, "url": "http://evil.example.com/a.png"}]
    )

    assert count == 0
    db.refresh(racer)
    assert racer.racer_image_url is None


def test_bulk_assign_photos_still_accepts_an_uploaded_path(db):
    race = _org_track_race(db, "PhotoBulkOk")
    racer = _racer(db, race)

    count = crud.bulk_assign_racer_photos(
        db, [{"racer_id": racer.id, "url": "/static/face.png"}]
    )

    assert count == 1
    db.refresh(racer)
    assert racer.racer_image_url == "/static/face.png"


def test_bulk_assign_photos_is_in_the_demo_denylist():
    """`uploadImage` is refused on the demo so a visitor cannot write a
    permanent file to disk; `bulkAssignPhotos` reaches the same racer photo
    fields with a caller-supplied URL and must be refused for the same
    reason (#746)."""
    assert "bulkAssignPhotos" in demo_policy.REFUSED_MUTATIONS


# --------------------------------------------------------------------------- #
# #879 — the #746 validator must not block a save that merely echoes back a   #
# racer's own already-stored (legacy or hand-assigned) photo URL              #
# --------------------------------------------------------------------------- #


def _legacy_photo_racer(db, race: models.Race, url: str) -> models.Racer:
    """A racer whose stored photo URL predates #746's validator — exactly the
    shape `bulkAssignPhotos` accepted with no check before that fix, or a
    hand-edited row from an install reachable by a LAN IP rather than
    `localhost`. `crud.create_racer` is bypassed on purpose: going through it
    would hit `RacerBase`'s own validator and refuse the very fixture this
    test needs to set up.
    """
    racer = models.Racer(
        first_name="Legacy",
        last_name="Racer",
        race_id=race.id,
        car_passed_inspection=True,
        racer_image_url=url,
    )
    db.add(racer)
    db.commit()
    db.refresh(racer)
    return racer


def test_update_racer_accepts_a_legacy_url_unchanged(client, db):
    """`RaceDetails.tsx` seeds its edit form from the stored URL and resends
    it on every save. A racer whose stored `racer_image_url` predates #746 —
    a `.jpeg` extension `uploadImage` has never produced, here — must still
    be renamable: the validator exists to stop a *new* bad value, not to
    freeze every field on a row that already has one (#879)."""
    race = _org_track_race(db, "PhotoLegacyUnchanged")
    racer = _legacy_photo_racer(db, race, "/static/photo.jpeg")

    body = _post(
        client,
        UPDATE_RACER,
        {
            "id": racer.id,
            "racer": {
                "firstName": "Renamed",
                "lastName": racer.last_name,
                "racerImageUrl": "/static/photo.jpeg",
            },
        },
    ).json()

    assert not body.get("errors"), body
    db.expire_all()
    updated = db.get(models.Racer, racer.id)
    assert updated.first_name == "Renamed"
    assert updated.racer_image_url == "/static/photo.jpeg"


def test_update_racer_accepts_a_legacy_absolute_url_unchanged(client, db):
    """The same as above for an absolute, LAN-IP-qualified URL — the other
    shape #879 names, from an install reached by its network address rather
    than `localhost`."""
    race = _org_track_race(db, "PhotoLegacyAbsolute")
    racer = _legacy_photo_racer(db, race, "http://192.168.1.5:8000/static/abc.png")

    body = _post(
        client,
        UPDATE_RACER,
        {
            "id": racer.id,
            "racer": {
                "firstName": racer.first_name,
                "lastName": "Renamed",
                "racerImageUrl": "http://192.168.1.5:8000/static/abc.png",
            },
        },
    ).json()

    assert not body.get("errors"), body
    db.expire_all()
    assert db.get(models.Racer, racer.id).last_name == "Renamed"


def test_update_racer_still_refuses_changing_to_a_new_external_url(client, db):
    """The exemption is for an *unchanged* value only — swapping a legacy URL
    for a *different* external one is exactly the hole #746 closed, and must
    stay closed (#879)."""
    race = _org_track_race(db, "PhotoLegacyChanged")
    racer = _legacy_photo_racer(db, race, "/static/photo.jpeg")

    body = _post(
        client,
        UPDATE_RACER,
        {
            "id": racer.id,
            "racer": {
                "firstName": racer.first_name,
                "lastName": racer.last_name,
                "racerImageUrl": "https://evil.example.com/child.png",
            },
        },
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer.id).racer_image_url == "/static/photo.jpeg"


def test_check_in_racer_accepts_a_legacy_url_unchanged(db):
    """`checkInRacer` funnels through the same `crud.update_racer`, and a
    check-in that resends a racer's own legacy photo URL (rather than a
    fresh one) must not be refused either (#879)."""
    race = _org_track_race(db, "PhotoLegacyCheckIn")
    racer = _legacy_photo_racer(db, race, "/static/photo.jpeg")

    updated = crud.update_racer(
        db,
        racer.id,
        schemas.RacerUpdate(
            car_passed_inspection=True, racer_image_url="/static/photo.jpeg"
        ),
    )

    assert updated is not None
    assert updated.car_passed_inspection is True
    assert updated.racer_image_url == "/static/photo.jpeg"


# --------------------------------------------------------------------------- #
# #759 — an award must not name a den or racer from a different race          #
# --------------------------------------------------------------------------- #

CREATE_AWARD = """
mutation($raceId: Int!, $award: AwardInput!) {
  createAward(raceId: $raceId, award: $award) { id }
}
"""

UPDATE_AWARD = """
mutation($id: Int!, $award: AwardInput!) {
  updateAward(id: $id, award: $award) { id }
}
"""


def test_create_award_refuses_a_racing_group_from_another_race(client, db):
    race_a = _org_track_race(db, "AwardGroupA")
    race_b = _org_track_race(db, "AwardGroupB")
    group_b = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race_b.id
    )

    body = _post(
        client,
        CREATE_AWARD,
        {
            "raceId": race_a.id,
            "award": {
                "name": "Fastest",
                "kind": "SPEED",
                "source": "ALL",
                "place": 1,
                "racingGroupId": group_b.id,
            },
        },
    ).json()

    assert body.get("errors")
    assert db.query(models.Award).filter(models.Award.race_id == race_a.id).count() == 0


def test_create_award_refuses_a_racer_from_another_race(client, db):
    race_a = _org_track_race(db, "AwardRacerA")
    race_b = _org_track_race(db, "AwardRacerB")
    racer_b = _racer(db, race_b)

    body = _post(
        client,
        CREATE_AWARD,
        {
            "raceId": race_a.id,
            "award": {"name": "Best Paint", "kind": "SPECIAL", "racerId": racer_b.id},
        },
    ).json()

    assert body.get("errors")
    assert db.query(models.Award).filter(models.Award.race_id == race_a.id).count() == 0


def test_update_award_refuses_reassigning_to_a_racer_from_another_race(client, db):
    race_a = _org_track_race(db, "AwardUpdateA")
    race_b = _org_track_race(db, "AwardUpdateB")
    award = crud.create_award(
        db,
        race_a.id,
        schemas.AwardCreate(name="Best Paint", kind=models.AwardKind.SPECIAL),
    )
    racer_b = _racer(db, race_b)

    body = _post(
        client,
        UPDATE_AWARD,
        {
            "id": award.id,
            "award": {"name": "Best Paint", "kind": "SPECIAL", "racerId": racer_b.id},
        },
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Award, award.id).racer_id is None


def test_update_award_refuses_reassigning_to_a_racing_group_from_another_race(
    client, db
):
    race_a = _org_track_race(db, "AwardUpdateGroupA")
    race_b = _org_track_race(db, "AwardUpdateGroupB")
    award = crud.create_award(
        db,
        race_a.id,
        schemas.AwardCreate(
            name="Fastest Wolf", kind=models.AwardKind.SPEED, source="ALL", place=1
        ),
    )
    group_b = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race_b.id
    )

    body = _post(
        client,
        UPDATE_AWARD,
        {
            "id": award.id,
            "award": {
                "name": "Fastest Wolf",
                "kind": "SPEED",
                "source": "ALL",
                "place": 1,
                "racingGroupId": group_b.id,
            },
        },
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Award, award.id).racing_group_id is None


# --------------------------------------------------------------------------- #
# #804 — a racer's racingGroupId must belong to the racer's own race          #
# --------------------------------------------------------------------------- #

CREATE_RACER_WITH_GROUP = """
mutation($racer: RacerInput!) {
  createRacer(racer: $racer) { id racingGroupId }
}
"""

UPDATE_RACER_WITH_GROUP = """
mutation($id: Int!, $racer: RacerInput!) {
  updateRacer(id: $id, racer: $racer) { id racingGroupId }
}
"""


def test_create_racer_refuses_a_racing_group_from_another_race(client, db):
    race_a = _org_track_race(db, "RacerGroupA")
    race_b = _org_track_race(db, "RacerGroupB")
    group_b = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race_b.id
    )

    body = _post(
        client,
        CREATE_RACER_WITH_GROUP,
        {
            "racer": {
                "firstName": "New",
                "lastName": "Comer",
                "raceId": race_a.id,
                "racingGroupId": group_b.id,
            }
        },
    ).json()

    assert body.get("errors")
    assert (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race_a.id, models.Racer.last_name == "Comer")
        .first()
        is None
    )


def test_update_racer_refuses_reassigning_to_a_racing_group_from_another_race(
    client, db
):
    race_a = _org_track_race(db, "RacerUpdGroupA")
    race_b = _org_track_race(db, "RacerUpdGroupB")
    racer = _racer(db, race_a)
    group_b = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race_b.id
    )

    body = _post(
        client,
        UPDATE_RACER_WITH_GROUP,
        {
            "id": racer.id,
            "racer": {
                "firstName": racer.first_name,
                "lastName": racer.last_name,
                "racingGroupId": group_b.id,
            },
        },
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer.id).racing_group_id is None


def test_bulk_move_to_racing_group_refuses_a_group_from_another_race(client, db):
    race_a = _org_track_race(db, "BulkMoveGroupA")
    race_b = _org_track_race(db, "BulkMoveGroupB")
    racer_a = _racer(db, race_a)
    group_b = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race_b.id
    )

    body = _post(
        client,
        BULK_MOVE,
        {"racerIds": [racer_a.id], "racingGroupId": group_b.id},
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, racer_a.id).racing_group_id is None


def test_crud_bulk_move_to_racing_group_refuses_a_group_from_another_race(db):
    """Defense in depth for a caller that reaches `crud` directly, the same
    reasoning `test_crud_bulk_functions_treat_a_stray_id_from_another_race_as_a_no_op`
    holds for the other bulk functions above — except here there is no
    "just don't touch it" option: a `racing_group_id` naming a group in a
    different race is not a per-row mismatch to skip, it is the whole call's
    own argument, so it is refused outright rather than silently no-op'd."""
    race_a = _org_track_race(db, "CrudBulkMoveGroupA")
    race_b = _org_track_race(db, "CrudBulkMoveGroupB")
    racer_a = _racer(db, race_a)
    group_b = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race_b.id
    )

    with pytest.raises(ValueError):
        crud.bulk_move_racers_to_racing_group(db, race_a.id, [racer_a.id], group_b.id)


# --------------------------------------------------------------------------- #
# #819 — createRacer must not retarget a nonexistent race id                  #
# --------------------------------------------------------------------------- #
#
# The last of this family, and the worst: the id is not merely unvalidated,
# it is *actively replaced* with a different one. `crud.create_racer` used to
# fall back to the first race in the database when `race_id` named no race,
# and invent a race called "Main Event" when there were none at all — so a
# stale or deleted race id produced a *success*, with the racer landed on
# somebody else's roster and nothing anywhere saying so.


def test_create_racer_refuses_a_nonexistent_race_id(client, db):
    race_a = _org_track_race(db, "NonexistentRaceA")
    other_racer_count_before = (
        db.query(models.Racer).filter(models.Racer.race_id == race_a.id).count()
    )

    body = _post(
        client,
        CREATE_RACER,
        {
            "racer": {
                "firstName": "New",
                "lastName": "Comer",
                "raceId": race_a.id + 999_000,
            }
        },
    ).json()

    assert body.get("errors"), (
        "a race id naming no race must be refused, not silently retargeted "
        "to the first race in the database"
    )
    assert (
        db.query(models.Racer).filter(models.Racer.race_id == race_a.id).count()
        == other_racer_count_before
    ), "the racer must not have landed on an unrelated race's roster"


def test_create_racer_refuses_when_no_race_id_is_given(client, db):
    # Even with a race already in the database, an absent raceId must be
    # refused outright rather than defaulting to "whichever race is first".
    race_a = _org_track_race(db, "NoRaceIdGivenA")

    body = _post(
        client,
        CREATE_RACER,
        {"racer": {"firstName": "New", "lastName": "Comer"}},
    ).json()

    assert body.get("errors")
    assert db.query(models.Racer).filter(models.Racer.race_id == race_a.id).count() == 0


def test_create_racer_does_not_invent_a_main_event_race(client, db):
    # No race exists in the database at all yet — but the app has been
    # configured (an `Organization` row exists), which is the exact
    # condition that used to conjure a race named "Main Event".
    crud.create_organization(db, schemas.OrganizationCreate(name="Freshly Configured"))

    body = _post(
        client,
        CREATE_RACER,
        {"racer": {"firstName": "New", "lastName": "Comer", "raceId": 123456}},
    ).json()

    assert body.get("errors")
    assert (
        db.query(models.Race).filter(models.Race.name == "Main Event").first() is None
    )


def test_crud_create_racer_refuses_a_nonexistent_race_id(db):
    with pytest.raises(ValueError):
        crud.create_racer(
            db,
            schemas.RacerCreate(first_name="New", last_name="Comer", race_id=987654),
        )


def test_crud_create_racer_refuses_a_missing_race_id(db):
    with pytest.raises(ValueError):
        crud.create_racer(
            db, schemas.RacerCreate(first_name="New", last_name="Comer", race_id=None)
        )
