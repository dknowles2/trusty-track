"""Test populate functionality respects race car numbering strategy."""

import pytest

from backend.db import crud, models, populate, schemas


def _race(db, **overrides) -> models.Race:
    """A race on its own track, in a group that really exists.

    The group is not scenery. ``races.group_id`` is a foreign key and SQLite
    enforces it now (#125), so a race hung off a bare ``group_id=1`` cannot be
    inserted at all — these tests used to get away with it because nothing was
    checking.
    """
    group = crud.create_group(db, schemas.GroupCreate(name="Test Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Test Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            group_id=group.id,
            name="Test Race",
            date_time="2024-01-01T10:00:00",
            location="Test Location",
            track_id=track.id,
            scheduling_strategy=models.SchedulingStrategy.PPC,
            scoring_strategy=models.ScoringStrategy.TIMED,
            **overrides,
        ),
    )


def test_populate_respects_global_numbering(db):
    """Test that populate respects GLOBAL car numbering strategy."""
    race = _race(
        db,
        car_numbering_strategy=models.CarNumberingStrategy.GLOBAL,
        global_start_number=100,
    )

    # Populate with 5 racers
    populate.generate_fake_racers(db, race.id, count=5)

    # Get all racers
    racers = crud.get_racers(db, race_id=race.id)

    # Verify we have 5 racers
    assert len(racers) == 5

    # Verify car numbers are sequential starting from 100
    car_numbers = sorted([r.car_number for r in racers if r.car_number is not None])
    assert car_numbers == [100, 101, 102, 103, 104]


def test_populate_respects_per_den_numbering(db):
    """Test that populate respects PER_GROUP (Per Den) car numbering strategy."""
    race = _race(db, car_numbering_strategy=models.CarNumberingStrategy.PER_GROUP)

    # Create dens with number ranges
    den1 = crud.create_den(
        db,
        schemas.DenCreate(
            name="Lions",
            color="#F4D03F",
            rank=models.Rank.LION,
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )

    den2 = crud.create_den(
        db,
        schemas.DenCreate(
            name="Tigers",
            color="#E67E22",
            rank=models.Rank.TIGER,
            car_number_range_start=200,
            car_number_range_end=299,
        ),
        race_id=race.id,
    )

    # Populate with 10 racers (will be distributed across dens)
    populate.generate_fake_racers(db, race.id, count=10)

    # Get all racers
    racers = crud.get_racers(db, race_id=race.id)

    # Verify we have 10 racers
    assert len(racers) == 10

    # Verify all racers have car numbers assigned
    assert all(r.car_number is not None for r in racers)

    # Verify car numbers are within den ranges
    for racer in racers:
        if racer.den_id == den1.id:
            assert 100 <= racer.car_number <= 199, (
                f"Racer {racer.id} has car number {racer.car_number} outside den1 range"
            )
        elif racer.den_id == den2.id:
            assert 200 <= racer.car_number <= 299, (
                f"Racer {racer.id} has car number {racer.car_number} outside den2 range"
            )


def test_populate_with_manual_numbering(db):
    """Test that populate with MANUAL strategy leaves car numbers as None."""
    race = _race(db, car_numbering_strategy=models.CarNumberingStrategy.MANUAL)

    # Populate with 3 racers
    populate.generate_fake_racers(db, race.id, count=3)

    # Get all racers
    racers = crud.get_racers(db, race_id=race.id)

    # Verify we have 3 racers
    assert len(racers) == 3

    # Verify car numbers are None (manual assignment)
    assert all(r.car_number is None for r in racers)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
