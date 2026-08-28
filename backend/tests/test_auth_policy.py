"""Roles refuse the mutations they should, and the table cannot go stale (#15).

Every test that matters here asserts a mutation was **refused** — that the row
is absent, or the value unchanged — rather than that a check ran. The design
sketch on the issue records why: raising from a `SchemaExtension.on_execute`
hook is silently swallowed and the mutation completes, so a guard can pass its
own test while permitting everything. `resolve` propagates, and these prove it
by looking at the database.

The other half is the completeness test. The policy denies anything absent from
the table, which is safe but surprising — you would find out at 9am on race day.
Comparing the table against the schema in both directions turns "forgot to
classify the new mutation" into a red build, and also catches an entry left
behind after one is renamed or removed.
"""

import pytest

from backend.api import auth
from backend.api.auth import POLICY, Role
from backend.api.schema import schema
from backend.db import crud, models, schemas


def _mutation_names() -> set[str]:
    """Every mutation the schema declares, read from the SDL.

    From the printed schema rather than from `Mutation.__annotations__` or a
    resolver registry: the SDL is what a client can actually call, which is the
    thing the policy has to cover.
    """
    body = schema.as_str().split("type Mutation {", 1)[1].split("\n}", 1)[0]
    names = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith(('"', "#")):
            continue
        names.add(line.split("(", 1)[0].split(":", 1)[0].strip())
    return names


# --------------------------------------------------------------------------- #
# The table cannot go stale                                                    #
# --------------------------------------------------------------------------- #


def test_every_mutation_is_classified():
    """Both directions, which is the point.

    Left-to-right catches a new mutation nobody bucketed — it would be denied to
    every role including the operator, silently, until someone tried it. Right-
    to-left catches an entry outliving the mutation it named, which is how a
    policy table quietly stops describing the schema.
    """
    declared = _mutation_names()
    classified = (
        auth.CHECKIN_MUTATIONS | auth.OPERATOR_ONLY_MUTATIONS | auth.VOTE_MUTATIONS
    )

    assert declared - classified == set(), (
        "mutations exist that no role can run — classify them in api/auth.py"
    )
    assert classified - declared == set(), (
        "the policy names mutations the schema does not have"
    )


def test_the_operator_can_run_everything():
    """The role that runs the race is not the place for a surprise."""
    assert POLICY[Role.OPERATOR] == _mutation_names()


def test_a_viewer_can_run_only_cast_vote():
    """The wall displays, and a phone with nobody's PIN (#305).

    `castVote` is the one deliberate exception to an otherwise-empty set —
    gated by `Race.voting_open`, not by this policy, which only says a
    caller with no PIN may attempt it at all."""
    assert POLICY[Role.VIEWER] == frozenset({"castVote"})


def test_check_in_cannot_touch_the_race():
    """The desk handles racers. Everything about running the event is refused —
    stated explicitly because the split is the whole point of the role."""
    for name in (
        "deleteRace",
        "updateHeatResult",
        "createRoundWizard",
        "advanceRound",
        "prepareHeat",
        "deleteRound",
        "updateInitialConfig",
        "populateRace",
    ):
        assert name not in POLICY[Role.CHECKIN], f"checkin should not run {name}"


# --------------------------------------------------------------------------- #
# PINs                                                                         #
# --------------------------------------------------------------------------- #


def test_a_pin_round_trips():
    stored = auth.hash_pin("4242")
    assert auth.verify_pin("4242", stored)
    assert not auth.verify_pin("4243", stored)


def test_the_same_pin_hashes_differently_each_time():
    """Salted, so two installs choosing 1234 do not share a hash."""
    assert auth.hash_pin("1234") != auth.hash_pin("1234")


@pytest.mark.parametrize("stored", [None, "", "not-a-hash"])
def test_verify_refuses_anything_that_is_not_a_hash(stored):
    assert not auth.verify_pin("1234", stored)


