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
    vehicleSingular
    vehiclePlural
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
            "vehicleSingular": "Car",
            "vehiclePlural": "Cars",
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
            "vehicleSingular": None,
            "vehiclePlural": None,
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
            # Untouched anywhere, so the built-in word.
            "vehicleSingular": "Car",
            "vehiclePlural": "Cars",
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


class TestVehicleTerm:
    """The third configurable term (#551) — a racer's vehicle, "Car" by
    default and wrong for a Space Derby (rockets) or a Raingutter Regatta
    (boats). Layers exactly like the other two, so this pins the GraphQL
    wiring specific to it rather than repeating every case above."""

    def test_the_organization_can_set_an_install_wide_default(self, client, db):
        db.query(models.Track).delete()
        db.query(models.Organization).delete()
        db.commit()

        mutation = """
        mutation($config: InitialConfigInput!) {
            createInitialConfig(config: $config) {
                terminology { vehicleSingular vehiclePlural }
            }
        }
        """
        variables = {
            "config": {
                "organizationName": "Rocket Pack",
                "vehicleSingular": "Rocket",
                "vehiclePlural": "Rockets",
                "tracks": [{"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}],
            }
        }
        response = client.post(
            "/graphql", json={"query": mutation, "variables": variables}
        )
        res = response.json()
        assert "errors" not in res, res
        assert res["data"]["createInitialConfig"]["terminology"] == {
            "vehicleSingular": "Rocket",
            "vehiclePlural": "Rockets",
        }

    def test_a_race_override_beats_the_organizations_default(self, client, db):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Boat Organization")
        )
        organization.vehicle_singular = "Rocket"
        organization.vehicle_plural = "Rockets"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Boat Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Boat Race", organization_id=organization.id, track_id=track.id
            ),
        )

        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{
                        vehicleSingular: "Boat", vehiclePlural: "Boats"
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
                    terminology {{ vehicleSingular vehiclePlural }}
                }} }}
                """
            },
        )
        assert response.json()["data"]["race"]["terminology"] == {
            "vehicleSingular": "Boat",
            "vehiclePlural": "Boats",
        }

    def test_the_override_can_be_cleared_back_to_inheriting(self, client, db):
        race = _race(db, "Cleared Vehicle Race")
        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    updateRace(id: {race.id}, race: {{
                        vehicleSingular: "Rocket"
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
                        vehicleSingular
                        terminology {{ vehicleSingular }}
                    }}
                }}
                """
            },
        )

        data = response.json()["data"]["updateRace"]
        assert data["vehicleSingular"] is None
        assert data["terminology"]["vehicleSingular"] == "Car"


class TestDefaultGeneralRoundName:
    """A general round's default name is derived from the resolved
    terminology at creation time (#533), not the literal ``"All Pack"`` that
    used to be hardcoded at three call sites — `crud.create_practice_race`,
    `createRoundWizard`, and `createRound`."""

    def test_default_install_still_yields_all_pack(self, db):
        race = _race(db, "Default Naming Race")
        assert crud.default_general_round_name(db, race) == "All Pack"

    def test_an_organization_rename_changes_the_default(self, db):
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Troop Organization")
        )
        organization.organization_singular = "Troop"
        organization.organization_plural = "Troops"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Troop Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Troop Race", organization_id=organization.id, track_id=track.id
            ),
        )

        assert crud.default_general_round_name(db, race) == "All Troop"

    def test_a_race_level_override_beats_the_organizations_own_word(self, db):
        race = _race(db, "School Naming Race")
        race.organization_singular = "School"
        db.commit()

        assert crud.default_general_round_name(db, race) == "All School"

    def test_created_round_uses_the_resolved_default_name(self, client, db):
        """End to end through ``createRound`` — before #533 this mutation
        hardcoded the literal "All Pack" regardless of terminology, so this
        fails without the fix even though the race has renamed "Pack" to
        "Troop"."""
        organization = crud.create_organization(
            db, schemas.OrganizationCreate(name="Renamed Organization")
        )
        organization.organization_singular = "Troop"
        db.commit()
        track = crud.create_track(
            db, schemas.TrackCreate(name="Renamed Track", lane_count=4)
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Renamed Race",
                organization_id=organization.id,
                track_id=track.id,
            ),
        )
        for i in range(2):
            crud.create_racer(
                db,
                schemas.RacerCreate(
                    first_name="Racer",
                    last_name=str(i),
                    race_id=race.id,
                    car_passed_inspection=True,
                ),
            )

        response = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    createRound(raceId: {race.id}, roundData: {{
                        schedulingStrategy: "PPC", runsPerLane: 1
                    }}) {{ name }}
                }}
                """
            },
        )

        data = response.json()["data"]["createRound"]
        assert data[0]["name"] == "All Troop"
