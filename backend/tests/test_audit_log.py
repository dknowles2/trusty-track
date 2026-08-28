"""What actually gets written, at each of the seams that writes it (#219).

`test_domain_audit.py` covers the rules. This covers the wiring: that a
mutation produces an entry, that a *refused* one produces an entry too, that
the timer's own results appear even though they are not a mutation, and — the
one worth losing sleep over — that an operator's PIN never reaches the table.
"""

import json

import pytest

from backend.db import crud, models, schemas
from backend.domain import audit, lanes


def entries(db, action: str | None = None) -> list[models.AuditEntry]:
    query = db.query(models.AuditEntry)
    if action:
        query = query.filter(models.AuditEntry.action == action)
    return query.order_by(models.AuditEntry.id).all()


@pytest.fixture
def race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Audit Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Audit Track", lane_count=2, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(name="Audit Derby", group_id=group.id, track_id=track.id),
    )


class TestTheMutationSeam:
    def test_a_mutation_is_recorded(self, client, db, race):
        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    createDen(raceId: {race.id}, den: {{name: "Wolves"}}) {{ id }}
                }}
                """
            },
        )

        recorded = entries(db, "createDen")
        assert len(recorded) == 1
        assert recorded[0].outcome == audit.Outcome.OK.value

    def test_it_notes_which_race(self, client, db, race):
        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    createDen(raceId: {race.id}, den: {{name: "Bears"}}) {{ id }}
                }}
                """
            },
        )

        assert entries(db, "createDen")[0].race_id == race.id

    def test_a_mutation_that_raises_is_recorded_as_failed(self, client, db):
        """An audit log that only recorded successes would be silent about the
        evening somebody kept trying something that did not work.

        `importRacers` against a race that does not exist raises rather than
        returning a falsy answer, which is what makes it the right probe here.
        """
        response = client.post(
            "/graphql",
            json={
                "query": ('mutation { importRacers(raceId: 999999, csvData: "a,b") }')
            },
        )
        assert response.json().get("errors"), "expected this mutation to raise"

        recorded = entries(db, "importRacers")
        assert [e.outcome for e in recorded] == [audit.Outcome.FAILED.value]

    @pytest.mark.usefixtures("race")
    def test_a_query_records_nothing(self, client, db):
        """Only operations. A wall display reading the leaderboard every two
        seconds would otherwise fill the table on its own."""
        client.post("/graphql", json={"query": "{ races { id } }"})

        assert entries(db) == []

    def test_no_pin_ever_reaches_the_table(self, client, db):
        """The one that matters. `InitialConfigInput` carries PINs in plaintext
        on their way to being hashed."""
        client.post(
            "/graphql",
            json={
                "query": """
                mutation {
                    createInitialConfig(config: {
                        groupName: "Pack 42",
                        operatorPin: "8531",
                        tracks: [{name: "T", laneCount: 4}]
                    }) { initialized }
                }
                """
            },
        )

        written = " ".join(e.details or "" for e in entries(db))
        assert "8531" not in written


@pytest.fixture
def locked_install(client, db):
    """An install with both PINs set, which is what turns enforcement on."""
    client.post(
        "/graphql",
        json={
            "query": """
            mutation {
                createInitialConfig(config: {
                    groupName: "Locked Pack",
                    operatorPin: "1111",
                    checkinPin: "2222",
                    tracks: [{name: "Locked Track", laneCount: 4}]
                }) { initialized }
            }
            """
        },
    )
    return db.query(models.Group).order_by(models.Group.id.desc()).first()


@pytest.mark.usefixtures("locked_install")
class TestRefusals:
    """The most interesting line the log can hold."""

    def test_a_refused_mutation_is_recorded(self, client, db):
        client.post(
            "/graphql",
            json={"query": "mutation { deleteRace(id: 1) }"},
            headers={"x-trustytrack-pin": "2222"},
        )

        refused = entries(db, "deleteRace")
        assert len(refused) == 1
        assert refused[0].outcome == audit.Outcome.REFUSED.value

    def test_it_records_the_role_that_was_turned_away(self, client, db):
        client.post(
            "/graphql",
            json={"query": "mutation { deleteRace(id: 1) }"},
            headers={"x-trustytrack-pin": "2222"},
        )

        assert entries(db, "deleteRace")[0].role == audit.ActorRole.CHECKIN.value

    def test_the_race_is_not_actually_deleted(self, client, db):
        """The guard still guards. A log that recorded a refusal while letting
        the mutation through would be worse than no log."""
        before = db.query(models.Race).count()

        client.post(
            "/graphql",
            json={"query": "mutation { deleteRace(id: 1) }"},
            headers={"x-trustytrack-pin": "2222"},
        )

        assert db.query(models.Race).count() == before