def test_no_operator_pin_means_no_enforcement():
    """What every existing install is, and stays, until someone sets one."""
    assert (
        auth.role_for(None, operator_pin_hash=None, checkin_pin_hash=None)
        is Role.OPERATOR
    )
    assert (
        auth.role_for("9999", operator_pin_hash=None, checkin_pin_hash=None)
        is Role.OPERATOR
    )


def test_the_right_pin_gets_the_right_role():
    operator = auth.hash_pin("1111")
    checkin = auth.hash_pin("2222")

    assert (
        auth.role_for("1111", operator_pin_hash=operator, checkin_pin_hash=checkin)
        is Role.OPERATOR
    )
    assert (
        auth.role_for("2222", operator_pin_hash=operator, checkin_pin_hash=checkin)
        is Role.CHECKIN
    )


def test_a_wrong_or_absent_pin_is_a_viewer():
    """Not an error. A display that sends nothing and a phone that guesses wrong
    are the same caller as far as this is concerned, and answering "wrong PIN"
    would tell an unauthenticated caller that a PIN exists."""
    operator = auth.hash_pin("1111")

    assert (
        auth.role_for(None, operator_pin_hash=operator, checkin_pin_hash=None)
        is Role.VIEWER
    )
    assert (
        auth.role_for("9999", operator_pin_hash=operator, checkin_pin_hash=None)
        is Role.VIEWER
    )


# --------------------------------------------------------------------------- #
# Refused for real, against the database                                       #
# --------------------------------------------------------------------------- #


@pytest.fixture
def secured(db):
    """A configured install with both PINs set, so enforcement is on."""
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    group.operator_pin_hash = auth.hash_pin("1111")
    group.checkin_pin_hash = auth.hash_pin("2222")
    db.commit()
    track = crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    return race


def _post(client, query, variables=None, pin=None):
    headers = {auth.PIN_HEADER: pin} if pin else {}
    return client.post(
        "/graphql",
        json={"query": query, "variables": variables or {}},
        headers=headers,
    )


CREATE_RACER = """
mutation Make($racer: RacerInput!) { createRacer(racer: $racer) { id } }
"""

DELETE_RACE = "mutation Kill($id: Int!) { deleteRace(id: $id) }"


def test_a_viewer_cannot_delete_a_race(client, db, secured):
    """The failure this issue exists for, end to end: the race survives."""
    body = _post(client, DELETE_RACE, {"id": secured.id}).json()

    assert body.get("errors"), "the mutation was not refused"
    assert "VIEWER is not allowed" in body["errors"][0]["message"]
    # The assertion that matters. A check that "ran" and let the row go is the
    # exact failure mode the sketch warns about.
    assert (
        db.query(models.Race).filter(models.Race.id == secured.id).first() is not None
    )


def test_check_in_cannot_delete_a_race_either(client, db, secured):
    body = _post(client, DELETE_RACE, {"id": secured.id}, pin="2222").json()

    assert body.get("errors")
    assert "CHECKIN is not allowed" in body["errors"][0]["message"]
    assert (
        db.query(models.Race).filter(models.Race.id == secured.id).first() is not None
    )


def test_check_in_can_register_a_racer(client, db, secured):
    """The role has to be useful, or the desk will just use the operator PIN."""
    body = _post(
        client,
        CREATE_RACER,
        {"racer": {"firstName": "Ada", "lastName": "A", "raceId": secured.id}},
        pin="2222",
    ).json()

    assert "errors" not in body, body
    assert (
        db.query(models.Racer).filter(models.Racer.race_id == secured.id).count() == 1
    )


CAST_VOTE = """
mutation Vote($awardId: Int!, $racerId: Int!, $ballotKey: String!) {
  castVote(awardId: $awardId, racerId: $racerId, ballotKey: $ballotKey)
}
"""


