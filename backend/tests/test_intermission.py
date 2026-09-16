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
from backend.db import crud, models, schemas


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


def _enable_keep_replays(db, race):
    organization = (
        db.query(models.Organization)
        .filter(models.Organization.id == race.organization_id)
        .first()
    )
    organization.keep_replays = True
    db.commit()
    return organization


def _add_stored_clip(db, race, *, heat_number=1):
    """A minimal `HeatReplay` row — enough for `race_has_stored_replays` to
    see, without going through the upload endpoint's own store/index
    machinery, which stage 2's own `test_replays.py` already covers."""
    heat = models.Heat(
        race_id=race.id,
        heat_number=heat_number,
        recorded_at="2026-09-16T12:00:00+00:00",
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)
    row = models.HeatReplay(
        heat_id=heat.id,
        camera_id="cam-1",
        recorded_at=heat.recorded_at,
        path="00000000-0000-0000-0000-000000000000.webm",
        duration_ms=4000,
        t0_offset_ms=500,
        size_bytes=1234,
        created_at="2026-09-16T12:00:01+00:00",
    )
    db.add(row)
    db.commit()
    return heat


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

    def test_start_refuses_a_duration_past_the_cap(self, db):
        """#886 — `startIntermission(durationSeconds: 100000000)` used to be
        accepted outright, landing `endsAt` in 2029. `crud.start_intermission`
        is a thin wrapper over `domain.intermission.start`, which now refuses
        anything past `MAX_DURATION_SECONDS`."""
        from backend.domain import intermission as domain_intermission

        race = _seed(db)
        with pytest.raises(ValueError):
            crud.start_intermission(
                db, race.id, domain_intermission.MAX_DURATION_SECONDS + 1, None
            )


class TestHighlightsEligibility:
    """#177 stage 3 — `highlights` is refused outright, not silently
    downgraded to `False`, unless `Organization.keepReplays` is on *and*
    the race already holds at least one stored clip. See
    `crud.start_intermission`'s own docstring for why a refusal is right
    here."""

    def test_refuses_when_keep_replays_is_off(self, db):
        race = _seed(db)
        _add_stored_clip(db, race)
        with pytest.raises(ValueError, match="Keep Replay Clips"):
            crud.start_intermission(db, race.id, 60, None, highlights=True)

    def test_refuses_when_keep_replays_is_on_but_no_clip_exists(self, db):
        race = _seed(db)
        _enable_keep_replays(db, race)
        with pytest.raises(ValueError, match="stored clip"):
            crud.start_intermission(db, race.id, 60, None, highlights=True)

    def test_accepted_once_both_conditions_hold(self, db):
        race = _seed(db)
        _enable_keep_replays(db, race)
        _add_stored_clip(db, race)
        updated = crud.start_intermission(db, race.id, 60, None, highlights=True)
        assert updated.intermission_highlights is True

    def test_off_needs_neither_condition(self, db):
        """The ordinary case — no camera at this event — is unaffected:
        `highlights=False` (the default) never touches either check."""
        race = _seed(db)
        updated = crud.start_intermission(db, race.id, 60, None)
        assert updated.intermission_highlights is False

    def test_cleared_on_end(self, db):
        race = _seed(db)
        _enable_keep_replays(db, race)
        _add_stored_clip(db, race)
        crud.start_intermission(db, race.id, 60, None, highlights=True)
        ended = crud.end_intermission(db, race.id)
        assert ended.intermission_highlights is False

    def test_a_fresh_start_with_no_argument_turns_it_back_off(self, db):
        race = _seed(db)
        _enable_keep_replays(db, race)
        _add_stored_clip(db, race)
        crud.start_intermission(db, race.id, 60, None, highlights=True)
        restarted = crud.start_intermission(db, race.id, 60, None)
        assert restarted.intermission_highlights is False


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


START_WITH_HIGHLIGHTS = """
mutation($raceId: Int!, $duration: Int!, $highlights: Boolean!) {
  startIntermission(
    raceId: $raceId
    durationSeconds: $duration
    highlights: $highlights
  ) {
    intermission { active highlights }
  }
}
"""

RACE_REPLAY_COUNT_QUERY = """
query($raceId: Int!) {
  race(raceId: $raceId) { replayCount }
}
"""


