"""Finding a timer, without a timer (issue #89).

Every port here is a fake that replays a scripted byte stream, which is what
lets these tests assert the thing that actually matters — that probing tries
candidates in turn and stops at the first that answers — without hardware.

What they cannot check is whether a real device answers `RV` the way the
MicroWizard profile says. Nothing short of the device on a desk can.
"""

import re
from dataclasses import replace

import pytest

from backend.services.timer import probe
from backend.services.timer.devices import MICROWIZARD
from backend.services.timer.devices.base import TimerProfile

BANNER = (
    b"Copyright (c) Micro Wizard 2002-2009\r\nK2 Version 2.3A  Serial Number29284\r\n"
)

#: Captured before conftest's autouse guard replaces it, so the one test that
#: is *about* port enumeration can still reach the real implementation.
REAL_USB_PORTS = probe.usb_ports


class FakePort:
    """A serial port that answers a probe, or does not.

    ``answers`` maps the bytes written to the bytes that come back, so a port
    can be made to respond to one profile's probe and stay silent for another
    — which is the case the whole walk exists for.
    """

    def __init__(self, answers: dict[bytes, bytes]):
        self.answers = answers
        self.written: list[bytes] = []
        self.pending = b""
        self.closed = False
        # TimerManager's read loop and writer both consult this on the port a
        # probe hands over, which is why it is part of the ProbePort protocol.
        self.is_open = True

    def write(self, data: bytes) -> int:
        self.written.append(data)
        self.pending += self.answers.get(data, b"")
        return len(data)

    def read(self, size: int) -> bytes:
        chunk, self.pending = self.pending[:size], self.pending[size:]
        return chunk

    def close(self) -> None:
        self.closed = True
        self.is_open = False


def opener(ports: dict[str, FakePort]):
    """An ``open_port`` that hands out the fakes, and fails for anything else."""

    def open_port(port: str, profile: TimerProfile) -> FakePort:  # noqa: ARG001
        if port not in ports:
            raise OSError(f"no such port: {port}")
        return ports[port]

    return open_port


# A second model, so "walks the profiles" is testable at all. It answers a
# different command with a different banner; nothing about it is real.
OTHER = TimerProfile(
    name="Other Timer",
    key="other",
    delimiter=b"\n",
    probe=(b"WHO",),
    identification=(re.compile(rb"OTHERTIMER"),),
)


# ---------------------------------------------------------------------------
# Walking ports and profiles
# ---------------------------------------------------------------------------


async def test_a_timer_is_found_on_the_port_it_is_plugged_into():
    ports = {
        "/dev/ttyUSB0": FakePort({}),
        "/dev/ttyUSB1": FakePort({b"RV": BANNER}),
    }

    found = await probe.detect(
        ["/dev/ttyUSB0", "/dev/ttyUSB1"],
        [MICROWIZARD],
        open_port=opener(ports),
        response_seconds=0.2,
    )

    assert found is not None
    assert found.port == "/dev/ttyUSB1"
    assert found.profile is MICROWIZARD


async def test_the_probe_command_is_actually_sent():
    """A profile with no probe would silently never match."""
    port = FakePort({b"RV": BANNER})

    await probe.detect(
        ["/dev/ttyUSB0"],
        [MICROWIZARD],
        open_port=opener({"/dev/ttyUSB0": port}),
        response_seconds=0.2,
    )

    assert port.written == [b"RV"]


async def test_each_profile_is_tried_until_one_answers():
    """The port is real; the first profile is the wrong model for it."""
    port = FakePort({b"WHO": b"OTHERTIMER v1\n"})

    found = await probe.detect(
        ["/dev/ttyUSB0"],
        [MICROWIZARD, OTHER],
        open_port=opener({"/dev/ttyUSB0": port}),
        response_seconds=0.2,
    )

    assert found is not None
    assert found.profile is OTHER
    assert port.written == [b"RV", b"WHO"]


async def test_nothing_answering_is_not_an_error():
    ports = {"/dev/ttyUSB0": FakePort({}), "/dev/ttyUSB1": FakePort({})}

    found = await probe.detect(
        list(ports),
        [MICROWIZARD],
        open_port=opener(ports),
        response_seconds=0.1,
    )

    assert found is None


async def test_a_port_that_will_not_open_is_skipped():
    """Busy, gone, or not ours. Every profile would fail the same way, so the
    walk moves to the next port rather than retrying the shut door."""
    ports = {"/dev/ttyUSB1": FakePort({b"RV": BANNER})}

    found = await probe.detect(
        ["/dev/nonexistent", "/dev/ttyUSB1"],
        [MICROWIZARD],
        open_port=opener(ports),
        response_seconds=0.2,
    )

    assert found is not None
    assert found.port == "/dev/ttyUSB1"


async def test_a_profile_that_cannot_be_probed_for_is_never_tried():
    """No probe command, or no banner to match, means nothing to detect —
    trying it would just burn the response deadline on every port."""
    silent = replace(MICROWIZARD, key="silent", probe=(), identification=())
    port = FakePort({b"RV": BANNER})

    found = await probe.detect(
        ["/dev/ttyUSB0"],
        [silent],
        open_port=opener({"/dev/ttyUSB0": port}),
        response_seconds=0.1,
    )

    assert found is None
    assert port.written == []


# ---------------------------------------------------------------------------
# Matching the banner
# ---------------------------------------------------------------------------


