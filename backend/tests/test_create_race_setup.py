"""`createRace` taking its racing groups, a terminology override and award
definitions along with the race (#662, #722).

The setup wizard scaffolds a pack's dens — or copies a previous race's
structure, awards included — and lands them in the same mutation as the race
itself, for the reason `createPracticeRace` (#201) is one mutation rather than
five: a setup that fails half way must not leave a half-built race. The
wizard's own flow is frontend-tested; this is the storage half.
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


class TestUnknownTrack:
    """#1023: a `trackId` naming no track is refused with a sentence, not
    the raw `sqlite3.IntegrityError` the `INSERT`'s own foreign key
    constraint used to surface — reachable through a stale id (a track
    deleted from another tab while the wizard was open) rather than the
    ordinary form, which will not submit without a track.
    """

    def test_create_race_refuses_an_unknown_track(self, client, db):
        organization_id, _track_id = _context(db)
        before_races = db.query(models.Race).count()

        response = client.post(
            "/graphql",
            json={
                "query": CREATE,
                "variables": {
                    "race": {
                        "name": "Stale Track Race",
                        "organizationId": organization_id,
                        "trackId": 999999,
                    }
                },
            },
        )

        body = response.json()
        assert "errors" in body
        message = body["errors"][0]["message"]
        assert message == "Cannot create a race: track 999999 does not exist."
        assert "IntegrityError" not in message
        assert "FOREIGN KEY" not in message
        assert db.query(models.Race).count() == before_races

    def test_create_race_with_an_unknown_track_creates_no_racing_groups_either(
        self, client, db
    ):
        organization_id, _track_id = _context(db)
        before_groups = db.query(models.RacingGroup).count()

        response = client.post(
            "/graphql",
            json={
                "query": CREATE,
                "variables": {
                    "race": {
                        "name": "Stale Track Race",
                        "organizationId": organization_id,
                        "trackId": 999999,
                        "racingGroups": [{"name": "Lion"}],
                    }
                },
            },
        )

        assert "errors" in response.json()
        assert db.query(models.RacingGroup).count() == before_groups

    def test_create_race_with_a_real_track_is_unaffected(self, client, db):
        """The existing path — a real track id — is untouched by the check."""
        organization_id, track_id = _context(db)

        created = _create(client, organization_id, track_id, name="Real Track Race")

        assert created["id"] is not None

    def test_update_race_refuses_an_unknown_track_too(self, client, db):
        """`update_race`'s own `UPDATE` has the identical foreign key, so a
        changed `trackId` naming no track needs the identical guard.
        """
        organization_id, track_id = _context(db)
        created = _create(client, organization_id, track_id, name="Race To Retarget")

        response = client.post(
            "/graphql",
            json={
                "query": """
                mutation Update($id: Int!, $race: RaceUpdateInput!) {
                    updateRace(id: $id, race: $race) { id trackId }
                }
                """,
                "variables": {
                    "id": created["id"],
                    "race": {"trackId": 999999},
                },
            },
        )

        body = response.json()
        assert "errors" in body
        message = body["errors"][0]["message"]
        assert message == "Cannot update race: track 999999 does not exist."
        assert "IntegrityError" not in message
        assert "FOREIGN KEY" not in message


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


CREATE_WITH_AWARDS = """
mutation Create($race: RaceInput!) {
    createRace(race: $race) {
        id
        racingGroups { id name }
        awards {
            id
            name
            kind
            source
            place
            fromBottom
            racingGroupId
            artworkKey
            sortOrder
            votable
            recipient { id }
        }
    }
}
"""


def _create_with_awards(client, organization_id, track_id, **extra):
    response = client.post(
        "/graphql",
        json={
            "query": CREATE_WITH_AWARDS,
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


class TestAwards:
    """Award definitions copied over by the setup wizard's copy step (#722).

    `AwardCopyInput` has no `racer_id` field at all, so a `SPECIAL` award's
    chosen winner has nowhere to ride along even by mistake (#170) — every
    award created this way opens with no recipient, which for `SPEED` is the
    ordinary "hasn't raced yet" state and for `SPECIAL` is the ordinary
    "nobody has decided yet" state.
    """

    def test_awards_are_created_with_the_race_and_never_carry_a_recipient(
        self, client, db
    ):
        organization_id, track_id = _context(db)

        created = _create_with_awards(
            client,
            organization_id,
            track_id,
            awards=[
                {
                    "name": "Fastest Overall",
                    "kind": "SPEED",
                    "source": "ALL",
                    "place": 1,
                    # A SPEED award's artwork is derived from its rule, never
                    # trusted from the client — `crud._set_speed_artwork_key`
                    # overwrites this regardless.
                    "artworkKey": "not-the-real-key",
                    "sortOrder": 0,
                    "votable": True,
                },
                {
                    "name": "Best Paint",
                    "kind": "SPECIAL",
                    "artworkKey": "medal",
                    "sortOrder": 1,
                    "votable": True,
                },
            ],
        )

        awards = {a["name"]: a for a in created["awards"]}
        assert set(awards) == {"Fastest Overall", "Best Paint"}
        assert awards["Fastest Overall"]["artworkKey"] == "trophy"
        # SPEED never takes votes, whatever the client sent (#305).
        assert awards["Fastest Overall"]["votable"] is False
        assert awards["Fastest Overall"]["recipient"] is None
        assert awards["Best Paint"]["artworkKey"] == "medal"
        assert awards["Best Paint"]["votable"] is True
        assert awards["Best Paint"]["recipient"] is None

    def test_a_racing_group_scoped_award_follows_its_group_to_the_new_race(
        self, client, db
    ):
        """`racingGroupId` still names the *previous* race's group; the
        server remaps it using the new group's own `copiedFromId` — the same
        mapping the wizard shows the operator in its preview.
        """
        organization_id, track_id = _context(db)
        source = _create(
            client,
            organization_id,
            track_id,
            name="Last Year",
            racingGroups=[{"name": "Wolves", "color": "#AAB7B8"}],
        )
        source_group_id = crud.get_racing_groups(db, race_id=source["id"])[0].id

        created = _create_with_awards(
            client,
            organization_id,
            track_id,
            name="This Year",
            racingGroups=[
                {
                    "name": "Wolves",
                    "color": "#AAB7B8",
                    "copiedFromId": source_group_id,
                }
            ],
            awards=[
                {
                    "name": "Fastest Wolf",
                    "kind": "SPEED",
                    "source": "ALL",
                    "place": 1,
                    "racingGroupId": source_group_id,
                    "sortOrder": 0,
                }
            ],
        )

        new_group_id = created["racingGroups"][0]["id"]
        assert new_group_id != source_group_id
        assert created["awards"][0]["racingGroupId"] == new_group_id

    def test_a_round_scoped_award_is_dropped_the_new_race_has_no_rounds_yet(
        self, client, db
    ):
        organization_id, track_id = _context(db)

        created = _create_with_awards(
            client,
            organization_id,
            track_id,
            awards=[
                {
                    "name": "Finals Champion",
                    "kind": "SPEED",
                    "source": "ROUND:9",
                    "place": 1,
                    "sortOrder": 0,
                }
            ],
        )

        assert created["awards"] == []

    def test_an_award_scoped_to_a_group_that_did_not_come_along_is_dropped(
        self, client, db
    ):
        """The wizard's own preview excludes this before submission, so this
        exercises the backend's independent, defence-in-depth check — no
        racing group at all was sent this time, so there is nothing for
        `racingGroupId` to remap to.
        """
        organization_id, track_id = _context(db)

        created = _create_with_awards(
            client,
            organization_id,
            track_id,
            awards=[
                {
                    "name": "Fastest Wolf",
                    "kind": "SPEED",
                    "source": "ALL",
                    "place": 1,
                    "racingGroupId": 999,
                    "sortOrder": 0,
                }
            ],
        )

        assert created["awards"] == []

    def test_no_awards_is_the_default(self, client, db):
        organization_id, track_id = _context(db)

        created = _create_with_awards(
            client, organization_id, track_id, name="Plain Race"
        )

        assert created["awards"] == []

    def test_a_refused_race_creates_no_awards_either(self, client, db):
        organization_id, track_id = _context(db)
        before = db.query(models.Award).count()

        response = client.post(
            "/graphql",
            json={
                "query": CREATE_WITH_AWARDS,
                "variables": {
                    "race": {
                        "name": "   ",
                        "organizationId": organization_id,
                        "trackId": track_id,
                        "awards": [
                            {
                                "name": "Fastest Overall",
                                "kind": "SPEED",
                                "source": "ALL",
                                "place": 1,
                            }
                        ],
                    }
                },
            },
        )

        assert "errors" in response.json()
        assert db.query(models.Award).count() == before
