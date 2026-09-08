"""Shrinking usable lanes below two must not strand an unraced elimination or
balanced round — #877.

`generate_heats_for_round` refuses to (re)schedule an elimination or balanced
round with fewer than two usable lanes (#791): the format needs an opponent.
`apply_outages_to_scheduled_heats` reaches that refusal for a round nothing
has been raced in yet, which is the one case it tries to regenerate outright
— but both of its callers, `setLaneOutages` and a shrinking `Track.lane_count`
(#325), had already committed the very change that caused it: `set_lane_outages`
writes its `LaneOutage` rows unconditionally, and `updateTrack` writes a
shrunk `lane_count` the same way. The operator saw an opaque GraphQL error,
the outage (or the smaller lane count) was left in place, `_revalidate_timers`
and `_publish_race_state` never ran, and the round's heats still named lanes
that no longer exist.

The fix refuses the whole change up front — before any row is written — and
names the round, through `crud.guard_against_stranding_a_round`. These tests
pin: the refusal happens, it happens before anything is committed, and both
of #877's call sites are covered.
"""

from backend.db import crud, models, schemas
from backend.domain import audit


def build_elimination_race(db, *, racers=6, lane_count=4):
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 877"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Stranding Track", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Stranding Race",
            organization_id=org.id,
            track_id=track.id,
        ),
    )
    for i in range(racers):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=900 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    round_obj = crud.create_round(
        db,
        race_id=race.id,
        round_number=1,
        scheduling_strategy=models.SchedulingStrategy.ELIMINATION,
        name="Elimination Playoff",
        elimination_losses=3,
    )
    crud.generate_heats_for_round(db, round_obj.id)
    return track.id, race.id, round_obj


class TestSetLaneOutages:
    def test_refuses_before_writing_any_outage_row(self, db):
        track_id, race_id, round_obj = build_elimination_race(db)

        try:
            crud.set_lane_outages(db, track_id, [2, 3, 4])
            raised = False
        except ValueError as exc:
            raised = True
            assert round_obj.name in str(exc)

        assert raised, "expected set_lane_outages to refuse a fatal shrink"
        # Nothing was written: the outage rows do not exist, and the round's
        # heats still hold their original lanes.
        assert crud.lane_outages_for_track(db, track_id) == []
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 3, 4]

    def test_leaving_two_usable_lanes_is_still_allowed(self, db):
        track_id, race_id, round_obj = build_elimination_race(db)
        crud.set_lane_outages(db, track_id, [3, 4])
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2]

    def test_a_round_with_even_one_recorded_heat_does_not_block_the_shrink(self, db):
        track_id, race_id, round_obj = build_elimination_race(db)
        # Once even one heat holds a result, the round is no longer "nothing
        # raced" — `apply_outages_to_scheduled_heats` vacates its remaining
        # lanes instead of trying to regenerate it outright, so it can never
        # reach the refusal this guards against.
        heat = crud.get_heats(db, race_id, round_id=round_obj.id)[0]
        lane_values = [
            lane for lane in crud.heat_lanes_of(db, heat) if lane.racer_id is not None
        ]
        for i, lane in enumerate(lane_values):
            lane.time = 3.0 + i
            lane.place = i + 1
        crud.record_heat_result(
            db, heat.id, lane_values, source=audit.ResultSource.OPERATOR
        )

        # Should not raise: this round can no longer be stranded by a shrink.
        crud.set_lane_outages(db, track_id, [2, 3, 4])


class TestUpdateTrackShrink:
    def test_refuses_before_writing_the_new_lane_count(self, db, client):
        track_id, race_id, round_obj = build_elimination_race(db)

        response = client.post(
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
                        "name": "Stranding Track",
                        "laneCount": 1,
                        "timerType": "FAKE",
                    },
                },
            },
        )

        body = response.json()
        assert "errors" in body, body
        assert round_obj.name in body["errors"][0]["message"]

        # The track's lane count is unchanged: the refusal happened before
        # `crud.update_track` ever ran.
        db.expire_all()
        track = crud.get_track(db, track_id)
        assert track.lane_count == 4
        assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 3, 4]
