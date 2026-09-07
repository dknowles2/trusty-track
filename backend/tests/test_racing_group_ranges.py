"""Racing group car-number range validation (#741).

Before this, `schemas.RacingGroupCreate`/`RacingGroupUpdate` declared
`car_number_range_start`/`_end` as plain optional ints with no validator, and
`crud.create_racing_group`/`update_racing_group` wrote whatever was given
straight to the row. Two configuration mistakes went in silently:

- an end number lower than its own start, and
- two racing groups whose ranges overlap, which combined with PER_GROUP
  auto-numbering hands out the same car number to racers in different dens.

`domain.roster_import`'s importers already refuse in-file duplicate car
numbers (#60); this is the same shape of gap in the wizard/`Manage Dens`
path, which the file importers never touch.

MANUAL car numbering deliberately allows *racers* to share a number
(`.claude/rules/roster.md`) — that is not touched here. A racing group's
*range* has no such legitimate duplicate: an operator who overlaps two dens'
blocks did not mean to, so this refuses rather than warns, unlike the
"warn, never refuse" precedent for the weight limit and for a racer's own
duplicate car number.
"""

import pytest

from backend.db import crud, models, schemas


def _race(db) -> models.Race:
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 741"))
    track = crud.create_track(db, schemas.TrackCreate(name="Test Track", lane_count=4))
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Race 741",
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy=models.CarNumberingStrategy.PER_GROUP,
        ),
    )


def test_create_racing_group_refuses_a_range_overlapping_an_existing_one(db):
    race = _race(db)
    crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lion",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )

    with pytest.raises(ValueError):
        crud.create_racing_group(
            db,
            schemas.RacingGroupCreate(
                name="Tiger",
                color="#E67E22",
                car_number_range_start=150,
                car_number_range_end=299,
            ),
            race_id=race.id,
        )

    # The bad group was never persisted.
    groups = crud.get_racing_groups(db, race_id=race.id)
    assert [g.name for g in groups] == ["Lion"]


def test_create_racing_group_allows_adjacent_non_overlapping_ranges(db):
    race = _race(db)
    crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lion",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )
    # 200-299 does not touch 100-199 at all.
    tiger = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Tiger",
            color="#E67E22",
            car_number_range_start=200,
            car_number_range_end=299,
        ),
        race_id=race.id,
    )
    assert tiger.car_number_range_start == 200


def test_create_racing_group_ignores_groups_with_no_range_configured(db):
    race = _race(db)
    crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(name="Demonstration", color="#000000"),
        race_id=race.id,
    )
    # A group with no range at all does not participate in numbering, so it
    # cannot "overlap" anything.
    lion = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lion",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )
    assert lion.car_number_range_start == 100


def test_create_racing_group_open_ended_range_overlaps_a_later_one(db):
    race = _race(db)
    crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lion",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=None,  # open-ended, per `next_free_car_number`
        ),
        race_id=race.id,
    )
    with pytest.raises(ValueError):
        crud.create_racing_group(
            db,
            schemas.RacingGroupCreate(
                name="Tiger",
                color="#E67E22",
                car_number_range_start=200,
                car_number_range_end=299,
            ),
            race_id=race.id,
        )


def test_update_racing_group_refuses_a_range_overlapping_a_sibling(db):
    race = _race(db)
    crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lion",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )
    tiger = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Tiger",
            color="#E67E22",
            car_number_range_start=200,
            car_number_range_end=299,
        ),
        race_id=race.id,
    )

    with pytest.raises(ValueError):
        crud.update_racing_group(
            db,
            racing_group_id=tiger.id,
            racing_group_update=schemas.RacingGroupUpdate(car_number_range_start=150),
        )

    db.refresh(tiger)
    assert tiger.car_number_range_start == 200


def test_update_racing_group_updating_unrelated_field_does_not_reverify_no_range(
    db,
):
    """Updating a field other than the range on a rangeless group must not
    spuriously fail — there is nothing to check against.
    """
    race = _race(db)
    demo = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(name="Demonstration", color="#000000"),
        race_id=race.id,
    )
    updated = crud.update_racing_group(
        db,
        racing_group_id=demo.id,
        racing_group_update=schemas.RacingGroupUpdate(color="#123456"),
    )
    assert updated is not None
    assert updated.color == "#123456"


def test_create_racing_group_refuses_end_before_start(db):
    race = _race(db)
    with pytest.raises(ValueError):
        crud.create_racing_group(
            db,
            schemas.RacingGroupCreate(
                name="Bear",
                color="#85C1E9",
                car_number_range_start=199,
                car_number_range_end=100,
            ),
            race_id=race.id,
        )


def test_create_race_refuses_overlapping_den_ranges_from_the_wizard(db):
    """The setup wizard's Dens step sends every den in the same `createRace`
    call as the race itself (`RaceInput.racingGroups`), not one
    `createRacingGroup` per den — so the per-group check above never sees
    this path at all. This is the one the wizard's own repro in #741 hits:
    Lion 100-199 and Tiger 150-299 on the same Dens step.
    """
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 741 W"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Wizard Track", lane_count=4)
    )

    with pytest.raises(ValueError):
        crud.create_race(
            db,
            schemas.RaceCreate(
                name="Wizard Race",
                organization_id=org.id,
                track_id=track.id,
                car_numbering_strategy=models.CarNumberingStrategy.PER_GROUP,
                racing_groups=[
                    schemas.RacingGroupCreate(
                        name="Lion",
                        color="#F4D03F",
                        car_number_range_start=100,
                        car_number_range_end=199,
                    ),
                    schemas.RacingGroupCreate(
                        name="Tiger",
                        color="#E67E22",
                        car_number_range_start=150,
                        car_number_range_end=299,
                    ),
                ],
            ),
        )

    # Nothing about the failed race should have been left behind.
    assert crud.get_races(db) == [] or all(
        r.name != "Wizard Race" for r in crud.get_races(db)
    )
