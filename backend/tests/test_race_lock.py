"""A locked race refuses the mutations that would change its record (#585).

Same rule as `test_demo_mode.py` and `test_auth_policy.py`: every test that
matters here asserts a mutation was **refused** — the row unchanged, or
absent — never that a check merely ran. Raising from a `SchemaExtension`'s
`on_execute` hook is silently swallowed and the mutation completes anyway,
which is exactly the guard that passes its own test while permitting
everything; `RaceLockExtension` uses `resolve` for that reason, and these
tests look at the database rather than trusting the response.
"""

import json

import pytest

from backend.api import auth, race_lock
from backend.api.race_lock import LOCKED_MUTATION_RESOLVERS
from backend.api.schema import schema
from backend.db import crud, models, schemas
from backend.domain import audit
from backend.tests.helpers import UPDATE_HEAT_RESULT, lane_input


def _mutation_names() -> set[str]:
    """Every mutation the schema declares, read from the SDL — the same
    derivation `test_auth_policy.py` and `test_demo_mode.py` use."""
    body = schema.as_str().split("type Mutation {", 1)[1].split("\n}", 1)[0]
    names = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith(('"', "#")):
            continue
        names.add(line.split("(", 1)[0].split(":", 1)[0].strip())
    return names


def entries(db, action: str) -> list[models.AuditEntry]:
    return (
        db.query(models.AuditEntry)
        .filter(models.AuditEntry.action == action)
        .order_by(models.AuditEntry.id)
        .all()
    )


# --------------------------------------------------------------------------- #
# The table cannot go stale                                                    #
# --------------------------------------------------------------------------- #


def test_every_locked_mutation_exists():
    """One direction only, like the demo's denylist and for the same reason:
    a mutation this module has not heard of yet is ordinary behaviour on a
    locked race, so only a stale entry — one naming a mutation the schema no
    longer has — is a build failure here."""
    declared = _mutation_names()
    assert set(LOCKED_MUTATION_RESOLVERS) - declared == set(), (
        "the lock denylist names mutations the schema does not have"
    )


def _race_update_input_fields() -> set[str]:
    """Every field `RaceUpdateInput` declares, read from the SDL and
    converted back to `snake_case` — the same derivation `_mutation_names`
    above uses for the `Mutation` type, applied instead to the input
    `updateRace`'s lock check is compared against."""
    body = schema.as_str().split("input RaceUpdateInput {", 1)[1].split("\n}", 1)[0]
    names = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith(('"', "#")):
            continue
        names.add(race_lock._snake(line.split(":", 1)[0].strip()))
    return names


def test_every_clear_flag_the_mutation_declares_is_a_clear_flag_target():
    """The direction that actually caught #1121's own gap: every
    `RaceUpdateInput` field named like a clear flag (`clear_weight_limit`,
    `clear_display_theme`, ...) has to be a key in `_CLEAR_FLAG_TARGETS`, or
    `is_lock_only_update` cannot recognise it and a locked race's own
    unlock-only resend is wrongly refused the moment a form starts sending
    it — which is exactly what shipped, briefly, until the ad hoc tests on
    #1121's own PR caught it by hand. `test_every_locked_mutation_exists`
    above checks the opposite direction (a stale entry naming a mutation
    gone from the schema) because a mutation this module has not heard of
    yet is harmless; a clear flag this dict has not heard of yet is not."""
    clear_flags = {
        name for name in _race_update_input_fields() if name.startswith("clear_")
    }
    assert clear_flags <= set(race_lock._CLEAR_FLAG_TARGETS)


