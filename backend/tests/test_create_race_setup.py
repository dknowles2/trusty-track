"""`createRace` taking its racing groups and a terminology override along
with the race (#662).

The setup wizard scaffolds a pack's dens — or copies a previous race's
structure — and lands them in the same mutation as the race itself, for the
reason `createPracticeRace` (#201) is one mutation rather than five: a setup
that fails half way must not leave a half-built race. The wizard's own flow
is frontend-tested; this is the storage half.
"""

from backend.db import crud, models, schemas


def _context(db):
    organization = crud.create_organization(
        db, schemas.OrganizationCreate(name="Setup Wizard Organization")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name="Setup Wizard Track", lane_count=4)
    )
    return organization.id, track.id


CREATE = """
mutation Create($race: RaceInput!) {
    createRace(race: $race) {
        id
        racingGroupSingular
        vehicleArtworkKey
        terminology { racingGroupSingular vehicleSingular vehicleArtworkKey }
        racingGroups { name color division carNumberRangeStart carNumberRangeEnd }
    }
}
"""


def _create(client, organization_id, track_id, **extra):
    response = client.post(
        "/graphql",
        json={
            "query": CREATE,
            "variables": {
                "race": {
                    "name": extra.pop("name", "Wizard Race"),
                    "organizationId": organization_id,
                    "trackId": track_id,
                    **extra,
                }
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    return body["data"]["createRace"]


class TestRacingGroups:
    def test_the_groups_are_created_with_the_race_in_the_order_given(self, client, db):
        organization_id, track_id = _context(db)

        created = _create(
            client,
            organization_id,
            track_id,
            racingGroups=[
                {"name": "Lion", "color": "#F4D03F", "division": "Lion"},
                {
                    "name": "Tiger",
                    "color": "#E67E22",
                    "division": "Tiger",
                    "carNumberRangeStart": 200,
                    "carNumberRangeEnd": 299,
                },
            ],
        )

        assert [g["name"] for g in created["racingGroups"]] == ["Lion", "Tiger"]
        assert created["racingGroups"][1] == {
            "name": "Tiger",
            "color": "#E67E22",
            "division": "Tiger",
            "carNumberRangeStart": 200,
            "carNumberRangeEnd": 299,
        }
        # And they are ordinary rows of the race's own — what Manage Dens,
        # the roster and the round wizard all read.
        rows = crud.get_racing_groups(db, race_id=created["id"])
        assert [r.name for r in rows] == ["Lion", "Tiger"]
        assert all(r.race_id == created["id"] for r in rows)

    def test_no_groups_is_the_default_and_what_every_older_caller_gets(
        self, client, db
    ):
        organization_id, track_id = _context(db)

        created = _create(client, organization_id, track_id, name="Plain Race")

        assert created["racingGroups"] == []
        assert (
            db.query(models.RacingGroup)
            .filter(models.RacingGroup.race_id == created["id"])
            .count()
            == 0
        )

    def test_a_refused_race_creates_no_groups_either(self, client, db):
        """One transaction: a race the schema refuses leaves nothing behind.

        A blank name is refused by `schemas.RaceBase` before anything is
        written, so the groups it came with must not have been written
        first — which is what a race-then-N-groups client sequence would
        have done.
        """
        organization_id, track_id = _context(db)
        before = db.query(models.RacingGroup).count()

        response = client.post(
            "/graphql",
            json={
                "query": CREATE,
                "variables": {
                    "race": {
                        "name": "   ",
                        "organizationId": organization_id,
                        "trackId": track_id,
                        "racingGroups": [{"name": "Lion"}],
                    }
                },
            },
        )

        assert "errors" in response.json()
        assert db.query(models.RacingGroup).count() == before


class TestTerminologyAtCreation:
    def test_the_override_is_stored_and_resolves_on_the_new_race(self, client, db):
        organization_id, track_id = _context(db)

        created = _create(
            client,
            organization_id,
            track_id,
            name="Space Derby",
            vehicleSingular="Rocket",
            vehiclePlural="Rockets",
            vehicleArtworkKey="rocket",
        )

        # The raw column, which the edit form reads back to tell "set" from
        # "inherited" — and the resolved words every screen reads.
        assert created["vehicleArtworkKey"] == "rocket"
        assert created["racingGroupSingular"] is None
        assert created["terminology"] == {
            "racingGroupSingular": "Den",
            "vehicleSingular": "Rocket",
            "vehicleArtworkKey": "rocket",
        }

    def test_absent_means_inherit(self, client, db):
        organization_id, track_id = _context(db)

        created = _create(client, organization_id, track_id, name="Inheriting Race")

        race = crud.get_race(db, created["id"])
        assert race.vehicle_singular is None
        assert race.racing_group_singular is None