class TestTheHeatResultSeam:
    """The route a mutation-only log would miss entirely."""

    @pytest.fixture
    def heat(self, db, race):
        racer = crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name="Ada",
                last_name="Ant",
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        round_obj = crud.create_round(db, race_id=race.id, round_number=1)
        heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
        db.add(heat)
        db.flush()
        crud.set_heat_lanes(heat, [lanes.Lane(lane=1, racer_id=racer.id)])
        db.commit()
        return heat

    def test_a_result_from_the_timer_is_recorded(self, db, heat):
        crud.record_heat_result(
            db,
            heat.id,
            [lanes.Lane(lane=1, racer_id=1, time=3.4, place=1)],
            source=audit.ResultSource.TIMER,
        )

        recorded = entries(db, "heatResultRecorded")
        assert len(recorded) == 1
        assert (
            json.loads(recorded[0].details)["source"] == audit.ResultSource.TIMER.value
        )

    def test_the_timer_is_the_system_rather_than_an_operator(self, db, heat):
        """Nobody was at a keyboard. Attributing it to the operator would put a
        person's name against a machine's work."""
        crud.record_heat_result(
            db,
            heat.id,
            [lanes.Lane(lane=1, racer_id=1, time=3.4, place=1)],
            source=audit.ResultSource.TIMER,
        )

        assert entries(db, "heatResultRecorded")[0].role == audit.ActorRole.SYSTEM.value

    def test_a_result_typed_in_by_hand_says_so(self, db, heat):
        crud.record_heat_result(
            db,
            heat.id,
            [lanes.Lane(lane=1, racer_id=1, time=9.9, place=1)],
            source=audit.ResultSource.OPERATOR,
        )

        details = json.loads(entries(db, "heatResultRecorded")[0].details)
        assert details["source"] == audit.ResultSource.OPERATOR.value

    def test_the_times_themselves_are_not_copied_in(self, db, heat):
        """`heat_lanes` is the record. A second copy here could disagree with
        it, and a log that disagrees with the results is worse than none."""
        crud.record_heat_result(
            db,
            heat.id,
            [lanes.Lane(lane=1, racer_id=1, time=3.4, place=1)],
            source=audit.ResultSource.TIMER,
        )

        assert "3.4" not in (entries(db, "heatResultRecorded")[0].details or "")

    def test_it_notes_the_heat_and_how_many_lanes_were_timed(self, db, heat):
        crud.record_heat_result(
            db,
            heat.id,
            [lanes.Lane(lane=1, racer_id=1, time=3.4, place=1)],
            source=audit.ResultSource.TIMER,
        )

        details = json.loads(entries(db, "heatResultRecorded")[0].details)
        assert details["heatId"] == heat.id
        assert details["lanesTimed"] == 1


class TestPruning:
    def test_it_keeps_the_newest(self, db):
        for index in range(10):
            crud.record_audit(db, f"action{index}", role=audit.ActorRole.OPERATOR.value)

        removed = crud.prune_audit_log(db, keep=4)

        remaining = [e.action for e in entries(db)]
        assert removed == 6
        assert remaining == ["action6", "action7", "action8", "action9"]

    def test_it_does_nothing_below_the_cap(self, db):
        crud.record_audit(db, "only", role=audit.ActorRole.OPERATOR.value)

        assert crud.prune_audit_log(db, keep=100) == 0
        assert len(entries(db)) == 1

    def test_it_survives_an_empty_table(self, db):
        assert crud.prune_audit_log(db, keep=10) == 0


class TestTheLimitParameter:
    """`min(limit, 500)` clamped the top but not the floor (#346) — a negative
    ``limit`` reaches SQLite as ``LIMIT -1``, which it reads as "no limit at
    all" rather than "zero rows".
    """

    def test_a_negative_limit_is_not_unlimited(self, client, db):
        for index in range(3):
            crud.record_audit(db, f"action{index}", role=audit.ActorRole.OPERATOR.value)

        response = client.post(
            "/graphql",
            json={"query": "{ auditLog(limit: -1) { id } }"},
        )

        assert response.json()["data"]["auditLog"] == []

    def test_a_limit_of_zero_is_zero_rows(self, client, db):
        crud.record_audit(db, "only", role=audit.ActorRole.OPERATOR.value)

        response = client.post(
            "/graphql",
            json={"query": "{ auditLog(limit: 0) { id } }"},
        )

        assert response.json()["data"]["auditLog"] == []

    def test_a_positive_limit_still_works(self, client, db):
        for index in range(3):
            crud.record_audit(db, f"action{index}", role=audit.ActorRole.OPERATOR.value)

        response = client.post(
            "/graphql",
            json={"query": "{ auditLog(limit: 2) { id } }"},
        )

        assert len(response.json()["data"]["auditLog"]) == 2


@pytest.mark.usefixtures("locked_install")
class TestWhoMayRead:
    """`RolePolicyExtension` guards mutations, and this is a query.

    The same gap `/api/backup` and `/ws/timer/{track_id}` each close for
    themselves — and it matters more here, because the log says which device
    did what.
    """

    def test_an_operator_may_read_it(self, client):
        response = client.post(
            "/graphql",
            json={"query": "{ auditLog { id action } }"},
            headers={"x-trustytrack-pin": "1111"},
        )

        assert response.json().get("data", {}).get("auditLog") is not None

    def test_a_display_with_no_pin_is_refused(self, client):
        """A wall display must never be able to ask who did what, from where."""
        response = client.post("/graphql", json={"query": "{ auditLog { id } }"})

        assert response.json()["errors"]
        assert response.json()["data"] is None

    def test_the_check_in_desk_is_refused_too(self, client):
        response = client.post(
            "/graphql",
            json={"query": "{ auditLog { id } }"},
            headers={"x-trustytrack-pin": "2222"},
        )

        assert response.json()["errors"]

    def test_the_address_is_operator_only_as_its_own_field(self, client):
        """Named separately so a screen can choose not to ask for it."""
        response = client.post(
            "/graphql",
            json={"query": "{ auditLog { id sourceIp } }"},
            headers={"x-trustytrack-pin": "1111"},
        )

        assert "errors" not in response.json()
