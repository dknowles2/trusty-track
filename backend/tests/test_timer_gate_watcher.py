"""Asking a timer whether the start gate is closed (issue #89).

Some timers announce both gate edges. Others only answer when asked, and six of
DerbyNet's thirteen profiles are the asking kind — so importing them needs this
first.

Two things here are not obvious and are the reason the mechanism looks the way
it does.

**Gate answers are scoped to the poll that asked for them.** Real ones are as
short as `0`, `U`, `O` and `.` — PDT's gate-closed pattern is a bare `.`, which
matches any character at all. Applied to general traffic they would claim
everything. They are only read as gate answers inside the window that follows a
query.

**The debounce is for polled state only.** A device that *reports* an edge has
done its own edge detection and says so once; requiring a second confirming
observation would mean never believing it. A poll is a sample, and the next one
re-observes whatever is true, which is what makes waiting for persistence work
there and only there.
"""

import asyncio
import re
from dataclasses import replace

from backend.db import models
from backend.services.timer.devices import MICROWIZARD
from backend.services.timer.devices.base import (
    Event,
    GateClosed,
    GateOpen,
    GateWatcher,
    GateWatcherUnsupported,
    Group,
    LaneResult,
    Matcher,
    RaceStarted,
    TimerProfile,
    lane_number,
    seconds,
)
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import GateBelief, TimerState

