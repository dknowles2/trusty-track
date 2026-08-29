"""A whole event on a fake timer, ready to run (#201).

The operator is a parent volunteer who uses this app once a year, and the night
before is when they want to find out what race day feels like. Everything
needed already existed; none of it was reachable as a rehearsal.
"""

import pytest

from backend.db import crud, models, schemas


@pytest.fixture
def configured(db):
    """The state the first-run gate guarantees before any route works."""
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="Practice Pack")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name="Real Track", lane_count=4, timer_type=models.TimerType.FAKE
        ),
    )
    return group, track


class TestTheTrackItRunsOn:
    def test_it_reuses_a_fake_timer_track(self, db, configured):
        """An operator who rehearses three times should not end up with three
        tracks in System Settings."""
        _, track = configured

        race = crud.create_practice_race(db)

        assert race.track_id == track.id

    def test_it_makes_one_when_every_track_is_real_hardware(self, db):
        crud.create_organization(db, schemas.OrganizationCreate(name="Hardware Pack"))
        crud.create_track(
            db,
            schemas.TrackCreate(
                name="Pack Track",
                lane_count=4,
                timer_type=models.TimerType.AUTO_DETECT_BACKEND,
            ),
        )

        race = crud.create_practice_race(db)

        track = db.query(models.Track).filter(models.Track.id == race.track_id).one()
        assert track.timer_type == models.TimerType.FAKE
        assert track.name == crud.PRACTICE_TRACK_NAME

    def test_it_never_puts_a_practice_race_on_real_hardware(self, db):
        """Arming a heat on a real timer sends a signal to a device in a room
        somebody may be standing in."""
        crud.create_organization(
            db, schemas.OrganizationCreate(name="Hardware Only Pack")
        )
        crud.create_track(
            db,
            schemas.TrackCreate(
                name="Pack Track",
                lane_count=4,
                timer_type=models.TimerType.AUTO_DETECT_PROXY,
            ),
        )

        race = crud.create_practice_race(db)

        track = db.query(models.Track).filter(models.Track.id == race.track_id).one()
        assert track.timer_type == models.TimerType.FAKE

    def test_a_second_rehearsal_adds_no_further_track(self, db):
        crud.create_organization(db, schemas.OrganizationCreate(name="Twice Pack"))
        crud.create_track(
            db,
            schemas.TrackCreate(
                name="Pack Track",
                lane_count=4,
                timer_type=models.TimerType.AUTO_DETECT_BACKEND,
            ),
        )

        crud.create_practice_race(db)
        crud.create_practice_race(db)

        fakes = (
            db.query(models.Track)
            .filter(models.Track.timer_type == models.TimerType.FAKE)
            .count()
        )
        assert fakes == 1


@pytest.mark.usefixtures("configured")
class TestWhatItBuilds:
    def test_it_has_a_roster(self, db):
        race = crud.create_practice_race(db)

        racers = crud.get_racers(db, race_id=race.id)
        assert len(racers) == crud.PRACTICE_RACER_COUNT

    def test_everybody_is_checked_in(self, db):
        """`generate_heats_for_round` fields only racers that passed
        inspection, so an uninspected roster produces an empty schedule rather
        than an error — a confusing way for a rehearsal to start."""
        race = crud.create_practice_race(db)

        racers = crud.get_racers(db, race_id=race.id)
        assert all(racer.car_passed_inspection for racer in racers)

    def test_the_racers_are_in_dens(self, db):
        race = crud.create_practice_race(db)

        assert crud.get_racing_groups(db, race.id)
        assert all(
            r.racing_group_id is not None for r in crud.get_racers(db, race_id=race.id)
        )

    def test_there_are_heats_to_run(self, db):
        """ "Ready to arm a heat" is the whole ask; a rehearsal that lands on an
        empty schedule has rehearsed nothing."""
        race = crud.create_practice_race(db)

        assert crud.get_heats(db, race_id=race.id)

    def test_it_includes_a_final(self, db):
        """Advancement is the part of race day that surprises people, so a
        rehearsal that stops before it leaves out the bit worth practising."""
        race = crud.create_practice_race(db)

        rounds = crud.get_rounds(db, race.id)
        assert [r.advancement_source for r in rounds] == [None, "ALL"]

    def test_the_final_is_scheduled_too(self, db):
        race = crud.create_practice_race(db)
        final = crud.get_rounds(db, race.id)[1]

        heats = [
            h for h in crud.get_heats(db, race_id=race.id) if h.round_id == final.id
        ]
        assert heats


@pytest.mark.usefixtures("configured")
class TestItsName:
    def test_it_says_what_it_is(self, db):
        race = crud.create_practice_race(db)

        assert race.name == crud.PRACTICE_RACE_NAME

    def test_a_second_one_does_not_collide(self, db):
        """`races.name` is unique, so a second rehearsal would otherwise fail
        at the point the operator is least equipped to understand why."""
        first = crud.create_practice_race(db)
        second = crud.create_practice_race(db)

        assert first.name == crud.PRACTICE_RACE_NAME
        assert second.name == f"{crud.PRACTICE_RACE_NAME} 2"

    def test_it_counts_up_rather_than_reusing_a_gap(self, db):
        crud.create_practice_race(db)
        second = crud.create_practice_race(db)
        third = crud.create_practice_race(db)

        assert third.name == f"{crud.PRACTICE_RACE_NAME} 3"
        assert second.name == f"{crud.PRACTICE_RACE_NAME} 2"

    def test_it_is_not_confused_by_a_race_the_operator_named_similarly(
        self, db, configured
    ):
        group, track = configured
        crud.create_race(
            db,
            schemas.RaceCreate(
                name=f"{crud.PRACTICE_RACE_NAME} for Pack 42",
                organization_id=group.id,
                track_id=track.id,
            ),
        )

        race = crud.create_practice_race(db)

        assert race.name == crud.PRACTICE_RACE_NAME


class TestThroughGraphQL:
    @pytest.mark.usefixtures("configured")
    def test_the_mutation_returns_a_race_to_open(self, client):
        response = client.post(
            "/graphql",
            json={
                "query": """
                mutation { createPracticeRace { id name trackId } }
                """
            },
        )

        data = response.json()["data"]["createPracticeRace"]
        assert data["name"] == crud.PRACTICE_RACE_NAME
        assert data["trackId"] is not None

    def test_it_refuses_before_the_system_is_set_up(self, client):
        """There is no group to hang a race on, and the first-run gate is what
        normally guarantees one."""
        response = client.post(
            "/graphql",
            json={"query": "mutation { createPracticeRace { id } }"},
        )

        assert response.json().get("errors")
