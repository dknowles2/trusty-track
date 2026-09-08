"""A subscriber's queue is bounded, and a full one drops its oldest entry —
*unless it asked not to be* (#881).

`_PubSub.publish` used to hand every subscriber a plain `asyncio.Queue()` with
no maximum. A consumer that stalls — a half-open connection in the window
before `liveConnection.ts`'s ping watchdog closes it, or a slow tablet under
load — kept every published event in memory for as long as the stall lasted.

That is safe to fix *for a subscriber whose payload is a full snapshot of the
channel's current state, never a delta* (see CLAUDE.md's "Key patterns and
conventions" — Backend, and #7's "the server owns the live heat view"). Such a
subscriber that missed several snapshots and receives only the newest one is
*correct*: the newest snapshot already supersedes every one before it. So the
right behaviour for a full queue, there, is to drop the *oldest* entry rather
than refuse the newest one, or block the publisher until the subscriber
catches up.

`test_publish_never_blocks_on_a_full_queue` pins the other half: a publisher
here is a mutation resolver or `TimerManager` mid-heat (#9), and it must never
stall waiting on a subscriber that has stopped reading.

**Not every subscriber fits the snapshot premise (#881).** `display_assignment
:{id}`'s payload is always `None` — a doorbell, not a mailbox — and what it
wakes the subscriber to re-read is `DisplayRegistry`'s current row, whose own
`slide_delta` is *overwritten* on each `advanceDisplay` call rather than
accumulated. Dropping an older doorbell ring in favour of a newer one there
does not deliver a stale-but-correct snapshot; it destroys a step the operator
took, because nothing else carries it forward. `subscribe`'s
`drop_oldest_when_full` parameter is the escape hatch — `False` leaves that
subscriber's queue with no maximum, exactly as every queue behaved before
#776, and `test_display_subscription.py` exercises it against the actual
`display_assignment` subscription rather than a generic channel name."""

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


async def test_drop_oldest_when_full_false_never_drops(bus):
    """A subscriber opted out of the bound (#881) must keep every payload no
    matter how far past `MAX_QUEUE_SIZE` a stall runs — the escape hatch for
    a channel whose payloads are individual events rather than
    interchangeable snapshots of one another."""
    async with bus.subscribe("channel", drop_oldest_when_full=False) as stream:
        for i in range(MAX_QUEUE_SIZE + 20):
            await bus.publish("channel", i)

        queue = bus._subscribers["channel"][0]
        assert queue.qsize() == MAX_QUEUE_SIZE + 20

        received = [
            await asyncio.wait_for(stream.__anext__(), timeout=TIMEOUT)
            for _ in range(MAX_QUEUE_SIZE + 20)
        ]
        assert received == list(range(MAX_QUEUE_SIZE + 20))


async def test_publish_never_blocks_on_an_unbounded_queue_either(bus):
    """The opt-out must not reintroduce the risk #776 removed for the
    channels that do use it: publishing well past `MAX_QUEUE_SIZE` on an
    unbounded subscriber must still return promptly."""
    async with bus.subscribe("channel", drop_oldest_when_full=False) as _stream:
        for i in range(MAX_QUEUE_SIZE + 20):
            await asyncio.wait_for(bus.publish("channel", i), timeout=TIMEOUT)
