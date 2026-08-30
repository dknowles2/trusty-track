"""Writing a heat through structured input.

Issue #5, step five. `updateHeatResult` and `recordFreeRaceResult` took a JSON
string that the server had to trust and every client had to construct — which
meant every client also had to know that an undecided championship slot was a
negative racer id.
"""

from pathlib import Path

import pytest

from backend.db import crud, models, schemas
from backend.tests.helpers import (
    RECORD_FREE_RACE_RESULT,
    UPDATE_HEAT_RESULT,
    as_lanes,
    lane_dicts,
    lane_input,
)


def _post(client, query, variables):
    response = client.post("/graphql", json={"query": query, "variables": variables})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def race(db):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            organization_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )


@pytest.fixture
def racer(db, race):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Ann", last_name="A", race_id=race.id, car_passed_inspection=True
        ),
    )


def _heat(db, race, blob):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
    )
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(blob))
    db.commit()
    return heat


def _lanes(db, heat_id):
    return (
        db.query(models.HeatLane)
        .filter(models.HeatLane.heat_id == heat_id)
        .order_by(models.HeatLane.lane)
        .all()
    )


def test_a_recorded_time_reaches_the_database(client, db, race, racer):
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "time": 3.421, "place": 1})
            ],
        },
    )

    row = _lanes(db, heat.id)[0]
    assert (row.racer_id, row.time_seconds, row.place) == (racer.id, 3.421, 1)


def test_a_placeholder_slot_survives_the_round_trip(client, db, race):
    """The negative-id encoding is now the server's business alone."""
    heat = _heat(db, race, [{"lane": 1, "racer_id": -2}])

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                {
                    "lane": 1,
                    "racerId": None,
                    "placeholderSlot": 2,
                    "time": None,
                    "place": None,
                    "skipped": False,
                }
            ],
        },
    )

    row = _lanes(db, heat.id)[0]
    assert (row.racer_id, row.placeholder_slot) == (None, 2)
    # Storage still encodes it the old way; that is step 5b's problem.
    db.refresh(heat)
    assert lane_dicts(db, heat)[0]["racer_id"] == -2


def test_skipping_and_then_unskipping_a_heat(client, db, race, racer):
    """`skipped` is a real field now, so clearing it has to actually clear it —
    a carried-over `skipped: true` would leave the heat permanently skipped."""
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])
    lane = lane_input({"lane": 1, "racer_id": racer.id})

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": heat.id, "lanes": [{**lane, "skipped": True}]},
    )
    assert _lanes(db, heat.id)[0].skipped

    _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": heat.id, "lanes": [{**lane, "skipped": False}]},
    )
    assert not _lanes(db, heat.id)[0].skipped

    # Stored by omission rather than as `"skipped": false`. Older blobs contain
    # both spellings and every reader has always treated absent as false, so
    # this normalises them without changing what any of them see.
    db.refresh(heat)
    assert "skipped" not in lane_dicts(db, heat)[0]


# `test_keys_the_client_cannot_see_are_not_dropped` was here. It pinned
# `lanes.carry_extras`: the blob could hold keys nothing modelled, a client that
# could not see them could not send them back, and an update therefore had to
# read the stored blob and merge. #72 removed the blob, and `heat_lanes` has a
# column for every field there is — so there is no longer any such key to carry,
# and no way to write one.


def test_an_unknown_heat_is_answered_with_null(client, race):  # noqa: ARG001
    body = _post(client, UPDATE_HEAT_RESULT, {"heatId": 9999, "lanes": []})
    assert body["data"]["updateHeatResult"] is None


def test_a_malformed_lane_is_rejected_rather_than_stored(client, race):  # noqa: ARG001
    """The old string argument could not be validated at all: a typo in the
    client's JSON became a heat with no lanes, silently."""
    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": 1, "lanes": [{"lane": "not a number"}]},
    )
    assert "errors" in body, "the schema should reject this before it reaches the DB"


def test_free_race_results_take_the_same_input(client, db, race, racer):
    heat = crud.create_free_race_heat(
        db,
        race.id,
        as_lanes([{"lane": 1, "racer_id": racer.id}, {"lane": 2, "racer_id": None}]),
    )
    db.commit()

    _post(
        client,
        RECORD_FREE_RACE_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "time": 3.14, "place": 1}),
                lane_input({"lane": 2, "racer_id": None}),
            ],
        },
    )

    rows = _lanes(db, heat.id)
    assert [row.time_seconds for row in rows] == [3.14, None]


def test_an_unknown_free_race_heat_is_answered_with_null(client, race):  # noqa: ARG001
    body = _post(client, RECORD_FREE_RACE_RESULT, {"heatId": 9999, "lanes": []})
    assert body["data"]["recordFreeRaceResult"] is None


