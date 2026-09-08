"""`updateInitialConfig` is the third path to a track's `lane_count` (#903).

[#325](https://github.com/dknowles2/trusty-track/issues/325) made `updateTrack`
reconcile heats when a lane count shrinks — regenerate an unraced round,
vacate a part-raced one, leave a finished one alone, revalidate armed timers,
publish race state — and [#877](https://github.com/dknowles2/trusty-track/issues/877)
(PR #902) added `crud.guard_against_stranding_a_round`, checked by both
`setLaneOutages` and `updateTrack` before either writes anything. Neither
touched `updateInitialConfig`, the mutation behind System Settings' **Save
Settings** button and the way an operator actually changes a lane count —
it called `crud.update_track` per track directly, writing the new count and
reconciling nothing.

These tests drive `updateInitialConfig` itself, not `updateTrack` — that is
the whole distinction the issue draws.
"""

from backend.db import crud, models, schemas
from backend.tests.helpers import record_heat_result


def build(db, *, racers=5, lane_count=4):
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 903"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Config Shrink Track", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Config Shrink Race",
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
                car_number=700 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    return org, track, race


def lanes_of(db, heat):
    return sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))


def save_settings(client, *, org_name, track_id, track_name, lane_count):
    resp = client.post(
        "/graphql",
        json={
            "query": """
            mutation Save($config: InitialConfigInput!) {
              updateInitialConfig(config: $config) {
                organizationName
                tracks { id laneCount }
              }
            }
            """,
            "variables": {
                "config": {
                    "organizationName": org_name,
                    "tracks": [
                        {
                            "id": track_id,
                            "name": track_name,
                            "laneCount": lane_count,
                            "timerType": "FAKE",
                        }
                    ],
                }
            },
        },
    )
    assert resp.status_code == 200
    return resp.json()


class TestShrinkingThroughSaveSettings:
    def test_reconciles_an_unraced_round(self, client, db):
        org, track, race = build(db, lane_count=4)
        round_obj = crud.create_round(db, race_id=race.id, round_number=1)
        crud.generate_heats_for_round(db, round_obj.id)

        body = save_settings(
            client,
            org_name=org.name,
            track_id=track.id,
            track_name=track.name,
            lane_count=3,
        )
        assert "errors" not in body, body.get("errors")

        db.expire_all()
        for heat in crud.get_heats(db, race.id, round_id=round_obj.id):
            assert 4 not in lanes_of(db, heat)

    def test_vacates_the_dead_lane_from_a_part_raced_round(self, client, db):
        org, track, race = build(db, lane_count=4)
        round_obj = crud.create_round(db, race_id=race.id, round_number=1)
        crud.generate_heats_for_round(db, round_obj.id)
        heats = crud.get_heats(db, race.id, round_id=round_obj.id)
        record_heat_result(
            client,
            heats[0].id,
            [
                {"lane": lane.lane, "racer_id": lane.racer_id, "time": 3.0 + lane.lane}
                for lane in crud.heat_lanes_of(db, heats[0])
                if lane.racer_id is not None
            ],
        )

        body = save_settings(
            client,
            org_name=org.name,
            track_id=track.id,
            track_name=track.name,
            lane_count=3,
        )
        assert "errors" not in body, body.get("errors")

        db.expire_all()
        db.refresh(round_obj)
        assert round_obj.disrupted is True
        pending = crud.get_heats(db, race.id, round_id=round_obj.id)[1:]
        assert pending
        for heat in pending:
            assert 4 not in lanes_of(db, heat)

    def test_the_track_row_reflects_the_new_count(self, client, db):
        org, track, race = build(db, lane_count=4)

        body = save_settings(
            client,
            org_name=org.name,
            track_id=track.id,
            track_name=track.name,
            lane_count=3,
        )
        assert "errors" not in body, body.get("errors")
        assert body["data"]["updateInitialConfig"]["tracks"][0]["laneCount"] == 3


class TestStrandingGuardIsCheckedBeforeAnyWrite:
    """The same refusal `updateTrack` makes for #877, reached through the
    settings page's own mutation — and the harder half: nothing else in the
    same submission (here, the organization's own name) may be written
    either, since a refusal partway through this form is worse than
    elsewhere (#903)."""

    def build_elimination_race(self, db, *, racers=6, lane_count=4):
        org = crud.create_organization(
            db, schemas.OrganizationCreate(name="Pack 903 Guard")
        )
        track = crud.create_track(
            db,
            schemas.TrackCreate(name="Stranding Config Track", lane_count=lane_count),
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Stranding Config Race",
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
                    car_number=910 + i,
                    race_id=race.id,
                    car_passed_inspection=True,
                ),
            )
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.ELIMINATION,
            name="Config Elimination Playoff",
            elimination_losses=3,
        )
        crud.generate_heats_for_round(db, round_obj.id)
        return org, track, race, round_obj

    def test_refuses_and_writes_nothing_at_all(self, client, db):
        org, track, race, round_obj = self.build_elimination_race(db)

        body = save_settings(
            client,
            org_name="Renamed Mid-Save",
            track_id=track.id,
            track_name=track.name,
            lane_count=1,
        )

        assert "errors" in body, body
        assert round_obj.name in body["errors"][0]["message"]

        db.expire_all()
        refreshed_track = crud.get_track(db, track.id)
        assert refreshed_track.lane_count == 4
        assert crud.usable_lanes_for_race(db, race.id) == [1, 2, 3, 4]

        refreshed_org = db.query(models.Organization).filter_by(id=org.id).first()
        assert refreshed_org.name == "Pack 903 Guard"
