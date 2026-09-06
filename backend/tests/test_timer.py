"""Unit tests for the timer subsystem.

Covers:
  - the MicroWizard profile's parse_line and is_identified_by
  - TimerManager byte framing (receive_bytes)
  - TimerManager state transitions
  - fakeTimerFinish result generation logic
"""

from unittest.mock import AsyncMock

import pytest

from backend.db import models
from backend.services.timer.devices import FAKE, MICROWIZARD
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState

# ---------------------------------------------------------------------------
# 1. the MicroWizard profile's parse_line tests
# ---------------------------------------------------------------------------


class TestMicroWizardParseLineValid:
    """Tests for the MicroWizard profile's parse_line with well-formed input."""

    def setup_method(self):
        self.device = MICROWIZARD

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


class TestMicroWizardParseLineNewFormat:
    """The MicroWizard profile's parse_line, on new-format multi-lane input."""

    def setup_method(self):
        self.device = MICROWIZARD

    def test_multi_lane_with_places(self):
        """New-format multi-lane line with symbols for place 1-6."""
        # A=3.001! (1st), B=3.002" (2nd), C=3.003# (3rd), D=3.004$ (4th)
        # E=3.005% (5th), F=3.006& (6th)
        line = b'A=3.001! B=3.002" C=3.003# D=3.004$ E=3.005% F=3.006&'
        results = self.device.parse_line(line)
        assert isinstance(results, list)
        assert len(results) == 6

        # Lane 1 (A)
        assert results[0].lane == 1
        assert results[0].time_seconds == pytest.approx(3.001)
        assert results[0].place == 1

        # Lane 2 (B)
        assert results[1].lane == 2
        assert results[1].time_seconds == pytest.approx(3.002)
        assert results[1].place == 2

        # Lane 3 (C)
        assert results[2].lane == 3
        assert results[2].time_seconds == pytest.approx(3.003)
        assert results[2].place == 3

        # Lane 4 (D)
        assert results[3].lane == 4
        assert results[3].time_seconds == pytest.approx(3.004)
        assert results[3].place == 4

        # Lane 5 (E)
        assert results[4].lane == 5
        assert results[4].time_seconds == pytest.approx(3.005)
        assert results[4].place == 5

        # Lane 6 (F)
        assert results[5].lane == 6
        assert results[5].time_seconds == pytest.approx(3.006)
        assert results[5].place == 6

    def test_multi_lane_no_places(self):
        """Multi-lane format without placement symbols (place=0)."""
        line = b"A=3.100  B=3.200  C=3.300"
        results = self.device.parse_line(line)
        assert isinstance(results, list)
        assert len(results) == 3
        for i, res in enumerate(results):
            assert res.lane == i + 1
            assert res.place == 0


class TestMicroWizardIsIdentifiedBy:
    """Tests for the MicroWizard profile's is_identified_by."""

    def setup_method(self):
        self.device = MICROWIZARD

    def test_rv_response_identifies_device(self):
        """Device returning a version string returns True."""
        assert (
            self.device.is_identified_by(
                b"Copyright (c) Micro Wizard 2001-2009 a K3 2.10"
            )
            is True
        )

    def test_identification_is_case_insensitive(self):
        """Identification check is case-insensitive."""
        assert (
            self.device.is_identified_by(b"copyright (c) micro wizard 2002-2009")
            is True
        )

    def test_version_line_identifies(self):
        """The version line is informational and does NOT identify."""
        # Line 2 alone should not identify
        assert (
            self.device.is_identified_by(b"K2 Version 2.3A  Serial Number29284")
            is False
        )

        # Line 1 identifies
        assert (
            self.device.is_identified_by(b"Copyright (c) Micro Wizard 2001-2009")
            is True
        )

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
    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)

    # Force into RUNNING state so LaneResult events are accepted
    manager._state = TimerState.RUNNING
    manager._active_heat_id = 1
    manager._lane_mask = 0b01  # lane 1 only

    # Replace _record_results to avoid DB access
    manager._record_results = AsyncMock()

    chunk1 = b"  1    3.4"
    chunk2 = b"52  1\r\n"

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
    device = MICROWIZARD
    manager = TimerManager(track_id=1, device=device)

    manager._state = TimerState.RUNNING
    manager._active_heat_id = 1
    # Lane mask covers lanes 1 and 2
    manager._lane_mask = 0b11
    manager._record_results = AsyncMock()

    data = b"  1    3.452  1\r\n  2    3.501  2\r\n"
    await manager.receive_bytes(data)

    assert 1 in manager._pending_results
    assert 2 in manager._pending_results
    assert manager._pending_results[1].time_seconds == pytest.approx(3.452)
    assert manager._pending_results[2].time_seconds == pytest.approx(3.501)
    manager._record_results.assert_awaited_once()


# ---------------------------------------------------------------------------
# 3. TimerManager state transition tests (the fake timer profile, no DB)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_fake_timer_starts_in_idle():
    """A manager using the fake timer profile starts in IDLE state."""
    device = FAKE
    manager = TimerManager(track_id=1, device=device)
    assert manager._state == TimerState.IDLE


