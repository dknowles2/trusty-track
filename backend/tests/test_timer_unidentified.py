"""A connected timer eventually says what it is.

The bug: a MicroWizard that connects normally stays in CONNECTED forever.
``handle_connect`` sends `N1` and `N2`, the device acknowledges both, and
``_process_line`` consumes acknowledgements through the pending-ack queue with
an early return — so nothing reaches the branch that leaves CONNECTED. The
timer is present, initialised and working, and the operator's badge says
"Connecting…" until the first heat is armed.

The watchdog was supposed to cover exactly this by resending
``identification_commands()``. That is empty for every profile we ship, so it
sent nothing, once a second, forever.

These drive ``nudge_if_unidentified`` directly rather than waiting on the
watchdog's one-second loop; the watchdog's only job is to call it.
"""

import asyncio
from dataclasses import replace

import pytest

from backend.db import models
from backend.services.timer import manager as manager_module
from backend.services.timer.devices import FAKE, MICROWIZARD
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

BANNER = b"Copyright (c) Micro Wizard 2002-2009\r"


def collecting(manager: TimerManager) -> list[bytes]:
    """Capture what the manager writes to the device."""
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    return sent


async def connected_and_acknowledged() -> tuple[TimerManager, list[bytes]]:
    """A manager in the state a normal, working connection leaves it in."""
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    sent = collecting(manager)
    await manager.handle_connect()
    # The device answers N1 and N2 exactly as the profile says it will.
    await manager.receive_bytes(b"\r\n*\r\n*\r\n")
    sent.clear()
    return manager, sent


async def test_the_normal_connection_really_does_end_up_unidentified():
    """The premise, pinned. If this ever stops being true the nudge is dead
    code and should go, rather than quietly never firing."""
    manager, _ = await connected_and_acknowledged()

    assert manager._state is TimerState.CONNECTED
    assert not manager._pending_acks

    await manager.stop()


async def test_a_silent_connection_is_asked_what_is_there():
    manager, sent = await connected_and_acknowledged()

    assert await manager.nudge_if_unidentified() is True
    assert sent == [b"RV"]

    await manager.stop()


async def test_the_answer_takes_it_out_of_connecting():
    """The whole point: the badge stops lying."""
    manager, _ = await connected_and_acknowledged()

    await manager.nudge_if_unidentified()
    await manager.receive_bytes(BANNER)

    assert manager._state is TimerState.IDLE

    await manager.stop()


async def test_an_armed_timer_is_never_interrogated():
    """`probe` and `on_connect` are separate fields precisely so that asking a
    device who it is cannot happen in the middle of a heat. A heat is armed
    from CONNECTED without waiting for identification, so this state is
    reachable."""
    manager, sent = await connected_and_acknowledged()
    manager._active_heat_id = 7

    assert await manager.nudge_if_unidentified() is False
    assert sent == []

    await manager.stop()


async def test_nudging_backs_off():
    """The watchdog ticks every second. Asking that often would chatter at a
    port that is not a timer at all."""
    manager, sent = await connected_and_acknowledged()

    assert await manager.nudge_if_unidentified() is True
    assert await manager.nudge_if_unidentified() is False
    assert sent == [b"RV"]

    await manager.stop()


async def test_a_reconnect_may_nudge_straight_away():
    """A fresh connection must not inherit the previous one's backoff and sit
    unidentified for longer than it needs to."""
    manager, _ = await connected_and_acknowledged()
    assert await manager.nudge_if_unidentified() is True

    await manager.handle_connect()
    sent = collecting(manager)
    await manager.receive_bytes(b"\r\n*\r\n*\r\n")

    assert await manager.nudge_if_unidentified() is True
    assert b"RV" in sent

    await manager.stop()


async def test_an_identified_timer_is_left_alone():
    manager, sent = await connected_and_acknowledged()
    await manager.receive_bytes(BANNER)
    assert manager._state is TimerState.IDLE

    assert await manager.nudge_if_unidentified() is False
    assert sent == []

    await manager.stop()


async def test_a_profile_with_nothing_to_ask_stays_quiet():
    """A device that cannot be interrogated is not helped by trying."""
    mute = replace(MICROWIZARD, key="mute", probe=())
    manager = TimerManager(track_id=1, device=mute)
    sent = collecting(manager)
    await manager.handle_connect()
    await manager.receive_bytes(b"\r\n*\r\n*\r\n")
    sent.clear()

    assert await manager.nudge_if_unidentified() is False
    assert sent == []

    await manager.stop()


async def test_the_fake_timer_is_not_nudged():
    """It starts in IDLE and has no port, so there is nobody to ask."""
    manager = TimerManager(track_id=1, device=FAKE)

    assert manager._state is TimerState.IDLE
    assert await manager.nudge_if_unidentified() is False

    await manager.stop()


async def test_the_watchdog_is_what_calls_it():
    """Nothing else does.

    Every other test here drives ``nudge_if_unidentified`` directly, so
    deleting the watchdog's call would leave them all green and the feature
    dead — which is exactly what the old, empty recovery had been doing.
    """
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(manager_module, "WATCHDOG_SECONDS", 0.01)
    try:
        manager, sent = await connected_and_acknowledged()
        manager._watchdog_task = asyncio.create_task(manager._watchdog_loop())

        for _ in range(50):
            await asyncio.sleep(0.01)
            if sent:
                break

        assert sent == [b"RV"], "the watchdog never asked"
        await manager.stop()
    finally:
        monkeypatch.undo()


async def test_arming_from_connected_still_works():
    """Belt and braces on the state the bug leaves behind: an operator who
    presses on rather than waiting for the badge must not be blocked."""
    manager, _ = await connected_and_acknowledged()

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)

    assert manager._state is TimerState.ARMED

    await manager.stop()
