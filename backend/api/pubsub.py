"""
In-process async pub/sub broadcaster.

Provides a simple publish/subscribe mechanism using asyncio queues.
Each subscriber gets its own queue; published messages are broadcast
to all active subscribers on a given channel.
"""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any


class _PubSub:
    """In-process async pub/sub broadcaster backed by asyncio queues."""

    def __init__(self) -> None:
        """Initialise an empty subscriber registry."""
        self._subscribers: dict[str, list[asyncio.Queue[Any]]] = {}

    async def publish(self, channel: str, payload: Any) -> None:
        """Broadcast *payload* to every subscriber on *channel*.

        Args:
            channel: The channel name to publish to.
            payload: The payload object to deliver to subscribers.
        """
        for queue in list(self._subscribers.get(channel, [])):
            await queue.put(payload)

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
        queue: asyncio.Queue[Any] = asyncio.Queue()
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
