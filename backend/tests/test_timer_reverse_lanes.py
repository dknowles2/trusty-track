"""Reverse lane numbering (#553, stage 1).

A finish-line unit is wired to lanes 1..N in whatever order the installer
happened to plug it in; when that order runs opposite to how the track is
numbered on the wall, every result lands on the wrong car. `Track.reverse_lanes`
is the fix — a fact about this venue's cable, on `Track` rather than on
`TimerProfile`, exactly as `Track.remote_start_installed` is a fact about this
track's solenoid rather than about the device (#111).

The mirror lives entirely in `TimerManager`, at the one seam a device-reported
lane index becomes the track's own lane number — see the "Reverse lane
numbering (#553)" block above `_translated_lane` in `manager.py`. These tests
exercise that seam directly; `test_timer_recordings.py`'s
`test_a_recorded_session_is_mirrored_through_the_manager` replays a real
recording through `TimerManager` (not just the profile) for the same proof
against real device output.
"""

from unittest.mock import AsyncMock

from backend.db import models
from backend.services.timer.devices import FAKE, MICROWIZARD
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


def manager(
    profile=MICROWIZARD, *, lane_count: int = 4, reverse_lanes: bool = True
) -> TimerManager:
    return TimerManager(
        track_id=1,
        device=profile,
        lane_count=lane_count,
        reverse_lanes=reverse_lanes,
    )


# ---------------------------------------------------------------------------
# Read side: a result off the wire lands on the mirrored lane
# ---------------------------------------------------------------------------


async def test_a_lane_result_is_mirrored():
    """Device lane 1 on a 4-lane reversed track is track lane 4, and so on."""
    mgr = manager(lane_count=4)
    mgr._state = TimerState.RUNNING

    await mgr.receive_bytes(b"A=3.500!\r")

    assert list(mgr._pending_results.keys()) == [4]
    assert mgr._pending_results[4].time_seconds == 3.500


async def test_the_middle_lane_of_an_odd_count_is_unmoved():
    """Lane_count + 1 - lane is its own fixed point at the centre."""
    mgr = manager(lane_count=3)
    mgr._state = TimerState.RUNNING

    await mgr.receive_bytes(b"B=3.500!\r")  # device lane 2 of 3

    assert list(mgr._pending_results.keys()) == [2]


async def test_not_reversed_is_unchanged():
    mgr = manager(lane_count=4, reverse_lanes=False)
    mgr._state = TimerState.RUNNING

    await mgr.receive_bytes(b"A=3.500!\r")

    assert list(mgr._pending_results.keys()) == [1]


async def test_a_device_lane_beyond_the_track_is_left_alone():
    """A 6-lane MicroWizard on a 4-lane reversed track: lanes 5 and 6 have no
    matching track lane to mirror onto, so they pass through unchanged."""
    mgr = manager(lane_count=4)
    mgr._state = TimerState.RUNNING

    await mgr.receive_bytes(b"E=3.500!\r")  # device lane 5, beyond lane_count

    assert list(mgr._pending_results.keys()) == [5]


# ---------------------------------------------------------------------------
# Write side: HeatPrep's mask commands address the device's own lanes
# ---------------------------------------------------------------------------


async def test_arming_masks_the_devices_own_lanes():
    """Track lanes 1 and 2 are racing on a reversed 4-lane MicroWizard, so the
    device is told to mask its own lanes C and D (=> track lanes 2 and 1),
    not A and B.

    A reversal applied only on the read side would record correctly-labelled
    results while arming (and so timing) the wrong two lanes — see the "every
    crossing flips exactly once" note above `_translated_lane`.
    """
    mgr = manager(lane_count=4)
    mgr._send_commands = AsyncMock()

    await mgr.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011)

    commands = mgr._send_commands.call_args.args[0]
    assert b"MA" in commands
    assert b"MB" in commands
    assert b"MC" not in commands
    assert b"MD" not in commands


async def test_arming_is_unchanged_when_not_reversed():
    mgr = manager(lane_count=4, reverse_lanes=False)
    mgr._send_commands = AsyncMock()

    await mgr.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011)

    commands = mgr._send_commands.call_args.args[0]
    assert b"MC" in commands
    assert b"MD" in commands
    assert b"MA" not in commands
    assert b"MB" not in commands


async def test_a_bench_test_arms_every_lane_either_way():
    """The full mask, mirrored, is the same full mask — nothing to prove
    wrong here, but a bench test (#235) is another `prepare_heat_commands`
    call site and it must not raise."""
    mgr = manager(lane_count=4)
    mgr._send_commands = AsyncMock()

    await mgr.prepare_test_heat(lane_count=4)

    commands = mgr._send_commands.call_args.args[0]
    for masked in (b"MA", b"MB", b"MC", b"MD"):
        assert masked not in commands


# ---------------------------------------------------------------------------
# The fake timer is not a device with lanes to mirror (#553)
# ---------------------------------------------------------------------------


async def test_the_fake_timer_is_not_mirrored():
    """`inject_event` bypasses `_process_line` — and so `_translate_incoming`
    — entirely. Fake results are built from the heat's own stored lanes
    (already the track's numbering), not read off a device, so there is
    nothing here for a reversed cable to have gotten backwards. Mirroring
    them anyway would scramble an otherwise-correct fake heat the moment an
    operator ticked the box while testing on the practice timer.
    """
    mgr = manager(FAKE, lane_count=4)
    mgr._record_results = AsyncMock()

    await mgr.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b0011)
    await mgr.inject_event(RaceStarted())
    await mgr.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
    await mgr.inject_event(LaneResult(lane=2, time_seconds=3.6, place=2))

    assert set(mgr._pending_results.keys()) == {1, 2}


# ---------------------------------------------------------------------------
# The mirror is its own inverse
# ---------------------------------------------------------------------------


def test_translated_lane_is_an_involution():
    mgr = manager(lane_count=4)
    for lane in range(1, 5):
        assert mgr._translated_lane(mgr._translated_lane(lane)) == lane


def test_translated_lane_off_when_not_reversed():
    mgr = manager(lane_count=4, reverse_lanes=False)
    for lane in range(1, 5):
        assert mgr._translated_lane(lane) == lane


# ---------------------------------------------------------------------------
# Through the API
# ---------------------------------------------------------------------------


def test_the_track_setting_round_trips(client):
    """Off by default, and settable — the same shape as
    `remote_start_installed`'s round trip in `test_timer_remote_start.py`."""
    created = client.post(
        "/graphql",
        json={
            "query": """
            mutation {
                createTrack(track: {name: "Reversed Track", timerType: "FAKE"}) {
                    id
                    reverseLanes
                }
            }
            """
        },
    ).json()["data"]["createTrack"]

    assert created["reverseLanes"] is False

    updated = client.post(
        "/graphql",
        json={
            "query": """
            mutation($id: Int!) {
                updateTrack(id: $id, track: {
                    name: "Reversed Track",
                    timerType: "FAKE",
                    reverseLanes: true
                }) {
                    reverseLanes
                }
            }
            """,
            "variables": {"id": created["id"]},
        },
    ).json()["data"]["updateTrack"]

    assert updated["reverseLanes"] is True
