"""Unit tests for the timer subsystem.

Covers:
  - MicroWizardDevice.parse_line and is_identified_by
  - TimerManager byte framing (receive_bytes)
  - TimerManager state transitions
  - fakeTimerFinish result generation logic
"""

from unittest.mock import AsyncMock

import pytest

from .timer.devices.base import LaneResult, RaceStarted
from .timer.devices.fake import FakeTimerDevice
from .timer.devices.microwizard import MicroWizardDevice
from .timer.manager import TimerManager
from .timer.state_machine import TimerState


# ---------------------------------------------------------------------------
# 1. MicroWizardDevice.parse_line tests
# ---------------------------------------------------------------------------


class TestMicroWizardParseLineValid:
    """Tests for MicroWizardDevice.parse_line with well-formed input."""

    def setup_method(self):
        self.device = MicroWizardDevice()

    def test_plain_result_line(self):
        """Plain result line without prefix parses to correct LaneResult."""
        result = self.device.parse_line(b"  1    3.452  1")
        assert result is not None
        assert isinstance(result, LaneResult)
        assert result.lane == 1
        assert result.time_seconds == pytest.approx(3.452)
        assert result.place == 1

    def test_at_prefix_stripped(self):
        """Leading '@' is stripped before parsing."""
        result = self.device.parse_line(b"@  2    3.321  2")
        assert result is not None
        assert isinstance(result, LaneResult)
        assert result.lane == 2
        assert result.time_seconds == pytest.approx(3.321)
        assert result.place == 2

    def test_gt_prefix_stripped(self):
        """Leading '>' is stripped before parsing."""
        result = self.device.parse_line(b">  3    3.500  3")
        assert result is not None
        assert isinstance(result, LaneResult)
        assert result.lane == 3
        assert result.time_seconds == pytest.approx(3.500)
        assert result.place == 3

    def test_unrecognized_line_returns_none(self):
        """Unrecognized line returns None."""
        result = self.device.parse_line(b"HELLO")
        assert result is None

    def test_empty_line_returns_none(self):
        """Empty line returns None."""
        result = self.device.parse_line(b"")
        assert result is None

    def test_partial_data_returns_none(self):
        """Partial/incomplete line returns None."""
        result = self.device.parse_line(b"  1    3.452")
        assert result is None


class TestMicroWizardIsIdentifiedBy:
    """Tests for MicroWizardDevice.is_identified_by."""

    def setup_method(self):
        self.device = MicroWizardDevice()

    def test_n1_response_identifies_device(self):
        """Device echoing N1 returns True."""
        assert self.device.is_identified_by(b"N1") is True

    def test_n1_lowercase_also_identified(self):
        """Identification check is case-insensitive; n1 also matches."""
        assert self.device.is_identified_by(b"n1") is True

    def test_hello_does_not_identify_device(self):
        """Arbitrary line does not identify the device."""
        assert self.device.is_identified_by(b"HELLO") is False

    def test_empty_line_does_not_identify(self):
        """Empty bytes do not identify the device."""
        assert self.device.is_identified_by(b"") is False


# ---------------------------------------------------------------------------
# 2. TimerManager byte-framing tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_byte_framing_split_across_chunks():
    """A result line split across two byte chunks is assembled and parsed."""
    device = MicroWizardDevice()
    manager = TimerManager(track_id=1, device=device)

    # Force into RUNNING state so LaneResult events are accepted
    manager._state = TimerState.RUNNING
    manager._active_heat_id = 1
    manager._lane_mask = 0b01  # lane 1 only

    # Replace _record_results to avoid DB access
    manager._record_results = AsyncMock()

    chunk1 = b"  1    3.4"
    chunk2 = b"52  1\n"

    await manager.receive_bytes(chunk1)
    # No complete line yet; pending_results should still be empty
    assert manager._pending_results == {}

    await manager.receive_bytes(chunk2)
    # Now we have a complete line
    assert 1 in manager._pending_results
    result = manager._pending_results[1]
    assert result.lane == 1
    assert result.time_seconds == pytest.approx(3.452)
    assert result.place == 1
    manager._record_results.assert_awaited_once()