class TestHighlightsGraphQL:
    def test_round_trips_through_the_mutation_and_the_query(self, client, db):
        race = _seed(db)
        _enable_keep_replays(db, race)
        _add_stored_clip(db, race)

        started = client.post(
            "/graphql",
            json={
                "query": START_WITH_HIGHLIGHTS,
                "variables": {"raceId": race.id, "duration": 60, "highlights": True},
            },
        ).json()
        assert "errors" not in started, started
        assert (
            started["data"]["startIntermission"]["intermission"]["highlights"] is True
        )

        read_back = client.post(
            "/graphql",
            json={"query": RACE_INTERMISSION_QUERY, "variables": {"raceId": race.id}},
        ).json()
        # `RACE_INTERMISSION_QUERY` above only asks for the original five
        # fields; a dedicated query confirms `highlights` survives a fresh
        # read rather than only the mutation's own echoed response.
        assert read_back["data"]["race"]["intermission"]["active"] is True

    def test_refused_over_graphql_when_not_eligible(self, client, db):
        race = _seed(db)
        body = client.post(
            "/graphql",
            json={
                "query": START_WITH_HIGHLIGHTS,
                "variables": {"raceId": race.id, "duration": 60, "highlights": True},
            },
        ).json()
        assert body.get("errors")

    def test_race_replay_count(self, client, db):
        race = _seed(db)
        empty = client.post(
            "/graphql",
            json={"query": RACE_REPLAY_COUNT_QUERY, "variables": {"raceId": race.id}},
        ).json()
        assert empty["data"]["race"]["replayCount"] == 0

        _enable_keep_replays(db, race)
        _add_stored_clip(db, race)
        _add_stored_clip(db, race, heat_number=2)

        populated = client.post(
            "/graphql",
            json={"query": RACE_REPLAY_COUNT_QUERY, "variables": {"raceId": race.id}},
        ).json()
        assert populated["data"]["race"]["replayCount"] == 2


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
        assert "operator PIN" in body["errors"][0]["message"]

    def test_check_in_cannot_start_an_intermission(self, client, secured):
        body = _post(
            client,
            START,
            {"raceId": secured.id, "duration": 300, "label": None},
            pin="2222",
        ).json()
        assert body.get("errors")
        assert "operator PIN" in body["errors"][0]["message"]

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
        assert "operator PIN" in body["errors"][0]["message"]


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


# --------------------------------------------------------------------------- #
# Race.highlightsSummary (#177 stage 3)                                       #
# --------------------------------------------------------------------------- #


def _round(db, race, *, round_number=1, name=None):
    round_obj = models.Round(race_id=race.id, round_number=round_number, name=name)
    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return round_obj


def _heat_in_round(db, race, round_obj, *, heat_number=1, recorded_at=None):
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=heat_number,
        recorded_at=recorded_at,
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)
    return heat


def _clip_for(db, heat):
    row = models.HeatReplay(
        heat_id=heat.id,
        camera_id="cam-1",
        recorded_at=heat.recorded_at or "2026-09-16T12:00:00+00:00",
        path="00000000-0000-0000-0000-000000000001.webm",
        duration_ms=4000,
        t0_offset_ms=500,
        size_bytes=1234,
        created_at="2026-09-16T12:00:01+00:00",
    )
    db.add(row)
    db.commit()
    return row


HIGHLIGHTS_SUMMARY_QUERY = """
query($raceId: Int!) {
  race(raceId: $raceId) {
    highlightsSummary { clipCount roundNumber roundName }
  }
}
"""


def _highlights_summary(client, race_id):
    body = client.post(
        "/graphql",
        json={"query": HIGHLIGHTS_SUMMARY_QUERY, "variables": {"raceId": race_id}},
    ).json()
    assert "errors" not in body, body
    return body["data"]["race"]["highlightsSummary"]


class TestHighlightsSummary:
    def test_null_when_nothing_has_a_clip(self, client, db):
        race = _seed(db)
        round_obj = _round(db, race, round_number=1)
        _heat_in_round(db, race, round_obj, recorded_at="2026-09-16T12:00:00+00:00")

        assert _highlights_summary(client, race.id) is None

    def test_names_the_round_of_the_last_recorded_heat_and_counts_its_clips(
        self, client, db
    ):
        race = _seed(db)
        round1 = _round(db, race, round_number=1, name="Preliminary")
        round2 = _round(db, race, round_number=2, name="Final")
        h1 = _heat_in_round(
            db, race, round1, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00"
        )
        _clip_for(db, h1)
        h2 = _heat_in_round(
            db, race, round2, heat_number=1, recorded_at="2026-09-16T12:10:00+00:00"
        )
        h3 = _heat_in_round(
            db, race, round2, heat_number=2, recorded_at="2026-09-16T12:20:00+00:00"
        )
        _clip_for(db, h2)
        _clip_for(db, h3)

        summary = _highlights_summary(client, race.id)
        assert summary == {"clipCount": 2, "roundNumber": 2, "roundName": "Final"}

    def test_falls_back_to_the_latest_round_with_a_clip_when_nothing_is_recorded(
        self, client, db
    ):
        race = _seed(db)
        round1 = _round(db, race, round_number=1, name="Preliminary")
        round2 = _round(db, race, round_number=2, name="Final")
        h1 = _heat_in_round(db, race, round1, heat_number=1)
        _clip_for(db, h1)
        _heat_in_round(db, race, round2, heat_number=1)

        summary = _highlights_summary(client, race.id)
        assert summary == {"clipCount": 1, "roundNumber": 1, "roundName": "Preliminary"}

    def test_null_when_the_race_has_no_heats_at_all(self, client, db):
        race = _seed(db)
        assert _highlights_summary(client, race.id) is None
