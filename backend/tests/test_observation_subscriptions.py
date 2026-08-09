"""Tests for Observation GraphQL subscriptions.

Verifies that the new observation subscriptions (leaderboard, on_deck,
currently_racing, timing_stats, heats) emit the expected data.
"""

import asyncio
from typing import Any

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.api.pubsub import _PubSub
from backend.api.schema import Subscription
from backend.db import crud
from backend.db.models import (
    Base,
    Group,
    Heat,
    Race,
    Racer,
    Round,
    SchedulingStrategy,
    Track,
)
from backend.domain import audit
from backend.tests.helpers import as_lanes


@pytest.fixture()
def db_session():
    """Provide an in-memory SQLite session for each test."""
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


def _seed_race(db_session: Any) -> tuple[int, int, int]:
    """Seed a race with two racers and two heats.

    Returns (race_id, heat1_id, heat2_id).
    """
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

    r1 = Racer(
        first_name="Alice", last_name="A", race_id=race.id, car_passed_inspection=True
    )
    r2 = Racer(
        first_name="Bob", last_name="B", race_id=race.id, car_passed_inspection=True
    )
    db_session.add_all([r1, r2])
    db_session.flush()

    round_obj = Round(
        race_id=race.id,
        round_number=1,
        scheduling_strategy=SchedulingStrategy.PPC,
        name="Round 1",
    )
    db_session.add(round_obj)
    db_session.flush()

    h1 = Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
    h2 = Heat(race_id=race.id, round_id=round_obj.id, heat_number=2)
    db_session.add_all([h1, h2])
    db_session.flush()
    for heat, racer in ((h1, r1), (h2, r2)):
        crud.set_heat_lanes(
            heat,
            as_lanes([{"lane": 1, "racer_id": racer.id, "time": None, "place": None}]),
        )
    db_session.commit()

    return race.id, h1.id, h2.id


@pytest.mark.anyio
async def test_leaderboard_subscription(db_session) -> None:
    race_id, h1_id, _ = _seed_race(db_session)
    local_pubsub = _PubSub()
    import backend.api.schema as schema_mod

    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    class MockInfo:
        context = {"db": db_session}

    collected = []

    async def _sub():
        async for result in Subscription().leaderboard(MockInfo(), race_id):
            collected.append(result)
            if len(collected) == 2:
                break

    async def _trigger():
        await asyncio.sleep(0.1)
        # Record result for h1
        from backend.db.crud import record_heat_result

        record_heat_result(
            db_session,
            h1_id,
            as_lanes([{"lane": 1, "racer_id": 1, "time": 3.5, "place": 1}]),
            source=audit.ResultSource.OPERATOR,
        )
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

    try:
        await asyncio.wait_for(asyncio.gather(_sub(), _trigger()), timeout=2.0)
    finally:
        schema_mod.pubsub = original_pubsub

    assert len(collected) == 2
    # First yield is empty leaderboard or initial state
    # Second yield should have the updated score
    assert any(entry.score > 0 for entry in collected[1])


@pytest.mark.anyio
async def test_on_deck_subscription(db_session) -> None:
    race_id, h1_id, h2_id = _seed_race(db_session)
    local_pubsub = _PubSub()
    import backend.api.schema as schema_mod

    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    class MockInfo:
        context = {"db": db_session}

    collected = []

    async def _sub():
        async for result in Subscription().on_deck(MockInfo(), race_id):
            collected.append(result)
            if len(collected) == 2:
                break

    async def _trigger():
        await asyncio.sleep(0.1)
        # Record result for h1, making h2 "current" and the one after h2
        # (none) "on deck"
        from backend.db.crud import record_heat_result

        record_heat_result(
            db_session,
            h1_id,
            as_lanes([{"lane": 1, "racer_id": 1, "time": 3.5, "place": 1}]),
            source=audit.ResultSource.OPERATOR,
        )
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

    try:
        await asyncio.wait_for(asyncio.gather(_sub(), _trigger()), timeout=2.0)
    finally:
        schema_mod.pubsub = original_pubsub

    assert len(collected) == 2
    # The heats, not their racers (#141) — the lane a car is in is part of the
    # answer, and a racer list cannot carry it. A list of them since #209, so
    # a display can name two heats and give a family a heat's notice.
    # Initially h1 is current, h2 is on deck.
    assert [heat.id for heat in collected[0]] == [h2_id]
    # After h1 is done, h2 is current and nothing is on deck.
    assert collected[1] == []


@pytest.mark.anyio
async def test_currently_racing_subscription(db_session) -> None:
    race_id, h1_id, h2_id = _seed_race(db_session)
    local_pubsub = _PubSub()
    import backend.api.schema as schema_mod

    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    class MockInfo:
        context = {"db": db_session}

    collected = []

    async def _sub():
        async for result in Subscription().currently_racing(MockInfo(), race_id):
            collected.append(result)
            if len(collected) == 2:
                break

    async def _trigger():
        await asyncio.sleep(0.1)
        from backend.db.crud import record_heat_result

        record_heat_result(
            db_session,
            h1_id,
            as_lanes([{"lane": 1, "racer_id": 1, "time": 3.5, "place": 1}]),
            source=audit.ResultSource.OPERATOR,
        )
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

    try:
        await asyncio.wait_for(asyncio.gather(_sub(), _trigger()), timeout=2.0)
    finally:
        schema_mod.pubsub = original_pubsub

    assert len(collected) == 2
    assert collected[0].id == h1_id
    assert collected[1].id == h2_id


@pytest.mark.anyio
async def test_timing_stats_subscription(db_session) -> None:
    race_id, h1_id, _ = _seed_race(db_session)
    local_pubsub = _PubSub()
    import backend.api.schema as schema_mod

    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    class MockInfo:
        context = {"db": db_session}

    collected = []

    async def _sub():
        async for result in Subscription().timing_stats(MockInfo(), race_id):
            collected.append(result)
            if len(collected) == 2:
                break

    async def _trigger():
        await asyncio.sleep(0.1)
        from backend.db.crud import record_heat_result

        record_heat_result(
            db_session,
            h1_id,
            as_lanes([{"lane": 1, "racer_id": 1, "time": 3.555, "place": 1}]),
            source=audit.ResultSource.OPERATOR,
        )
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

    try:
        await asyncio.wait_for(asyncio.gather(_sub(), _trigger()), timeout=2.0)
    finally:
        schema_mod.pubsub = original_pubsub

    assert len(collected) == 2
    assert collected[0] is None
    assert collected[1] is not None
    assert collected[1].heat_id == h1_id
    assert collected[1].lanes[0].time == 3.555


@pytest.mark.anyio
async def test_heats_subscription(db_session) -> None:
    race_id, _, _ = _seed_race(db_session)
    local_pubsub = _PubSub()
    import backend.api.schema as schema_mod

    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub

    class MockInfo:
        context = {"db": db_session}

    collected = []

    async def _sub():
        async for result in Subscription().heats(MockInfo(), race_id):
            collected.append(result)
            if len(collected) == 2:
                break

    async def _trigger():
        await asyncio.sleep(0.1)
        from backend.api.schema import _publish_race_state

        await _publish_race_state(race_id)

    try:
        await asyncio.wait_for(asyncio.gather(_sub(), _trigger()), timeout=2.0)
    finally:
        schema_mod.pubsub = original_pubsub

    assert len(collected) == 2
    assert len(collected[0]) == 1  # One round
    assert len(collected[0][0].heats) == 2
