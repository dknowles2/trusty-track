"""Arming is confirmed, not merely sent (#780).

Found while closing #761 (PR #778), which stops a phantom lane's result being
scored once one slips through — the *consequence*. This is the upstream cause
that PR deliberately left: ``TimerManager._send_commands`` writes a profile's
``HeatPrep`` commands, including the lane mask, and moves on. Nothing noticed
whether the device actually acknowledged them before the heat was reported
ARMED.

``_pending_acks`` already existed and ``_process_line`` consumed
acknowledgements through it — but only to stay quiet about them. A dropped
mask command, a NAK, or an ack arriving while the device is still finishing
its boot banner all looked exactly like success: the operator's badge said
ARMED and the lanes it asked for might not be the lanes that were live.

The scope of the fix is deliberately narrow, and this file pins why: only the
*arm* command (``TimerProfile.heat_prep.arm``) is watched, not every
individual mask command, even for the one profile (MicroWizard) that declares
an acknowledgement for both. ``timer_recordings/fasttrack-mark-set.playback``
— a real K3's own recorded session, not a line anyone here wrote down — shows
the unmask command's declared "AC" reply never actually arrives in that
session (only an echo), while the arm command's "*" arrives cleanly every
time. Waiting on a per-command ack the one real recording available shows is
unreliable would risk exactly the false alarm the issue itself warns against;
the arm command is the one signal this file has real evidence for.

Two of thirteen profiles declare any acknowledgement for their arm command at
all — MicroWizard and PDT — so this is opt-in per profile, driven by
``TimerProfile.acks``, and every other profile (including the fake timer and
the ten other DerbyNet-adapted ones) is completely unaffected: arming stays
exactly as optimistic as it has always been for them.
"""

import asyncio
from dataclasses import replace

import pytest

from backend.db import models
from backend.services.timer import manager as manager_module
from backend.services.timer.devices import FAKE, MICROWIZARD
from backend.services.timer.devices.derbynet import PDT
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

BANNER = b"Copyright (c) Micro Wizard 2002-2009\r"


def _fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(manager_module, "ARM_ACK_WAIT_SECONDS", 0.2)
    monkeypatch.setattr(manager_module, "ARM_ACK_POLL_SECONDS", 0.01)


def collecting(manager: TimerManager) -> list[bytes]:
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    return sent


async def _idle_microwizard() -> tuple[TimerManager, list[bytes]]:
    """A MicroWizard manager identified and sitting in IDLE, ready to arm."""
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    sent = collecting(manager)
    await manager.handle_connect()
    # The device answers N1 and N2 exactly as the profile says it will.
    await manager.receive_bytes(b"\r\n*\r\n*\r\n")
    await manager.receive_bytes(BANNER)
    assert manager._state is TimerState.IDLE
    sent.clear()
    return manager, sent


async def _wait_settled(manager: TimerManager, deadline: float = 1.0) -> None:
    """Give the background arm-ack watch a chance to run to completion."""
    step = 0.02
    elapsed = 0.0
    while elapsed < deadline:
        await asyncio.sleep(step)
        elapsed += step
        if manager._arm_ack_task is None or manager._arm_ack_task.done():
            return


async def test_a_dropped_arm_ack_is_noticed(monkeypatch):
    """The device never answers "LR" at all — the bytes went nowhere.

    Before the fix, nothing ever noticed: the manager reported ARMED and
    stayed there forever, with the operator none the wiser.
    """
    _fast(monkeypatch)
    manager, _ = await _idle_microwizard()

    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
    )

    # Reported ARMED immediately — arming stays optimistic; confirming is a
    # background question, not something the operator waits on.
    assert manager._state is TimerState.ARMED

    # No acknowledgement of any kind arrives on this test's wire.
    await _wait_settled(manager)

    assert manager._state is TimerState.FAULT
    assert manager._active_heat_id is None
    assert manager._last_error is not None
    assert "arm" in manager._last_error.lower()

    await manager.stop()


