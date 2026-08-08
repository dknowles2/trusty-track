"""Running a timer through a port the browser holds (issue #89).

``AUTO_DETECT_PROXY`` assumed the MicroWizard. ``AUTO_DETECT_BACKEND`` stopped
assuming when ``probe.py`` landed, but that prober owns the port: it opens each
candidate's framing itself, writes, reads, and hands the winner over. On this
path the browser owns the port, so the same walk has to be driven over the
WebSocket — configure, wait for the port to be open, write the probe, watch the
bytes that come back.

That is the whole of this module: ``ProxySession`` is the walk plus the handover,
and ``ProxyTransport`` is the two things it needs a connection to do. The
WebSocket endpoint keeps only the message encoding, which is what it was for.

Three decisions worth knowing:

**The port is reopened only when the framing actually changes.** Reopening is
the expensive, failure-prone part — the browser has to cancel its reader, close,
reopen and say so — and with the profiles we ship it is needed exactly once,
because every device we can probe for runs at 9600 8-N-1. The check is on the
framing rather than on the profile so that the day a 1200-baud profile becomes
probeable, it still works.

**Bytes received while probing never reach the manager.** They are answers to
other profiles' probe commands, and feeding them to a manager that is about to
be told which device it has would put lines through the wrong matchers, and
answers through acknowledgement matching that never asked for them.

**Finding nothing falls back to the assumed profile**, rather than leaving the
track without a timer. It is what this path did before probing existed, so a
device that cannot be identified is no worse off than it was — and the one
device most likely to be on the other end is the one that is assumed.
"""

import asyncio
import base64
import contextlib
import logging
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Protocol

from . import probe
from .devices import ALL_PROFILES, DEFAULT_PROFILE, TimerProfile
from .manager import TimerManager

logger = logging.getLogger(__name__)

#: How long to wait for the browser to say it has the port open. Generous: it
#: covers a `close()` and an `open()` on a USB device, and being wrong here
#: costs an undetected timer rather than a slow one.
READY_SECONDS = 5.0

Framing = tuple[int, int, float, str]

#: Sending one JSON message to the browser.
JsonSender = Callable[[dict[str, Any]], Awaitable[None]]


def framing_of(profile: TimerProfile) -> Framing:
    """The port settings a profile needs, as something comparable."""
    return (
        profile.baud_rate,
        profile.data_bits,
        profile.stop_bits,
        profile.parity,
    )


class ProxyTransport(Protocol):
    """What a proxy session needs a connection to the browser to do."""

    async def configure(self, profile: TimerProfile) -> None:
        """Ask for the port to be (re)opened with this profile's framing."""
        ...

    async def send(self, data: bytes) -> None:
        """Write bytes to the port."""
        ...


