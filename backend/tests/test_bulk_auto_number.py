"""Tests for `crud.auto_number_racers` (#739, #740).

Two related bugs, both in the same function:

- Numbering a *partial selection* restarted counting from the race's own
  start number as though the roster were empty, so a subset of racers could
  be handed numbers other racers outside the selection already hold (#739).
- `populate.generate_fake_racers` called `auto_number_racers` with no
  `racer_ids`, which numbers the *whole race* — silently renumbering
  racers that were already on the roster before Populate Test Data ran
  (#740). That one is exercised in `test_populate.py`; this file covers the
  bug in the shared function itself.

No tests existed for `auto_number_racers` before this file — the "restart
at the start number" and "ungrouped racers get nothing" behaviours were both
found by reading the code, not by a failing test.
"""

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas


def _race(
    db: Session,
    strategy: models.CarNumberingStrategy,
    global_start_number: int = 1,
) -> models.Race:
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 739"))
    track = crud.create_track(db, schemas.TrackCreate(name="Test Track", lane_count=4))
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Race {strategy.value} {global_start_number}",
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy=strategy,
            global_start_number=global_start_number,
        ),
    )


def _racer(
    db: Session,
    race: models.Race,
    first: str,
    last: str,
    car_number: int | None = None,
    racing_group_id: int | None = None,
) -> models.Racer:
    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=first,
            last_name=last,
            race_id=race.id,
            car_number=car_number,
            racing_group_id=racing_group_id,
        ),
    )
    assert racer is not None
    return racer


def test_auto_numbering_a_selection_does_not_duplicate_numbers_held_outside_it(
    db: Session,
) -> None:
    """Reproduces #739: a partial selection must not restart at the start
    number and hand out numbers other racers already hold.
    """
    race = _race(db, models.CarNumberingStrategy.GLOBAL, global_start_number=1)

    ace = _racer(db, race, "Ace", "Bolt", car_number=1)
    neo = _racer(db, race, "Neo", "Bolt", car_number=2)

    # Two more racers, not yet numbered (simulating racers added after the
    # roster was already numbered — e.g. late check-ins).
    zoe = _racer(db, race, "Zoe", "Zephyr")
    yara = _racer(db, race, "Yara", "Yankee")
    crud.bulk_clear_car_numbers(db, race.id, [zoe.id, yara.id])

    updated = crud.auto_number_racers(db, race.id, racer_ids=[zoe.id, yara.id])
    assert updated == 2

    db.refresh(ace)
    db.refresh(neo)
    db.refresh(zoe)
    db.refresh(yara)

    all_numbers = [ace.car_number, neo.car_number, zoe.car_number, yara.car_number]
    assert len(all_numbers) == len(set(all_numbers)), (
        f"auto-numbering the selection produced duplicates: {all_numbers}"
    )
    # Ace and Neo must keep their numbers — they were not in the selection.
    assert ace.car_number == 1
    assert neo.car_number == 2


def test_auto_numbering_a_selection_respects_per_group_ranges_too(
    db: Session,
) -> None:
    """The same bug, under PER_GROUP: a partial selection restarts at the
    group's own range start rather than continuing past numbers already
    held in that range.
    """
    race = _race(db, models.CarNumberingStrategy.PER_GROUP)
    lions = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lions",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )

    ace = _racer(db, race, "Ace", "Bolt", car_number=100, racing_group_id=lions.id)
    neo = _racer(db, race, "Neo", "Bolt", car_number=101, racing_group_id=lions.id)
    zoe = _racer(db, race, "Zoe", "Zephyr", racing_group_id=lions.id)
    crud.bulk_clear_car_numbers(db, race.id, [zoe.id])

    updated = crud.auto_number_racers(db, race.id, racer_ids=[zoe.id])
    assert updated == 1

    db.refresh(ace)
    db.refresh(neo)
    db.refresh(zoe)

    numbers = [ace.car_number, neo.car_number, zoe.car_number]
    assert len(numbers) == len(set(numbers)), (
        f"auto-numbering the selection produced duplicates: {numbers}"
    )
    assert zoe.car_number == 102


