"""``bulk_assign_racer_photos``: the whole-batch answer and its skip rules.

Found in a coverage audit — the bulk photo path was exercised end to end by
the browser tests, but the counting and skipping rules had no unit pins: a
malformed entry silently miscounted rather than failing anything.
"""

from backend.db import crud, schemas


def _race_with_racers(db, count=2):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Photo Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Photo Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            organization_id=group.id, name="Photo Derby", track_id=track.id
        ),
    )
    racers = [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race.id,
                first_name=f"Racer{n}",
                last_name="Photo",
                car_number=n + 1,
            ),
        )
        for n in range(count)
    ]
    return race, racers


def test_racer_and_car_photos_land_on_their_own_columns(db):
    _, (first, second) = _race_with_racers(db)

    count = crud.bulk_assign_racer_photos(
        db,
        [
            {"racer_id": first.id, "url": "/static/face.png", "photo_type": "racer"},
            {"racer_id": second.id, "url": "/static/car.png", "photo_type": "car"},
        ],
    )

    assert count == 2
    db.refresh(first)
    db.refresh(second)
    assert first.racer_image_url == "/static/face.png"
    assert first.car_image_url is None
    assert second.car_image_url == "/static/car.png"
    assert second.racer_image_url is None


def test_the_default_photo_type_is_the_racer(db):
    _, (racer, _) = _race_with_racers(db)

    assert (
        crud.bulk_assign_racer_photos(
            db, [{"racer_id": racer.id, "url": "/static/face.png"}]
        )
        == 1
    )
    db.refresh(racer)
    assert racer.racer_image_url == "/static/face.png"


def test_malformed_entries_are_skipped_not_counted(db):
    """The count is what the screen reports back to the operator — an entry
    that changed nothing must not inflate it."""
    _, (racer, _) = _race_with_racers(db)

    count = crud.bulk_assign_racer_photos(
        db,
        [
            {"racer_id": None, "url": "/static/a.png"},
            {"racer_id": racer.id, "url": None},
            {"racer_id": racer.id, "url": "/static/a.png", "photo_type": "banner"},
            {"racer_id": 99999, "url": "/static/a.png"},
            {"racer_id": racer.id, "url": "/static/kept.png"},
        ],
    )

    assert count == 1
    db.refresh(racer)
    assert racer.racer_image_url == "/static/kept.png"