def test_the_lock_leaves_reads_and_display_and_voting_mutations_alone():
    """The allowed-while-locked mutations named in `race_lock`'s own module
    docstring — none of them belongs in the denylist."""
    for name in (
        "assignDisplay",
        "advanceDisplay",
        "identifyDisplay",
        "renameDisplay",
        "forgetDisplay",
        "castVote",
        "deleteRace",
        "updateRace",
        "createTrack",
        "updateTrack",
        "setLaneOutages",
        "reconnectTimer",
        "abortHeat",
        "forceResults",
        "startTimerTest",
        "releaseStartGate",
        "resetTimer",
        "pauseIntermission",
        "resumeIntermission",
        "endIntermission",
    ):
        assert name not in LOCKED_MUTATION_RESOLVERS


# --------------------------------------------------------------------------- #
# Fixtures: a race with enough on it to exercise every argument shape          #
# --------------------------------------------------------------------------- #


@pytest.fixture
def group(db):
    return crud.create_organization(db, schemas.OrganizationCreate(name="Lock Pack"))


@pytest.fixture
def track(db):
    return crud.create_track(
        db, schemas.TrackCreate(name="Lock Track", lane_count=4, timer_type="FAKE")
    )


@pytest.fixture
def race(db, group, track):
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Lock Derby", organization_id=group.id, track_id=track.id
        ),
    )


@pytest.fixture
def racer(db, race):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Ada",
            last_name="Lovelace",
            race_id=race.id,
            car_passed_inspection=True,
        ),
    )


@pytest.fixture
def second_racer(db, race):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Bea",
            last_name="Byron",
            race_id=race.id,
            car_passed_inspection=True,
        ),
    )


@pytest.fixture
def round_(db, race, racer, second_racer):
    round_obj = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim"
    )
    crud.generate_heats_for_round(
        db, round_obj.id, racer_ids=[racer.id, second_racer.id]
    )
    return round_obj


@pytest.fixture
def heat(db, race, round_):  # noqa: ARG001 - round_ builds the heat
    return db.query(models.Heat).filter(models.Heat.race_id == race.id).first()


def _lock(db, race) -> None:
    race.is_locked = True
    db.commit()


def _post(client, query, variables=None):
    return client.post("/graphql", json={"query": query, "variables": variables or {}})


# --------------------------------------------------------------------------- #
# Each argument shape refuses when locked                                      #
# --------------------------------------------------------------------------- #


def _stored_lanes(db, heat_id: int) -> list[models.HeatLane]:
    return (
        db.query(models.HeatLane)
        .filter(models.HeatLane.heat_id == heat_id)
        .order_by(models.HeatLane.lane)
        .all()
    )


def test_a_heat_result_is_refused(client, db, race, heat):
    existing = _stored_lanes(db, heat.id)
    _lock(db, race)

    entries = [
        {"lane": lane.lane, "racer_id": lane.racer_id, "time": 3.5} for lane in existing
    ]
    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": heat.id, "lanes": [lane_input(e) for e in entries]},
    ).json()

    assert body.get("errors"), "expected the mutation to be refused"
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    assert all(lane.time_seconds is None for lane in _stored_lanes(db, heat.id))


def test_a_heat_result_still_works_unlocked(client, db, race, heat):  # noqa: ARG001
    entries = [
        {"lane": lane.lane, "racer_id": lane.racer_id, "time": 4.0}
        for lane in _stored_lanes(db, heat.id)
    ]
    body = _post(
        client,
        UPDATE_HEAT_RESULT,
        {"heatId": heat.id, "lanes": [lane_input(e) for e in entries]},
    ).json()

    assert not body.get("errors"), body.get("errors")


UPDATE_RACER = """
mutation($id: Int!, $racer: RacerInput!) { updateRacer(id: $id, racer: $racer) { id } }
"""


