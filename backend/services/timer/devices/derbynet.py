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
    Ack,
    Event,
    GateWatcher,
    Group,
    HeatPrep,
    Matcher,
    ScopedQuery,
    TimerProfile,
    lane_letter,
    lane_number,
    seconds,
)

# Shown to the operator on the timer check page and in the model picker, so
# these are written for a volunteer, not for us: what the support is based on,
# how far it has been checked, and what would move it forward. The MIT-licensed
# origin is credited in plain words here and in full at the top of this file.
_UNTESTED = (
    "Support for the {} comes from DerbyNet's notes, with thanks to Jeff "
    "Piazza. It has never been tried with the real device — treat it as a "
    "starting point, and a two-minute timer test would tell us how it really "
    "behaves."
)

_REPLAYED = (
    "Support for the {} comes from DerbyNet's notes, with thanks to Jeff "
    "Piazza, and has been checked against a recording of a real one — {}. "
    "No real heat has ever been run through it, though; a two-minute timer "
    "test would confirm it."
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
        "its start-up message, gate answers, start signal and results all "
        "read correctly",
    ),
    probe=(b"R",),
    identification=(re.compile(rb"^RESET$"), re.compile(rb"^READY\s*\d+\s+LANES")),
    heat_prep=HeatPrep(unmask=b"C", mask=b"M", first_lane=b"1"),
    # RACE below is its own matcher, independent of the gate — so polling can
    # safely run while armed and stop the moment the race starts, without the
    # Champ's "gate-open is the only start signal" trap (issue #340).
    gate_state_is_knowable=True,
    gate_watcher=GateWatcher(
        command=b"G",
        matchers=(
            Matcher(re.compile(rb"^U$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^D$"), Event.GATE_OPEN),
        ),
    ),
    # No documented device-side timeout for this one, unlike the MicroWizard's
    # measured 10s — this is purely so our own watchdog can reach
    # RESULTS_OVERDUE at all (issue #339). Matches the only number we have.
    result_timeout_seconds=10.0,
    # F forces the end of a race and reports whatever the timer has. Also
    # wired as force_results below, so the manual Force Results button sends
    # the same command rather than nothing (issue #339).
    force_results=(b"F",),
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
# Reports gate-open unprompted *and* answers a gate query, and — unlike every
# other profile carrying both — this one genuinely needs both (issue #636).
# drakedev.com's protocol page documents `B` as "sent when race starts (gate
# opened - Begin)" and nothing else: the device has no push of its own for the
# gate *closing*, only the on-demand `C` query, answered `Gc`/`Go`. So
# gate_state_is_knowable is True here, not for its own sake, but because it is
# the only way ARMED→READY is reachable at all for this device — without it
# `polls_the_gate()` is false, nothing ever asks `C`, and READY (and so the
# pushed `B` below, which only means anything from READY) is a dead end. That
# was this profile's shape before #636: gate_state_is_knowable stayed False
# specifically to keep polling off, on the reasoning that nothing would ever
# tell the poll loop a race had started — true at the time, because a pushed
# `B` from READY only fell back to ARMED. It is no longer true: `B` now routes
# through gate_open_starts_race (below) into the same `_start_race()` a
# matched RaceStarted would use, which cancels the poll task as its first act
# — see `TimerManager._handle_event`'s `GateOpen` branch. So the Champ's
# #340/Pack936 trap (asking `C` straight through a live run) cannot recur: the
# pushed edge is exactly the "something" that used to be missing.

