"""Detecting a timer through a port the browser holds (issue #89).

``AUTO_DETECT_PROXY`` used to assume the MicroWizard, because probing means
trying candidates in turn and on this path the backend does not own the port —
the browser does, and each candidate may need it reopened with different
framing.

The fake browser below is a scripted device plus the two things the real one
does: it opens the port when asked, and it relays bytes both ways. That is
enough to assert the walk, the reopen, the handover and the fallback without a
WebSocket, a serial port or hardware.
"""

import re
from dataclasses import replace

from backend.services.timer.devices import MICROWIZARD
from backend.services.timer.devices.base import TimerProfile
from backend.services.timer.manager import TimerManager
from backend.services.timer.proxy import Framing, ProxySession, framing_of
from backend.services.timer.state_machine import TimerState

BANNER = b"Copyright (c) Micro Wizard 2002-2009\rK2 Version 2.3A  Serial Number29284\r"

# A second model, so "walks the profiles" is testable at all. Nothing about it
# is real; the framing differs from the MicroWizard's so that reopening the
# port is exercised, which no profile we ship currently forces.
OTHER = TimerProfile(
    name="Other Timer",
    key="other",
    baud_rate=1200,
    data_bits=7,
    stop_bits=2,
    delimiter=b"\n",
    probe=(b"WHO",),
    identification=(re.compile(rb"OTHERTIMER"),),
    setup=(b"GO",),
)


class FakeBrowser:
    """A browser holding a port with a scripted device on the far end.

    ``answers`` maps what is written to what comes back, so a device can be
    made to answer one profile's probe and stay silent for another — the case
    the whole walk exists for.
    """

    def __init__(self, answers: dict[bytes, bytes], *, opens: bool = True) -> None:
        self.answers = answers
        self.opens = opens
        self.configures: list[Framing] = []
        self.written: list[bytes] = []
        self.session: ProxySession | None = None

    async def configure(self, profile: TimerProfile) -> None:
        self.configures.append(framing_of(profile))
        if self.opens:
            assert self.session is not None
            self.session.on_ready()

    async def send(self, data: bytes) -> None:
        self.written.append(data)
        reply = self.answers.get(data)
        if reply and self.session is not None:
            await self.session.on_bytes(reply)


def session_for(
    browser: FakeBrowser,
    profiles: list[TimerProfile],
    **kwargs: object,
) -> tuple[ProxySession, TimerManager]:
    """A manager wired to a fake browser, and the session driving them."""
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager.set_write_fn(browser.send)
    session = ProxySession(
        manager,
        browser,
        profiles,
        response_seconds=0.1,
        settle_seconds=0.0,
        ready_seconds=0.2,
        **kwargs,  # type: ignore[arg-type]
    )
    browser.session = session
    return session, manager


async def run_to_completion(session: ProxySession) -> None:
    """Let the session's task finish. Nothing here waits on a real device."""
    assert session._task is not None
    await session._task


# ---------------------------------------------------------------------------
# Walking the profiles
# ---------------------------------------------------------------------------


async def test_the_probe_goes_out_and_the_answer_identifies_the_device():
    browser = FakeBrowser({b"RV": BANNER})
    session, manager = session_for(browser, [MICROWIZARD])

    session.start()
    await run_to_completion(session)

    assert manager._device is MICROWIZARD
    assert browser.written[0] == b"RV"

    await manager.stop()


async def test_each_profile_is_tried_until_one_answers():
    """The device is real; the first candidate is the wrong model for it."""
    browser = FakeBrowser({b"WHO": b"OTHERTIMER v1\n"})
    session, manager = session_for(browser, [MICROWIZARD, OTHER])

    session.start()
    await run_to_completion(session)

    assert manager._device is OTHER
    assert browser.written[:2] == [b"RV", b"WHO"]

    await manager.stop()


async def test_a_profile_that_cannot_be_probed_for_is_never_tried():
    """No probe command, or no banner to match, means nothing to detect —
    trying it would only burn the response deadline."""
    silent = replace(MICROWIZARD, key="silent", probe=(), identification=())
    browser = FakeBrowser({b"RV": BANNER})
    session, manager = session_for(browser, [silent])

    session.start()
    await run_to_completion(session)

    # Nothing was probed, so nothing was found and the fallback took over —
    # whose setup commands are all that went out.
    assert b"RV" not in browser.written

    await manager.stop()


# ---------------------------------------------------------------------------
# Reopening the port
# ---------------------------------------------------------------------------