# --------------------------------------------------------------------------- #
# Validating the replacement (#307)                                           #
# --------------------------------------------------------------------------- #
#
# `updateHeatResult` and `recordFreeRaceResult` replace a heat's whole lane
# set with whatever a client sends, and nothing checked it before it reached
# the table: an empty list wiped the schedule, a partial list silently
# dropped the lanes it omitted, and a nonexistent racer id surfaced as a raw
# `sqlite3.IntegrityError`. Each test below asserts both halves — the
# mutation is refused *and* the stored lanes are untouched — because a
# rejected write that partially applied would be worse than the bug it
# replaces.


def test_an_empty_lane_list_is_refused(client, db, race, racer):
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])

    body = _post(client, UPDATE_HEAT_RESULT, {"heatId": heat.id, "lanes": []})

    assert "errors" in body, "an empty lane set must not silently wipe a heat"
    assert [row.lane for row in _lanes(db, heat.id)] == [1]


def test_a_partial_lane_list_is_refused(client, db, race, racer):
    """One lane for a four-lane heat used to leave three racers with no run."""
    heat = _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": racer.id},
            {"lane": 2, "racer_id": None},
            {"lane": 3, "racer_id": None},
            {"lane": 4, "racer_id": None},
        ],
    )

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [lane_input({"lane": 1, "racer_id": racer.id, "time": 3.1})],
        },
    )

    assert "errors" in body
    assert [row.lane for row in _lanes(db, heat.id)] == [1, 2, 3, 4]


def test_a_lane_number_the_heat_does_not_have_is_refused(client, db, race, racer):
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id}),
                lane_input({"lane": 2, "racer_id": None}),
            ],
        },
    )

    assert "errors" in body
    assert [row.lane for row in _lanes(db, heat.id)] == [1]


def test_duplicate_lane_numbers_are_refused(client, db, race, racer):
    heat = _heat(
        db, race, [{"lane": 1, "racer_id": racer.id}, {"lane": 2, "racer_id": None}]
    )

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "time": 3.1}),
                lane_input({"lane": 1, "racer_id": racer.id, "time": 3.2}),
            ],
        },
    )

    assert "errors" in body
    assert [row.time_seconds for row in _lanes(db, heat.id)] == [None, None]


def test_a_racer_id_outside_the_race_is_refused_cleanly(client, db, race, racer):
    """A raw `sqlite3.IntegrityError` used to reach the client here."""
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [lane_input({"lane": 1, "racer_id": 999999})],
        },
    )

    assert "errors" in body
    assert "IntegrityError" not in body["errors"][0]["message"]
    assert [row.racer_id for row in _lanes(db, heat.id)] == [racer.id]


def test_a_racer_from_another_race_is_refused(client, db, race, racer):
    other_race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Another Derby",
            organization_id=race.organization_id,
            track_id=race.track_id,
            car_numbering_strategy="MANUAL",
        ),
    )
    other_racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Bea",
            last_name="B",
            race_id=other_race.id,
            car_passed_inspection=True,
        ),
    )
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [lane_input({"lane": 1, "racer_id": other_racer.id})],
        },
    )

    assert "errors" in body
    assert [row.racer_id for row in _lanes(db, heat.id)] == [racer.id]


def test_an_empty_lane_list_is_refused_for_a_free_race_heat(client, db, race, racer):
    heat = crud.create_free_race_heat(
        db, race.id, as_lanes([{"lane": 1, "racer_id": racer.id}])
    )
    db.commit()

    body = _post(client, RECORD_FREE_RACE_RESULT, {"heatId": heat.id, "lanes": []})

    assert "errors" in body
    assert [row.lane for row in _lanes(db, heat.id)] == [1]


# --------------------------------------------------------------------------- #
# Validating a hand-entered place (#524)                                      #
# --------------------------------------------------------------------------- #
#
# #490 gave `updateHeatResult` its first way to receive a *place* the server
# did not derive itself. `POINTS` sums places with lower winning, so a bad
# one here is not merely wrong — a non-positive place is a reward, a
# duplicate double-counts a finish, and one past the field is points against
# a racer who never lost that badly. Each test asserts both halves, the same
# convention as the #307 section above: the mutation is refused *and* the
# stored lanes are untouched.


@pytest.mark.parametrize("bad_place", [0, -1])
def test_a_non_positive_place_is_refused(client, db, race, racer, bad_place):
    heat = _heat(db, race, [{"lane": 1, "racer_id": racer.id}])

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "place": bad_place})
            ],
        },
    )

    assert "errors" in body
    assert [row.place for row in _lanes(db, heat.id)] == [None]


def test_a_place_above_the_field_is_refused(client, db, race, racer):
    other = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Bea", last_name="B", race_id=race.id, car_passed_inspection=True
        ),
    )
    heat = _heat(
        db,
        race,
        [{"lane": 1, "racer_id": racer.id}, {"lane": 2, "racer_id": other.id}],
    )

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "place": 1}),
                lane_input({"lane": 2, "racer_id": other.id, "place": 5}),
            ],
        },
    )

    assert "errors" in body
    assert [row.place for row in _lanes(db, heat.id)] == [None, None]


