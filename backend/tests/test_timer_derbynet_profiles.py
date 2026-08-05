"""The profiles adapted from DerbyNet parse what their timers actually say.

These are transcriptions. The data behind them is well-tested — DerbyNet has
had these in front of real hardware for years — but the transcription is new,
and a regex copied with one character wrong fails in the worst available way:
silently, at an event, by simply never matching.

So every profile here is fed a line taken from its DerbyNet definition or from
the comments around it, and asked to produce the event that line means. That
catches a mistyped pattern. It cannot catch a *wrong* pattern — if DerbyNet's
regex and mine are both wrong about the hardware, these tests agree with both.

**Nothing here has run against a timer.** The provenance on each profile says
so, and the timer check page shows it.
"""

import pytest

from backend.services.timer.devices import ALL_PROFILES
from backend.services.timer.devices.base import (
    GateClosed,
    GateOpen,
    LaneCount,
    LaneResult,
    RaceStarted,
    TimerProfile,
)
from backend.services.timer.devices.derbynet import (
    BERT_DRAKE,
    CHAMP,
    DERBY_TIMER,
    JIT_RACEMASTER,
    NEWBOLD,
    PDT,
    THE_JUDGE,
)


def one(result) -> object:
    """Unwrap whatever `parse_line` gave back into a single event."""
    if isinstance(result, list):
        assert len(result) == 1, result
        return result[0]
    return result


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("profile", "line", "lane", "time_seconds"),
    [
        # The shared "lane, spaces, time" shape, used by three models.
        (NEWBOLD, b"  1   3.4567", 1, 3.4567),
        (DERBY_TIMER, b"  2   3.4567", 2, 3.4567),
        (BERT_DRAKE, b"  3   3.4567 X", 3, 3.4567),
        # PDT separates them with a dash.
        (PDT, b"4 - 3.4567", 4, 3.4567),
        # The Judge writes it out, and pads the time with leading zeroes.
        (THE_JUDGE, b"Lane  5   03.4567", 5, 3.4567),
        # JIT Racemaster is verbose, and reports four decimal places.
        (
            JIT_RACEMASTER,
            b"1st Place Single Lane Number:  6  Time in Seconds:  3.4567",
            6,
            3.4567,
        ),
        # The Champ letters its lanes, like the MicroWizard.
        (CHAMP, b"A=3.456", 1, 3.456),
        (CHAMP, b"C=3.456", 3, 3.456),
    ],
)
def test_a_result_line_is_read_as_a_result(
    profile: TimerProfile, line: bytes, lane: int, time_seconds: float
):
    event = one(profile.parse_line(line))

    assert isinstance(event, LaneResult), f"{profile.key}: {line!r} -> {event!r}"
    assert event.lane == lane
    assert event.time_seconds == pytest.approx(time_seconds)


def test_the_champ_reports_every_lane_on_one_line():
    """Like the MicroWizard, so the matcher repeats."""
    events = CHAMP.parse_line(b' A=3.001! B=3.002" C=3.003#')

    assert isinstance(events, list)
    assert [e.lane for e in events] == [1, 2, 3]


def test_a_dnf_on_the_judge_is_an_ordinary_result():
    """DerbyNet's note: DNFs arrive with a real time, just before the race is
    declared over, so there is nothing special to do with them."""
    event = one(THE_JUDGE.parse_line(b"Lane  6   31.0589   DNF"))

    assert isinstance(event, LaneResult)
    assert event.lane == 6
    assert event.time_seconds == pytest.approx(31.0589)


# ---------------------------------------------------------------------------
# The race starting
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("profile", "line"),
    [
        (DERBY_TIMER, b"RACE"),
        (PDT, b"B"),
        (THE_JUDGE, b"Go"),
        (THE_JUDGE, b"GO!"),
    ],
)
def test_the_start_signal_is_read(profile: TimerProfile, line: bytes):
    assert one(profile.parse_line(line)) == RaceStarted()


def test_the_bert_drake_announces_the_gate_rather_than_the_start():
    """Its `B` is gate-open, not "I am counting" — which is why the two are
    different events. Conflating them starts a heat whenever somebody lifts
    the gate to reload."""
    assert one(BERT_DRAKE.parse_line(b"B")) == GateOpen()


# ---------------------------------------------------------------------------
# Lane counts
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("profile", "line", "lanes"),
    [
        (DERBY_TIMER, b"READY 6 LANES", 6),
        (PDT, b"numl=4", 4),
        (THE_JUDGE, b"Number of Lanes: 8", 8),
    ],
)
def test_a_reported_lane_count_is_read(profile: TimerProfile, line: bytes, lanes: int):
    event = one(profile.parse_line(line))

    assert isinstance(event, LaneCount)
    assert event.lanes == lanes


