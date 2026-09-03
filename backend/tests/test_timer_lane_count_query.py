"""Asking a timer how many lanes it has (issue #637).

The Champ's lane count is not volunteered — DerbyNet draws it out with an `on`
query whose answer is a bare digit. A matcher that broad would claim any
single-digit line the device ever sends, so it is the same shape as a gate
watcher's answer (see ``test_timer_gate_watcher.py``): asked once, and read
only inside the short window that follows, never as ordinary traffic.

Three things this pins, each a way of getting it wrong:

**The query fires once, on the way to IDLE, never while a heat is armed or
running.** Unlike the gate watcher's repeated poll, this is a one-shot
question asked right after the device identifies itself — asking it mid-event
would be traffic sent to a timer nobody should be interrupting.

**Outside its window, the answer is ordinary, unclaimed traffic.** A bare `4`
means nothing to the Champ's own matchers (they only recognise
``A=3.456``-style results), so it must not silently become a lane count
because one happened to arrive at the wrong moment.

**A device that volunteers its lane count needs none of this** — see
``test_a_reported_lane_count_is_read`` in ``test_timer_derbynet_profiles.py``
for ``DERBY_TIMER`` and ``PDT``, which produce ``LANE_COUNT`` from an ordinary
matcher and carry no ``lane_count_query`` at all.
"""

import asyncio

import pytest

from backend.services.timer.devices.derbynet import CHAMP
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

# ---------------------------------------------------------------------------
# The window
# ---------------------------------------------------------------------------


async def test_an_answer_inside_the_window_is_read_as_a_lane_count():
    manager = TimerManager(track_id=1, device=CHAMP)
    manager._state = TimerState.IDLE
    manager._lane_count_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b"4\n")

    assert manager._reported_lane_count == 4
    await manager.stop()


async def test_the_same_bytes_outside_the_window_are_not_a_lane_count():
    """Nothing asked, so nothing answered — the Champ's own matchers do not
    recognise a bare digit either, so this must fall through as unclaimed
    traffic rather than crash or silently record something."""
    manager = TimerManager(track_id=1, device=CHAMP)
    manager._state = TimerState.IDLE
    manager._lane_count_window_until = 0.0

    await manager.receive_bytes(b"4\n")

    assert manager._reported_lane_count is None
    await manager.stop()


async def test_one_answer_closes_the_window():
    manager = TimerManager(track_id=1, device=CHAMP)
    manager._state = TimerState.IDLE
    manager._lane_count_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b"4\n")

    assert manager._lane_count_window_until == 0.0
    await manager.stop()


# ---------------------------------------------------------------------------
# When it asks
# ---------------------------------------------------------------------------


async def test_the_query_is_sent_once_the_device_identifies_itself():
    """The defined moment: right after an ordinary connection identifies
    itself, with no heat armed yet."""
    manager = TimerManager(track_id=1, device=CHAMP)
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    manager._state = TimerState.CONNECTED

    await manager.receive_bytes(b"eTekGadget SmartLine Timer\r\n")

    assert b"on\r" in sent
    assert manager._lane_count_window_until > asyncio.get_event_loop().time()
    await manager.stop()


async def test_the_query_is_not_sent_when_identification_arrives_with_a_heat_armed():
    """The branch that fires the query only covers the IDLE case; an armed
    heat re-sends its lane mask instead (existing behaviour), and the lane
    count is not asked mid-event."""
    manager = TimerManager(track_id=1, device=CHAMP)
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    manager._state = TimerState.CONNECTED
    manager._active_heat_id = 1
    manager._lane_mask = 0b1

    await manager.receive_bytes(b"eTekGadget SmartLine Timer\r\n")

    assert b"on\r" not in sent
    assert manager._lane_count_window_until == 0.0
    await manager.stop()


@pytest.mark.parametrize(
    "state", [TimerState.ARMED, TimerState.READY, TimerState.RUNNING]
)
async def test_the_query_is_never_sent_while_a_heat_is_in_progress(
    state: TimerState,
):
    """Belt and braces on ``_query_lane_count`` itself, in case a future call
    site reaches it without deriving IDLE from ``_active_heat_id`` the way
    ``_process_line``'s own trigger does."""
    manager = TimerManager(track_id=1, device=CHAMP)
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    manager._state = state
    manager._active_heat_id = 1

    await manager._query_lane_count()

    assert sent == []
    assert manager._lane_count_window_until == 0.0
    await manager.stop()


async def test_a_profile_with_no_lane_count_query_is_never_asked():
    from backend.services.timer.devices import MICROWIZARD

    manager = TimerManager(track_id=1, device=MICROWIZARD)
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    manager._state = TimerState.IDLE

    await manager._query_lane_count()

    assert sent == []
    assert manager._lane_count_window_until == 0.0
    await manager.stop()
