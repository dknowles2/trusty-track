"""Intermissions, wired end to end (#592).

Complements `test_domain_intermission.py` (the pure rule, no database) with
`crud`'s five thin wrappers, the GraphQL mutations, the operator-only role
policy, and the `race_state:{race_id}` publish — the display's own leash,
carrying the resolved state directly rather than a bare "something changed".
"""

import asyncio

import pytest

from backend.api import auth
from backend.api import schema as schema_module
from backend.api.pubsub import pubsub
from backend.api.schema import RaceChangeKind
from backend.db import crud, schemas


def _seed(db):
    org = crud.create_organization(
        db, schemas.OrganizationCreate(name="Intermission Pack")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name="Intermission Track", lane_count=4)
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Intermission Race", organization_id=org.id, track_id=track.id
        ),
    )


# --------------------------------------------------------------------------- #
# crud                                                                         #
# --------------------------------------------------------------------------- #


class TestCrud:
    def test_start_sets_the_columns(self, db):
        race = _seed(db)
        updated = crud.start_intermission(db, race.id, 300, "Snack break")
        assert updated.intermission_ends_at is not None
        assert updated.intermission_paused_remaining_seconds is None
        assert updated.intermission_label == "Snack break"

    def test_pause_then_resume_round_trips(self, db):
        race = _seed(db)
        crud.start_intermission(db, race.id, 300, "Break")
        paused = crud.pause_intermission(db, race.id)
        assert paused.intermission_ends_at is None
        assert paused.intermission_paused_remaining_seconds is not None

        resumed = crud.resume_intermission(db, race.id)
        assert resumed.intermission_ends_at is not None
        assert resumed.intermission_paused_remaining_seconds is None

    def test_extend_adds_time(self, db):
        race = _seed(db)
        crud.start_intermission(db, race.id, 60, None)
        before = db.get(type(race), race.id).intermission_ends_at
        extended = crud.extend_intermission(db, race.id, 300)
        assert extended.intermission_ends_at != before

    def test_end_clears_everything(self, db):
        race = _seed(db)
        crud.start_intermission(db, race.id, 60, "Break")
        ended = crud.end_intermission(db, race.id)
        assert ended.intermission_ends_at is None
        assert ended.intermission_paused_remaining_seconds is None
        assert ended.intermission_label is None

    def test_extend_refuses_with_nothing_active(self, db):
        race = _seed(db)
        with pytest.raises(ValueError):
            crud.extend_intermission(db, race.id, 60)

    def test_unknown_race_raises(self, db):
        with pytest.raises(ValueError):
            crud.start_intermission(db, 999999, 60, None)


# --------------------------------------------------------------------------- #
# GraphQL, end to end                                                         #
# --------------------------------------------------------------------------- #

START = """
mutation($raceId: Int!, $duration: Int!, $label: String) {
  startIntermission(raceId: $raceId, durationSeconds: $duration, label: $label) {
    id
    intermission { active remainingSeconds paused label endsAt }
  }
}
"""

EXTEND = """
mutation($raceId: Int!, $seconds: Int!) {
  extendIntermission(raceId: $raceId, seconds: $seconds) {
    intermission { remainingSeconds }
  }
}
"""

PAUSE = """
mutation($raceId: Int!) {
  pauseIntermission(raceId: $raceId) { intermission { paused remainingSeconds } }
}
"""

RESUME = """
mutation($raceId: Int!) {
  resumeIntermission(raceId: $raceId) { intermission { paused active } }
}
"""

END = """
mutation($raceId: Int!) {
  endIntermission(raceId: $raceId) { intermission { active } }
}
"""

RACE_INTERMISSION_QUERY = """
query($raceId: Int!) {
  race(raceId: $raceId) {
    intermission { active remainingSeconds paused label endsAt }
  }
}
"""