async def test_the_whole_banner_must_match_in_order():
    """The MicroWizard's first line is a manufacturer string, which its
    siblings share. The lines after it are what tell models apart, so a
    partial banner is not a match."""
    port = FakePort({b"RV": b"Copyright (c) Micro Wizard 2002-2009\r\n"})

    found = await probe.detect(
        ["/dev/ttyUSB0"],
        [MICROWIZARD],
        open_port=opener({"/dev/ttyUSB0": port}),
        response_seconds=0.2,
    )

    assert found is None


async def test_a_banner_split_across_reads_still_matches():
    """Serial bytes arrive when they arrive; a line may straddle two reads."""

    class Dribbling(FakePort):
        def read(self, size: int) -> bytes:  # noqa: ARG002 - ignores it on purpose
            return super().read(1)

    port = Dribbling({b"RV": BANNER})

    found = await probe.detect(
        ["/dev/ttyUSB0"],
        [MICROWIZARD],
        open_port=opener({"/dev/ttyUSB0": port}),
        response_seconds=2.0,
    )

    assert found is not None


# ---------------------------------------------------------------------------
# The open port is the handoff
# ---------------------------------------------------------------------------


async def test_the_matching_port_is_left_open():
    """Reopening would lose the banner the device just sent, leaving the
    manager waiting in CONNECTED for a greeting that already happened."""
    port = FakePort({b"RV": BANNER})

    found = await probe.detect(
        ["/dev/ttyUSB0"],
        [MICROWIZARD],
        open_port=opener({"/dev/ttyUSB0": port}),
        response_seconds=0.2,
    )

    assert found is not None
    assert found.connection is port
    assert port.closed is False


async def test_ports_that_did_not_match_are_closed():
    """Otherwise a scan leaks a file descriptor per port, every time it runs."""
    quiet = FakePort({})
    answering = FakePort({b"RV": BANNER})

    await probe.detect(
        ["/dev/ttyUSB0", "/dev/ttyUSB1"],
        [MICROWIZARD],
        open_port=opener({"/dev/ttyUSB0": quiet, "/dev/ttyUSB1": answering}),
        response_seconds=0.1,
    )

    assert quiet.closed is True


# ---------------------------------------------------------------------------
# Which ports are candidates
# ---------------------------------------------------------------------------


def test_only_usb_ports_are_candidates(monkeypatch):
    """Probing writes to a port. A machine's built-in serial ports are as
    likely to be a console as a timer — on a Pi, /dev/ttyAMA0 is the GPIO
    header — and every pinewood timer sold this century is USB.
    """

    class Info:
        def __init__(self, device, vid):
            self.device = device
            self.vid = vid

    monkeypatch.setattr(
        probe.serial.tools.list_ports,
        "comports",
        lambda: [
            Info("/dev/ttyAMA0", None),
            Info("/dev/cu.Bluetooth-Incoming-Port", None),
            Info("/dev/ttyUSB0", 0x0403),
        ],
    )

    assert REAL_USB_PORTS() == ["/dev/ttyUSB0"]


# ---------------------------------------------------------------------------
# The manager takes it from there
# ---------------------------------------------------------------------------


@pytest.fixture
def found_on_usb1(monkeypatch):
    """A MicroWizard answering on /dev/ttyUSB1, and nothing on USB0."""
    ports = {
        "/dev/ttyUSB0": FakePort({}),
        "/dev/ttyUSB1": FakePort({b"RV": BANNER}),
    }
    monkeypatch.setattr(probe, "usb_ports", lambda: list(ports))
    monkeypatch.setattr(probe, "open_serial", opener(ports))
    return ports


async def test_the_manager_adopts_what_the_probe_found(found_on_usb1):
    from backend.services.timer.devices import FAKE
    from backend.services.timer.manager import TimerManager
    from backend.services.timer.state_machine import TimerState

    manager = TimerManager(track_id=1, device=FAKE)

    port = await manager.autodetect()

    assert port == "/dev/ttyUSB1"
    # Straight to IDLE: the probe has already seen the banner, so waiting in
    # CONNECTED for an identification would be waiting for something past.
    assert manager._state == TimerState.IDLE
    assert manager._device is MICROWIZARD
    # And the setup commands went out, so the device is in the output format
    # the profile's matchers expect.
    assert found_on_usb1["/dev/ttyUSB1"].written == [b"RV", b"N1", b"N2"]

    await manager.stop()


async def test_finding_nothing_says_so_on_the_status(monkeypatch):
    """An unplugged timer and an undetected one look identical to an operator
    unless we say which."""
    from backend.services.timer.devices import FAKE
    from backend.services.timer.manager import TimerManager
    from backend.services.timer.state_machine import TimerState

    quiet = {"/dev/ttyUSB0": FakePort({})}
    monkeypatch.setattr(probe, "usb_ports", lambda: list(quiet))
    monkeypatch.setattr(probe, "open_serial", opener(quiet))
    monkeypatch.setattr(probe, "RESPONSE_SECONDS", 0.1)

    manager = TimerManager(track_id=1, device=FAKE)

    port = await manager.autodetect()

    assert port is None
    assert manager._state == TimerState.DISCONNECTED
    assert "/dev/ttyUSB0" in manager._last_error

    await manager.stop()


async def test_no_usb_ports_at_all_is_reported_differently(monkeypatch):
    """Nothing plugged in is a different problem from nothing answering, and
    the operator's next move differs."""
    from backend.services.timer.devices import FAKE
    from backend.services.timer.manager import TimerManager

    monkeypatch.setattr(probe, "usb_ports", list)

    manager = TimerManager(track_id=1, device=FAKE)

    assert await manager.autodetect() is None
    assert "No USB serial ports" in manager._last_error

    await manager.stop()