def test_a_racer_edit_is_refused(client, db, race, racer):
    _lock(db, race)
    body = _post(
        client,
        UPDATE_RACER,
        {
            "id": racer.id,
            "racer": {
                "firstName": "Changed",
                "lastName": racer.last_name,
                "raceId": race.id,
            },
        },
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    assert db.get(models.Racer, racer.id).first_name == "Ada"


REGENERATE_ROUND = (
    "mutation($roundId: Int!) { regenerateRound(roundId: $roundId) { id } }"
)


def test_a_round_regeneration_is_refused(client, db, race, round_):
    before = [
        h.id for h in db.query(models.Heat).filter(models.Heat.round_id == round_.id)
    ]
    _lock(db, race)

    body = _post(client, REGENERATE_ROUND, {"roundId": round_.id}).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    after = [
        h.id for h in db.query(models.Heat).filter(models.Heat.round_id == round_.id)
    ]
    assert after == before


CHECK_IN_RACER = """
mutation($id: Int!, $passedInspection: Boolean!, $weight: Float) {
  checkInRacer(id: $id, passedInspection: $passedInspection, weight: $weight) { id }
}
"""


def test_a_check_in_is_refused(client, db, race):
    unchecked = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Cee",
            last_name="Cog",
            race_id=race.id,
            car_passed_inspection=False,
        ),
    )
    _lock(db, race)

    body = _post(
        client,
        CHECK_IN_RACER,
        {"id": unchecked.id, "passedInspection": True, "weight": None},
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    assert db.get(models.Racer, unchecked.id).car_passed_inspection is False


BULK_CHECK_IN = """
mutation($racerIds: [Int!]!) { bulkCheckIn(racerIds: $racerIds) }
"""


def test_a_bulk_check_in_is_refused(client, db, race):
    unchecked = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Dee",
            last_name="Dog",
            race_id=race.id,
            car_passed_inspection=False,
        ),
    )
    _lock(db, race)

    body = _post(client, BULK_CHECK_IN, {"racerIds": [unchecked.id]}).json()

    assert body.get("errors")
    db.expire_all()
    assert db.get(models.Racer, unchecked.id).car_passed_inspection is False


CREATE_RACER = """
mutation($racer: RacerInput!) { createRacer(racer: $racer) { id } }
"""


def test_creating_a_racer_is_refused(client, db, race):
    before = db.query(models.Racer).filter(models.Racer.race_id == race.id).count()
    _lock(db, race)

    body = _post(
        client,
        CREATE_RACER,
        {"racer": {"firstName": "New", "lastName": "Comer", "raceId": race.id}},
    ).json()

    assert body.get("errors")
    db.expire_all()
    after = db.query(models.Racer).filter(models.Racer.race_id == race.id).count()
    assert after == before


CREATE_RACING_GROUP = """
mutation($raceId: Int!, $racingGroup: RacingGroupInput!) {
  createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id }
}
"""


