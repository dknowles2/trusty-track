"""A subscriber's queue is bounded, and a full one drops its oldest entry.

`_PubSub.publish` used to hand every subscriber a plain `asyncio.Queue()` with
no maximum. A consumer that stalls — a half-open connection in the window
before `liveConnection.ts`'s ping watchdog closes it, or a slow tablet under
load — kept every published event in memory for as long as the stall lasted.

That is safe to fix because every payload published here is a full snapshot
of the channel's current state, never a delta (see CLAUDE.md's "Key patterns
and conventions" — Backend, and #7's "the server owns the live heat view").
A subscriber that missed several snapshots and receives only the newest one
is *correct*: the newest snapshot already supersedes every one before it. So
the right behaviour for a full queue is to drop the *oldest* entry rather than
refuse the newest one, or block the publisher until the subscriber catches up.

`test_publish_never_blocks_on_a_full_queue` pins the other half: a publisher
here is a mutation resolver or `TimerManager` mid-heat (#9), and it must never
stall waiting on a subscriber that has stopped reading.
"""

import asyncio

import pytest

from backend.api.pubsub import MAX_QUEUE_SIZE, _PubSub

TIMEOUT = 2.0


@pytest.fixture
def bus():
    """A private bus per test — never the module-level singleton."""
    return _PubSub()


async def test_a_stalled_subscriber_does_not_grow_the_queue_without_bound(bus):
    """Publishing well past the bound must not leave the queue holding
    every payload ever sent to a subscriber that never reads."""
    async with bus.subscribe("channel") as _stream:
        for i in range(MAX_QUEUE_SIZE + 20):
            await bus.publish("channel", i)

        queue = bus._subscribers["channel"][0]
        assert queue.qsize() <= MAX_QUEUE_SIZE


async def test_a_full_queue_drops_the_oldest_entry_not_the_newest(bus):
    """A subscriber that wakes up after a stall wants the *current* state of
    the race, not the state from when it fell behind. The first payload it
    reads back out must be recent, never the very first one published."""
    async with bus.subscribe("channel") as stream:
        for i in range(MAX_QUEUE_SIZE + 5):
            await bus.publish("channel", i)

        first = await asyncio.wait_for(stream.__anext__(), timeout=TIMEOUT)

        # The oldest surviving payloads are indices 5..MAX_QUEUE_SIZE+4; index
        # 0 was published first and must have been the one dropped.
        assert first != 0
        assert first >= 5


async def test_publish_never_blocks_on_a_full_queue(bus):
    """Filling a subscriber's queue past its bound must not make `publish`
    hang — a publisher is a mutation resolver or the timer manager mid-heat
    (#9), and neither may stall on a display nobody is watching."""
    async with bus.subscribe("channel") as _stream:
        for i in range(MAX_QUEUE_SIZE + 5):
            await asyncio.wait_for(bus.publish("channel", i), timeout=TIMEOUT)


async def test_an_attentive_subscriber_still_sees_every_payload(bus):
    """The bound only matters to a subscriber that has fallen behind — one
    reading as it goes must lose nothing, the ordinary case on every device
    that has not stalled."""
    async with bus.subscribe("channel") as stream:
        for i in range(3):
            await bus.publish("channel", i)
            assert await asyncio.wait_for(stream.__anext__(), timeout=TIMEOUT) == i
