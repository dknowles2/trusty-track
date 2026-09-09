"""
In-process async pub/sub broadcaster.

Provides a simple publish/subscribe mechanism using asyncio queues.
Each subscriber gets its own queue; published messages are broadcast
to all active subscribers on a given channel.
"""

import asyncio
import contextlib
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

#: Most payloads published here are a full snapshot of the channel's current
#: state, never a delta (see CLAUDE.md's "Key patterns and conventions" —
#: Backend, and #7's "the server owns the live heat view"). That is what makes
#: a bounded queue safe *for those channels*: a subscriber that missed several
#: snapshots and gets only the newest one is *correct*, since the newest
#: already supersedes everything before it. Eight is several times the depth
#: an ordinary burst of heat results would ever reach; a subscriber still that
#: far behind has already gone quiet in a way `liveConnection.ts`'s ping
#: watchdog is about to notice and close. This bound only keeps memory flat
#: for the window before that happens — it is not a substitute for the
#: watchdog.
#:
#: **Not every channel fits that premise** (#881). `display_assignment:{id}`
#: is a doorbell, not a mailbox: every payload on it is `None`, and a woken
#: subscriber re-reads `DisplayRegistry`'s *current* row rather than the
#: payload itself — but that row's own `slide_delta` is overwritten on each
#: `advanceDisplay` call, not accumulated, and `AwardCeremony.tsx` applies it
#: exactly once per distinct `slide_seq` it observes (`.claude/rules/
#: displays.md`'s "Identify is an event, not a state"). Dropping an older
#: doorbell ring in favour of a newer one therefore does not merely deliver a
#: slightly-stale-but-still-correct snapshot the way it does everywhere else
#: — it destroys a step the operator actually took, silently, with nothing
#: superseding it. `subscribe`'s `drop_oldest_when_full` parameter is the
#: escape hatch: `False` leaves that one queue unbounded, which is exactly
#: what every queue was before #776, and is safe for the same reason it
#: always was — an event channel's rate is an operator's own pace, not a
#: sensor's, and a subscriber stalled long enough for that to matter is the
#: half-open connection the ping watchdog is about to close anyway.
#:
#: **A second, narrower exception** (#896). `race_state:{race_id}` carries
#: `RaceStateChangedEvent` payloads, and most of that channel's subscribers
#: (`heatSession`, `leaderboard`, `onDeck`, `currentlyRacing`, `timingStats`,
#: `heats`, `freeRaceHeat`/`activeFreeRaceHeat`) do fit the snapshot premise —
#: a wake-up just means "go re-read the database". `raceStateChanged` alone
#: hands the event straight to the client, and a `HEAT_RESULT`/`RACER`
#: payload is merged directly into the normalized cache (#12) rather than
#: triggering a re-read, so an older one dropped in favour of a newer one is a
#: genuine update lost, not a superseded snapshot — reachable, and pinned by
#: `test_race_state_changed_queue_drop.py`, though self-healing on the next
#: structural (non-mergeable) event kept it from ever being reported. Only
#: `Subscription.race_state_changed`'s own `pubsub.subscribe` call opts out
#: (`drop_oldest_when_full=False`); every other subscriber on the same
#: channel keeps the ordinary bound, since `drop_oldest_when_full` is set per
#: subscriber, not per channel.
MAX_QUEUE_SIZE = 8


class _PubSub:
    """In-process async pub/sub broadcaster backed by asyncio queues."""

    def __init__(self) -> None:
        """Initialise an empty subscriber registry."""
        self._subscribers: dict[str, list[asyncio.Queue[Any]]] = {}

    async def publish(self, channel: str, payload: Any) -> None:
        """Broadcast *payload* to every subscriber on *channel*.

        Never blocks on a slow subscriber. A caller here is a mutation
        resolver or `TimerManager` recording a result mid-heat (#9), and
        either one stalling on a display nobody is reading would stall race
        day itself. A subscriber's queue is bounded at `MAX_QUEUE_SIZE` by
        default; a full one has its oldest entry dropped to make room for the
        new one, which is safe for the reason `MAX_QUEUE_SIZE` documents —
        the payload is a full snapshot, so the newest is all a subscriber
        needs once it wakes up. A subscriber that opted out of the bound
        (`subscribe`'s `drop_oldest_when_full=False`, #881) has no maximum
        size, so `queue.full()` is always false for it and nothing is ever
        dropped — `put_nowait` below still never blocks, since an unbounded
        queue is never full either.

        Args:
            channel: The channel name to publish to.
            payload: The payload object to deliver to subscribers.
        """
        for queue in list(self._subscribers.get(channel, [])):
            if queue.full():
                # No `await` between here and `put_nowait` below, so this
                # runs with no other task able to interleave — a concurrent
                # subscriber can still have just drained the queue itself,
                # in which case `get_nowait` finds it already empty.
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(payload)

    @asynccontextmanager
    async def subscribe(
        self, *channels: str, drop_oldest_when_full: bool = True
    ) -> AsyncGenerator[AsyncGenerator[Any, None], None]:
        """Async context manager that yields an async generator of payloads.

        Pass more than one channel to receive from all of them on a single
        stream, in arrival order. That is one queue on several channels rather
        than several streams to interleave, which matters for a subscriber whose
        answer depends on more than one source: `heatSession` recomputes from
        the database on any event, and cares that something changed rather than
        which thing did.

        Args:
            channels: The channel names to subscribe to.
            drop_oldest_when_full: Whether this subscriber's queue is bounded
                at `MAX_QUEUE_SIZE` and drops its oldest entry once full
                (the default, and every ordinary subscriber's choice — see
                `MAX_QUEUE_SIZE`). Pass `False` for a subscriber whose
                payloads are individual events rather than interchangeable
                snapshots of one another — `display_assignment:{id}` chief
                among them (#881) — so the queue is left with no maximum
                instead. That is the whole of the fix: it is exactly the
                behaviour every channel had before #776, kept available for
                the one shape #776's premise does not cover, rather than
                applied everywhere and quietly losing an event nothing else
                will ever resupply.

        Yields:
            An async generator that yields payloads published to any of them.
        """
        maxsize = MAX_QUEUE_SIZE if drop_oldest_when_full else 0
        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=maxsize)
        for channel in channels:
            self._subscribers.setdefault(channel, []).append(queue)
        try:

            async def _stream() -> AsyncGenerator[Any, None]:
                while True:
                    payload = await queue.get()
                    yield payload

            yield _stream()
        finally:
            for channel in channels:
                # A channel repeated in *channels* registered the queue twice;
                # remove() takes one each time, so the counts stay matched.
                self._subscribers[channel].remove(queue)


# Module-level singleton used by schema.py and tests.
pubsub = _PubSub()