#: Modelled on DerbyNet's PDT profile, whose gate answers are `O` for open and a
#: bare `.` for closed. The `.` is the point: as a general matcher it would
#: claim every line the timer ever sends.
POLLED = TimerProfile(
    name="Polled Test Timer",
    key="polled-test",
    delimiter=b"\n",
    gate_state_is_knowable=True,
    identification=(re.compile(rb"^POLLED$"),),
    probe=(b"V",),
    gate_watcher=GateWatcher(
        command=b"G",
        matchers=(
            Matcher(re.compile(rb"^O$"), Event.GATE_OPEN),
            Matcher(re.compile(rb"^\.$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^X$"), Event.GATE_UNSUPPORTED),
        ),
    ),
    matchers=(
        Matcher(re.compile(rb"^B$"), Event.RACE_STARTED),
        Matcher(
            re.compile(rb"^(\d) - (\d+\.\d+)$"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


#: Bert Drake's shape (issue #636): a pushed `B` for the gate opening, with no
#: pushed matcher of its own for the gate closing — only the on-demand `C`
#: query, answered `Gc`/`Go` inside a poll window. Push and poll coexist for
#: opposite edges rather than being alternatives, which is why this is its own
#: profile instead of a `replace(POLLED, ...)`: POLLED's own `B` already means
#: RACE_STARTED.
PUSHES_OPEN_POLLS_CLOSED = TimerProfile(
    name="Pushes Gate Open, Polls Gate Closed",
    key="pushes-open-polls-closed",
    delimiter=b"\n",
    gate_state_is_knowable=True,
    identification=(re.compile(rb"^BD$"),),
    probe=(b"V",),
    gate_watcher=GateWatcher(
        command=b"C",
        matchers=(
            Matcher(re.compile(rb"^Gc$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^Go$"), Event.GATE_OPEN),
        ),
    ),
    matchers=(
        Matcher(re.compile(rb"^B$"), Event.GATE_OPEN),
        Matcher(
            re.compile(rb"^(\d) - (\d+\.\d+)$"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


def armed(profile: TimerProfile = POLLED, *, instant: bool = True) -> TimerManager:
    """A manager with a heat armed and the debounce out of the way."""
    manager = TimerManager(track_id=1, device=profile)
    manager._state = TimerState.ARMED
    manager._active_heat_id = 1
    if instant:
        manager._gate.min_change_seconds = 0.0
    return manager


# ---------------------------------------------------------------------------
# The rule, on its own
# ---------------------------------------------------------------------------


def test_one_disagreeing_sample_is_not_enough():
    """Staging cars against a gate produces readings that are true for an
    instant and meaningless a moment later."""
    belief = GateBelief(min_change_seconds=0.5, closed=False)

    assert belief.observe(closed=True, now=0.0) is False
    assert belief.closed is False


def test_a_change_that_persists_is_believed():
    belief = GateBelief(min_change_seconds=0.5, closed=False)

    belief.observe(closed=True, now=0.0)
    assert belief.observe(closed=True, now=0.6) is True
    assert belief.closed is True


def test_a_change_at_exactly_the_threshold_is_believed():
    """The boundary is inclusive: ``now - changing_since ==
    min_change_seconds`` is a persisted change, not one sample short of it.
    ``test_a_change_that_persists_is_believed`` above samples at 0.6s, past
    the 0.5s threshold; this pins the `>=` at the exact value it names."""
    belief = GateBelief(min_change_seconds=0.5, closed=False)

    belief.observe(closed=True, now=0.0)
    assert belief.observe(closed=True, now=0.5) is True
    assert belief.closed is True


def test_a_sample_that_agrees_cancels_a_pending_change():
    """A bounce that comes back is not a change, and must not leave a clock
    running that the next stray reading completes."""
    belief = GateBelief(min_change_seconds=0.5, closed=False)

    belief.observe(closed=True, now=0.0)  # starts changing
    belief.observe(closed=False, now=0.1)  # back to what we believed
    assert belief.observe(closed=True, now=0.7) is False
    assert belief.closed is False


def test_believing_something_twice_is_not_a_change():
    belief = GateBelief(min_change_seconds=0.0, closed=True)

    assert belief.observe(closed=True, now=1.0) is False


def test_reset_forgets_a_pending_change():
    belief = GateBelief(min_change_seconds=0.5, closed=False)
    belief.observe(closed=True, now=0.0)

    belief.reset()

    assert belief.observe(closed=True, now=10.0) is False


# ---------------------------------------------------------------------------
# Reading an answer
# ---------------------------------------------------------------------------


def test_the_gate_matchers_are_not_part_of_general_parsing():
    """`.` would otherwise match every line the timer ever sends."""
    assert POLLED.parse_line(b".") is None
    assert POLLED.parse_line(b"O") is None

    assert isinstance(POLLED.read_gate(b"."), GateClosed)
    assert isinstance(POLLED.read_gate(b"O"), GateOpen)


def test_a_profile_that_cannot_be_asked_reads_no_gate():
    assert MICROWIZARD.read_gate(b".") is None


def test_polling_is_off_when_the_gate_is_not_knowable():
    """DerbyNet carries a gate query on The Judge and notes that it never runs,
    because the profile also declares the gate unknowable. The declaration
    wins."""
    unknowable = replace(POLLED, key="unknowable", gate_state_is_knowable=False)

    assert POLLED.polls_the_gate() is True
    assert unknowable.polls_the_gate() is False
    assert MICROWIZARD.polls_the_gate() is False


# ---------------------------------------------------------------------------
# The window
# ---------------------------------------------------------------------------


async def test_an_answer_inside_the_window_moves_the_state():
    manager = armed()
    manager._gate_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b".\n")

    assert manager._state is TimerState.READY
    await manager.stop()


async def test_the_same_bytes_outside_the_window_are_not_a_gate_answer():
    """Nothing asked, so nothing answered."""
    manager = armed()
    manager._gate_window_until = 0.0

    await manager.receive_bytes(b".\n")

    assert manager._state is TimerState.ARMED
    await manager.stop()


async def test_a_result_arriving_during_a_window_is_still_a_result():
    """The window makes gate patterns *eligible*, not exclusive. A timer does
    not stop reporting because we happened to ask about the gate."""
    manager = armed()
    manager._state = TimerState.RUNNING
    manager._lane_mask = 0
    manager._gate_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b"1 - 3.452\n")

    assert manager._pending_results[1].time_seconds == 3.452
    await manager.stop()


async def test_one_answer_closes_the_window():
    """A poll asked one question and got one answer; the next line is ordinary
    traffic again."""
    manager = armed()
    manager._gate_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b".\n")
    assert manager._gate_window_until == 0.0

    await manager.stop()


# ---------------------------------------------------------------------------
# What the state does
# ---------------------------------------------------------------------------


async def test_a_gate_that_opens_again_goes_back_to_armed():
    """Somebody reloading, or a car pulled off the line. Not a race."""
    manager = armed()
    manager._gate_window_until = asyncio.get_event_loop().time() + 5
    await manager.receive_bytes(b".\n")
    assert manager._state is TimerState.READY

    manager._gate_window_until = asyncio.get_event_loop().time() + 5
    await manager.receive_bytes(b"O\n")

    assert manager._state is TimerState.ARMED
    await manager.stop()


async def test_a_polled_open_gate_does_not_start_a_race():
    """The gate being up is not the timer saying it is counting. Conflating
    them starts a heat every time somebody lifts the gate to reload."""
    manager = armed()
    manager._gate_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b"O\n")

    assert manager._state is not TimerState.RUNNING
    await manager.stop()


async def test_a_device_with_no_start_signal_reads_gate_open_as_the_race_starting():
    """The Champ's shape (issue #340): nothing in its matchers ever produces
    RACE_STARTED, so ``gate_open_starts_race`` routes a polled gate-open
    observed from READY through the same handling as a matched one — stop
    polling, RUNNING, the on-start commands — rather than back to ARMED.
    """
    profile = replace(POLLED, key="gate-starts-race", gate_open_starts_race=True)
    manager = armed(profile)
    manager._start_gate_polling()
    manager._gate_window_until = asyncio.get_event_loop().time() + 5
    await manager.receive_bytes(b".\n")
    assert manager._state is TimerState.READY

    manager._gate_window_until = asyncio.get_event_loop().time() + 5
    await manager.receive_bytes(b"O\n")

    assert manager._state is TimerState.RUNNING
    assert manager._gate_poll_task is None
    await manager.stop()


async def test_gate_open_starts_race_does_nothing_from_armed():
    """The flag only changes the READY→open reading. A gate opening while
    merely ARMED (never having closed) is unaffected — there is no start to
    infer without a closed gate first."""
    profile = replace(POLLED, key="gate-starts-race-armed", gate_open_starts_race=True)
    manager = armed(profile)
    manager._gate_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b"O\n")

    assert manager._state is TimerState.ARMED
    await manager.stop()


async def test_a_pushed_open_gate_starts_the_race_when_the_flag_is_set():
    """Bert Drake's shape (issue #636), the pushed twin of the Champ's polled
    one above. The pushed `B` needs no poll window and no
    ``gate_state_is_knowable`` of its own to act on — this device sets that
    flag only to reach READY in the first place, via the ordinary polled
    `C`/`Gc` above. Once READY, the pushed edge starts the race and stops the
    poll task, the same as ``_start_race`` always does.
    """
    profile = replace(PUSHES_OPEN_POLLS_CLOSED, gate_open_starts_race=True)
    manager = armed(profile)
    manager._start_gate_polling()
    manager._gate_window_until = asyncio.get_event_loop().time() + 5
    await manager.receive_bytes(b"Gc\n")
    assert manager._state is TimerState.READY
    assert manager._gate_poll_task is not None

    await manager.receive_bytes(b"B\n")

    assert manager._state is TimerState.RUNNING
    assert manager._gate_poll_task is None
    await manager.stop()


async def test_a_pushed_open_gate_falls_back_to_armed_without_the_flag():
    """A device that pushes an edge but does not claim ``gate_open_starts_race``
    (the MicroWizard's shape — it starts a race from its own ``RaceStarted``
    matcher instead) must be unaffected by this branch: a pushed GateOpen from
    READY still just means "not staged any more", exactly as it did before
    issue #636. A regression here would double-start a device that already
    has its own start signal.
    """
    manager = armed(PUSHES_OPEN_POLLS_CLOSED)
    manager._state = TimerState.READY

    await manager.receive_bytes(b"B\n")

    assert manager._state is TimerState.ARMED
    await manager.stop()


async def test_the_debounce_applies_to_polled_answers():
    manager = armed(instant=False)
    manager._gate.min_change_seconds = 10.0
    manager._gate_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b".\n")

    assert manager._state is TimerState.ARMED, "one sample is not staging"
    await manager.stop()


async def test_a_pushed_edge_is_believed_at_once():
    """The asymmetry, pinned. A device that announces the edge has already
    debounced it, and waiting for a second observation that will never come
    would make READY unreachable — the exact bug #88 nearly reintroduced.
    """
    pushes = replace(
        POLLED,
        key="pushes",
        gate_watcher=None,
        matchers=(*POLLED.matchers, Matcher(re.compile(rb"^C$"), Event.GATE_CLOSED)),
    )
    manager = armed(pushes, instant=False)
    manager._gate.min_change_seconds = 10.0

    await manager.receive_bytes(b"C\n")

    assert manager._state is TimerState.READY
    await manager.stop()


async def test_a_device_that_says_its_gate_query_is_off_is_not_asked_again():
    manager = armed()
    manager._start_gate_polling()
    manager._gate_window_until = asyncio.get_event_loop().time() + 5

    await manager.receive_bytes(b"X\n")

    assert manager._gate_watcher_off is True
    assert manager._gate_poll_task is None
    await manager.stop()


async def test_reconnecting_gives_the_gate_query_another_chance():
    """It may be a different device, or the same one with its options changed."""
    manager = armed()
    manager._gate_watcher_off = True

    await manager.handle_connect()

    assert manager._gate_watcher_off is False
    await manager.stop()


# ---------------------------------------------------------------------------
# When it asks
# ---------------------------------------------------------------------------


async def test_arming_a_heat_starts_the_asking():
    manager = TimerManager(track_id=1, device=POLLED)
    sent: list[bytes] = []

    async def write(data: bytes) -> None:
        sent.append(data)

    manager.set_write_fn(write)
    manager._state = TimerState.IDLE
    assert manager._gate_poll_task is None

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)

    assert manager._gate_poll_task is not None
    await manager.stop()


async def test_a_running_race_is_not_interrupted_to_ask_about_the_gate():
    """Pack936, via DerbyNet's Champ profile: a gate query sent too soon after
    the gate opened made the timer resend the previous heat's results. The
    answer cannot change anything once the cars are away, either."""
    manager = armed()
    manager._start_gate_polling()

    await manager.inject_event(RaceStarted())

    assert manager._state is TimerState.RUNNING
    assert manager._gate_poll_task is None
    await manager.stop()


async def test_a_timer_that_announces_its_gate_is_never_polled():
    """The MicroWizard reports both edges through `N2`. Asking as well would be
    traffic on a serial line for an answer already volunteered — and untested
    risk on the one device anybody actually runs."""
    manager = TimerManager(track_id=1, device=MICROWIZARD)
    manager._state = TimerState.IDLE

    await manager.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)

    assert manager._gate_poll_task is None
    await manager.stop()


async def test_the_gate_belief_is_forgotten_between_heats():
    """A new heat starts from "not yet staged", whatever the last one ended on,
    or the second heat of a round would arrive already READY."""
    manager = armed()
    manager._gate.closed = True

    await manager.prepare_heat(heat_id=2, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)

    assert manager._gate.closed is False
    assert manager._state is TimerState.ARMED
    await manager.stop()


async def test_the_events_are_distinct_types():
    """`GateOpen` and `RaceStarted` are separate for a reason, and a type that
    is never constructed is a rule nobody is following."""
    assert POLLED.read_gate(b"O") == GateOpen()
    assert POLLED.read_gate(b".") == GateClosed()
    assert POLLED.read_gate(b"X") == GateWatcherUnsupported()
    assert POLLED.parse_line(b"1 - 3.001") == LaneResult(
        lane=1, time_seconds=3.001, place=0
    )