def test_auto_numbering_the_whole_race_still_works(db: Session) -> None:
    """Numbering everyone (no `racer_ids`) is unaffected by the fix — it is
    the same as numbering a selection that happens to be everybody.
    """
    race = _race(db, models.CarNumberingStrategy.GLOBAL, global_start_number=1)
    a = _racer(db, race, "Ace", "Bolt")
    b = _racer(db, race, "Neo", "Bolt")
    crud.bulk_clear_car_numbers(db, race.id, [a.id, b.id])

    updated = crud.auto_number_racers(db, race.id)
    assert updated == 2

    db.refresh(a)
    db.refresh(b)
    assert {a.car_number, b.car_number} == {1, 2}


def test_an_ungrouped_racer_is_left_unnumbered_under_per_group(db: Session) -> None:
    """Under `PER_GROUP`, a racer with no racing group has no range to draw
    a number from — the docstring says they are "left unnumbered, same as
    before", and nothing had ever exercised that this is what actually
    happens rather than, say, an unhandled `None` key crashing the sort, or
    the racer silently being counted in `updated_count` with no number
    written.
    """
    race = _race(db, models.CarNumberingStrategy.PER_GROUP)
    lions = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lions",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )

    grouped = _racer(db, race, "Ace", "Bolt", racing_group_id=lions.id)
    # No racing_group_id at all — a sibling car, or a racer added before a
    # racing group was assigned.
    ungrouped = _racer(db, race, "Zoe", "Zephyr", racing_group_id=None)

    updated = crud.auto_number_racers(db, race.id, racer_ids=[grouped.id, ungrouped.id])

    # Only the grouped racer is counted and numbered.
    assert updated == 1

    db.refresh(grouped)
    db.refresh(ungrouped)
    assert grouped.car_number == 100
    assert ungrouped.car_number is None


def test_an_exhausted_racing_group_range_leaves_the_remainder_unnumbered(
    db: Session,
) -> None:
    """A group's range is a hard ceiling — once it is exhausted, the racers
    past that point stay unnumbered "for the operator to notice" rather than
    spilling into a neighbouring group's range or wrapping around.
    """
    race = _race(db, models.CarNumberingStrategy.PER_GROUP)
    # Only two numbers available: 100 and 101.
    lions = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lions",
            color="#F4D03F",
            car_number_range_start=100,
            car_number_range_end=101,
        ),
        race_id=race.id,
    )

    a = _racer(db, race, "Ace", "Bolt", racing_group_id=lions.id)
    b = _racer(db, race, "Bea", "Bolt", racing_group_id=lions.id)
    c = _racer(db, race, "Cy", "Bolt", racing_group_id=lions.id)

    updated = crud.auto_number_racers(
        db, race.id, racer_ids=[a.id, b.id, c.id]
    )

    # Sorted by (last_name, first_name) — Bolt, Bolt, Bolt then by first
    # name: Ace, Bea, Cy — so Ace and Bea take the two available numbers and
    # Cy is the one left over.
    assert updated == 2

    db.refresh(a)
    db.refresh(b)
    db.refresh(c)
    assert a.car_number == 100
    assert b.car_number == 101
    assert c.car_number is None


def test_a_racing_group_with_no_configured_range_is_skipped_entirely(
    db: Session,
) -> None:
    """A racing group created with no `car_number_range_start` has nothing
    to draw a number from either — the same "left unnumbered" outcome as an
    ungrouped racer, but reached through the group's own configuration
    rather than the racer's.
    """
    race = _race(db, models.CarNumberingStrategy.PER_GROUP)
    unconfigured = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(name="Tigers", color="#FF8C00"),
        race_id=race.id,
    )

    racer = _racer(db, race, "Ace", "Bolt", racing_group_id=unconfigured.id)

    updated = crud.auto_number_racers(db, race.id, racer_ids=[racer.id])

    assert updated == 0
    db.refresh(racer)
    assert racer.car_number is None
