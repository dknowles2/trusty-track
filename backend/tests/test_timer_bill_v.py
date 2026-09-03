"""Bill V's Derby Timer parses what its protocol notes (issue #632) say it
sends.

Like `test_timer_derbynet_profiles.py`, this is a transcription check: the
lines below are taken directly from the issue, so a mistyped regex fails
here. It cannot catch a *wrong* transcription — nobody has run this profile
against the real device, which its provenance says outright.
"""

from unittest.mock import AsyncMock

import pytest

from backend.db import models
from backend.services.timer.devices import ALL_PROFILES, BILL_V
from backend.services.timer.devices.base import (
    GateClosed,
    GateOpen,
    LaneResult,
    RaceStarted,
)
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


def one(result: object) -> object:
    """Unwrap whatever `parse_line` gave back into a single event."""
    if isinstance(result, list):
        assert len(result) == 1, result
        return result[0]
    return result


def test_it_is_in_the_registry():
    assert BILL_V in ALL_PROFILES


# ---------------------------------------------------------------------------
# Identification
# ---------------------------------------------------------------------------


def test_the_probe_answer_identifies_the_device():
    """`CC` is the documented probe; `@TM` is the documented answer."""
    assert BILL_V.probe == (b"CC",)
    assert BILL_V.is_identified_by(b"@TM") is True
    assert BILL_V.is_identified_by(b"anything else") is False


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


def test_the_results_line_parses_to_two_lane_results_in_order():
    """`Times: h-a.aaaa j-b.bbbb`: the first pair is always lane 1, the
    second always lane 2, whatever the finish order digit says — it is a
    place, not a lane identifier."""
    events = BILL_V.parse_line(b"Times: 1-3.2451 2-3.6782")

    assert isinstance(events, list)
    assert len(events) == 2

    lane1, lane2 = events
    assert isinstance(lane1, LaneResult)
    assert lane1.lane == 1
    assert lane1.time_seconds == pytest.approx(3.2451)
    assert lane1.place == 1

    assert isinstance(lane2, LaneResult)
    assert lane2.lane == 2
    assert lane2.time_seconds == pytest.approx(3.6782)
    assert lane2.place == 2


def test_the_finish_order_digit_is_a_place_not_a_lane():
    """Lane 2 can still finish first: the lane comes from position in the
    line, the place from the digit that names *that* lane's own fragment."""
    events = BILL_V.parse_line(b"Times: 2-3.6782 1-3.2451")

    assert isinstance(events, list)
    lane1, lane2 = events

    assert lane1.lane == 1
    assert lane1.place == 2
    assert lane1.time_seconds == pytest.approx(3.6782)

    assert lane2.lane == 2
    assert lane2.place == 1
    assert lane2.time_seconds == pytest.approx(3.2451)


# ---------------------------------------------------------------------------
# Status lines
# ---------------------------------------------------------------------------


def test_ready_is_gate_closed():
    assert one(BILL_V.parse_line(b"RDY")) == GateClosed()


def test_not_ready_is_gate_open():
    assert one(BILL_V.parse_line(b"NRD")) == GateOpen()


def test_racing_is_the_start_signal():
    assert one(BILL_V.parse_line(b"RAC")) == RaceStarted()


@pytest.mark.parametrize(
    "line",
    [
        # FIN carries no data of its own — the Times: line is what reports
        # the result — so it is recognised and produces nothing.
        b"FIN",
        # GSW and TRK are fault conditions the current event vocabulary has
        # no matcher for (see the module docstring in bill_v.py); recognised
        # rather than left to read as an unidentified device.
        b"GSW",
        b"TRK",
        b"TRK, 1",
        b"TRK, 1, 2",
    ],
)
def test_status_lines_with_no_event_are_recognised_and_silent(line: bytes):
    assert BILL_V.parse_line(line) == []


def test_an_unknown_line_is_not_recognised():
    assert BILL_V.parse_line(b"nonsense") is None


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def test_masking_addresses_lanes_by_their_own_number():
    """M1/M2 mask lanes 1 and 2 by name; U unmasks everything. lane_mask=0b01
    (only lane 1 racing) masks out lane 2."""
    assert BILL_V.prepare_heat_commands(0b01) == [b"U", b"M2"]
    assert BILL_V.prepare_heat_commands(0b10) == [b"U", b"M1"]
    assert BILL_V.prepare_heat_commands(0b11) == [b"U"]


# ---------------------------------------------------------------------------
# A manager-level run
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_a_full_run_is_armed_started_and_recorded():
    """arm -> RAC -> Times: -> recorded, driven through the real manager
    rather than synthetic events."""
    manager = TimerManager(track_id=1, device=BILL_V)
    manager._record_results = AsyncMock()

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)
    assert manager._state == TimerState.ARMED

    await manager.receive_bytes(b"RAC\n")
    assert manager._state == TimerState.RUNNING

    await manager.receive_bytes(b"Times: 1-3.2451 2-3.6782\n")

    assert 1 in manager._pending_results
    assert 2 in manager._pending_results
    assert manager._pending_results[1].time_seconds == pytest.approx(3.2451)
    assert manager._pending_results[2].time_seconds == pytest.approx(3.6782)
    manager._record_results.assert_awaited_once()
