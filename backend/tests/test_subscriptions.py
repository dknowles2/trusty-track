"""Tests for GraphQL subscriptions.

Tests that the raceStateChanged subscription receives events when mutations
that modify race data are executed.
"""

import asyncio
from typing import Any

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.pubsub import _PubSub
from backend.api.schema import RaceStateChangedEvent
from backend.db import crud, schemas
from backend.db.models import Base
from backend.tests.helpers import as_lanes

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_session():
    """Provide an in-memory SQLite session for each test.

    `StaticPool` pins every checkout to one connection — without it, a
    request driven through `client` (a real ASGI call, which may run on a
    different thread than the test) gets its own private `:memory:`
    database and finds none of the tables the fixture just created.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_race(db_session: Any) -> tuple[int, int]:
    """Seed a minimal race, track, racer, heat, and return (race_id, heat_id)."""
    from backend.db.models import (
        Group,
        Heat,
        Race,
        Racer,
        Round,
        SchedulingStrategy,
        Track,
    )

    group = Group(name="Test Pack")
    db_session.add(group)
    db_session.flush()

    track = Track(name="Track 1", lane_count=2, timer_type="FAKE")
    db_session.add(track)
    db_session.flush()

    race = Race(
        name="Test Race",
        group_id=group.id,
        track_id=track.id,
        car_numbering_strategy="MANUAL",
        scoring_strategy="TIMED",
        global_start_number=1,
        championship_trophies=3,
    )
    db_session.add(race)
    db_session.flush()

    racer = Racer(
        first_name="Alice",
        last_name="Smith",
        race_id=race.id,
        car_passed_inspection=False,
    )
    db_session.add(racer)
    db_session.flush()

    round_obj = Round(
        race_id=race.id,
        round_number=1,
        scheduling_strategy=SchedulingStrategy.PPC,
        name="Round 1",
    )
    db_session.add(round_obj)
    db_session.flush()

    heat = Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
    )
    db_session.add(heat)
    db_session.flush()
    crud.set_heat_lanes(
        heat, as_lanes([{"lane": 1, "racer_id": racer.id, "time": None, "place": None}])
    )
    db_session.commit()

    return race.id, heat.id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_race_state_changed_subscription_emits_event(db_session) -> None:
    """Subscription resolver emits an event after _publish_race_state is called.

    Tests the end-to-end flow: pubsub subscribe → _publish_race_state → event received.
    A real WebSocket transport test would require a running server; this unit test
    validates the pub/sub wiring that the subscription resolver depends on.
    """
    race_id, _heat_id = _seed_race(db_session)

    # Use a local pubsub so this test is isolated from the module singleton
    local_pubsub = _PubSub()
    import backend.api.schema as schema_mod

    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    collected: list[RaceStateChangedEvent] = []

    async def _subscribe_task() -> None:
        """Mirror what the resolver does: subscribe then collect one event."""
        async with local_pubsub.subscribe(f"race_state:{race_id}") as stream:
            async for event in stream:
                collected.append(event)
                break

    async def _publish_task() -> None:
        """Simulate a mutation calling _publish_race_state."""
        await asyncio.sleep(0.05)
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

    try:
        await asyncio.wait_for(
            asyncio.gather(_subscribe_task(), _publish_task()),
            timeout=2.0,
        )
    except asyncio.TimeoutError:
        pytest.fail("Subscription did not receive an event within 2 seconds")
    finally:
        schema_mod.pubsub = original_pubsub

    assert len(collected) == 1
    assert collected[0].race_id == race_id
    assert collected[0].changed_at  # non-empty ISO timestamp


@pytest.mark.anyio
async def test_publish_race_state_delivers_to_subscriber() -> None:
    """_publish_race_state broadcasts to pubsub subscribers on the correct channel."""
    from backend.api.schema import _publish_race_state

    local_pubsub = _PubSub()
    collected: list[RaceStateChangedEvent] = []

    async def _collector() -> None:
        """Collect one event from the local pubsub channel."""
        async with local_pubsub.subscribe("race_state:42") as stream:
            async for event in stream:
                collected.append(event)
                break

    # Patch the module-level pubsub temporarily
    import backend.api.schema as schema_mod

    original = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub
    try:
        collector_task = asyncio.create_task(_collector())
        await asyncio.sleep(0.01)  # Let collector subscribe
        await _publish_race_state(42)
        await asyncio.wait_for(collector_task, timeout=1.0)
    finally:
        schema_mod.pubsub = original

    assert len(collected) == 1
    assert collected[0].race_id == 42


@pytest.mark.anyio
async def test_pubsub_multiple_subscribers() -> None:
    """All subscribers on a channel receive the published payload."""
    local = _PubSub()
    results: list[str] = []

    async def _sub(name: str) -> None:
        async with local.subscribe("test_channel") as stream:
            async for payload in stream:
                results.append(f"{name}:{payload}")
                break

    tasks = [asyncio.create_task(_sub("a")), asyncio.create_task(_sub("b"))]
    await asyncio.sleep(0.01)
    await local.publish("test_channel", "hello")
    await asyncio.wait_for(asyncio.gather(*tasks), timeout=1.0)

    assert sorted(results) == ["a:hello", "b:hello"]


# ---------------------------------------------------------------------------
# racesChanged (#300) — the navigation's race list going stale in another tab
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_races_changed_subscription_forwards_the_signal() -> None:
    """The resolver itself, not a re-implementation of it, emits on a signal.

    `races_changed` takes no arguments, so — unlike every other subscription
    here — it can be driven directly rather than mirrored by hand.
    """
    from backend.api.schema import Subscription, _publish_races_list

    local_pubsub = _PubSub()
    import backend.api.schema as schema_mod

    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    collected: list[bool] = []

    async def _subscribe_task() -> None:
        async for value in Subscription().races_changed():
            collected.append(value)
            break

    async def _publish_task() -> None:
        await asyncio.sleep(0.05)
        await _publish_races_list()

    try:
        await asyncio.wait_for(
            asyncio.gather(_subscribe_task(), _publish_task()),
            timeout=2.0,
        )
    except asyncio.TimeoutError:
        pytest.fail("racesChanged did not receive a signal within 2 seconds")
    finally:
        schema_mod.pubsub = original_pubsub

    assert collected == [True]


def _spy_on_publish(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any]]:
    """Record every ``pubsub.publish`` call the mutation under test makes.

    Wraps the real method rather than replacing it, so every other publish a
    mutation makes (``race_state:<id>``) still reaches its own subscribers —
    a swapped-in fake `_PubSub`, as the tests above use, would also work but
    would mean building a second in-memory GraphQL request path instead of
    driving the real one through `client`.
    """
    import backend.api.schema as schema_mod

    calls: list[tuple[str, Any]] = []
    original_publish = schema_mod.pubsub.publish

    async def _spy(channel: str, payload: Any) -> None:
        calls.append((channel, payload))
        await original_publish(channel, payload)

    monkeypatch.setattr(schema_mod.pubsub, "publish", _spy)
    return calls


def _configure(db: Any) -> tuple[int, int]:
    """A group and a track — the state System Settings guarantees before a
    race can be created."""
    group = crud.create_group(db, schemas.GroupCreate(name="Nav Test Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Nav Test Track", lane_count=4)
    )
    return group.id, track.id


def test_create_race_publishes_races_changed(client, db, monkeypatch) -> None:
    """Without the signal, a race created in one tab never appears in another's
    navigation until it reloads (#300)."""
    from backend.api.schema import RACES_LIST_CHANNEL

    calls = _spy_on_publish(monkeypatch)
    group_id, track_id = _configure(db)

    mutation = f"""
    mutation {{
        createRace(
            race: {{name: "Nav Race", groupId: {group_id}, trackId: {track_id}}}
        ) {{
            id
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200
    assert response.json()["data"]["createRace"]["id"] is not None

    assert (RACES_LIST_CHANNEL, None) in calls


def test_create_practice_race_publishes_races_changed(client, db, monkeypatch) -> None:
    """Inserts a race the same as `createRace` (#361's lesson: it was missed
    once already, for the client-side cache update this signal mirrors)."""
    from backend.api.schema import RACES_LIST_CHANNEL

    calls = _spy_on_publish(monkeypatch)
    _configure(db)

    response = client.post(
        "/graphql", json={"query": "mutation { createPracticeRace { id } }"}
    )
    assert response.status_code == 200
    assert response.json()["data"]["createPracticeRace"]["id"] is not None

    assert (RACES_LIST_CHANNEL, None) in calls


def test_update_race_publishes_races_changed(client, db, monkeypatch) -> None:
    """A rename is exactly what the browser tab's title reads (#300)."""
    from backend.api.schema import RACES_LIST_CHANNEL

    group_id, track_id = _configure(db)
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Before", group_id=group_id, track_id=track_id),
    )

    calls = _spy_on_publish(monkeypatch)

    mutation = f"""
    mutation {{
        updateRace(id: {race.id}, race: {{name: "After"}}) {{
            id
            name
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200
    assert response.json()["data"]["updateRace"]["name"] == "After"

    assert (RACES_LIST_CHANNEL, None) in calls


def test_update_race_publishes_race_state_changed(client, db, monkeypatch) -> None:
    """`createRace` publishes RACE_SETTINGS on `race_state:{id}`, and so must
    `updateRace` — it is the mutation that actually changes the name,
    scoring_strategy, auto_advance_heat, championship_trophies and the
    weight limit (#319). Without it, an audience display's `leaderboard`
    subscription keeps showing standings computed under the old scoring
    strategy until the next heat result happens to fire the channel."""
    from backend.api.schema import RaceChangeKind

    group_id, track_id = _configure(db)
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Before", group_id=group_id, track_id=track_id),
    )

    calls = _spy_on_publish(monkeypatch)

    mutation = f"""
    mutation {{
        updateRace(id: {race.id}, race: {{scoringStrategy: "POINTS"}}) {{
            id
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200
    assert response.json()["data"]["updateRace"]["id"] == race.id

    race_state_events = [
        payload for channel, payload in calls if channel == f"race_state:{race.id}"
    ]
    assert len(race_state_events) == 1
    assert race_state_events[0].kind == RaceChangeKind.RACE_SETTINGS


def test_update_race_does_not_publish_for_a_missing_race(client, monkeypatch) -> None:
    """No race was actually changed, so no tab needs to hear about one."""
    calls = _spy_on_publish(monkeypatch)

    mutation = """
    mutation {
        updateRace(id: 999999, race: {name: "Nobody"}) {
            id
        }
    }
    """
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200
    assert response.json()["data"]["updateRace"] is None

    assert not any(channel == "races_list" for channel, _ in calls)


def test_delete_race_publishes_races_changed(client, db, monkeypatch) -> None:
    from backend.api.schema import RACES_LIST_CHANNEL

    group_id, track_id = _configure(db)
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Doomed", group_id=group_id, track_id=track_id),
    )

    calls = _spy_on_publish(monkeypatch)

    mutation = f"mutation {{ deleteRace(id: {race.id}) }}"
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200
    assert response.json()["data"]["deleteRace"] is True

    assert (RACES_LIST_CHANNEL, None) in calls