def test_creating_a_racing_group_is_refused(client, db, race):
    _lock(db, race)

    body = _post(
        client,
        CREATE_RACING_GROUP,
        {"raceId": race.id, "racingGroup": {"name": "Wolves", "color": "#112233"}},
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert (
        db.query(models.RacingGroup)
        .filter(models.RacingGroup.race_id == race.id)
        .count()
        == 0
    )


CREATE_AWARD = """
mutation($raceId: Int!, $award: AwardInput!) {
  createAward(raceId: $raceId, award: $award) { id }
}
"""


def test_creating_an_award_is_refused(client, db, race):
    _lock(db, race)

    body = _post(
        client, CREATE_AWARD, {"raceId": race.id, "award": {"name": "Best Paint"}}
    ).json()

    assert body.get("errors")
    db.expire_all()
    assert db.query(models.Award).filter(models.Award.race_id == race.id).count() == 0


START_INTERMISSION = """
mutation($raceId: Int!, $durationSeconds: Int!) {
  startIntermission(raceId: $raceId, durationSeconds: $durationSeconds) { id }
}
"""


def test_starting_an_intermission_is_refused(client, db, race):
    """A locked race is presumably done racing (#585); starting a break on
    it changes the race's own stored columns the same way `createAward`
    does, so it belongs on the same denylist (#592)."""
    _lock(db, race)

    body = _post(
        client, START_INTERMISSION, {"raceId": race.id, "durationSeconds": 300}
    ).json()

    assert body.get("errors")
    db.expire_all()
    db.refresh(race)
    assert race.intermission_ends_at is None


PAUSE_INTERMISSION = """
mutation($raceId: Int!) { pauseIntermission(raceId: $raceId) { id } }
"""

RESUME_INTERMISSION = """
mutation($raceId: Int!) { resumeIntermission(raceId: $raceId) { id } }
"""

END_INTERMISSION = """
mutation($raceId: Int!) { endIntermission(raceId: $raceId) { id } }
"""

EXTEND_INTERMISSION = """
mutation($raceId: Int!, $seconds: Int!) {
  extendIntermission(raceId: $raceId, seconds: $seconds) { id }
}
"""


def test_a_paused_intermission_on_a_locked_race_can_still_be_ended(client, db, race):
    """#886 — the state an operator could not get out of: start a break,
    pause it (which drops its `ends_at`, so unlike a running one it never
    expires on its own), lock the race, and `endIntermission` used to be
    refused right along with every other mutation on the denylist — leaving
    every display assigned to the race parked on the break overlay forever.

    Pausing and resuming only ever hold steady or shorten the time already on
    the clock — never lengthen it — so they stay reachable too; only
    `startIntermission`/`extendIntermission`, which would hand a race
    presumed done *more* break time than it already had, remain locked.
    """
    body = _post(
        client, START_INTERMISSION, {"raceId": race.id, "durationSeconds": 300}
    ).json()
    assert not body.get("errors"), body.get("errors")

    body = _post(client, PAUSE_INTERMISSION, {"raceId": race.id}).json()
    assert not body.get("errors"), body.get("errors")

    _lock(db, race)
    db.expire_all()

    body = _post(client, END_INTERMISSION, {"raceId": race.id}).json()

    assert not body.get("errors"), body.get("errors")
    db.expire_all()
    ended = db.get(models.Race, race.id)
    assert ended.intermission_ends_at is None
    assert ended.intermission_paused_remaining_seconds is None


def test_pausing_and_resuming_are_allowed_when_locked(client, db, race):
    body = _post(
        client, START_INTERMISSION, {"raceId": race.id, "durationSeconds": 300}
    ).json()
    assert not body.get("errors"), body.get("errors")

    _lock(db, race)
    db.expire_all()

    body = _post(client, PAUSE_INTERMISSION, {"raceId": race.id}).json()
    assert not body.get("errors"), body.get("errors")

    body = _post(client, RESUME_INTERMISSION, {"raceId": race.id}).json()
    assert not body.get("errors"), body.get("errors")


def test_extending_an_intermission_is_still_refused_when_locked(client, db, race):
    """Unlike ending or pausing, `extendIntermission` would hand a race
    presumed done more break time than it already had, so it stays on the
    denylist alongside `startIntermission`."""
    body = _post(
        client, START_INTERMISSION, {"raceId": race.id, "durationSeconds": 300}
    ).json()
    assert not body.get("errors"), body.get("errors")

    _lock(db, race)
    db.expire_all()

    body = _post(client, EXTEND_INTERMISSION, {"raceId": race.id, "seconds": 60}).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]


# --------------------------------------------------------------------------- #
# What stays reachable on a locked race                                        #
# --------------------------------------------------------------------------- #


DELETE_RACE = "mutation($id: Int!) { deleteRace(id: $id) }"


def test_delete_race_still_works_when_locked(client, db, race):
    _lock(db, race)

    body = _post(client, DELETE_RACE, {"id": race.id}).json()

    assert not body.get("errors"), body.get("errors")
    db.expire_all()
    assert db.query(models.Race).filter(models.Race.id == race.id).first() is None


UPDATE_RACE = """
mutation($id: Int!, $race: RaceUpdateInput!) {
  updateRace(id: $id, race: $race) { id isLocked }
}
"""


