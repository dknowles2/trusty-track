"""Our profiles against what real timers actually said.

Every other timer test checks a profile against a line *we* wrote down from
protocol documentation. That catches a typo and cannot catch a
confidently-wrong description — if our reading of the protocol is mistaken, the
test is mistaken in exactly the same way and agrees.

The recordings in `timer_recordings/` come from DerbyNet (MIT, © Jeff Piazza)
and are what three devices genuinely emitted. Replaying them is the only
evidence in this repository that comes from hardware rather than from us.

It earned its keep immediately: it found that the MicroWizard profile could not
identify a K3, whose firmware writes `Serial Number 15985` with a space.
Auto-detection would have failed on the device and nothing we wrote ourselves
would ever have said so.

See `timer_recordings/NOTICE.md` for the file format and for what this does not
prove.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.services.timer.devices import MICROWIZARD, TimerProfile
from backend.services.timer.devices.base import (
    GateClosed,
    GateOpen,
    LaneCount,
    LaneResult,
    RaceStarted,
)
from backend.services.timer.devices.derbynet import DERBY_TIMER, PDT

RECORDINGS = Path(__file__).parent / "timer_recordings"


def device_lines(name: str) -> Iterator[tuple[str | None, bytes]]:
    """Every line the device emits, with the command that drew it out."""
    trigger: str | None = None
    for raw in (RECORDINGS / f"{name}.playback").read_text().splitlines():
        line = raw.rstrip()
        if not line.strip() or line.startswith("##"):
            continue
        if line.startswith("#on "):
            trigger = line[4:].strip()
            continue
        if line.startswith(("#end", "#pause")):
            trigger = None if line.startswith("#end") else trigger
            continue
        yield trigger, line.encode()


def read(profile: TimerProfile, trigger: str | None, line: bytes) -> object:
    """What the profile makes of one line, given what was asked.

    A line that answers the gate query is read as a gate answer, mirroring the
    manager's response window — outside it, these patterns are not consulted.
    """
    watcher = profile.gate_watcher
    if watcher is not None and trigger == watcher.command.decode():
        answer = profile.read_gate(line)
        if answer is not None:
            return answer
    return profile.parse_line(line)


# ---------------------------------------------------------------------------
# FastTrack K3 — the MicroWizard's own family
# ---------------------------------------------------------------------------


def test_a_real_k3_identifies_itself():
    """The bug this file was written to find.

    K3 firmware writes `Serial Number 15985`; the K2 sample we had written down
    ourselves has no space. Both are the same device family, and the prober
    needs the whole banner to match in order — so on a K3 it found nothing.
    """
    banner = [
        b"Copyright (c) Micro Wizard 2002-2005",
        b"K3 Version 1.05A  Serial Number 15985",
    ]

    assert MICROWIZARD.is_identified_by(banner[0])
    for pattern, line in zip(MICROWIZARD.identification, banner, strict=True):
        assert pattern.search(line), f"{pattern.pattern!r} does not match {line!r}"


def test_the_older_banner_still_matches():
    """The K2 form, without the space. Both are real."""
    assert MICROWIZARD.identification[1].search(b"K2 Version 2.3A  Serial Number29284")


def test_a_real_k3_result_line_is_read_completely():
    """Four cars finished and two did not, which is an ordinary heat.

    This is the case the "trust reported places" rule exists for, and here it
    is in real output: the finishers carry place symbols and the DNFs carry
    neither a symbol nor a time.
    """
    line = b'A=4.009" B=3.261! C=4.129$ D=4.013# E=0.000  F=0.000'

    results = MICROWIZARD.parse_line(line)

    assert isinstance(results, list)
    assert [(r.lane, r.time_seconds, r.place) for r in results] == [
        (1, 4.009, 2),
        (2, 3.261, 1),
        (3, 4.129, 4),
        (4, 4.013, 3),
        (5, 0.0, 0),
        (6, 0.0, 0),
    ]


def test_the_places_a_real_timer_reported_are_the_ones_kept():
    """Every lane that finished has a place, so sorting is not needed and the
    timer's own ordering survives."""
    results = MICROWIZARD.parse_line(
        b'A=4.009" B=3.261! C=4.129$ D=4.013# E=0.000  F=0.000'
    )

    finishers = [r for r in results if r.time_seconds > 0]
    assert all(r.place > 0 for r in finishers)


