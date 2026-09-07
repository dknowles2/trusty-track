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

#: Every payload published here is a full snapshot of the channel's current
#: state, never a delta (see CLAUDE.md's "Key patterns and conventions" —
#: Backend, and #7's "the server owns the live heat view"). That is what makes
#: a bounded queue safe: a subscriber that missed several snapshots and gets
#: only the newest one is *correct*, since the newest already supersedes
#: everything before it. Eight is several times the depth an ordinary burst of
#: heat results would ever reach; a subscriber still that far behind has
#: already gone quiet in a way `liveConnection.ts`'s ping watchdog is about to
#: notice and close. This bound only keeps memory flat for the window before
#: that happens — it is not a substitute for the watchdog.
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
        day itself. A subscriber's queue is bounded at `MAX_QUEUE_SIZE`; a
        full one has its oldest entry dropped to make room for the new one,
        which is safe for the reason `MAX_QUEUE_SIZE` documents — every
        payload is a full snapshot, so the newest is all a subscriber needs
        once it wakes up.

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
        self, *channels: str
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

        Yields:
            An async generator that yields payloads published to any of them.
        """
        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=MAX_QUEUE_SIZE)
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