def test_duplicate_places_are_refused(client, db, race, racer):
    other = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Bea", last_name="B", race_id=race.id, car_passed_inspection=True
        ),
    )
    heat = _heat(
        db,
        race,
        [{"lane": 1, "racer_id": racer.id}, {"lane": 2, "racer_id": other.id}],
    )

    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {
            "heatId": heat.id,
            "lanes": [
                lane_input({"lane": 1, "racer_id": racer.id, "place": 1}),
                lane_input({"lane": 2, "racer_id": other.id, "place": 1}),
            ],
        },
    )

    assert "errors" in body
    assert [row.place for row in _lanes(db, heat.id)] == [None, None]


def test_a_negative_place_is_refused_for_a_free_race_heat(client, db, race, racer):
    heat = crud.create_free_race_heat(
        db, race.id, as_lanes([{"lane": 1, "racer_id": racer.id}])
    )
    db.commit()

    body = _post(
        client,
        RECORD_FREE_RACE_RESULT,
        {
            "heatId": heat.id,
            "lanes": [lane_input({"lane": 1, "racer_id": racer.id, "place": -1})],
        },
    )

    assert "errors" in body
    assert [row.place for row in _lanes(db, heat.id)] == [None]


def test_only_one_place_writes_a_heats_lanes():
    """`crud.set_heat_lanes` is the one door (#72).

    Nine call sites used to assign `lane_results` directly. Making
    `heat_lanes` the source of truth means changing how a heat's lanes are
    stored, and that is a change to one function only while this holds. A new
    assignment elsewhere would still pass every other test — the blob would be
    right and `lane_sync` would project it — and would only surface as extra
    work when the flip happens.

    Scanned across the whole backend package rather than `crud.py` alone. The
    narrower version could only ever hold the property where it already held:
    an assignment in `api/schema.py` or a service was exactly as invisible as
    the ones this was written to catch, and there was one — a detached
    subscription snapshot copying the blob across, read by nothing but its own
    test.
    """
    import ast

    backend = Path(__file__).resolve().parents[1]
    writers = set()
    for path in sorted(backend.rglob("*.py")):
        # Migrations speak the storage format by definition, and the tests
        # here build blobs on purpose.
        if path.relative_to(backend).parts[0] in {"tests", "migrations"}:
            continue
        for func in ast.walk(ast.parse(path.read_text())):
            if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(func):
                targets = (
                    node.targets
                    if isinstance(node, ast.Assign)
                    else [node.target]
                    if isinstance(node, ast.AugAssign)
                    else []
                )
                for target in targets:
                    if (
                        isinstance(target, ast.Attribute)
                        and target.attr == "lane_results"
                    ):
                        writers.add(f"{path.relative_to(backend)}:{func.name}")

    assert writers == set(), (
        f"heats.lane_results was dropped in #72 but is still assigned: "
        f"{sorted(writers)}"
    )


def test_only_lane_sync_writes_heat_lane_rows():
    """The door moved with the storage (#72).

    While the blob existed, "one door" meant one place assigning
    `Heat.lane_results`. It is `heat_lanes` rows now, so that is what has to
    have one writer — otherwise `crud.set_heat_lanes` stops being the thing a
    reader can trust, and the projection can be bypassed exactly as the blob
    once could.

    `lane_sync` is that writer. `crud` reaches it through `set_heat_lanes`;
    nothing else should construct a `HeatLane` or insert into the table.
    """
    import ast

    backend = Path(__file__).resolve().parents[1]
    writers = set()
    for path in sorted(backend.rglob("*.py")):
        parts = path.relative_to(backend).parts
        # `lane_sync` is the writer; migrations build the table; tests read it.
        if parts[0] in {"tests", "migrations"} or path.name == "lane_sync.py":
            continue
        tree = ast.parse(path.read_text())

        # `HeatLane` is also the name of the *GraphQL* type in `api/schema.py`,
        # which is a read-side shell and nothing to do with the table. Only a
        # name bound to the ORM model counts.
        imported = any(
            isinstance(node, ast.ImportFrom)
            and node.module
            and node.module.endswith("db.models")
            and any(alias.name == "HeatLane" for alias in node.names)
            for node in ast.walk(tree)
        )

        def _is_model(node: ast.expr, imported: bool = imported) -> bool:
            if isinstance(node, ast.Attribute):
                return node.attr == "HeatLane"
            return isinstance(node, ast.Name) and node.id == "HeatLane" and imported

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if _is_model(node.func):
                writers.add(f"{path.relative_to(backend)}: constructs HeatLane")
            elif (
                isinstance(node.func, ast.Name)
                and node.func.id in {"insert", "update"}
                and any(_is_model(arg) for arg in node.args)
            ):
                writers.add(f"{path.relative_to(backend)}: {node.func.id}(HeatLane)")

    assert writers == set(), (
        f"heat_lanes rows are written outside lane_sync: {sorted(writers)}"
    )