def test_a_viewer_can_cast_a_vote_while_voting_is_open(client, db, secured):
    """The one deliberate exception, end to end (#305).

    A phone with no PIN — nothing in `_post` sets one — reaching a mutation
    at all is the failure every other test in this file exists to prevent.
    Here it is the intended behaviour, gated by `Race.votingOpen` and
    `Award.votable` rather than by a credential.
    """
    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Ada", last_name="A", race_id=secured.id, car_number=7
        ),
    )
    award = crud.create_award(
        db,
        secured.id,
        schemas.AwardCreate(
            name="Best Paint", kind=models.AwardKind.SPECIAL, votable=True
        ),
    )
    secured.voting_open = True
    db.commit()

    body = _post(
        client,
        CAST_VOTE,
        {"awardId": award.id, "racerId": racer.id, "ballotKey": "abc-123"},
    ).json()

    assert "errors" not in body, body
    assert body["data"]["castVote"] is None  # null means the vote was recorded
    assert (
        db.query(models.AwardVote).filter(models.AwardVote.award_id == award.id).count()
        == 1
    )


def test_a_viewer_cannot_vote_while_voting_is_closed(client, db, secured):
    """`Race.votingOpen` is what gates it — the role policy only says a
    caller with no PIN may attempt the mutation at all."""
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Ada", last_name="A", race_id=secured.id)
    )
    award = crud.create_award(
        db,
        secured.id,
        schemas.AwardCreate(
            name="Best Paint", kind=models.AwardKind.SPECIAL, votable=True
        ),
    )
    # secured.voting_open defaults False.

    body = _post(
        client,
        CAST_VOTE,
        {"awardId": award.id, "racerId": racer.id, "ballotKey": "abc-123"},
    ).json()

    assert "errors" not in body, body
    assert body["data"]["castVote"] == "Voting is closed."
    assert (
        db.query(models.AwardVote).filter(models.AwardVote.award_id == award.id).count()
        == 0
    )


def test_a_viewer_still_cannot_run_any_other_mutation(client, db, secured):
    """`castVote` is the exception, not a crack in the wall around the rest."""
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Ada", last_name="A", race_id=secured.id)
    )
    body = _post(
        client,
        """
        mutation Edit($id: Int!, $racer: RacerInput!) {
          updateRacer(id: $id, racer: $racer) { id }
        }
        """,
        {"id": racer.id, "racer": {"firstName": "Bea", "lastName": "A"}},
    ).json()

    assert body.get("errors")
    assert "VIEWER is not allowed" in body["errors"][0]["message"]


def test_the_operator_can_delete_a_race(client, db, secured):
    body = _post(client, DELETE_RACE, {"id": secured.id}, pin="1111").json()

    assert "errors" not in body, body
    assert db.query(models.Race).filter(models.Race.id == secured.id).first() is None


def test_a_viewer_can_still_read(client, secured):  # noqa: ARG001
    """Displays are pointed at a URL with no credential and must keep working."""
    body = _post(client, "query { races { id name } }").json()

    assert "errors" not in body, body
    assert [r["name"] for r in body["data"]["races"]] == ["Derby"]


def test_an_unsecured_install_still_lets_anyone_operate(client, db):
    """No PIN set: exactly today's behaviour, so an upgrade mid-season does not
    lock the operator out of their own event."""
    group = crud.create_group(db, schemas.GroupCreate(name="Open Pack"))
    track = crud.create_track(db, schemas.TrackCreate(name="T", lane_count=4))
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Open Derby",
            group_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )

    body = _post(client, DELETE_RACE, {"id": race.id}).json()

    assert "errors" not in body, body
    assert db.query(models.Race).filter(models.Race.id == race.id).first() is None


def test_a_viewer_is_refused_over_the_websocket_too(client, secured):
    """The gap the design sketch flagged, closed by the same hook.

    `graphql-ws` permits a mutation on the socket a subscription arrived on, and
    observation is almost entirely subscriptions — so a display could send one.
    """
    with client.websocket_connect(
        "/graphql", subprotocols=["graphql-transport-ws"]
    ) as ws:
        ws.send_json({"type": "connection_init"})
        ws.receive_json()
        ws.send_json(
            {
                "id": "1",
                "type": "subscribe",
                "payload": {"query": DELETE_RACE, "variables": {"id": secured.id}},
            }
        )
        message = ws.receive_json()

    errors = (message.get("payload") or {}).get("errors") or []
    if message["type"] == "error":
        errors = message["payload"]
    assert errors, f"the socket ran the mutation: {message}"
    assert "not allowed" in str(errors)


