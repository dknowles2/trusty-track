"""Timer descriptions adapted from DerbyNet.

`DerbyNet <https://github.com/jeffpiazza/derbynet>`_ (MIT, © Jeff Piazza)
carries profiles for thirteen timer models, refined over years of real events.
The protocols below are transcribed from those definitions, with the reasoning
in their comments carried across where it explains a choice.

**None of these has been run against the hardware it describes.** The data is
well-tested; this transcription of it is not, and the group readers that turn a
captured string into a lane or a time are new code per device. Every profile
here says so in its ``provenance``, which the timer check page shows, and
nobody should be told their timer works until one of them has actually run.

Four models from DerbyNet are deliberately absent:

* **SuperTimer II** reports a result in two separate messages, takes its lane
  mask as one binary-encoded command, and scales times by 10000. Three
  mechanisms for one device.
* **FastTrack P-series** and **DerbyMagic 9600** are variants that DerbyNet
  carries without probers, distinguished from their siblings only by the port
  settings a user picks by hand.
* **ChampSRM** is a rebadged Champ whose banner differs; adding it is a second
  identification pattern once anyone has one to test against.
"""

import re

from .base import (
    Event,
    GateWatcher,
    Group,
    HeatPrep,
    Matcher,
    TimerProfile,
    lane_letter,
    lane_number,
    seconds,
)

_UNTESTED = (
    "Adapted from DerbyNet's {} profile (MIT, © Jeff Piazza). "
    "Never run against this hardware by Trusty Track — treat as a starting "
    "point and report what actually happens."
)

_REPLAYED = (
    "Adapted from DerbyNet's {} profile (MIT, © Jeff Piazza), and checked "
    "against a recorded session from the device — {}. Never driven live: no "
    "heat has been run through it."
)


# ---------------------------------------------------------------------------
# NewBold DT / TURBO / DerbyStick
# ---------------------------------------------------------------------------
#
# The reason the port parameters became a profile field at all: this family is
# 1200 baud, 7 data bits, 2 stop bits, and opening it at the usual 8-N-1 gives
# silent garbage rather than an error.
#
# No prober, so it can never be auto-detected — DerbyNet has none either. It
# has to be chosen.