# ---------------------------------------------------------------------------
# Whole sessions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("recording", "profile"),
    [
        ("fasttrack-mark-set", MICROWIZARD),
        ("derbytimer", DERBY_TIMER),
        ("pdt", PDT),
    ],
)
def test_a_recorded_session_produces_the_events_it_should(
    recording: str, profile: TimerProfile
):
    """Nothing the device said is a surprise, and the run is visible.

    Command echoes are excluded: the manager consumes those against its pending
    command rather than parsing them, so they are not the profile's problem.
    """
    seen: list[object] = []
    for trigger, line in device_lines(recording):
        if trigger is not None and line == trigger.encode():
            continue  # the device echoing the command back
        event = read(profile, trigger, line)
        if isinstance(event, list):
            seen.extend(event)
        elif event is not None:
            seen.append(event)

    assert any(isinstance(e, LaneResult) for e in seen), "no results were read"
    if profile.polls_the_gate():
        assert any(isinstance(e, (GateClosed, GateOpen)) for e in seen)


def test_derby_timer_and_pdt_actually_poll_the_gate():
    """Pins issue #338: both recordings carry gate answers, and the assertion
    in the test above is only exercised — instead of silently skipped — once
    ``polls_the_gate()`` is true for these two profiles."""
    assert DERBY_TIMER.polls_the_gate() is True
    assert PDT.polls_the_gate() is True


def test_the_derby_timer_session_reads_end_to_end():
    """Its recording is the most complete: identification, lane count, both
    gate states, the start, and three results."""
    events = []
    for trigger, line in device_lines("derbytimer"):
        if trigger is not None and line == trigger.encode():
            continue
        event = read(DERBY_TIMER, trigger, line)
        if isinstance(event, list):
            events.extend(event)
        elif event is not None:
            events.append(event)

    assert LaneCount(lanes=3) in events
    assert GateClosed() in events
    assert GateOpen() in events
    assert RaceStarted() in events
    assert [(r.lane, r.time_seconds) for r in events if isinstance(r, LaneResult)] == [
        (1, 1.3186),
        (2, 1.7269),
        (3, 2.0396),
    ]


def test_the_pdt_session_reads_its_results():
    events = []
    for trigger, line in device_lines("pdt"):
        event = read(PDT, trigger, line)
        if isinstance(event, list):
            events.extend(event)
        elif event is not None:
            events.append(event)

    assert [(r.lane, r.time_seconds) for r in events if isinstance(r, LaneResult)] == [
        (1, 0.222),
        (2, 0.515),
    ]


def test_the_pdt_announces_its_race_start_as_racing():
    """DerbyNet's PDT profile matches `B` for this, but the recorded device
    says `RACING`. Both are accepted rather than choosing between a profile and
    a recording that disagree — a timer we cannot test is not a place to be
    clever."""
    assert PDT.parse_line(b"RACING") == RaceStarted()
    assert PDT.parse_line(b"B") == RaceStarted()


def test_the_fasttrack_answers_a_gate_query_and_we_still_do_not_ask():
    """A deliberate choice, and the recording is the evidence behind it.

    The K3 in this recording answers `RG` with `RG1` and `RG0`, so polling it
    would work — DerbyNet's FastTrack profile does exactly that. We do not,
    because `N2` makes the same device *push* both edges: the answer is already
    volunteered, and a query every 250 ms during a heat is a risk with no
    matching benefit.

    If `N2` ever turns out to be unreliable on some firmware, this is the note
    saying the other route is available and known to work.
    """
    assert b"RG1" in (RECORDINGS / "fasttrack-mark-set.playback").read_bytes()
    assert MICROWIZARD.gate_watcher is None
    assert MICROWIZARD.polls_the_gate() is False
    # And the push route the choice rests on.
    assert MICROWIZARD.parse_line(b">") == GateClosed()
    assert b"N2" in MICROWIZARD.setup


def test_a_gate_answer_is_still_not_a_general_matcher():
    """The PDT recording sends `O` and `.` only in reply to `G`. Read outside
    that window they would claim ordinary traffic — `.` matches anything."""
    assert PDT.parse_line(b".") is None
    assert PDT.parse_line(b"O") is None