BERT_DRAKE = TimerProfile(
    name="Bert Drake timer",
    key="bert-drake",
    provenance=_UNTESTED.format("Bert Drake"),
    pre_probe=(b"R",),
    probe=(b"V",),
    identification=(re.compile(rb"Bert Drake"),),
    heat_prep=HeatPrep(arm=b"R"),
    gate_state_is_knowable=True,
    gate_open_starts_race=True,
    gate_watcher=GateWatcher(
        command=b"C",
        matchers=(
            Matcher(re.compile(rb"^Gc$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^Go$"), Event.GATE_OPEN),
        ),
    ),
    # See DERBY_TIMER's comment: no documented device timeout, just enough to
    # let the watchdog reach RESULTS_OVERDUE (issue #339).
    result_timeout_seconds=10.0,
    force_results=(b"F",),
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
# DerbyNet gives this timer an unconditional remote start (`S`), where the
# FastTrack's depends on an accessory being fitted. We still make the operator
# say the track has a gate release before offering it, because "the protocol
# has a command" and "this track has a solenoid on the gate" are different
# claims and only the operator knows the second.

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
    remote_start=(b"S",),
    heat_prep=HeatPrep(unmask=b"U", mask=b"M", first_lane=b"1", arm=b"R"),
    # RACING/B below is its own matcher, independent of the gate poll, so the
    # gate can safely be polled while armed — see DERBY_TIMER's comment. This
    # is also what makes the documented Event.GATE_CLOSED -> "R" reset below
    # reachable: without a knowable gate state, READY (and so GATE_CLOSED) is
    # never entered.
    gate_state_is_knowable=True,
    gate_watcher=GateWatcher(
        command=b"G",
        matchers=(
            Matcher(re.compile(rb"^O$"), Event.GATE_OPEN),
            Matcher(re.compile(rb"^\.$"), Event.GATE_CLOSED),
        ),
    ),
    # See DERBY_TIMER's comment: no documented device timeout, just enough to
    # let the watchdog reach RESULTS_OVERDUE (issue #339).
    result_timeout_seconds=10.0,
    force_results=(b"F",),
    on_event={
        # "The Reset command needs to be sent after the gate is closed."
        Event.GATE_CLOSED: (b"R",),
        Event.RESULTS_OVERDUE: (b"F",),
    },
    # The recording answers every `R` with `K` (dfgtec's Ready Response) —
    # `#on R` / `K` in pdt.playback. Without this, `K` reached `parse_line`
    # unmatched and was silently dropped rather than consumed as the ack for
    # the reset sent from `setup`, `heat_prep.arm` and the GATE_CLOSED->R
    # above.
    acks=(Ack(re.compile(rb"^R$"), re.compile(rb"^K$")),),
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
    # See DERBY_TIMER's comment: no documented device timeout, just enough to
    # let the watchdog reach RESULTS_OVERDUE (issue #339).
    result_timeout_seconds=10.0,
    force_results=(b"*",),
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
# query whose answer is a bare digit — too broad for an ordinary matcher, the
# same reason the gate answers above are read through `gate_watcher` rather
# than `matchers`. `lane_count_query` (issue #637) is that safe place: a
# `ScopedQuery` asked once, right after setup completes on connect, and read
# only inside the short window that follows — never a general matcher, so a
# bare "4" arriving any other time is ordinary unclaimed traffic.
#
# GPRM's compatibility matrix lists a "Photo Finish Trigger" for this model,
# on double-sided units only (#553). The trigger is a discrete hardware signal
# — a contact closure or a flash-sync line firing a camera at the line — not a
# serial message, so there is nothing to match here and no way for us to tell
# a single-sided unit from a double-sided one over the wire. The flag below is
# a plain datasheet claim for that reason, same as every other capability on
# this profile: nobody here has run one.

CHAMP = TimerProfile(
    name='"The Champ" (SmartLine / BestTrack)',
    key="champ",
    provenance=_UNTESTED.format("Champ")
    + (
        " Its Photo Finish Trigger is documented for double-sided units only, "
        "which this profile cannot distinguish from a single-sided one."
    ),
    command_eol=b"\r",
    max_lanes=6,
    has_photo_finish_trigger=True,
    pre_probe=(b"",),
    probe=(b"v",),
    identification=(re.compile(rb"eTekGadget SmartLine Timer"),),
    # r resets; the or/ol/od/op/rs group interrogates settings; ol0 makes lane 1
    # report as "A" and op3 sets the place character. DerbyNet leaves out the
    # documented `ox0` because it makes the timer stop answering for a second
    # or two, swallowing everything sent after it.
    setup=(b"r", b"or", b"ol", b"od", b"op", b"rs", b"ol0", b"op3"),
    heat_prep=HeatPrep(unmask=b"om0", mask=b"om", first_lane=b"1", arm=b"rg"),
    # This device has no matcher of its own for a race starting — the gate
    # opening *is* the only start signal, so gate_open_starts_race routes a
    # polled gate-open observed from READY through the same handling as a
    # matched RaceStarted (stop polling, RUNNING, send the on-start commands)
    # rather than back to ARMED. gate_state_is_knowable has to be True for
    # that: it is what makes polling — and therefore READY — reachable at
    # all. Polling itself stops the instant the race starts, which is what
    # keeps `rs` from being sent during a live run, the documented Pack936
    # failure below.
    gate_state_is_knowable=True,
    gate_open_starts_race=True,
    gate_watcher=GateWatcher(
        command=b"rs",
        matchers=(
            Matcher(re.compile(rb"^0$"), Event.GATE_CLOSED),
            Matcher(re.compile(rb"^1$"), Event.GATE_OPEN),
        ),
    ),
    # `on` draws the lane count out as a bare digit — see the module comment
    # above this profile for why that has to be a `ScopedQuery` rather than an
    # ordinary matcher.
    lane_count_query=ScopedQuery(
        command=b"on",
        matchers=(
            Matcher(
                re.compile(rb"^(\d)$"), Event.LANE_COUNT, lane=Group(1, lane_number)
            ),
        ),
    ),
    # See DERBY_TIMER's comment: no documented device timeout, just enough to
    # let the watchdog reach RESULTS_OVERDUE (issue #339).
    result_timeout_seconds=10.0,
    # ra also force-ends the race, so Force Results sends it too rather than
    # nothing (issue #339).
    force_results=(b"ra",),
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