async def test_a_nakked_arm_command_is_noticed(monkeypatch):
    """The device answers, but not with what the profile says an arm ack
    looks like — a NAK, or an answer to a different command entirely."""
    _fast(monkeypatch)
    manager, _ = await _idle_microwizard()

    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
    )
    assert manager._state is TimerState.ARMED

    # Something arrives, but it is neither the expected "*" nor an echo of
    # "LR" — an out-of-order or garbled response.
    await manager.receive_bytes(b"NAK\r")

    await _wait_settled(manager)

    assert manager._state is TimerState.FAULT
    assert manager._active_heat_id is None

    await manager.stop()


async def test_a_confirmed_arm_stays_armed(monkeypatch):
    """The happy path: the device answers exactly as documented, and nothing
    about the operator's experience changes."""
    _fast(monkeypatch)
    manager, sent = await _idle_microwizard()

    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
    )
    assert manager._state is TimerState.ARMED

    # Echo, then the real acknowledgement, for every command in the batch —
    # unmask, four masks (lanes 3-6 are out under a 0b0011 mask), then arm.
    # The unmask command's own "AC" is deliberately left out here, mirroring
    # the real K3 recording this design is checked against — it must not
    # matter, because only the arm command is watched.
    for cmd in (b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"):
        await manager.receive_bytes(cmd + b"\r")
        if cmd != b"MG":
            await manager.receive_bytes(b"*\r")

    await _wait_settled(manager)

    assert manager._state is TimerState.ARMED
    assert manager._active_heat_id == 1
    assert manager._last_error is None

    await manager.stop()


async def test_a_profile_with_no_declared_ack_is_unaffected(monkeypatch):
    """The opt-in point: a profile that never promised an acknowledgement for
    its arm command must behave exactly as it always has — no wait, no
    background watch, no possibility of a false FAULT."""
    _fast(monkeypatch)
    mute = replace(MICROWIZARD, key="mute-acks", acks=())
    manager = TimerManager(track_id=1, device=mute)
    collecting(manager)
    await manager.handle_connect()
    await manager.receive_bytes(b"\r\n\r\n")
    await manager.receive_bytes(BANNER)
    assert manager._state is TimerState.IDLE

    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
    )

    assert manager._state is TimerState.ARMED
    # No confirmation was ever promised, so no watch was ever started.
    assert manager._arm_ack_task is None

    await asyncio.sleep(0.3)

    assert manager._state is TimerState.ARMED
    assert manager._last_error is None

    await manager.stop()


async def test_the_fake_timer_is_unaffected(monkeypatch):
    """No serial port, no acks, no watch — the default state of the world."""
    _fast(monkeypatch)
    manager = TimerManager(track_id=1, device=FAKE)
    assert manager._state is TimerState.IDLE

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)

    assert manager._state is TimerState.ARMED
    assert manager._arm_ack_task is None

    await manager.stop()


async def test_pdts_arm_command_alone_is_watched(monkeypatch):
    """PDT declares an acknowledgement only for its arm command ("R" → "K"),
    not for its mask commands — the same opt-in shape, on a second profile."""
    _fast(monkeypatch)
    manager = TimerManager(track_id=1, device=PDT)
    collecting(manager)
    manager._state = TimerState.IDLE

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b01)

    assert manager._state is TimerState.ARMED
    assert manager._arm_ack_task is not None

    # Nothing ever answers "R".
    await _wait_settled(manager)

    assert manager._state is TimerState.FAULT

    await manager.stop()


async def test_aborting_while_unconfirmed_cancels_the_watch():
    """The operator does not have to wait out the confirmation window to move
    on — aborting (or re-arming, or resetting) supersedes it cleanly rather
    than racing a FAULT transition against whatever they did next."""
    manager, _ = await _idle_microwizard()

    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
    )
    assert manager._arm_ack_task is not None

    await manager.abort_heat()

    assert manager._state is TimerState.IDLE
    # Give the (now-cancelled) watch every chance to misfire before checking.
    await asyncio.sleep(0.1)
    assert manager._state is TimerState.IDLE
    assert manager._last_error is None

    await manager.stop()