# ---------------------------------------------------------------------------
# Gate answers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("profile", "closed_line", "open_line"),
    [
        (DERBY_TIMER, b"U", b"D"),
        (BERT_DRAKE, b"Gc", b"Go"),
        (PDT, b".", b"O"),
        # Note the Champ is the *opposite* way round from the FastTrack, where
        # RG0 means open. Transcribing one from the other would have been wrong
        # in the quietest way available.
        (CHAMP, b"0", b"1"),
    ],
)
def test_gate_answers_are_read_the_right_way_round(
    profile: TimerProfile, closed_line: bytes, open_line: bytes
):
    assert profile.read_gate(closed_line) == GateClosed()
    assert profile.read_gate(open_line) == GateOpen()


def test_gate_answers_are_never_general_matchers():
    """PDT's gate-closed pattern is a bare `.`. If it were tried against every
    line, it would claim all of them."""
    assert PDT.parse_line(b".") is None
    assert PDT.parse_line(b"O") is None
    assert CHAMP.parse_line(b"0") is None
    assert DERBY_TIMER.parse_line(b"U") is None


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def test_the_timers_that_need_a_carriage_return_get_one():
    """Silence is the failure mode for a command without its terminator, which
    is indistinguishable from a timer that is not there."""
    assert THE_JUDGE.wire(b"*") == b"*\r"
    assert CHAMP.wire(b"rg") == b"rg\r"
    # And the ones that do not, do not.
    assert DERBY_TIMER.wire(b"R") == b"R"
    assert PDT.wire(b"G") == b"G"


@pytest.mark.parametrize(
    ("profile", "command"),
    [
        (DERBY_TIMER, b"F"),
        (BERT_DRAKE, b"F"),
        (PDT, b"F"),
        (THE_JUDGE, b"*"),
        (CHAMP, b"ra"),
    ],
)
def test_an_overdue_race_is_told_to_give_up(profile: TimerProfile, command: bytes):
    """These timers report when told to. Without this the operator waits for a
    heat that has already finished."""
    from backend.services.timer.devices.base import Event

    assert profile.commands_for(Event.RESULTS_OVERDUE) == [command]


def test_the_champ_is_told_to_report_when_the_race_starts():
    from backend.services.timer.devices.base import Event

    assert CHAMP.commands_for(Event.RACE_STARTED) == [b"rg"]


def test_the_pdt_is_reset_once_the_gate_is_closed():
    """DerbyNet's comment: the reset command has to come after the gate closes."""
    from backend.services.timer.devices.base import Event

    assert PDT.commands_for(Event.GATE_CLOSED) == [b"R"]


def test_lane_masking_uses_each_timers_own_lane_naming():
    # Numbered from '1'...
    assert DERBY_TIMER.prepare_heat_commands(0b101)[:1] == [b"C"]
    assert b"M2" in DERBY_TIMER.prepare_heat_commands(0b101)
    # ...and the Champ, which also numbers rather than letters its mask.
    assert b"om2" in CHAMP.prepare_heat_commands(0b101)


# ---------------------------------------------------------------------------
# The set as a whole
# ---------------------------------------------------------------------------


def test_the_adapted_profiles_are_registered():
    for profile in (DERBY_TIMER, BERT_DRAKE, PDT, THE_JUDGE, CHAMP, JIT_RACEMASTER):
        assert profile in ALL_PROFILES


#: The two honest claims a profile may make. Replaying a recording is real
#: evidence and stronger than transcription, but it is still not a heat.
_DISCLAIMERS = ("Never run against this hardware", "Never driven live")


def test_no_profile_claims_to_have_been_driven_live():
    """The honest bit, and the invariant that has to hold until someone runs a
    real heat through one of these.

    Two of them have been replayed against recorded device output, which is
    better than nothing and says so — but a recording has no timing, no gate
    that bounces, and no operator. If anyone ever confirms one on a track, this
    test is where the claim changes.
    """
    from backend.services.timer.devices import ALL_PROFILES

    for profile in ALL_PROFILES:
        assert any(claim in profile.provenance for claim in _DISCLAIMERS), (
            f"{profile.key} makes a claim nothing here supports: {profile.provenance!r}"
        )


def test_the_replayed_ones_say_which_evidence_they_have():
    """A profile checked against real device output should say so — otherwise
    there is no way to tell it from one nobody has looked at."""
    for profile in (DERBY_TIMER, PDT):
        assert "recorded session" in profile.provenance

    for profile in (NEWBOLD, JIT_RACEMASTER, BERT_DRAKE, THE_JUDGE, CHAMP):
        assert "Never run against this hardware" in profile.provenance


def test_no_two_profiles_answer_the_same_probe_the_same_way():
    """A prober takes the first match, so two models that cannot be told apart
    would silently mean one of them is unreachable.

    This checks the weaker, checkable thing: no two share a first
    identification pattern.
    """
    firsts = [p.identification[0].pattern for p in ALL_PROFILES if p.identification]

    assert len(firsts) == len(set(firsts))