def test_unlocking_is_always_allowed(client, db, race):
    _lock(db, race)

    body = _post(
        client, UPDATE_RACE, {"id": race.id, "race": {"isLocked": False}}
    ).json()

    assert not body.get("errors"), body.get("errors")
    db.expire_all()
    assert db.get(models.Race, race.id).is_locked is False


def test_relocking_with_nothing_else_is_allowed(client, db, race):
    _lock(db, race)

    body = _post(
        client, UPDATE_RACE, {"id": race.id, "race": {"isLocked": True}}
    ).json()

    assert not body.get("errors"), body.get("errors")


def test_unlocking_works_when_the_form_resends_every_field_unchanged(client, db, race):
    """`RaceForm` resends the whole race, not a diff — `RaceDetails.
    handleUpdateRace` builds `name`, `trackId`, `scoringStrategy` and every
    other setting from the form's own state on *every* save, including the
    one where the operator only touched the lock checkbox. A comparison
    against each field's schema default would refuse this exact payload;
    `is_lock_only_update` has to compare against the race's own current
    values instead. This is the regression that matters most in this file."""
    _lock(db, race)

    body = _post(
        client,
        UPDATE_RACE,
        {
            "id": race.id,
            "race": {
                "isLocked": False,
                "name": race.name,
                "trackId": race.track_id,
                "scoringStrategy": race.scoring_strategy.value,
                "tiebreaker": race.tiebreaker.value,
                "dropWorstRuns": race.drop_worst_runs,
                "carNumberingStrategy": race.car_numbering_strategy.value,
                "globalStartNumber": race.global_start_number,
                "championshipTrophies": race.championship_trophies,
                "masterRunningOrder": race.master_running_order,
                "excludeRoundWinnersFromQualifyingStandings": (
                    race.exclude_round_winners_from_qualifying_standings
                ),
                "clearWeightLimit": race.weight_limit_oz is None,
                "clearTerminology": race.racing_group_singular is None,
                "clearNameDisplay": race.name_display is None,
            },
        },
    ).json()

    assert not body.get("errors"), body.get("errors")
    db.expire_all()
    assert db.get(models.Race, race.id).is_locked is False