# --------------------------------------------------------------------------- #
# Setting a PIN through the API                                               #
# --------------------------------------------------------------------------- #

SET_CONFIG = """
mutation Configure($config: InitialConfigInput!) {
  updateInitialConfig(config: $config) { initialized pinRequired }
}
"""

CONFIG_STATUS = "query { initialConfig { pinRequired checkinPinSet isOperator } }"


def _config(name="Pack", **extra):
    return {
        "groupName": name,
        "debugMode": False,
        "tracks": [{"name": "Track", "laneCount": 4, "timerType": "FAKE"}],
        **extra,
    }


def test_setting_an_operator_pin_turns_enforcement_on(client, db):
    """Start open, set a PIN, and the same anonymous caller loses the race."""
    crud.create_group(db, schemas.GroupCreate(name="Pack"))
    crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))

    before = _post(client, CONFIG_STATUS).json()["data"]["initialConfig"]
    assert before == {
        "pinRequired": False,
        "checkinPinSet": False,
        "isOperator": True,
    }

    body = _post(client, SET_CONFIG, {"config": _config(operatorPin="1234")}).json()
    assert "errors" not in body, body
    assert body["data"]["updateInitialConfig"]["pinRequired"] is True

    after = _post(client, CONFIG_STATUS).json()["data"]["initialConfig"]
    assert after == {
        "pinRequired": True,
        "checkinPinSet": False,
        "isOperator": False,
    }


def test_the_pin_is_not_stored_in_the_clear(client, db):
    crud.create_group(db, schemas.GroupCreate(name="Pack"))
    crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))

    _post(client, SET_CONFIG, {"config": _config(operatorPin="1234")})

    stored = db.query(models.Group).first().operator_pin_hash
    assert stored and "1234" not in stored
    assert auth.verify_pin("1234", stored)


def test_saving_settings_without_a_pin_leaves_it_alone(client, db):
    """The one that would have quietly switched enforcement back off.

    The settings page re-submits the whole config whenever anything changes, and
    it cannot send back a PIN it is never given. If "absent" meant "clear", then
    renaming a track would unlock the install.
    """
    crud.create_group(db, schemas.GroupCreate(name="Pack"))
    crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))
    _post(client, SET_CONFIG, {"config": _config(operatorPin="1234")})

    # A save that touches something else entirely, with no PIN in it.
    _post(client, SET_CONFIG, {"config": _config(name="Renamed Pack")})

    assert (
        _post(client, CONFIG_STATUS).json()["data"]["initialConfig"]["pinRequired"]
        is True
    )


def test_an_explicit_empty_pin_clears_it(client, db):
    """The escape hatch: an operator who has forgotten the PIN and can reach the
    machine can turn enforcement off again, which is why empty and absent are
    different."""
    crud.create_group(db, schemas.GroupCreate(name="Pack"))
    crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))
    _post(client, SET_CONFIG, {"config": _config(operatorPin="1234")})

    _post(
        client,
        SET_CONFIG,
        {"config": _config(operatorPin="")},
        pin="1234",
    )

    assert (
        _post(client, CONFIG_STATUS).json()["data"]["initialConfig"]["pinRequired"]
        is False
    )


def test_the_status_says_whether_a_checkin_pin_is_set(client, db):
    """The settings page can only offer to *remove* a PIN it knows exists.

    `pinRequired` answers that for the operator PIN. Without the same fact
    about the optional check-in PIN there was no way to tell "no PIN" from
    "a PIN you cannot see", and a blank field means "leave it alone" (#192).
    """
    crud.create_group(db, schemas.GroupCreate(name="Pack"))
    crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))

    before = _post(client, CONFIG_STATUS).json()["data"]["initialConfig"]
    assert before["checkinPinSet"] is False

    _post(client, SET_CONFIG, {"config": _config(checkinPin="5678")})

    after = _post(client, CONFIG_STATUS).json()["data"]["initialConfig"]
    assert after["checkinPinSet"] is True
    # Setting only the check-in PIN must not claim an operator PIN exists —
    # that is the flag the whole role system keys off.
    assert after["pinRequired"] is False