async def test_the_port_is_reopened_when_the_framing_changes():
    """The browser opened the port for one profile's framing; the next
    candidate needs different bytes on the wire, so it has to open it again."""
    browser = FakeBrowser({b"WHO": b"OTHERTIMER v1\n"})
    session, manager = session_for(browser, [MICROWIZARD, OTHER])

    session.start()
    await run_to_completion(session)

    assert browser.configures == [(9600, 8, 1, "N"), (1200, 7, 2, "N")]

    await manager.stop()


async def test_the_port_is_not_reopened_when_the_framing_is_already_right():
    """Reopening is the expensive, failure-prone part, and with the profiles we
    ship it is needed exactly once — everything probeable is 9600 8-N-1."""
    quiet = replace(MICROWIZARD, key="quiet", probe=(b"XX",))
    browser = FakeBrowser({b"RV": BANNER})
    session, manager = session_for(browser, [quiet, MICROWIZARD])

    session.start()
    await run_to_completion(session)

    assert manager._device is MICROWIZARD
    assert browser.configures == [(9600, 8, 1, "N")]

    await manager.stop()


async def test_a_browser_that_never_opens_the_port_does_not_hang_the_session():
    browser = FakeBrowser({b"RV": BANNER}, opens=False)
    session, manager = session_for(browser, [MICROWIZARD])

    session.start()
    await run_to_completion(session)

    assert browser.written == []
    assert manager._state == TimerState.DISCONNECTED

    await manager.stop()


# ---------------------------------------------------------------------------
# The handover
# ---------------------------------------------------------------------------


async def test_an_identified_device_goes_straight_to_idle():
    """The banner has been seen, and it is the only greeting the device sends.
    Waiting in CONNECTED for it would be waiting for something already past."""
    browser = FakeBrowser({b"RV": BANNER})
    session, manager = session_for(browser, [MICROWIZARD])

    session.start()
    await run_to_completion(session)

    assert manager._state == TimerState.IDLE
    # And the setup commands went out, so the device is in the output format
    # the profile's matchers expect.
    assert browser.written == [b"RV", b"N1", b"N2"]

    await manager.stop()


async def test_bytes_arriving_during_probing_never_reach_the_manager():
    """They are answers to other profiles' probes. Putting them through the
    manager would run them past the wrong matchers, and past acknowledgement
    matching that never asked for them."""
    browser = FakeBrowser({b"WHO": b"OTHERTIMER v1\n"})
    session, manager = session_for(browser, [MICROWIZARD, OTHER])

    session.start()
    await run_to_completion(session)

    # Only the setup commands sent after adoption are in the log's TX side, and
    # nothing the probe elicited is in its RX side.
    received = [e.data for e in manager._serial_log if e.direction == "RX"]
    assert received == []

    await manager.stop()


async def test_bytes_arriving_after_identification_do_reach_the_manager():
    browser = FakeBrowser({b"RV": BANNER})
    session, manager = session_for(browser, [MICROWIZARD])

    session.start()
    await run_to_completion(session)

    await session.on_bytes(b"@\r")

    assert [e.data for e in manager._serial_log if e.direction == "RX"] == ["@\\r"]

    await manager.stop()


# ---------------------------------------------------------------------------
# Nothing answering
# ---------------------------------------------------------------------------


async def test_nothing_identified_falls_back_to_the_assumed_profile():
    """It is what this path did before probing existed, so a device that
    cannot be identified is no worse off than it was."""
    browser = FakeBrowser({})
    session, manager = session_for(browser, [MICROWIZARD])

    session.start()
    await run_to_completion(session)

    assert manager._device is MICROWIZARD
    assert manager._state == TimerState.CONNECTED
    # The normal handshake, not the adoption shortcut: nothing has identified
    # itself, so the manager waits to hear something before believing it has.
    assert browser.written == [b"RV", b"N1", b"N2"]

    await manager.stop()


async def test_the_fallback_opens_the_port_when_probing_never_did():
    """With no candidate to probe, nothing has asked for the port yet — and a
    port nobody opened relays nothing."""
    browser = FakeBrowser({})
    session, manager = session_for(browser, [])

    session.start()
    await run_to_completion(session)

    assert browser.configures == [(9600, 8, 1, "N")]
    assert manager._state == TimerState.CONNECTED

    await manager.stop()


# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------


async def test_closing_stops_the_walk_and_disconnects_the_manager():
    """The operator closed the tab mid-probe. Nothing should still be talking
    to a port that is gone."""
    browser = FakeBrowser({}, opens=False)
    session, manager = session_for(browser, [MICROWIZARD])

    session.start()
    walk = session._task
    await session.close()

    assert manager._state == TimerState.DISCONNECTED
    assert walk is not None and walk.cancelled()

    await manager.stop()
