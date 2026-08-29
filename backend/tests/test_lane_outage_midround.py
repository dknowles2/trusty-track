"""A lane going out of service part-way through a round (#171, step 3).

Step 2 recorded the outage and scheduled *new* rounds around it, and left
existing heats alone on purpose. This is the rest: what happens to a round that
is already in flight, and what that costs under each scoring strategy.

The rule in one line — a round nobody has raced is rebuilt, a round part-way
through keeps its results and loses the dead lane from what is still to come, a
round already finished is untouched.
"""

from backend.db import crud, models, schemas
from backend.tests.helpers import record_heat_result


def build(db, *, racers=5, strategy=models.ScoringStrategy.TIMED):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 42"))
    track = crud.create_track(db, schemas.TrackCreate(name="Mid Track", lane_count=4))
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Mid Race",
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
                car_number=700 + i,
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


class TestARoundNobodyHasRaced:
    def test_is_rebuilt_for_the_lanes_that_remain(self, db):
        # The clean outcome: no result is at risk, so everybody gets an equal,
        # valid schedule rather than a heat with a hole in it.
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)

        for heat in crud.get_heats(db, race_id, round_id=round_obj.id):
            assert lanes_of(db, heat) == [1, 2, 4]

    def test_is_not_marked_disrupted(self, db):
        # Nothing was lost, so nothing has to be excluded from scoring.
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)

        db.refresh(round_obj)
        assert round_obj.disrupted is False


class TestARoundPartWayThrough:
    def test_recorded_heats_are_left_exactly_as_they_ran(self, client, db):
        # Those cars ran, on lanes that worked. Rewriting them would be
        # falsifying a result.
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        recorded = crud.get_heats(db, race_id, round_id=round_obj.id)[:2]
        before = {heat.id: lanes_of(db, heat) for heat in recorded}

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)
        db.expire_all()

        after = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)[:2]
        }
        assert after == before

    def test_the_dead_lane_is_vacated_from_what_is_still_to_come(self, client, db):
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)
        db.expire_all()

        pending = crud.get_heats(db, race_id, round_id=round_obj.id)[2:]
        assert pending
        for heat in pending:
            assert 3 not in lanes_of(db, heat)

    def test_the_heat_ids_survive(self, client, db):
        # An armed heat must not be swapped for a different row underneath the
        # operator — the whole subject of #50.
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        before = [h.id for h in crud.get_heats(db, race_id, round_id=round_obj.id)]

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)
        db.expire_all()

        after = [h.id for h in crud.get_heats(db, race_id, round_id=round_obj.id)]
        assert after == before

    def test_it_is_marked_disrupted(self, client, db):
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        disrupted = crud.set_lane_outages(db, track_id, [3]) and (
            crud.apply_outages_to_scheduled_heats(db, track_id)
        )

        db.refresh(round_obj)
        assert round_obj.disrupted is True
        assert disrupted == [round_obj.id]


class TestARoundAlreadyFinished:
    def test_is_untouched(self, client, db):
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id)

        before = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)
        db.expire_all()

        after = {
            heat.id: lanes_of(db, heat)
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }
        assert after == before
        db.refresh(round_obj)
        assert round_obj.disrupted is False


class TestWhatItCostsTheStandings:
    """The whole reason `disrupted` is a flag rather than a correction."""

    def _disrupted_race(self, client, db, strategy):
        track_id, race_id = build(db, racers=5, strategy=strategy)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)
        db.expire_all()
        return race_id, round_obj.id

    def test_a_timed_race_still_counts_the_round(self, client, db):
        # `TIMED` averages, which is scale-free: four heats and five heats are
        # compared on the same footing, so the round is still good evidence.
        from backend.services import scoring

        race_id, _round_id = self._disrupted_race(
            client, db, models.ScoringStrategy.TIMED
        )
        assert scoring.get_leaderboard(db, race_id) != []

    def test_a_points_race_drops_it(self, client, db):
        # `POINTS` sums placements, so a racer with one heat fewer has a lower
        # total, and lower is better. Counting the round would hand somebody a
        # trophy for a heat they never ran.
        from backend.services import scoring

        race_id, _round_id = self._disrupted_race(
            client, db, models.ScoringStrategy.POINTS
        )
        assert scoring.get_leaderboard(db, race_id) == []

    def test_asking_for_that_round_directly_still_shows_it(self, client, db):
        # The screen asking is showing that round rather than the race, and a
        # blank page would be a worse answer than the results it holds.
        from backend.services import scoring

        race_id, round_id = self._disrupted_race(
            client, db, models.ScoringStrategy.POINTS
        )
        assert scoring.get_leaderboard(db, race_id, round_id=round_id) != []


class TestOverGraphQL:
    def test_a_round_reports_whether_it_was_disrupted(self, client, db):
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        client.post(
            "/graphql",
            json={
                "query": """
                mutation Outages($trackId: Int!, $lanes: [Int!]!) {
                  setLaneOutages(trackId: $trackId, lanes: $lanes)
                }
                """,
                "variables": {"trackId": track_id, "lanes": [3]},
            },
        )

        body = client.post(
            "/graphql",
            json={
                "query": "query R($id: Int!) { rounds(raceId: $id) { id disrupted } }",
                "variables": {"id": race_id},
            },
        ).json()
        assert "errors" not in body, body.get("errors")
        assert body["data"]["rounds"][0]["disrupted"] is True

    def test_the_mutation_does_the_whole_job(self, client, db):
        # Setting the outage and applying it to what is scheduled are one
        # operator action, not two.
        track_id, race_id = build(db)
        round_obj = start_round(db, race_id)

        client.post(
            "/graphql",
            json={
                "query": """
                mutation Outages($trackId: Int!, $lanes: [Int!]!) {
                  setLaneOutages(trackId: $trackId, lanes: $lanes)
                }
                """,
                "variables": {"trackId": track_id, "lanes": [3]},
            },
        )
        db.expire_all()

        for heat in crud.get_heats(db, race_id, round_id=round_obj.id):
            assert lanes_of(db, heat) == [1, 2, 4]
