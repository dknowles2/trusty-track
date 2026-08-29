"""Test populate functionality respects race car numbering strategy."""

import pytest

from backend import demo_seed
from backend.db import crud, models, populate, schemas


def _race(db, **overrides) -> models.Race:
    """A race on its own track, in a group that really exists.

    The group is not scenery. ``races.organization_id`` is a foreign key and SQLite
    enforces it now (#125), so a race hung off a bare ``organization_id=1`` cannot be
    inserted at all — these tests used to get away with it because nothing was
    checking.

    The group and track are named after the race, so a test that wants two
    races is not stopped by a unique constraint on something it does not care
    about.
    """
    name = overrides.pop("name", "Test Race")
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Test Pack for {name}")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"Test Track for {name}", lane_count=4, timer_type="FAKE"
        ),
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            organization_id=group.id,
            name=name,
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
    """Test that populate respects PER_GROUP (Per Racing Group) numbering."""
    race = _race(db, car_numbering_strategy=models.CarNumberingStrategy.PER_GROUP)

    # Create racing_groups with number ranges
    den1 = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Lions",
            color="#F4D03F",
            rank=models.Rank.LION,
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )

    den2 = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Tigers",
            color="#E67E22",
            rank=models.Rank.TIGER,
            car_number_range_start=200,
            car_number_range_end=299,
        ),
        race_id=race.id,
    )

    # Populate with 10 racers (will be distributed across racing_groups)
    populate.generate_fake_racers(db, race.id, count=10)

    # Get all racers
    racers = crud.get_racers(db, race_id=race.id)

    # Verify we have 10 racers
    assert len(racers) == 10

    # Verify all racers have car numbers assigned
    assert all(r.car_number is not None for r in racers)

    # Verify car numbers are within racing_group ranges
    for racer in racers:
        if racer.racing_group_id == den1.id:
            assert 100 <= racer.car_number <= 199, (
                f"Racer {racer.id} has car number {racer.car_number} outside den1 range"
            )
        elif racer.racing_group_id == den2.id:
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


class TestRepeatability:
    """The roster is invented, and the documentation screenshots photograph it.

    Random by default — a practice race that introduced the operator to the
    same thirty children every evening would be a worse rehearsal. Repeatable
    when asked, because otherwise every name in every screenshot changed on
    every run, so a change to one page rewrote fifty binary files and two
    documentation branches conflicted on all fifty. See `backend.demo_seed`.
    """

    def _roster(self, db, race) -> list[str]:
        """Populate from empty and report who turned up.

        Cleared first, because `get_unique_name` refuses a name the race
        already holds — so a second populate on a full race would differ for
        that reason rather than for the one under test. Clearing reproduces
        what the screenshot run actually does, which is start from an empty
        data directory every time.
        """
        already = crud.get_racers(db, race_id=race.id)
        crud.bulk_delete_racers(db, [r.id for r in already])
        populate.generate_fake_racers(
            db, race.id, count=6, add_racer_photos=False, add_car_photos=False
        )
        return [
            f"{r.first_name} {r.last_name}"
            for r in crud.get_racers(db, race_id=race.id)
        ]

    def test_an_unseeded_roster_differs_every_time(self, db, monkeypatch):
        monkeypatch.delenv(demo_seed.SEED_VARIABLE, raising=False)
        race = _race(db)

        assert self._roster(db, race) != self._roster(db, race)

    def test_a_seeded_roster_repeats(self, db, monkeypatch):
        monkeypatch.setenv(demo_seed.SEED_VARIABLE, "a-fixed-seed")
        race = _race(db)

        assert self._roster(db, race) == self._roster(db, race)

    def test_two_races_still_get_different_rosters(self, db, monkeypatch):
        """Keyed on the race, so one seed does not make every race identical."""
        monkeypatch.setenv(demo_seed.SEED_VARIABLE, "a-fixed-seed")
        first = _race(db)
        second = _race(db, name="Another Race")

        assert self._roster(db, first) != self._roster(db, second)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
