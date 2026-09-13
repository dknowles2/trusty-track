"""The state-machine transitions ring (#1079).

The debug panel `RaceExecution.tsx` shows under Debugging Mode reads
`TimerStatus.transitions`, which `TimerManager` records every time
`_transition` actually changes state. Unlike the hardware mole's serial
log, this fills in for every timer type, including `FAKE` — the one the
public demo's own track always is.
"""

import pytest

from backend.db import models
from backend.services.timer.devices import FAKE
from backend.services.timer.manager import MAX_TRANSITIONS_LOG, TimerManager
from backend.services.timer.state_machine import TimerState


def _manager() -> TimerManager:
    return TimerManager(track_id=1, device=FAKE)


@pytest.mark.asyncio
async def test_starts_empty():
    manager = _manager()
    assert manager.status().transitions == []


@pytest.mark.asyncio
async def test_a_transition_is_recorded_with_from_and_to():
    manager = _manager()

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.FREE, lane_mask=0b01)

    transitions = manager.status().transitions
    assert transitions
    last = transitions[-1]
    assert last.to_state == TimerState.ARMED.value
    # `at` is an ISO 8601 timestamp string, the same shape `SerialLogEntry`
    # already uses for its own `timestamp` field.
    assert "T" in last.at


@pytest.mark.asyncio
async def test_a_no_op_transition_is_not_recorded():
    """`_transition` only records (and publishes) a genuine change — the
    same short-circuit it already had for publishing, extended to the ring
    rather than given a second check."""
    manager = _manager()
    before = len(manager.status().transitions)

    await manager._transition(manager._state)  # noqa: SLF001 - unit test of the seam itself

    assert len(manager.status().transitions) == before


@pytest.mark.asyncio
async def test_the_ring_is_bounded():
    manager = _manager()

    for _ in range(MAX_TRANSITIONS_LOG + 20):
        await manager._transition(TimerState.ARMED)  # noqa: SLF001
        await manager._transition(TimerState.IDLE)  # noqa: SLF001

    assert len(manager.status().transitions) == MAX_TRANSITIONS_LOG
