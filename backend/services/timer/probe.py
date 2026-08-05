"""Find which serial port has a timer on it, and which timer it is.

``AUTO_DETECT_BACKEND`` has never detected anything: it assumed one model and
made the operator type a device path into the track settings, which is a thing
nobody at a pack meeting knows. This is the other half of issue #89 — the half
that the profile records made possible, since probing means trying candidates
in turn and a candidate has to be data you can read.

The shape is DerbyNet's: for each port, for each profile, open the port with
*that profile's* framing, send its probe command, and watch for its
identification banner within a short deadline. The first match wins.

Two decisions worth knowing:

**Only USB ports are probed.** Probing writes bytes to a port, and a machine's
built-in serial ports are as likely to be a console or a modem as a timer — on
a Raspberry Pi, ``/dev/ttyAMA0`` is the GPIO header. Every pinewood timer sold
in the last twenty years is USB, and an operator with an RS-232 timer can still
enter the path by hand, which is what everyone had to do before this existed.

**A successful probe hands its open port to the caller.** Closing and
reopening would lose the banner the device just sent in response to the probe,
leaving the manager waiting in CONNECTED for a greeting that already happened.
"""

import asyncio
import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import serial
import serial.tools.list_ports

from .devices import ALL_PROFILES, TimerProfile

logger = logging.getLogger(__name__)

#: How long to wait for a profile's banner after sending its probe. Long
#: enough for a device that answers slowly, short enough that walking a
#: handful of ports against a handful of profiles stays under a few seconds.
RESPONSE_SECONDS = 0.6

#: How long to let a device settle after its pre-probe command. DerbyNet's
#: value; the timers that need a reset before they will talk also need time to
#: come back from it.
PRE_PROBE_SETTLE_SECONDS = 2.0

#: Read size per poll. Banners are tens of bytes; this only bounds one read.
CHUNK = 256


class ProbePort(Protocol):
    """The part of a serial connection probing needs.

    ``is_open`` is here for the handoff rather than for probing: ``Detection``
    carries the port on to ``TimerManager``, whose read loop and writer both
    consult it.
    """

    is_open: bool

    def write(self, data: bytes) -> int | None: ...
    def read(self, size: int) -> bytes: ...
    def close(self) -> None: ...


PortOpener = Callable[[str, TimerProfile], ProbePort]


@dataclass
class Detection:
    """A timer was found, and the port to it is still open.

    ``connection`` is live and owned by whoever receives this. Not closing it
    is the point — see the module docstring.
    """

    port: str
    profile: TimerProfile
    banner: bytes
    connection: ProbePort


def open_serial(port: str, profile: TimerProfile) -> ProbePort:
    """Open ``port`` with the framing ``profile`` expects."""
    connection: Any = serial.Serial(
        port,
        baudrate=profile.baud_rate,
        bytesize=profile.data_bits,
        stopbits=profile.stop_bits,
        parity=profile.parity,
        timeout=0.1,
    )
    return connection


def usb_ports() -> list[str]:
    """Serial ports that are USB devices, which is where a timer will be."""
    return [
        info.device
        for info in serial.tools.list_ports.comports()
        if info.vid is not None
    ]


def _split(buffer: bytes, delimiter: bytes) -> tuple[list[bytes], bytes]:
    """Complete lines, and whatever is left over."""
    if not delimiter:
        return [buffer], b""
    parts = buffer.split(delimiter)
    return parts[:-1], parts[-1]


async def _banner_from(
    connection: ProbePort,
    profile: TimerProfile,
    response_seconds: float,
) -> bytes | None:
    """Send the probe and watch for the banner. Returns what matched, or None.

    The identification patterns are matched **in order**: a model whose first
    line is a generic manufacturer string is told apart from its siblings by
    the lines that follow, which is the whole reason the field is a sequence.
    """
    # Some timers will not answer until they have been reset or woken, and
    # then need a moment. The pause is why this is a separate field rather than
    # two more probe commands.
    if profile.pre_probe:
        for command in profile.pre_probe:
            await asyncio.to_thread(connection.write, profile.wire(command))
        await asyncio.sleep(PRE_PROBE_SETTLE_SECONDS)

    for command in profile.probe:
        await asyncio.to_thread(connection.write, profile.wire(command))

    wanted = profile.identification
    seen = 0
    matched: list[bytes] = []
    buffer = b""
    deadline = time.monotonic() + response_seconds

    while time.monotonic() < deadline:
        chunk = await asyncio.to_thread(connection.read, CHUNK)
        if not chunk:
            continue
        buffer += chunk
        lines, buffer = _split(buffer, profile.delimiter)
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if wanted[seen].search(stripped):
                matched.append(stripped)
                seen += 1
                if seen == len(wanted):
                    return b" ".join(matched)

    return None


async def detect(
    ports: Sequence[str],
    profiles: Sequence[TimerProfile] = ALL_PROFILES,
    *,
    open_port: PortOpener | None = None,
    response_seconds: float | None = None,
) -> Detection | None:
    """Walk ports against profiles until one answers. ``None`` if none do.

    ``open_port`` and ``response_seconds`` resolve here rather than in the
    signature, so that replacing ``open_serial`` on this module takes effect.
    A default argument binds at definition time, which would have made the
    test suite's guard against touching real hardware quietly useless.
    """
    opener = open_port if open_port is not None else open_serial
    deadline_seconds = (
        response_seconds if response_seconds is not None else RESPONSE_SECONDS
    )
    candidates = [p for p in profiles if p.probe and p.identification]
    if not candidates:
        logger.warning("No profile can be probed for; nothing to detect")
        return None

    for port in ports:
        for profile in candidates:
            logger.info("Probing %s for %s", port, profile.name)
            try:
                connection = await asyncio.to_thread(opener, port, profile)
            except Exception as error:
                # The port is unusable — busy, gone, or not ours to open. Every
                # other profile would fail the same way, so move to the next
                # port rather than trying them all against a door that is shut.
                logger.info("Cannot open %s: %s", port, error)
                break

            try:
                banner = await _banner_from(connection, profile, deadline_seconds)
            except Exception as error:
                logger.info("Probe of %s for %s failed: %s", port, profile.name, error)
                banner = None

            if banner is not None:
                logger.info("Found %s on %s: %r", profile.name, port, banner)
                return Detection(
                    port=port,
                    profile=profile,
                    banner=banner,
                    connection=connection,
                )

            await asyncio.to_thread(connection.close)

    return None