async def test_reconnect_rearm_starts_arm_ack_watch_and_faults_on_dropped_ack(
    monkeypatch,
):
    """#815: When a device reconnects while a heat is armed, the re-arming
    sequence must start the arm-ack watch so a dropped arm command is caught."""
    _fast(monkeypatch)
    manager, sent = await _idle_microwizard()

    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
    )
    # Confirm initial arming
    for cmd in (b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"):
        await manager.receive_bytes(cmd + b"\r")
        if cmd != b"MG":
            await manager.receive_bytes(b"*\r")
    await _wait_settled(manager)
    assert manager._state is TimerState.ARMED
    sent.clear()

    # Device reconnects / reboots mid-heat
    manager._state = TimerState.CONNECTED
    # Identification line received, triggering re-arm sequence in _process_line
    await manager.receive_bytes(BANNER)

    # State transitions back to ARMED and sends prepare_heat_commands
    assert manager._state is TimerState.ARMED
    # The arm-ack watch must have been started
    assert manager._arm_ack_task is not None

    # No acks arrive for the re-arm commands
    await _wait_settled(manager)

    assert manager._state is TimerState.FAULT
    assert manager._active_heat_id is None
    assert manager._last_error is not None
    assert "arm" in manager._last_error.lower()

    await manager.stop()


async def test_reconnect_rearm_confirmed_ack_stays_armed(monkeypatch):
    """#815: When a device reconnects while a heat is armed and confirms the re-arm,
    it stays ARMED."""
    _fast(monkeypatch)
    manager, sent = await _idle_microwizard()

    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
    )
    for cmd in (b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"):
        await manager.receive_bytes(cmd + b"\r")
        if cmd != b"MG":
            await manager.receive_bytes(b"*\r")
    await _wait_settled(manager)
    assert manager._state is TimerState.ARMED
    sent.clear()

    # Device reconnects mid-heat
    manager._state = TimerState.CONNECTED
    await manager.receive_bytes(BANNER)
    assert manager._state is TimerState.ARMED
    assert manager._arm_ack_task is not None

    # Echo and ack for re-arm commands arrive
    for cmd in (b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"):
        await manager.receive_bytes(cmd + b"\r")
        if cmd != b"MG":
            await manager.receive_bytes(b"*\r")

    await _wait_settled(manager)

    assert manager._state is TimerState.ARMED
    assert manager._active_heat_id == 1
    assert manager._last_error is None

    await manager.stop()


async def test_the_watch_survives_the_ack_log_wrapping_around(monkeypatch):
    """#876: `_ack_log` is a bounded `deque(maxlen=64)`, and the watch used to
    remember its own starting point as `len(self._ack_log)` — an absolute
    index into that deque. `len()` cannot exceed 64, so once the deque had
    filled even once, every later watch recorded a starting point of 64 and
    `list(self._ack_log)[64:]` is always `[]`: the acknowledgement could
    never be found again, however promptly the device answered, and every
    arm from that point on timed out into a false FAULT.

    A four-lane MicroWizard logs five acknowledgements per confirmed arm
    (unmask's echo carries no ack, but each of the four masks and the arm
    command itself do), so the deque fills after roughly thirteen heats — a
    quarter of the way through a real pack derby. This arms, confirms and
    disarms enough heats to wrap the deque at least once, then arms one more
    time and checks the confirmation still resolves rather than timing out.
    """
    _fast(monkeypatch)
    manager, _ = await _idle_microwizard()

    async def arm_and_confirm(heat_id: int) -> None:
        await manager.prepare_heat(
            heat_id=heat_id, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011
        )
        for cmd in (b"MG", b"MC", b"MD", b"ME", b"MF", b"LR"):
            await manager.receive_bytes(cmd + b"\r")
            if cmd != b"MG":
                await manager.receive_bytes(b"*\r")
        await _wait_settled(manager)
        assert manager._state is TimerState.ARMED, f"heat {heat_id} faulted"
        assert manager._last_error is None, f"heat {heat_id}: {manager._last_error}"

    # 5 logged acks per heat (MC, MD, ME, MF, LR) x 16 heats = 80, well past
    # the deque's maxlen of 64 -- it wraps around several times over before
    # this loop finishes, and every one of these must still confirm cleanly.
    for i in range(1, 17):
        await arm_and_confirm(i)

    await manager.stop()