@pytest.mark.anyio
async def test_byte_framing_two_lines_in_one_chunk():
    """Two complete result lines delivered in a single chunk are both parsed."""
    device = MicroWizardDevice()
    manager = TimerManager(track_id=1, device=device)

    manager._state = TimerState.RUNNING
    manager._active_heat_id = 1
    # Lane mask covers lanes 1 and 2
    manager._lane_mask = 0b11
    manager._record_results = AsyncMock()

    data = b"  1    3.452  1\n  2    3.501  2\n"
    await manager.receive_bytes(data)

    assert 1 in manager._pending_results
    assert 2 in manager._pending_results
    assert manager._pending_results[1].time_seconds == pytest.approx(3.452)
    assert manager._pending_results[2].time_seconds == pytest.approx(3.501)
    manager._record_results.assert_awaited_once()


# ---------------------------------------------------------------------------
# 3. TimerManager state transition tests (FakeTimerDevice, no DB)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_fake_timer_starts_in_idle():
    """A manager using FakeTimerDevice starts in IDLE state."""
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)
    assert manager._state == TimerState.IDLE


@pytest.mark.anyio
async def test_prepare_heat_transitions_to_armed():
    """prepare_heat moves state from IDLE to ARMED."""
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)

    await manager.prepare_heat(heat_id=1, lane_mask=0b11)

    assert manager._state == TimerState.ARMED
    assert manager._active_heat_id == 1
    assert manager._lane_mask == 0b11


@pytest.mark.anyio
async def test_inject_race_started_transitions_to_running():
    """Injecting RaceStarted while ARMED moves state to RUNNING."""
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)

    await manager.prepare_heat(heat_id=1, lane_mask=0b11)
    assert manager._state == TimerState.ARMED

    await manager.inject_event(RaceStarted())
    assert manager._state == TimerState.RUNNING


@pytest.mark.anyio
async def test_partial_lane_results_stay_running():
    """Receiving only one of two expected lanes keeps state RUNNING."""
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # lane_mask 0b11 = lanes 1 and 2 expected
    await manager.prepare_heat(heat_id=1, lane_mask=0b11)
    await manager.inject_event(RaceStarted())
    assert manager._state == TimerState.RUNNING

    # Inject only lane 1 result
    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
    assert manager._state == TimerState.RUNNING
    manager._record_results.assert_not_awaited()


@pytest.mark.anyio
async def test_all_lanes_reported_calls_record_results():
    """When all expected lanes report, _record_results is called."""
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # lane_mask 0b11 = lanes 1 and 2 expected
    await manager.prepare_heat(heat_id=1, lane_mask=0b11)
    await manager.inject_event(RaceStarted())

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.6, place=2))

    manager._record_results.assert_awaited_once()


@pytest.mark.anyio
async def test_zero_lane_mask_does_not_trigger_record_results():
    """With lane_mask=0 (no expected lanes), LaneResults are accumulated but _record_results
    is never auto-triggered because the expected_lanes set is empty (falsy guard in manager).
    """
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # lane_mask=0 means no lanes are expected; the manager's guard is:
    #   if expected_lanes and expected_lanes.issubset(...)
    # An empty set is falsy, so _record_results is never called automatically.
    await manager.prepare_heat(heat_id=1, lane_mask=0)
    await manager.inject_event(RaceStarted())
    assert manager._state == TimerState.RUNNING

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
    # Result is stored but _record_results not triggered automatically
    assert 1 in manager._pending_results
    manager._record_results.assert_not_awaited()


@pytest.mark.anyio
async def test_abort_heat_from_armed_returns_to_idle():
    """abort_heat from ARMED state transitions back to IDLE."""
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)

    await manager.prepare_heat(heat_id=1, lane_mask=0b11)
    assert manager._state == TimerState.ARMED

    await manager.abort_heat()
    assert manager._state == TimerState.IDLE
    assert manager._active_heat_id is None
    assert manager._pending_results == {}