class TestGraphQLMutations:
    def test_start_reports_the_resolved_state(self, client, db):
        race = _seed(db)
        body = client.post(
            "/graphql",
            json={
                "query": START,
                "variables": {"raceId": race.id, "duration": 300, "label": "Snacks"},
            },
        ).json()
        assert "errors" not in body, body
        intermission = body["data"]["startIntermission"]["intermission"]
        assert intermission["active"] is True
        assert intermission["paused"] is False
        assert intermission["label"] == "Snacks"
        assert 295 <= intermission["remainingSeconds"] <= 300
        assert intermission["endsAt"] is not None

    def test_race_query_reads_it_back(self, client, db):
        race = _seed(db)
        client.post(
            "/graphql",
            json={
                "query": START,
                "variables": {"raceId": race.id, "duration": 60, "label": None},
            },
        )
        body = client.post(
            "/graphql",
            json={"query": RACE_INTERMISSION_QUERY, "variables": {"raceId": race.id}},
        ).json()
        assert body["data"]["race"]["intermission"]["active"] is True

    def test_pause_and_resume_round_trip(self, client, db):
        race = _seed(db)
        client.post(
            "/graphql",
            json={
                "query": START,
                "variables": {"raceId": race.id, "duration": 300, "label": None},
            },
        )
        paused = client.post(
            "/graphql", json={"query": PAUSE, "variables": {"raceId": race.id}}
        ).json()
        assert paused["data"]["pauseIntermission"]["intermission"]["paused"] is True

        resumed = client.post(
            "/graphql", json={"query": RESUME, "variables": {"raceId": race.id}}
        ).json()
        resumed_intermission = resumed["data"]["resumeIntermission"]["intermission"]
        assert resumed_intermission["paused"] is False
        assert resumed_intermission["active"] is True

    def test_extend_adds_time(self, client, db):
        race = _seed(db)
        client.post(
            "/graphql",
            json={
                "query": START,
                "variables": {"raceId": race.id, "duration": 60, "label": None},
            },
        )
        body = client.post(
            "/graphql",
            json={"query": EXTEND, "variables": {"raceId": race.id, "seconds": 300}},
        ).json()
        remaining = body["data"]["extendIntermission"]["intermission"][
            "remainingSeconds"
        ]
        assert 355 <= remaining <= 360

    def test_end_deactivates(self, client, db):
        race = _seed(db)
        client.post(
            "/graphql",
            json={
                "query": START,
                "variables": {"raceId": race.id, "duration": 60, "label": None},
            },
        )
        body = client.post(
            "/graphql", json={"query": END, "variables": {"raceId": race.id}}
        ).json()
        assert body["data"]["endIntermission"]["intermission"]["active"] is False

    def test_extend_with_nothing_active_is_a_graphql_error(self, client, db):
        race = _seed(db)
        body = client.post(
            "/graphql",
            json={"query": EXTEND, "variables": {"raceId": race.id, "seconds": 60}},
        ).json()
        assert body.get("errors"), "extending nothing should be refused"


# --------------------------------------------------------------------------- #
# Roles (#15)                                                                  #
# --------------------------------------------------------------------------- #


@pytest.fixture
def secured(db):
    """A configured install with both PINs set, so enforcement is on."""
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="Secured Pack")
    )
    group.operator_pin_hash = auth.hash_pin("1111")
    group.checkin_pin_hash = auth.hash_pin("2222")
    db.commit()
    track = crud.create_track(db, schemas.TrackCreate(name="Track", lane_count=4))
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Secured Race",
            organization_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )


def _post(client, query, variables=None, pin=None):
    headers = {auth.PIN_HEADER: pin} if pin else {}
    return client.post(
        "/graphql", json={"query": query, "variables": variables or {}}, headers=headers
    )


class TestRoles:
    def test_a_viewer_cannot_start_an_intermission(self, client, secured):
        body = _post(
            client, START, {"raceId": secured.id, "duration": 300, "label": None}
        ).json()
        assert body.get("errors")
        assert "VIEWER is not allowed" in body["errors"][0]["message"]

    def test_check_in_cannot_start_an_intermission(self, client, secured):
        body = _post(
            client,
            START,
            {"raceId": secured.id, "duration": 300, "label": None},
            pin="2222",
        ).json()
        assert body.get("errors")
        assert "CHECKIN is not allowed" in body["errors"][0]["message"]

    def test_the_operator_can_start_one(self, client, secured):
        body = _post(
            client,
            START,
            {"raceId": secured.id, "duration": 300, "label": "Break"},
            pin="1111",
        ).json()
        assert "errors" not in body, body

    def test_a_viewer_cannot_end_one(self, client, db, secured):
        crud.start_intermission(db, secured.id, 300, None)
        body = _post(client, END, {"raceId": secured.id}).json()
        assert body.get("errors")
        assert "VIEWER is not allowed" in body["errors"][0]["message"]


# --------------------------------------------------------------------------- #
# Publish — the display's own leash                                           #
# --------------------------------------------------------------------------- #


async def _capture(race_id, action, expected=1):
    received = []
    ready = asyncio.Event()

    async def listen():
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            ready.set()
            async for event in stream:
                received.append(event)
                if len(received) >= expected:
                    return

    task = asyncio.create_task(listen())
    await ready.wait()
    await action()
    try:
        await asyncio.wait_for(task, timeout=2)
    except asyncio.TimeoutError:  # pragma: no cover - only on failure
        task.cancel()
    return received


@pytest.mark.anyio
async def test_starting_publishes_the_resolved_state_on_the_race_channel(db):
    """No new pub/sub channel: this rides `race_state:{race_id}`, the same
    one every other race-level change already publishes on, so a display
    holding the subscription it already has learns of the break."""
    race = _seed(db)

    async def act():
        crud.start_intermission(db, race.id, 300, "Snack break")
        await schema_module._publish_race_state(
            race.id,
            kind=RaceChangeKind.INTERMISSION,
            intermission_race=race,
        )

    events = await _capture(race.id, act)
    assert len(events) == 1
    event = events[0]
    assert event.kind is RaceChangeKind.INTERMISSION
    assert event.intermission is not None
    assert event.intermission.active is True
    assert event.intermission.label == "Snack break"
    assert 295 <= event.intermission.remaining_seconds <= 300