def test_an_explicit_empty_checkin_pin_clears_it(client, db):
    """The check-in PIN is optional, so a pack that sets one for a busy year
    and not the next needs the same way out as the operator PIN."""
    crud.create_group(db, schemas.GroupCreate(name="Pack"))
    crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))
    _post(client, SET_CONFIG, {"config": _config(checkinPin="5678")})

    _post(client, SET_CONFIG, {"config": _config(checkinPin="")})

    assert (
        _post(client, CONFIG_STATUS).json()["data"]["initialConfig"]["checkinPinSet"]
        is False
    )


# --------------------------------------------------------------------------- #
# The timer socket, which is not GraphQL                                       #
# --------------------------------------------------------------------------- #


@pytest.fixture
def proxy_track(db):
    """A configured install with a proxy-mode track and an operator PIN."""
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    group.operator_pin_hash = auth.hash_pin("1111")
    group.checkin_pin_hash = auth.hash_pin("2222")
    db.commit()
    return crud.create_track(
        db,
        schemas.TrackCreate(
            name="Proxy Track", lane_count=4, timer_type="AUTO_DETECT_PROXY"
        ),
    )


def _timer_socket_close_code(client, track_id, pin=None):
    """The code the server closed with, whatever the reason.

    Every path here closes rather than rejecting the handshake, so the code is
    the only thing that says *why* — 4403 for the credential, 4000 for anything
    about the track.
    """
    url = f"/ws/timer/{track_id}" + (f"?pin={pin}" if pin else "")
    with client.websocket_connect(url) as ws:
        message = ws.receive()
    return message.get("code")


def test_the_timer_socket_refuses_a_viewer(client, proxy_track):
    """The one path that changes who won without touching a mutation.

    This socket *is* the timer on a proxied track — whatever connects here
    reports the lane times that become a heat's result. The role policy guards
    GraphQL, and this is not GraphQL.
    """
    assert _timer_socket_close_code(client, proxy_track.id) == 4403


def test_the_timer_socket_refuses_check_in(client, proxy_track):
    """Registration has no business driving the timer."""
    assert _timer_socket_close_code(client, proxy_track.id, pin="2222") == 4403


def test_the_timer_socket_accepts_the_operator(client, proxy_track):
    """Refused for the *right* reason, not by accident: with the operator PIN
    the connection gets past the credential check and fails later, on the track
    having no manager registered in this test app."""
    assert _timer_socket_close_code(client, proxy_track.id, pin="1111") != 4403


def test_an_unsecured_install_leaves_the_timer_socket_open(client, db):
    """No PIN set is no enforcement, here as everywhere — a proxied timer must
    keep working through an upgrade that nobody has configured."""
    crud.create_group(db, schemas.GroupCreate(name="Open Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="T", lane_count=4, timer_type="AUTO_DETECT_PROXY"),
    )

    assert _timer_socket_close_code(client, track.id) != 4403


def test_a_viewer_cannot_assign_a_display(client, db):
    """The asymmetry #174 is built on.

    A screen holds no PIN and is a VIEWER. It registers by *subscribing* — the
    display is the thing being told — and it must not be able to tell anything
    else what to show. Anyone who could would be able to put the awards
    ceremony on the projector mid-heat.
    """
    crud.create_group(db, schemas.GroupCreate(name="Pack"))
    crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))
    _post(client, SET_CONFIG, {"config": _config(operatorPin="1234")})

    response = _post(
        client,
        """
        mutation Assign($id: String!) {
            assignDisplay(displayId: $id, view: PROJECTOR) { displayId }
        }
        """,
        {"id": "abc"},
    )

    body = response.json()
    assert "errors" in body, body