NEWBOLD = TimerProfile(
    name="NewBold DT, TURBO or DerbyStick",
    key="newbold",
    provenance=_UNTESTED.format("NewBold"),
    baud_rate=1200,
    data_bits=7,
    stop_bits=2,
    parity="N",
    gate_state_is_knowable=False,
    setup=(b" ",),
    heat_prep=HeatPrep(arm=b" "),
    matchers=(
        Matcher(
            re.compile(rb"^\s*(\d)\s+(\d\.\d+)(\s|)"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


# ---------------------------------------------------------------------------
# JIT Racemaster
# ---------------------------------------------------------------------------

JIT_RACEMASTER = TimerProfile(
    name="JIT Racemaster",
    key="jit-racemaster",
    provenance=_UNTESTED.format("JIT Racemaster"),
    gate_state_is_knowable=False,
    probe=(b"V",),
    identification=(
        re.compile(rb"JIT, Inc.*Racemaster Software"),
        re.compile(rb"^Software Version"),
    ),
    setup=(b"L",),
    heat_prep=HeatPrep(arm=b"R"),
    matchers=(
        Matcher(
            re.compile(
                rb"Place Single Lane Number:\s*(\d+)\s+"
                rb"Time in Seconds:\s*(\d+\.\d{4,})"
            ),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


# ---------------------------------------------------------------------------
# DerbyTimer.com
# ---------------------------------------------------------------------------

DERBY_TIMER = TimerProfile(
    name="Derby Timer (derbytimer.com)",
    key="derbytimer",
    provenance=_REPLAYED.format(
        "Derby Timer",
        "its banner, lane count, both gate states, the start signal and "
        "three results all read correctly",
    ),
    probe=(b"R",),
    identification=(re.compile(rb"^RESET$"), re.compile(rb"^READY\s*\d+\s+LANES")),
    heat_prep=HeatPrep(unmask=b"C", mask=b"M", first_lane=b"1"),
    gate_watcher=GateWatcher(
        command=b"G",
        matchers=(
            Matcher(re.compile(rb"^U$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^D$"), Event.GATE_OPEN),
        ),
    ),
    # F forces the end of a race and reports whatever the timer has.
    on_event={Event.RESULTS_OVERDUE: (b"F",)},
    matchers=(
        Matcher(re.compile(rb"^RACE$"), Event.RACE_STARTED),
        Matcher(
            re.compile(rb"^READY\s*(\d+)\s+LANES"),
            Event.LANE_COUNT,
            lane=Group(1, lane_number),
        ),
        Matcher(
            re.compile(rb"^\s*(\d)\s+(\d\.\d+)(\s.*|)"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


# ---------------------------------------------------------------------------
# Bert Drake
# ---------------------------------------------------------------------------
#
# Reports gate-open unprompted *and* answers a gate query, which is why push
# and poll have to coexist rather than being alternatives.

BERT_DRAKE = TimerProfile(
    name="Bert Drake timer",
    key="bert-drake",
    provenance=_UNTESTED.format("Bert Drake"),
    pre_probe=(b"R",),
    probe=(b"V",),
    identification=(re.compile(rb"Bert Drake"),),
    heat_prep=HeatPrep(arm=b"R"),
    gate_watcher=GateWatcher(
        command=b"C",
        matchers=(
            Matcher(re.compile(rb"^Gc$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^Go$"), Event.GATE_OPEN),
        ),
    ),
    on_event={Event.RESULTS_OVERDUE: (b"F",)},
    matchers=(
        Matcher(re.compile(rb"^B$"), Event.GATE_OPEN),
        Matcher(
            re.compile(rb"^\s*(\d)\s+(\d\.\d+)(\s.*|)"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


# ---------------------------------------------------------------------------
# PDT (dfgtec)
# ---------------------------------------------------------------------------
#
# The gate-closed answer is a bare `.`, which matches any character. It is the
# clearest reason gate answers are read only inside a poll's response window
# and never as general matchers.
#
# DerbyNet also gives this timer a remote start (`S`, release the gate from
# software). We have no remote start, so that is dropped rather than
# half-described.

PDT = TimerProfile(
    name="PDT timer (dfgtec.com/pdt)",
    key="pdt",
    provenance=_REPLAYED.format(
        "PDT",
        "its gate answers and results read correctly, and the recording is "
        "where the RACING start signal came from",
    ),
    # An empty pre-probe: DerbyNet sends nothing and waits, which settles a
    # timer that is mid-sentence when the port opens.
    pre_probe=(b"",),
    probe=(b"V",),
    identification=(re.compile(rb"vert="),),
    setup=(b"R", b"N"),
    heat_prep=HeatPrep(unmask=b"U", mask=b"M", first_lane=b"1", arm=b"R"),
    gate_watcher=GateWatcher(
        command=b"G",
        matchers=(
            Matcher(re.compile(rb"^O$"), Event.GATE_OPEN),
            Matcher(re.compile(rb"^\.$"), Event.GATE_CLOSED),
        ),
    ),
    on_event={
        # "The Reset command needs to be sent after the gate is closed."
        Event.GATE_CLOSED: (b"R",),
        Event.RESULTS_OVERDUE: (b"F",),
    },
    matchers=(
        # DerbyNet's profile matches `B`; the device in their recording says
        # `RACING`. Both are accepted rather than choosing between a profile
        # and a recording that disagree — a timer nobody here can test is not
        # the place to be clever about which one is right.
        Matcher(re.compile(rb"^(B|RACING)$"), Event.RACE_STARTED),
        Matcher(
            re.compile(rb"numl=(\d)"), Event.LANE_COUNT, lane=Group(1, lane_number)
        ),
        Matcher(
            re.compile(rb"(\d) - (\d+\.\d+)"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


# ---------------------------------------------------------------------------
# The Judge (New Directions)
# ---------------------------------------------------------------------------
#
# DerbyNet gives this a gate query and then notes that it never runs, because
# the profile also declares the gate unknowable — and that it is not even clear
# the timer supports the command. Left out rather than carried as decoration.
#
# DNFs arrive as ordinary lane results with a real time, just before the race
# is declared over, so there is nothing special to do with them.

THE_JUDGE = TimerProfile(
    name="The Judge (New Directions)",
    key="the-judge",
    provenance=_UNTESTED.format("The Judge"),
    command_eol=b"\r",
    gate_state_is_knowable=False,
    probe=(b"*",),
    identification=(re.compile(rb"Checking Valid Lanes"),),
    heat_prep=HeatPrep(),
    on_event={Event.RESULTS_OVERDUE: (b"*",)},
    matchers=(
        Matcher(re.compile(rb"^G[oO]!?$"), Event.RACE_STARTED),
        Matcher(
            re.compile(rb"Number of Lanes:?\s+(\d)"),
            Event.LANE_COUNT,
            lane=Group(1, lane_number),
        ),
        Matcher(
            re.compile(rb"^Lane\s+(\d)\s+0*(\d+\.\d+)(\s.*)?$"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
        ),
    ),
)


# ---------------------------------------------------------------------------
# "The Champ" (SmartLine / BestTrack)
# ---------------------------------------------------------------------------
#
# Note the gate answers are the *opposite* way round from the FastTrack's: here
# 0 is closed and 1 is open. Transcribing one from the other would have been
# wrong in the most quietly damaging way available.
#
# DerbyNet additionally interrogates this timer for its lane count with an `on`
# query whose answer is a bare digit. A matcher that broad would claim any
# single-digit line, so it is left out until there is somewhere safe to put it.

CHAMP = TimerProfile(
    name='"The Champ" (SmartLine / BestTrack)',
    key="champ",
    provenance=_UNTESTED.format("Champ"),
    command_eol=b"\r",
    max_lanes=6,
    pre_probe=(b"",),
    probe=(b"v",),
    identification=(re.compile(rb"eTekGadget SmartLine Timer"),),
    # r resets; the or/ol/od/op/rs group interrogates settings; ol0 makes lane 1
    # report as "A" and op3 sets the place character. DerbyNet leaves out the
    # documented `ox0` because it makes the timer stop answering for a second
    # or two, swallowing everything sent after it.
    setup=(b"r", b"or", b"ol", b"od", b"op", b"rs", b"ol0", b"op3"),
    heat_prep=HeatPrep(unmask=b"om0", mask=b"om", first_lane=b"1", arm=b"rg"),
    gate_watcher=GateWatcher(
        command=b"rs",
        matchers=(
            Matcher(re.compile(rb"^0$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^1$"), Event.GATE_OPEN),
        ),
    ),
    on_event={
        # rg = "return results when the race ends". DerbyNet's note: a gate
        # query sent after this cancels it, and Pack936 found that sending it
        # too soon after gate-open made the timer resend the previous heat's
        # results. Our gate polling stops when a race starts for that reason.
        Event.RACE_STARTED: (b"rg",),
        # ra = force the end of the race, return results, then reset.
        Event.RESULTS_OVERDUE: (b"ra",),
    },
    matchers=(
        Matcher(
            re.compile(rb" *([A-Z])=(\d\.\d+)([^ ]?)"),
            Event.LANE_RESULT,
            lane=Group(1, lane_letter),
            time=Group(2, seconds),
            repeat=True,
        ),
    ),
)


#: Everything adapted here, in the order a prober should try them. Profiles
#: without an identification banner are included for selection but the prober
#: skips them on its own.
ADAPTED_FROM_DERBYNET: tuple[TimerProfile, ...] = (
    DERBY_TIMER,
    BERT_DRAKE,
    PDT,
    THE_JUDGE,
    CHAMP,
    JIT_RACEMASTER,
    NEWBOLD,
)
