"""Name-display setting storage and resolution (#552).

The layering rule itself is `domain/name_display.py`, pinned by
`test_domain_name_display.py` with no database involved. This file is the
GraphQL wiring: the columns, `resolvedNameDisplay`, and the
`clearNameDisplay` flag on the race scope.
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


class TestBuiltInDefault:
    def test_a_race_with_no_overrides_anywhere_resolves_to_full(self, client, db):
        race = _race(db, "Default Name Display Race")

        response = client.post(
            "/graphql",
            json={"query": f"{{ race(raceId: {race.id}) {{ resolvedNameDisplay }} }}"},
        )

        assert response.json()["data"]["race"]["resolvedNameDisplay"] == "FULL"

    def test_the_raw_override_field_is_null_until_something_is_set(self, client, db):
        race = _race(db, "Null Override Race")

        response = client.post(
            "/graphql",
            json={"query": f"{{ race(raceId: {race.id}) {{ nameDisplay }} }}"},
        )

        assert response.json()["data"]["race"]["nameDisplay"] is None


class TestOrganizationDefault:
    def test_the_organization_can_set_an_install_wide_default(self, client, db):
        db.query(models.Track).delete()
        db.query(models.Organization).delete()
        db.commit()

        mutation = """
        mutation($config: InitialConfigInput!) {
            createInitialConfig(config: $config) {
                nameDisplay
                resolvedNameDisplay
            }
        }
        """
        variables = {
            "config": {
                "organizationName": "Custom Name Display Pack",
                "nameDisplay": "LAST_INITIAL",
                "tracks": [{"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}],
            }
        }
        response = client.post(
            "/graphql", json={"query": mutation, "variables": variables}
        )
        res = response.json()
        assert "errors" not in res, res
        data = res["data"]["createInitialConfig"]
        assert data["nameDisplay"] == "LAST_INITIAL"
        assert data["resolvedNameDisplay"] == "LAST_INITIAL"

    def test_a_race_inherits_the_organizations_default(self, client, db):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Inheriting Name Display Organization")
        )
        organization.name_display = "FIRST_ONLY"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Inheriting Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Inheriting Name Display Race",
                organization_id=organization.id,
                track_id=track.id,
            ),
        )

        response = client.post(
            "/graphql",
            json={"query": f"{{ race(raceId: {race.id}) {{ resolvedNameDisplay }} }}"},
        )

        assert response.json()["data"]["race"]["resolvedNameDisplay"] == "FIRST_ONLY"

    def test_an_explicit_full_needs_no_clear_flag(self, client, db):
        """Unlike terminology, `FULL` is itself a reachable value at the
        organization layer — setting it back explicitly is enough, with no
        `clearNameDisplay`-style flag needed at this scope."""
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
                        "organizationName": "Reset Name Display Pack",
                        "nameDisplay": "LAST_INITIAL",
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
                        resolvedNameDisplay
                    }
                }
                """,
                "variables": {
                    "config": {
                        "organizationName": "Reset Name Display Pack",
                        "nameDisplay": "FULL",
                        "tracks": [],
                    }
                },
            },
        )
        res = response.json()
        assert "errors" not in res, res
        assert res["data"]["updateInitialConfig"]["resolvedNameDisplay"] == "FULL"


class TestRaceOverride:
    def test_a_race_override_beats_the_organizations_default(self, client, db):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Overridden Name Display Organization")
        )
        organization.name_display = "LAST_INITIAL"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Overridden Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Overridden Name Display Race",
                organization_id=organization.id,
                track_id=track.id,
            ),
        )

        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{ nameDisplay: "FIRST_ONLY" }}) {{
                        id
                    }}
                }}
                """
            },
        )

        response = client.post(
            "/graphql",
            json={"query": f"{{ race(raceId: {race.id}) {{ resolvedNameDisplay }} }}"},
        )
        assert response.json()["data"]["race"]["resolvedNameDisplay"] == "FIRST_ONLY"

    def test_a_race_can_override_back_to_full_over_an_abbreviating_organization(
        self, client, db
    ):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Full Override Organization")
        )
        organization.name_display = "LAST_INITIAL"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Full Override Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Full Override Race",
                organization_id=organization.id,
                track_id=track.id,
            ),
        )

        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{ nameDisplay: "FULL" }}) {{ id }}
                }}
                """
            },
        )

        response = client.post(
            "/graphql",
            json={"query": f"{{ race(raceId: {race.id}) {{ resolvedNameDisplay }} }}"},
        )
        assert response.json()["data"]["race"]["resolvedNameDisplay"] == "FULL"

    def test_an_absent_override_leaves_the_stored_one_alone(self, client, db):
        race = _race(db, "Untouched Name Display Race")
        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{ nameDisplay: "FIRST_ONLY" }}) {{
                        id
                    }}
                }}
                """
            },
        )

        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{ updateRace(id: {race.id}, race: {{ name: "Renamed" }}) {{
                    id
                }} }}
                """
            },
        )

        response = client.post(
            "/graphql",
            json={"query": f"{{ race(raceId: {race.id}) {{ nameDisplay }} }}"},
        )
        assert response.json()["data"]["race"]["nameDisplay"] == "FIRST_ONLY"

    def test_clear_name_display_returns_the_race_to_inheriting(self, client, db):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Clear Name Display Organization")
        )
        organization.name_display = "LAST_INITIAL"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Clear Name Display Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Clear Name Display Race",
                organization_id=organization.id,
                track_id=track.id,
            ),
        )
        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{ nameDisplay: "FIRST_ONLY" }}) {{
                        id
                    }}
                }}
                """
            },
        )

        response = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{ clearNameDisplay: true }}) {{
                        nameDisplay
                        resolvedNameDisplay
                    }}
                }}
                """
            },
        )
        res = response.json()
        assert "errors" not in res, res
        data = res["data"]["updateRace"]
        assert data["nameDisplay"] is None
        # Falls back through to the organization's own default.
        assert data["resolvedNameDisplay"] == "LAST_INITIAL"
