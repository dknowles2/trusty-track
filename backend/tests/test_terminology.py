"""Custom terminology storage and resolution (#496, stage 3).

The layering rule itself is `domain/terminology.py`, pinned by
`test_domain_terminology.py` with no database involved. This file is the
GraphQL wiring: the columns, the `Terminology` type, and the
`clearTerminology` flag on both scopes.
"""

from backend.db import crud, models, schemas


def _race(db, name: str) -> models.Race:
    organization = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{name} Organization")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{name} Track", lane_count=4)
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name=name, organization_id=organization.id, track_id=track.id
        ),
    )


TERMINOLOGY_FIELDS = """
    racingGroupSingular
    racingGroupPlural
    organizationSingular
    organizationPlural
"""


class TestBuiltInDefault:
    def test_a_race_with_no_overrides_anywhere_resolves_to_den_and_pack(
        self, client, db
    ):
        race = _race(db, "Default Terminology Race")

        response = client.post(
            "/graphql",
            json={
                "query": f"""
                {{ race(raceId: {race.id}) {{
                    terminology {{ {TERMINOLOGY_FIELDS} }}
                }} }}
                """
            },
        )

        assert response.json()["data"]["race"]["terminology"] == {
            "racingGroupSingular": "Den",
            "racingGroupPlural": "Dens",
            "organizationSingular": "Pack",
            "organizationPlural": "Packs",
        }

    def test_the_raw_override_fields_are_null_until_something_is_set(self, client, db):
        race = _race(db, "Null Overrides Race")

        response = client.post(
            "/graphql",
            json={"query": f"{{ race(raceId: {race.id}) {{ {TERMINOLOGY_FIELDS} }} }}"},
        )

        data = response.json()["data"]["race"]
        assert data == {
            "racingGroupSingular": None,
            "racingGroupPlural": None,
            "organizationSingular": None,
            "organizationPlural": None,
        }


class TestOrganizationDefault:
    def test_the_organization_can_set_an_install_wide_default(self, client, db):
        db.query(models.Track).delete()
        db.query(models.Organization).delete()
        db.commit()

        mutation = """
        mutation($config: InitialConfigInput!) {
            createInitialConfig(config: $config) {
                terminology { racingGroupSingular racingGroupPlural
                              organizationSingular organizationPlural }
            }
        }
        """
        variables = {
            "config": {
                "organizationName": "Custom Terms Pack",
                "racingGroupSingular": "Class",
                "racingGroupPlural": "Classes",
                "tracks": [{"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}],
            }
        }
        response = client.post(
            "/graphql", json={"query": mutation, "variables": variables}
        )
        res = response.json()
        assert "errors" not in res, res
        assert res["data"]["createInitialConfig"]["terminology"] == {
            "racingGroupSingular": "Class",
            "racingGroupPlural": "Classes",
            # Not overridden — falls through to the built-in word.
            "organizationSingular": "Pack",
            "organizationPlural": "Packs",
        }

    def test_a_race_inherits_the_organizations_default(self, client, db):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Inheriting Organization")
        )
        organization.racing_group_singular = "Class"
        organization.racing_group_plural = "Classes"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Inheriting Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Inheriting Race",
                organization_id=organization.id,
                track_id=track.id,
            ),
        )

        response = client.post(
            "/graphql",
            json={
                "query": f"""
                {{ race(raceId: {race.id}) {{
                    terminology {{ {TERMINOLOGY_FIELDS} }}
                }} }}
                """
            },
        )

        assert response.json()["data"]["race"]["terminology"][
            "racingGroupSingular"
        ] == ("Class")
        assert response.json()["data"]["race"]["terminology"]["racingGroupPlural"] == (
            "Classes"
        )

    def test_the_organization_default_can_be_cleared_back_to_null(self, client, db):
        db.query(models.Track).delete()
        db.query(models.Organization).delete()
        db.commit()

        client.post(
            "/graphql",
            json={
                "query": """
                mutation($config: InitialConfigInput!) {
                    createInitialConfig(config: $config) { id: organizationName }
                }
                """,
                "variables": {
                    "config": {
                        "organizationName": "Clear Me Pack",
                        "racingGroupSingular": "Class",
                        "tracks": [
                            {"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}
                        ],
                    }
                },
            },
        )

        response = client.post(
            "/graphql",
            json={
                "query": """
                mutation($config: InitialConfigInput!) {
                    updateInitialConfig(config: $config) {
                        racingGroupSingular
                        terminology { racingGroupSingular }
                    }
                }
                """,
                "variables": {
                    "config": {
                        "organizationName": "Clear Me Pack",
                        "clearTerminology": True,
                        "tracks": [],
                    }
                },
            },
        )
        res = response.json()
        assert "errors" not in res, res
        data = res["data"]["updateInitialConfig"]
        assert data["racingGroupSingular"] is None
        assert data["terminology"]["racingGroupSingular"] == "Den"


class TestRaceOverride:
    def test_a_race_override_beats_the_organizations_default(self, client, db):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Overridden Organization")
        )
        organization.racing_group_singular = "Class"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Overridden Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Overridden Race",
                organization_id=organization.id,
                track_id=track.id,
            ),
        )

        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{
                        racingGroupSingular: "Team", racingGroupPlural: "Teams"
                    }}) {{ id }}
                }}
                """
            },
        )

        response = client.post(
            "/graphql",
            json={
                "query": f"""
                {{ race(raceId: {race.id}) {{
                    terminology {{ {TERMINOLOGY_FIELDS} }}
                }} }}
                """
            },
        )
        assert response.json()["data"]["race"]["terminology"] == {
            "racingGroupSingular": "Team",
            "racingGroupPlural": "Teams",
            # Untouched at the race level, so still falls through to the
            # organization's own override.
            "organizationSingular": "Pack",
            "organizationPlural": "Packs",
        }

    def test_an_absent_override_leaves_the_stored_one_alone(self, client, db):
        """The behaviour `clearTerminology` exists to override on purpose —
        the same shape as `test_an_absent_limit_leaves_the_stored_one_alone`
        in `test_weight_limit.py`."""
        race = _race(db, "Untouched Terminology Race")
        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{
                        racingGroupSingular: "Team"
                    }}) {{ id }}
                }}
                """
            },
        )

        response = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{location: "The gym"}}) {{
                        racingGroupSingular
                    }}
                }}
                """
            },
        )

        assert response.json()["data"]["updateRace"]["racingGroupSingular"] == "Team"

    def test_the_override_can_be_cleared_back_to_inheriting(self, client, db):
        race = _race(db, "Cleared Terminology Race")
        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{
                        racingGroupSingular: "Team"
                    }}) {{ id }}
                }}
                """
            },
        )

        response = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{clearTerminology: true}}) {{
                        racingGroupSingular
                        terminology {{ racingGroupSingular }}
                    }}
                }}
                """
            },
        )

        data = response.json()["data"]["updateRace"]
        assert data["racingGroupSingular"] is None
        assert data["terminology"]["racingGroupSingular"] == "Den"
