"""Shrinking a track's `lane_count` reconciles heats the way a lane outage does (#325).

`updateTrack` used to write the new `lane_count` and stop, leaving heats
holding racers on lanes the track no longer has — an armed heat would send a
lane mask for sensors that no longer exist, and nothing regenerated an unraced
round the way `setLaneOutages` does from the same settings card. This pins the
fix, using the same three cases `apply_outages_to_scheduled_heats` already
established for a lane going out of service.
"""

from backend.db import crud, models, schemas
from backend.tests.helpers import record_heat_result


def build(db, *, racers=5, lane_count=4, strategy=models.ScoringStrategy.TIMED):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 42"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Shrink Track", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Shrink Race",
            organization_id=group.id,
            track_id=track.id,
            scoring_strategy=strategy,
        ),
    )
    for i in range(racers):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=800 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    return track.id, race.id


def start_round(db, race_id, number=1):
    round_obj = crud.create_round(db, race_id=race_id, round_number=number)
    crud.generate_heats_for_round(db, round_obj.id)
    return round_obj


def run_heats(client, db, race_id, round_id, count=None):
    """Record results for the first ``count`` heats of a round."""
    heats = crud.get_heats(db, race_id, round_id=round_id)
    for heat in heats[: count if count is not None else len(heats)]:
        record_heat_result(
            client,
            heat.id,
            [
                {"lane": lane.lane, "racer_id": lane.racer_id, "time": 3.0 + lane.lane}
                for lane in crud.heat_lanes_of(db, heat)
                if lane.racer_id is not None
            ],
        )


def lanes_of(db, heat):
    return sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))


def shrink_track(client, track_id, lane_count, name="Shrink Track"):
    resp = client.post(
        "/graphql",
        json={
            "query": """
            mutation Shrink($id: Int!, $track: TrackInput!) {
              updateTrack(id: $id, track: $track) { id laneCount }
            }
            """,
            "variables": {
                "id": track_id,
                "track": {
                    "name": name,
                    "laneCount": lane_count,
                    "timerType": "FAKE",
                },
            },
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    return body["data"]["updateTrack"]


class TestARoundNobodyHasRaced:
    def test_is_rebuilt_for_the_lanes_that_remain(self, client, db):
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)

        shrink_track(client, track_id, 3)
        db.expire_all()

        for heat in crud.get_heats(db, race_id, round_id=round_obj.id):
            assert 4 not in lanes_of(db, heat)

    def test_is_not_marked_disrupted(self, client, db):
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)

        shrink_track(client, track_id, 3)

        db.refresh(round_obj)
        assert round_obj.disrupted is False


class TestARoundPartWayThrough:
    def test_recorded_heats_are_left_exactly_as_they_ran(self, client, db):
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        recorded = crud.get_heats(db, race_id, round_id=round_obj.id)[:2]
        before = {heat.id: lanes_of(db, heat) for heat in recorded}

        shrink_track(client, track_id, 3)
        db.expire_all()

        after = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)[:2]
        }
        assert after == before

    def test_the_dead_lane_is_vacated_from_what_is_still_to_come(self, client, db):
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        shrink_track(client, track_id, 3)
        db.expire_all()

        pending = crud.get_heats(db, race_id, round_id=round_obj.id)[2:]
        assert pending
        for heat in pending:
            assert 4 not in lanes_of(db, heat)

    def test_the_heat_ids_survive(self, client, db):
        # An armed heat must not be swapped for a different row underneath the
        # operator — the whole subject of #50.
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        before = [h.id for h in crud.get_heats(db, race_id, round_id=round_obj.id)]

        shrink_track(client, track_id, 3)
        db.expire_all()

        after = [h.id for h in crud.get_heats(db, race_id, round_id=round_obj.id)]
        assert after == before

    def test_it_is_marked_disrupted(self, client, db):
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        shrink_track(client, track_id, 3)

        db.refresh(round_obj)
        assert round_obj.disrupted is True


class TestARoundAlreadyFinished:
    def test_is_untouched(self, client, db):
        track_id, race_id = build(db, lane_count=4, racers=4)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id)

        before = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }

        shrink_track(client, track_id, 3)
        db.expire_all()

        after = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }
        assert after == before
        db.refresh(round_obj)
        assert round_obj.disrupted is False


class TestGrowingLaneCount:
    def test_leaves_heats_alone(self, client, db):
        # There is nothing to vacate when the field only got bigger.
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        before = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }

        shrink_track(client, track_id, 6)
        db.expire_all()

        after = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }
        assert after == before
        db.refresh(round_obj)
        assert round_obj.disrupted is False


class TestUnchangedLaneCount:
    def test_leaves_heats_alone(self, client, db):
        # Every ordinary settings save re-submits the whole track, lane count
        # included — this must not treat "same as before" as a shrink.
        track_id, race_id = build(db, lane_count=4)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        before = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }

        shrink_track(client, track_id, 4)
        db.expire_all()

        after = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }
        assert after == before
        db.refresh(round_obj)
        assert round_obj.disrupted is False


class TestWhatItCostsTheStandings:
    """The same reason `disrupted` is a flag rather than a correction for a
    lane outage (#171) applies here."""

    def _disrupted_race(self, client, db, strategy):
        track_id, race_id = build(db, racers=5, lane_count=4, strategy=strategy)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        shrink_track(client, track_id, 3)
        db.expire_all()
        return race_id, round_obj.id

    def test_a_points_race_drops_the_round(self, client, db):
        from backend.services import scoring

        race_id, _round_id = self._disrupted_race(
            client, db, models.ScoringStrategy.POINTS
        )
        assert scoring.get_leaderboard(db, race_id) == []