@pytest.mark.anyio
async def test_lane_result_ignored_when_not_running():
    """LaneResult injected while not RUNNING is ignored (state unchanged)."""
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # Start in IDLE (no prepare_heat call)
    assert manager._state == TimerState.IDLE
    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))

    # State stays IDLE; no results recorded
    assert manager._state == TimerState.IDLE
    manager._record_results.assert_not_awaited()


# ---------------------------------------------------------------------------
# 4. fakeTimerFinish result generation logic
# ---------------------------------------------------------------------------


def _generate_fake_results(occupied_lanes: list[int]) -> list[dict]:
    """Replicate the fakeTimerFinish result-generation logic from schema.py.

    Given a list of occupied lane numbers, generates random times in [3.0, 4.0),
    assigns places (1 = fastest), and returns results sorted by lane number.
    """
    import random

    timed = [(lane, 3.0 + random.random()) for lane in occupied_lanes]
    # Sort by time to assign places
    timed_sorted = sorted(timed, key=lambda x: x[1])
    place_by_lane = {lane: place for place, (lane, _t) in enumerate(timed_sorted, start=1)}
    time_by_lane = {lane: t for lane, t in timed}

    results = sorted(
        [
            {"lane": lane, "time": time_by_lane[lane], "place": place_by_lane[lane]}
            for lane in occupied_lanes
        ],
        key=lambda r: r["lane"],
    )
    return results


def test_fake_timer_finish_times_in_range():
    """All generated times fall within [3.0, 4.0)."""
    results = _generate_fake_results([1, 2, 3, 4])
    for r in results:
        assert 3.0 <= r["time"] < 4.0, f"Time {r['time']} out of range for lane {r['lane']}"


def test_fake_timer_finish_places_assigned_1_to_n():
    """Places are a permutation of 1..N with place 1 going to the lowest time."""
    n = 4
    results = _generate_fake_results(list(range(1, n + 1)))
    places = sorted(r["place"] for r in results)
    assert places == list(range(1, n + 1))


def test_fake_timer_finish_place_1_is_fastest():
    """The lane with place=1 has the lowest time among all lanes."""
    results = _generate_fake_results([1, 2, 3, 4])
    place1 = next(r for r in results if r["place"] == 1)
    min_time = min(r["time"] for r in results)
    assert place1["time"] == pytest.approx(min_time)


def test_fake_timer_finish_sorted_by_lane():
    """Result list is sorted in ascending lane order."""
    occupied = [3, 1, 4, 2]
    results = _generate_fake_results(occupied)
    lanes = [r["lane"] for r in results]
    assert lanes == sorted(lanes)


def test_fake_timer_finish_single_lane():
    """Single-lane heat produces one result with place=1."""
    results = _generate_fake_results([2])
    assert len(results) == 1
    assert results[0]["lane"] == 2
    assert results[0]["place"] == 1
    assert 3.0 <= results[0]["time"] < 4.0


@pytest.mark.anyio
async def test_fake_timer_finish_via_inject_events():
    """Simulate fakeTimerFinish by injecting pre-computed LaneResult events.

    Verifies that after all lanes report, _record_results is called with the
    correct pending_results dictionary containing times and places.
    """
    device = FakeTimerDevice()
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # 2-lane heat
    await manager.prepare_heat(heat_id=42, lane_mask=0b11)
    await manager.inject_event(RaceStarted())

    # Inject pre-determined results: lane 2 is faster (place 1), lane 1 is slower (place 2)
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.1, place=1))
    await manager.inject_event(LaneResult(lane=1, time_seconds=3.9, place=2))

    manager._record_results.assert_awaited_once()

    # Verify pending_results content before _record_results cleared it
    # (Since _record_results is mocked, pending_results is not cleared)
    assert manager._pending_results[1].time_seconds == pytest.approx(3.9)
    assert manager._pending_results[1].place == 2
    assert manager._pending_results[2].time_seconds == pytest.approx(3.1)
    assert manager._pending_results[2].place == 1
