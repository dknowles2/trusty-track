"""Tests for GraphQL subscriptions.

Tests that the raceStateChanged subscription receives events when mutations
that modify race data are executed.
"""

import asyncio
from typing import Any

import pytest
import strawberry
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .models import Base
from .schema import Mutation, Query, RaceStateChangedEvent, Subscription
from .pubsub import _PubSub


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_session():
    """Provide an in-memory SQLite session for each test."""
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def test_schema():
    """Return the full strawberry schema with subscriptions."""
    return strawberry.Schema(
        query=Query, mutation=Mutation, subscription=Subscription
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_race(db_session: Any) -> tuple[int, int]:
    """Seed a minimal race, track, racer, heat, and return (race_id, heat_id)."""
    from .models import Group, Race, Track, Racer, Round, Heat, SchedulingStrategy

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

    import json

    heat = Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [{"lane": 1, "racer_id": racer.id, "time": None, "place": None}]
        ),
    )
    db_session.add(heat)
    db_session.commit()

    return race.id, heat.id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_race_state_changed_subscription_emits_event(
    db_session, test_schema
) -> None:
    """Subscription resolver emits an event after _publish_race_state is called.

    Tests the end-to-end flow: pubsub subscribe → _publish_race_state → event received.
    A real WebSocket transport test would require a running server; this unit test
    validates the pub/sub wiring that the subscription resolver depends on.
    """
    race_id, _heat_id = _seed_race(db_session)

    # Use a local pubsub so this test is isolated from the module singleton
    local_pubsub = _PubSub()
    import backend.schema as schema_mod

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
        from .schema import _publish_race_state
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
async def test_publish_race_state_delivers_to_subscriber(db_session) -> None:
    """_publish_race_state broadcasts to pubsub subscribers on the correct channel."""
    from .schema import _publish_race_state

    local_pubsub = _PubSub()
    collected: list[RaceStateChangedEvent] = []

    async def _collector() -> None:
        """Collect one event from the local pubsub channel."""
        async with local_pubsub.subscribe("race_state:42") as stream:
            async for event in stream:
                collected.append(event)
                break

    # Patch the module-level pubsub temporarily
    import backend.schema as schema_mod

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