@pytest.mark.anyio
async def test_prepare_heat_transitions_to_armed():
    """prepare_heat moves state from IDLE to ARMED."""
    device = FAKE
    manager = TimerManager(track_id=1, device=device)

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)

    assert manager._state == TimerState.ARMED
    assert manager._active_heat_id == 1
    assert manager._lane_mask == 0b11


@pytest.mark.anyio
async def test_inject_race_started_transitions_to_running():
    """Injecting RaceStarted while ARMED moves state to RUNNING."""
    device = FAKE
    manager = TimerManager(track_id=1, device=device)

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)
    assert manager._state == TimerState.ARMED

    await manager.inject_event(RaceStarted())
    assert manager._state == TimerState.RUNNING


@pytest.mark.anyio
async def test_partial_lane_results_stay_running():
    """Receiving only one of two expected lanes keeps state RUNNING."""
    device = FAKE
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # lane_mask 0b11 = lanes 1 and 2 expected
    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)
    await manager.inject_event(RaceStarted())
    assert manager._state == TimerState.RUNNING

    # Inject only lane 1 result
    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
    assert manager._state == TimerState.RUNNING
    manager._record_results.assert_not_awaited()


@pytest.mark.anyio
async def test_all_lanes_reported_calls_record_results():
    """When all expected lanes report, _record_results is called."""
    device = FAKE
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # lane_mask 0b11 = lanes 1 and 2 expected
    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)
    await manager.inject_event(RaceStarted())

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.6, place=2))

    manager._record_results.assert_awaited_once()


@pytest.mark.anyio
async def test_lane_result_for_unarmed_lane_is_ignored():
    """A result for a lane the heat never armed must not take a place (#761).

    A dropped mask acknowledgement, or a device that reports every sensor
    regardless of what it was told to arm, can hand back a `LaneResult` for
    a lane outside `_lane_mask`. That lane has no `HeatLane` row for the
    result to belong to, so it must be dropped rather than recorded or
    allowed into the place calculation — otherwise a phantom lane can take
    place 1 ahead of the lanes the heat actually holds.
    """
    device = FAKE
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # lane_mask 0b011 = lanes 1 and 2 armed; lane 3 is not.
    await manager.prepare_heat(
        heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b011
    )
    await manager.inject_event(RaceStarted())

    # A phantom result for the unarmed lane arrives first, and fastest.
    await manager.inject_event(LaneResult(lane=3, time_seconds=1.000, place=0))
    assert 3 not in manager._pending_results
    manager._record_results.assert_not_awaited()

    # The two genuinely armed lanes report afterward.
    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=0))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.8, place=0))

    manager._record_results.assert_awaited_once()
    assert 3 not in manager._pending_results
    assert manager._pending_results[1].place == 1
    assert manager._pending_results[2].place == 2


@pytest.mark.anyio
async def test_zero_lane_mask_does_not_trigger_record_results():
    """With lane_mask=0, LaneResults accumulate but _record_results is never
    auto-triggered because the expected_lanes set is empty (falsy guard in manager).
    """
    device = FAKE
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # lane_mask=0 means no lanes are expected; the manager's guard is:
    #   if expected_lanes and expected_lanes.issubset(...)
    # An empty set is falsy, so _record_results is never called automatically.
    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0)
    await manager.inject_event(RaceStarted())
    assert manager._state == TimerState.RUNNING

    await manager.inject_event(LaneResult(lane=1, time_seconds=3.5, place=1))
    # Result is stored but _record_results not triggered automatically
    assert 1 in manager._pending_results
    manager._record_results.assert_not_awaited()


@pytest.mark.anyio
async def test_abort_heat_from_armed_returns_to_idle():
    """abort_heat from ARMED state transitions back to IDLE."""
    device = FAKE
    manager = TimerManager(track_id=1, device=device)

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)
    assert manager._state == TimerState.ARMED

    await manager.abort_heat()
    assert manager._state == TimerState.IDLE
    assert manager._active_heat_id is None
    assert manager._pending_results == {}


@pytest.mark.anyio
async def test_lane_result_ignored_when_not_running():
    """LaneResult injected while not RUNNING is ignored (state unchanged)."""
    device = FAKE
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
    place_by_lane = {
        lane: place for place, (lane, _t) in enumerate(timed_sorted, start=1)
    }
    time_by_lane = dict(timed)

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
        assert 3.0 <= r["time"] < 4.0, (
            f"Time {r['time']} out of range for lane {r['lane']}"
        )


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
    device = FAKE
    manager = TimerManager(track_id=1, device=device)
    manager._record_results = AsyncMock()

    # 2-lane heat
    await manager.prepare_heat(
        heat_id=42, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )
    await manager.inject_event(RaceStarted())

    # lane 2 faster (place 1), lane 1 slower (place 2)
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.1, place=1))
    await manager.inject_event(LaneResult(lane=1, time_seconds=3.9, place=2))

    manager._record_results.assert_awaited_once()

    # Verify pending_results content before _record_results cleared it
    # (Since _record_results is mocked, pending_results is not cleared)
    assert manager._pending_results[1].time_seconds == pytest.approx(3.9)
    assert manager._pending_results[1].place == 2
    assert manager._pending_results[2].time_seconds == pytest.approx(3.1)
    assert manager._pending_results[2].place == 1
