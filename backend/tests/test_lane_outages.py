"""A lane that is out of service (#171).

Step 1 taught the scheduler to take *which* lanes; this is where the answer
comes from. What is checked here is the seam — that `usable_lanes_for_race` is
the one place deciding, and that a new schedule actually skips the dead lane.

Re-laning a round that is already under way is deliberately **not** here. It is
the open part of #171, and it carries a fairness decision (a racer with fewer
heats scores better under POINTS) that should not fall out of an implementation.
"""

from backend.db import crud, models, schemas


def build(db, lane_count=4, racers=4):
    group = crud.create_group(db, schemas.GroupCreate(name="Pack 42"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Outage Track", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Outage Race", group_id=group.id, track_id=track.id),
    )
    for i in range(racers):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=600 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    return track.id, race.id


class TestRecordingAnOutage:
    def test_a_track_starts_with_every_lane_working(self, db):
        track_id, race_id = build(db)
        assert crud.lane_outages_for_track(db, track_id) == []
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 3, 4]

    def test_taking_a_lane_out_removes_it_from_the_usable_set(self, db):
        track_id, race_id = build(db)
        crud.set_lane_outages(db, track_id, [3])
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 4]

    def test_the_whole_set_is_replaced_each_time(self, db):
        # The screen is a row of checkboxes submitted together, so a lane that
        # has come back is simply absent from the next call.
        track_id, race_id = build(db)
        crud.set_lane_outages(db, track_id, [2, 3])
        crud.set_lane_outages(db, track_id, [3])
        assert crud.lane_outages_for_track(db, track_id) == [3]
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 4]

    def test_setting_the_same_outage_twice_is_not_an_error(self, db):
        track_id, _race_id = build(db)
        crud.set_lane_outages(db, track_id, [3])
        crud.set_lane_outages(db, track_id, [3])
        assert crud.lane_outages_for_track(db, track_id) == [3]

    def test_a_lane_the_track_does_not_have_is_dropped(self, db):
        # A stale outage on lane 6 of a track since reconfigured to four lanes
        # would never appear on the screen to be un-set, and would shrink
        # nothing while sitting there.
        track_id, race_id = build(db, lane_count=4)
        crud.set_lane_outages(db, track_id, [3, 6, 0, -1])
        assert crud.lane_outages_for_track(db, track_id) == [3]
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 4]

    def test_clearing_them_brings_the_lane_back(self, db):
        track_id, race_id = build(db)
        crud.set_lane_outages(db, track_id, [3])
        crud.set_lane_outages(db, track_id, [])
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 3, 4]

    def test_deleting_the_track_takes_its_outages_with_it(self, db):
        # A spare track with no race on it: `delete_track` refuses to remove one
        # that races point at, which is a different rule and not this one.
        spare = crud.create_track(db, schemas.TrackCreate(name="Spare", lane_count=4))
        crud.set_lane_outages(db, spare.id, [3])
        crud.delete_track(db, spare.id)
        assert db.query(models.LaneOutage).all() == []

    def test_a_race_with_no_track_still_gets_four_lanes(self, db):
        # The fallback the scheduler has always had. Built through the ORM
        # rather than `crud.create_race`, because `RaceCreate.track_id` is
        # required — `Race.track_id` is nullable and this path is defensive
        # rather than reachable, which is worth knowing before anybody relies
        # on it.
        group = crud.create_group(db, schemas.GroupCreate(name="Trackless"))
        race = models.Race(name="Trackless Race", group_id=group.id, track_id=None)
        db.add(race)
        db.commit()
        assert crud.usable_lanes_for_race(db, race.id) == [1, 2, 3, 4]


class TestSchedulingAroundIt:
    def test_a_new_round_skips_the_dead_lane(self, db):
        track_id, race_id = build(db, racers=5)
        crud.set_lane_outages(db, track_id, [3])

        round_obj = crud.create_round(db, race_id=race_id, round_number=1)
        crud.generate_heats_for_round(db, round_obj.id)

        heats = crud.get_heats(db, race_id, round_id=round_obj.id)
        assert heats
        for heat in heats:
            lanes = sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))
            assert lanes == [1, 2, 4], f"heat {heat.heat_number} used lanes {lanes}"

    def test_everybody_still_races_the_same_number_of_times(self, db):
        # The fairness property. Under POINTS a racer with fewer heats scores
        # *better*, which is #26 from the other direction.
        track_id, race_id = build(db, racers=6)
        crud.set_lane_outages(db, track_id, [2])

        round_obj = crud.create_round(db, race_id=race_id, round_number=1)
        crud.generate_heats_for_round(db, round_obj.id)

        appearances: dict[int, int] = {}
        for heat in crud.get_heats(db, race_id, round_id=round_obj.id):
            for lane in crud.heat_lanes_of(db, heat):
                if lane.racer_id is not None:
                    appearances[lane.racer_id] = appearances.get(lane.racer_id, 0) + 1

        assert len(appearances) == 6
        assert len(set(appearances.values())) == 1, appearances

    def test_heats_that_already_exist_are_left_alone(self, db):
        # The deliberate limit of this step. A round already scheduled keeps the
        # schedule the operator is looking at; re-laning one under way is the
        # open part of #171.
        track_id, race_id = build(db, racers=4)
        round_obj = crud.create_round(db, race_id=race_id, round_number=1)
        crud.generate_heats_for_round(db, round_obj.id)

        before = {
            heat.id: sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }

        crud.set_lane_outages(db, track_id, [3])
        db.expire_all()

        after = {
            heat.id: sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        }
        assert after == before


class TestOverGraphQL:
    def test_a_track_reports_its_outages(self, client, db):
        track_id, _race_id = build(db)
        crud.set_lane_outages(db, track_id, [2, 4])

        body = client.post(
            "/graphql",
            json={"query": "{ tracks { id laneCount laneOutages } }"},
        ).json()
        assert "errors" not in body, body.get("errors")
        track = next(t for t in body["data"]["tracks"] if t["id"] == track_id)
        assert track["laneOutages"] == [2, 4]

    def test_setting_them_through_the_mutation(self, client, db):
        track_id, race_id = build(db)

        body = client.post(
            "/graphql",
            json={
                "query": """
                mutation Outages($trackId: Int!, $lanes: [Int!]!) {
                  setLaneOutages(trackId: $trackId, lanes: $lanes)
                }
                """,
                "variables": {"trackId": track_id, "lanes": [3]},
            },
        ).json()
        assert "errors" not in body, body.get("errors")
        assert body["data"]["setLaneOutages"] == [3]
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 4]

    def test_an_unknown_track_reports_no_outages_rather_than_failing(self, client, db):
        build(db)
        body = client.post(
            "/graphql",
            json={
                "query": """
                mutation Outages($trackId: Int!, $lanes: [Int!]!) {
                  setLaneOutages(trackId: $trackId, lanes: $lanes)
                }
                """,
                "variables": {"trackId": 9999, "lanes": [3]},
            },
        ).json()
        assert "errors" not in body, body.get("errors")
        assert body["data"]["setLaneOutages"] == []
