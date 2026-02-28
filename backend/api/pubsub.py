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
        self, channel: str
    ) -> AsyncGenerator[AsyncGenerator[Any, None], None]:
        """Async context manager that yields an async generator of payloads.

        Args:
            channel: The channel name to subscribe to.

        Yields:
            An async generator that yields payloads published to *channel*.
        """
        queue: asyncio.Queue[Any] = asyncio.Queue()
        subscribers = self._subscribers.setdefault(channel, [])
        subscribers.append(queue)
        try:

            async def _stream() -> AsyncGenerator[Any, None]:
                while True:
                    payload = await queue.get()
                    yield payload

            yield _stream()
        finally:
            subscribers.remove(queue)


# Module-level singleton used by schema.py and tests.
pubsub = _PubSub()
