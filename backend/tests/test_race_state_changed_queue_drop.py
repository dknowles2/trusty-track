"""Reachability check for #896: does `raceStateChanged`'s bounded queue ever
actually drop a mergeable update in a way nothing else repairs?

`api/pubsub.py`'s `MAX_QUEUE_SIZE` bound assumes every payload is a full
snapshot of the channel's current state, so a subscriber that misses several
and receives only the newest is still correct. `raceStateChanged` breaks that
assumption: it forwards its `RaceStateChangedEvent` payload directly, and the
frontend's normalized cache merges a `HEAT_RESULT`/`RACER` payload's nested
entity straight in rather than treating it as disposable (`useRaceStateChanged
.ts`'s `MERGEABLE_KINDS`). If eight of those pile up behind a subscriber that
has fallen behind, drop-oldest discards genuine, irreplaceable per-entity
diffs — and unlike `display_assignment` (#881), there was no reported failure
to anchor this on, so this test exists to settle whether it is reachable
before anything is changed.

Two tests. The first drives a bare `_PubSub` at its ordinary default against a
stalled consumer (one that simply does not call `__anext__` while publishes
pile up, standing in for a subscriber whose `websocket.send()` is stalled on a
slow venue-wifi link, per `liveConnection.ts`'s own reasoning for why a socket
can go quiet without closing) with real `RaceStateChangedEvent` payloads. It
proves the drop is real and, because every published event here is
independently a `RACER` kind (mergeable, so `shouldRefetch` never fires), that
nothing self-heals it — the self-healing the issue describes only helps when a
later, non-mergeable event happens to arrive on the same channel. The second
drives the actual `Subscription.race_state_changed` resolver the same way, and
is the regression test proper: it fails on the code as filed (default bound)
and passes once that resolver opts its own queue out of drop-oldest.
"""

import asyncio
from typing import Any

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.pubsub import MAX_QUEUE_SIZE, _PubSub
from backend.api.schema import RaceChangeKind, Subscription, _publish_race_state
from backend.db.models import Base, Organization, Race, Racer, Track


@pytest.fixture()
def db_session():
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


def _seed_race_with_racers(db: Any, count: int) -> tuple[int, list[Racer]]:
    org = Organization(name="Test Pack")
    db.add(org)
    db.flush()

    track = Track(name="Track 1", lane_count=2, timer_type="FAKE")
    db.add(track)
    db.flush()

    race = Race(
        name="Test Race",
        organization_id=org.id,
        track_id=track.id,
        car_numbering_strategy="MANUAL",
        scoring_strategy="TIMED",
        global_start_number=1,
        championship_trophies=3,
    )
    db.add(race)
    db.flush()

    racers = []
    for i in range(count):
        racer = Racer(
            first_name=f"Racer{i}",
            last_name="Smith",
            race_id=race.id,
            car_passed_inspection=False,
        )
        db.add(racer)
        racers.append(racer)
    db.flush()
    db.commit()

    return race.id, racers


@pytest.mark.anyio
async def test_the_default_bound_drops_a_mergeable_update_with_no_self_heal(
    db_session,
) -> None:
    """The mechanical case for #896, independent of whichever way
    `race_state_changed` itself is currently wired.

    Subscribes to `race_state:{race_id}` at the *ordinary* default — the
    same bound every one of that channel's other subscribers keeps, and the
    one `race_state_changed` used to keep before it was given its own
    opt-out below. Publish more `RACER` (mergeable) events for one race than
    the subscriber ever reads before the first is even delivered — the
    shape of a websocket `send()` stalled on a bad connection while several
    quick racer updates land (a busy check-in desk during the same window a
    wall display's link is degraded) — then drain it. Some early racer ids
    never arrive at all, and because every event here is `RACER`, none of
    them is a kind `shouldRefetch` would treat as needing a fresh read, so
    nothing about this run ever repairs the gap.
    """
    published_count = MAX_QUEUE_SIZE + 5
    race_id, racers = _seed_race_with_racers(db_session, published_count)

    bus = _PubSub()

    async def _publish(racer: Racer) -> None:
        # `_publish_race_state` always publishes through `schema.pubsub`;
        # building the event by hand keeps this test decoupled from that
        # module-level singleton and from `race_state_changed`'s own
        # `pubsub.subscribe` call, whatever it currently opts into.
        from backend.api.schema import RaceStateChangedEvent, _RacerSnapshot

        await bus.publish(
            f"race_state:{race_id}",
            RaceStateChangedEvent(
                race_id=race_id,
                changed_at="2026-01-01T00:00:00+00:00",
                kind=RaceChangeKind.RACER,
                heat=None,
                racer=_RacerSnapshot(racer),
                round_id=None,
                intermission=None,
            ),
        )

    async with bus.subscribe(f"race_state:{race_id}") as stream:
        # No `await` between subscribing and publishing that would let the
        # subscriber drain anything — the ordinary default queue only ever
        # holds the newest `MAX_QUEUE_SIZE` entries, so reaching that count
        # here suffices to force the drop without needing a real stalled
        # socket.
        for racer in racers:
            await _publish(racer)

        received = [
            await asyncio.wait_for(stream.__anext__(), timeout=2.0)
            for _ in range(MAX_QUEUE_SIZE)
        ]

    received_racer_ids = {event.racer.id for event in received if event.racer}
    published_racer_ids = {racer.id for racer in racers}

    # This is the reachable defect: with drop-oldest, the queue only ever
    # held the newest MAX_QUEUE_SIZE entries, so the earliest racer updates
    # are gone — not merely delayed.
    missing = published_racer_ids - received_racer_ids
    assert missing, "expected some racer updates to be dropped by drop-oldest"

    # And confirm the self-heal the issue describes does not apply here:
    # every delivered event is still RACER (mergeable), so a client using
    # `shouldRefetch` would never have refetched to repair the gap.
    assert all(event.kind == RaceChangeKind.RACER for event in received)


@pytest.mark.anyio
async def test_race_state_changed_resolver_keeps_every_mergeable_update(
    db_session,
) -> None:
    """The fix: `Subscription.race_state_changed` itself opts its own queue
    out of drop-oldest, so a subscriber that falls exactly as far behind as
    the test above loses nothing. Drives the real resolver, not a
    hand-rolled stand-in, so a revert of the `drop_oldest_when_full=False`
    argument on its `pubsub.subscribe` call fails this test directly.
    """
    import backend.api.schema as schema_mod

    local_pubsub = _PubSub()
    original_pubsub = schema_mod.pubsub
    schema_mod.pubsub = local_pubsub
    try:
        published_count = MAX_QUEUE_SIZE + 5
        race_id, racers = _seed_race_with_racers(db_session, published_count)

        gen = Subscription().race_state_changed(race_id)
        first_task = asyncio.create_task(gen.__anext__())
        await asyncio.sleep(0)

        for racer in racers:
            await _publish_race_state(race_id, kind=RaceChangeKind.RACER, racer=racer)

        received = [await asyncio.wait_for(first_task, timeout=2.0)]
        for _ in range(published_count - 1):
            received.append(await asyncio.wait_for(gen.__anext__(), timeout=2.0))

        received_racer_ids = {event.racer.id for event in received if event.racer}
        published_racer_ids = {racer.id for racer in racers}
        assert received_racer_ids == published_racer_ids
    finally:
        schema_mod.pubsub = original_pubsub
        await gen.aclose()