class ProxySession:
    """One browser-proxied connection: identify the timer, then run it.

    The lifecycle is driven from outside by whatever is reading the socket:
    ``start`` once, then ``on_ready`` and ``on_bytes`` per message, then
    ``close``. Everything ordered — the walk over candidates, the deadlines,
    the handover — happens on the task ``start`` creates, so the caller's read
    loop never blocks waiting for a device.
    """

    def __init__(
        self,
        manager: TimerManager,
        transport: ProxyTransport,
        profiles: Sequence[TimerProfile] = ALL_PROFILES,
        *,
        chosen: TimerProfile | None = None,
        fallback: TimerProfile = DEFAULT_PROFILE,
        response_seconds: float | None = None,
        settle_seconds: float | None = None,
        ready_seconds: float = READY_SECONDS,
    ) -> None:
        self._manager = manager
        self._transport = transport
        # A named model is not a candidate to be found; it is the answer (#143).
        # Emptying the walk reaches the same code the fallback already uses —
        # reopen the port with this profile's framing and hand over — so there
        # is no second path for "we know what this is".
        self._chosen = chosen
        self._candidates = (
            [] if chosen else [p for p in profiles if p.probe and p.identification]
        )
        self._fallback = chosen or fallback
        self._response_seconds = (
            probe.RESPONSE_SECONDS if response_seconds is None else response_seconds
        )
        self._settle_seconds = (
            probe.PRE_PROBE_SETTLE_SECONDS if settle_seconds is None else settle_seconds
        )
        self._ready_seconds = ready_seconds

        self._rx: asyncio.Queue[bytes] = asyncio.Queue()
        self._ready = asyncio.Event()
        self._probing = True
        self._task: asyncio.Task | None = None
        self._open_framing: Framing | None = None

    # ------------------------------------------------------------------ #
    # Driven from the socket                                               #
    # ------------------------------------------------------------------ #

    def start(self) -> None:
        """Begin identifying the device."""
        self._task = asyncio.create_task(self._run())

    def on_ready(self) -> None:
        """The browser has the port open with the framing last asked for."""
        self._ready.set()

    async def on_bytes(self, data: bytes) -> None:
        """The device said something."""
        if self._probing:
            self._rx.put_nowait(data)
        else:
            await self._manager.receive_bytes(data)

    async def close(self) -> None:
        """The link is gone.

        The walk is not merely cancelled but waited for: a task still unwinding
        could otherwise send a command, or hand over a profile, *after* the
        manager has been told the connection is down.
        """
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._manager.handle_disconnect()

    # ------------------------------------------------------------------ #
    # The walk                                                             #
    # ------------------------------------------------------------------ #

    async def _run(self) -> None:
        try:
            await self._identify_then_hand_over()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Timer %d: proxy session failed", self._manager.track_id)

    async def _identify_then_hand_over(self) -> None:
        try:
            profile = await self._identify()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Timer %d: proxy probe failed", self._manager.track_id)
            profile = None

        # No await between reading the queue and clearing the flag, so nothing
        # can arrive and be filed under the wrong half of the session.
        pending = self._rx.qsize()
        self._probing = False
        self._drain()

        if profile is not None:
            if pending:
                logger.debug(
                    "Timer %d: discarding %d chunk(s) left from probing",
                    self._manager.track_id,
                    pending,
                )
            await self._manager.adopt_profile(profile)
            return

        # No `set_device` here: the fallback is the profile the manager was
        # built with, and set_device stops the manager — which on this path
        # would drop the write function the socket installed, leaving the
        # handshake below talking to nobody.
        if self._chosen is not None:
            logger.info(
                "Timer %d: using the configured %s over the proxy",
                self._manager.track_id,
                self._chosen.name,
            )
        else:
            logger.info(
                "Timer %d: nothing identified over the proxy; assuming %s",
                self._manager.track_id,
                self._fallback.name,
            )
        if await self._reopen(self._fallback):
            await self._manager.handle_connect()

    async def _identify(self) -> TimerProfile | None:
        for profile in self._candidates:
            if not await self._reopen(profile):
                # The browser never came back. Every remaining candidate would
                # wait the same way, so stop rather than spend the operator's
                # time proving it.
                return None

            matcher = probe.BannerMatcher(profile)
            self._drain()

            if profile.pre_probe:
                for command in profile.pre_probe:
                    await self._transport.send(profile.wire(command))
                await asyncio.sleep(self._settle_seconds)
                self._drain()

            for command in profile.probe:
                await self._transport.send(profile.wire(command))

            banner = await self._collect(matcher)
            if banner is not None:
                logger.info(
                    "Timer %d: proxy found %s: %r",
                    self._manager.track_id,
                    profile.name,
                    banner,
                )
                return profile

        return None

    async def _reopen(self, profile: TimerProfile) -> bool:
        """Get the port open with ``profile``'s framing. False if it never is.

        A no-op when the framing is already right — see the module docstring.
        """
        wanted = framing_of(profile)
        if wanted == self._open_framing:
            return True

        # Cleared before the request, not after: a browser that answers before
        # this coroutine is resumed would otherwise have its answer thrown away.
        self._ready.clear()
        await self._transport.configure(profile)
        try:
            await asyncio.wait_for(self._ready.wait(), self._ready_seconds)
        except asyncio.TimeoutError:
            logger.warning(
                "Timer %d: browser did not open the port for %s",
                self._manager.track_id,
                profile.name,
            )
            return False

        self._open_framing = wanted
        # Whatever a freshly opened port coughed up belongs to no probe.
        self._drain()
        return True

    async def _collect(self, matcher: probe.BannerMatcher) -> bytes | None:
        """Watch for the banner until the deadline."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._response_seconds
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return None
            try:
                chunk = await asyncio.wait_for(self._rx.get(), remaining)
            except asyncio.TimeoutError:
                return None
            banner = matcher.feed(chunk)
            if banner is not None:
                return banner

    def _drain(self) -> None:
        while not self._rx.empty():
            self._rx.get_nowait()


class WebSocketTransport:
    """``ProxyTransport`` over the ``/ws/timer/{track_id}`` protocol.

    The only part of proxying that is about JSON and base64 rather than about
    timers.
    """

    def __init__(self, send_json: JsonSender, track_id: int) -> None:
        self._send_json = send_json
        self._track_id = track_id

    async def configure(self, profile: TimerProfile) -> None:
        # All four framing parameters, not just the baud rate: the Web Serial
        # API defaults to 8-N-1 exactly as pyserial does, so a device that is
        # not 8-N-1 was previously opened wrong on this path too.
        await self._send_json(
            {
                "type": "configure",
                "baud_rate": profile.baud_rate,
                "data_bits": profile.data_bits,
                "stop_bits": profile.stop_bits,
                "parity": profile.parity,
            }
        )

    async def send(self, data: bytes) -> None:
        try:
            await self._send_json(
                {
                    "type": "serial_tx",
                    "data": base64.b64encode(data).decode("utf-8"),
                }
            )
        except Exception as error:
            logger.error(
                "Failed to send serial_tx to track %d: %s", self._track_id, error
            )