def test_a_field_genuinely_changed_alongside_a_full_resend_is_still_refused(
    client, db, race
):
    """The same full-payload shape as above, but `name` actually differs —
    proving the comparison is against the *current* value, not merely
    "present vs. absent"."""
    _lock(db, race)

    body = _post(
        client,
        UPDATE_RACE,
        {
            "id": race.id,
            "race": {
                "isLocked": False,
                "name": "A different name entirely",
                "trackId": race.track_id,
                "scoringStrategy": race.scoring_strategy.value,
                "tiebreaker": race.tiebreaker.value,
                "dropWorstRuns": race.drop_worst_runs,
                "carNumberingStrategy": race.car_numbering_strategy.value,
                "globalStartNumber": race.global_start_number,
                "championshipTrophies": race.championship_trophies,
                "masterRunningOrder": race.master_running_order,
                "excludeRoundWinnersFromQualifyingStandings": (
                    race.exclude_round_winners_from_qualifying_standings
                ),
                "clearWeightLimit": race.weight_limit_oz is None,
                "clearTerminology": race.racing_group_singular is None,
                "clearNameDisplay": race.name_display is None,
            },
        },
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    stored = db.get(models.Race, race.id)
    assert stored.name == "Lock Derby"
    assert stored.is_locked is True


def test_a_locked_races_other_fields_are_refused_even_alongside_the_unlock(
    client, db, race
):
    """The payload has to touch nothing but `isLocked` — sneaking a rename in
    alongside the unlock is still a locked-race edit."""
    _lock(db, race)

    body = _post(
        client,
        UPDATE_RACE,
        {"id": race.id, "race": {"isLocked": False, "name": "Renamed"}},
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    stored = db.get(models.Race, race.id)
    assert stored.name == "Lock Derby"
    assert stored.is_locked is True


def _full_resend(race: models.Race, **overrides: object) -> dict:
    """The same whole-race payload `RaceForm` sends on every save — the
    fields `test_unlocking_works_when_the_form_resends_every_field_unchanged`
    lists by hand, factored out so the theme-flag tests below can each layer
    one field on top without repeating the other dozen unchanged ones a
    fourth and fifth time."""
    return {
        "name": race.name,
        "trackId": race.track_id,
        "scoringStrategy": race.scoring_strategy.value,
        "tiebreaker": race.tiebreaker.value,
        "dropWorstRuns": race.drop_worst_runs,
        "carNumberingStrategy": race.car_numbering_strategy.value,
        "globalStartNumber": race.global_start_number,
        "championshipTrophies": race.championship_trophies,
        "masterRunningOrder": race.master_running_order,
        "excludeRoundWinnersFromQualifyingStandings": (
            race.exclude_round_winners_from_qualifying_standings
        ),
        "clearWeightLimit": race.weight_limit_oz is None,
        "clearTerminology": race.racing_group_singular is None,
        "clearNameDisplay": race.name_display is None,
        **overrides,
    }


def test_unlocking_works_alongside_clearing_themes_already_null(client, db, race):
    """#1121 added `clearDisplayTheme`/`clearPrintablesTheme` to `updateRace`,
    and `RaceForm` sends both as `true` on every save of a race with no
    override of its own (see `update_race`'s own comment on why it compares
    stored values rather than trusting the flag) — so a race that has never
    set either theme sends this exact payload on the ordinary unlock save,
    not just on an edge case. #1123 is that no test pinned it directly."""
    assert race.display_theme is None
    assert race.printables_theme is None
    _lock(db, race)

    body = _post(
        client,
        UPDATE_RACE,
        {
            "id": race.id,
            "race": _full_resend(
                race,
                isLocked=False,
                clearDisplayTheme=True,
                clearPrintablesTheme=True,
            ),
        },
    ).json()

    assert not body.get("errors"), body.get("errors")
    db.expire_all()
    stored = db.get(models.Race, race.id)
    assert stored.is_locked is False
    assert stored.display_theme is None
    assert stored.printables_theme is None


def test_clearing_a_set_display_theme_is_refused_even_alongside_the_unlock(
    client, db, race
):
    """A locked race whose `display_theme` is already a real override —
    clearing it is a genuine change to the record, the same as the rename in
    `test_a_locked_races_other_fields_are_refused_even_alongside_the_unlock`,
    just reached through a clear flag instead of an ordinary field."""
    race.display_theme = "old-glory"
    db.commit()
    _lock(db, race)

    body = _post(
        client,
        UPDATE_RACE,
        {
            "id": race.id,
            "race": _full_resend(race, isLocked=False, clearDisplayTheme=True),
        },
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    stored = db.get(models.Race, race.id)
    assert stored.display_theme == "old-glory"
    assert stored.is_locked is True


def test_setting_a_different_display_theme_is_refused_even_alongside_the_unlock(
    client, db, race
):
    """Setting `displayTheme` to a real, different key is a genuine change
    whether or not any clear flag is involved — `display_theme` itself, not
    only `clear_display_theme`, has to be compared against the race's
    current stored value."""
    assert race.display_theme is None
    _lock(db, race)

    body = _post(
        client,
        UPDATE_RACE,
        {
            "id": race.id,
            "race": _full_resend(race, isLocked=False, displayTheme="under-the-lights"),
        },
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    stored = db.get(models.Race, race.id)
    assert stored.display_theme is None
    assert stored.is_locked is True


def test_clearing_a_set_printables_theme_is_refused_even_alongside_the_unlock(
    client, db, race
):
    """Same as
    `test_clearing_a_set_display_theme_is_refused_even_alongside_the_unlock`,
    for the printables column — the two clear flags are independent entries
    in `_CLEAR_FLAG_TARGETS` and each wants its own coverage."""
    race.printables_theme = "old-glory"
    db.commit()
    _lock(db, race)

    body = _post(
        client,
        UPDATE_RACE,
        {
            "id": race.id,
            "race": _full_resend(race, isLocked=False, clearPrintablesTheme=True),
        },
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    stored = db.get(models.Race, race.id)
    assert stored.printables_theme == "old-glory"
    assert stored.is_locked is True


def test_ordinary_race_edits_are_refused_when_locked(client, db, race):
    _lock(db, race)

    body = _post(
        client, UPDATE_RACE, {"id": race.id, "race": {"name": "Renamed"}}
    ).json()

    assert body.get("errors")
    assert race_lock.LOCK_MESSAGE in body["errors"][0]["message"]
    db.expire_all()
    assert db.get(models.Race, race.id).name == "Lock Derby"


def test_ordinary_race_edits_still_work_unlocked(client, db, race):
    body = _post(
        client, UPDATE_RACE, {"id": race.id, "race": {"name": "Renamed"}}
    ).json()

    assert not body.get("errors"), body.get("errors")
    db.expire_all()
    assert db.get(models.Race, race.id).name == "Renamed"


RENAME_DISPLAY = """
mutation($displayId: String!, $name: String!) {
  renameDisplay(displayId: $displayId, name: $name) { displayId }
}
"""


def test_display_mutations_are_untouched_by_a_lock(client, db, race):
    """Not race data — see `race_lock`'s own docstring for why."""
    _lock(db, race)

    body = _post(
        client, RENAME_DISPLAY, {"displayId": "abc", "name": "Gym North"}
    ).json()

    # `renameDisplay` returns null for an unknown display id rather than
    # raising — the point here is only that it is not refused for a *lock*
    # reason.
    assert not body.get("errors"), body.get("errors")


# --------------------------------------------------------------------------- #
# The refusal is recorded, and extension order says who is asked first         #
# --------------------------------------------------------------------------- #


def test_the_refusal_is_recorded(client, db, race):
    """`RaceLockExtension` sits inside `AuditExtension`'s wrap, so a lock
    refusal is recorded exactly like any other."""
    _lock(db, race)

    _post(client, UPDATE_RACE, {"id": race.id, "race": {"name": "Renamed"}})

    recorded = entries(db, "updateRace")
    assert [e.outcome for e in recorded] == [audit.Outcome.REFUSED.value]


def test_the_refusal_records_the_lock_message(client, db, race):
    """The one question a dispute about a refused edit asks — a lock refusal
    must not read like a role refusal or a demo refusal (#889)."""
    _lock(db, race)

    _post(client, UPDATE_RACE, {"id": race.id, "race": {"name": "Renamed"}})

    details = json.loads(entries(db, "updateRace")[0].details)
    assert details["reason"] == race_lock.LOCK_MESSAGE


def test_the_role_policy_is_asked_before_the_lock(client, db, race, heat):
    """A caller the role policy would refuse anyway hears about *that*, not
    the lock — `RaceLockExtension` is innermost of the three policies, so it
    never runs unless the role policy already let the mutation through.

    Reproduced with a PIN configured (enforcement on) and no PIN sent, which
    makes the caller a `VIEWER` — refused for every mutation but `castVote`
    regardless of any lock.
    """
    group = (
        db.query(models.Organization)
        .filter(models.Organization.id == race.organization_id)
        .first()
    )
    group.operator_pin_hash = auth.hash_pin("1111")
    db.commit()
    _lock(db, race)

    lanes = [{"lane": 1, "racerId": None, "time": 3.5, "place": None, "skipped": False}]
    body = _post(client, UPDATE_HEAT_RESULT, {"heatId": heat.id, "lanes": lanes}).json()

    assert body.get("errors")
    assert "operator PIN" in body["errors"][0]["message"]
    assert race_lock.LOCK_MESSAGE not in body["errors"][0]["message"]
