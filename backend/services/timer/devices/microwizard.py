"""MicroWizard K1/K2/K3, and the FastTrack timers that share its protocol.

Sold by Micro Wizard as the FastTrack K-series. The protocol notes below come
from the device documentation and from DerbyNet's FastTrack profile, which has
been in front of this hardware at real events for years.
"""

import re

from .base import (
    Ack,
    Event,
    Group,
    HeatPrep,
    Matcher,
    TimerProfile,
    lane_letter,
    lane_number,
    place_number,
    place_symbol,
    seconds,
)

# Every lane on one line, in the "new format" that N1 selects:
#   A=3.001! B=3.002" C=3.003# D=3.004$ E=3.005% F=3.006&
# The trailing symbol is the place. Some firmware marks only the winner, which
# is why the place group is allowed to come back empty.
_MULTI_LANE = re.compile(rb"([A-P])\s*=\s*(\d+(?:\.\d+)?)\s*([!\"#$%&]?)")

# The older single-result line: lane, time, place.
#   1    3.452  1
# A leading '@' or '>' is tolerated. The framer normally splits those off as
# messages in their own right, since they are in `immediate_chars`, but the
# device emits them as prefixes often enough to be worth allowing here.
_SINGLE_LANE = re.compile(rb"^[@>]*\s*(\d+)\s+([\d.!\s]+?)\s+(\d+)\s*$")

# The gate opened and the timer began counting.
_GATE_OPEN = re.compile(rb"^@$")

# The gate closed. While the timer is armed this means the cars are staged
# behind a latched gate, which is the ARMED to READY transition; it says
# nothing about a run already under way.
_GATE_CLOSED = re.compile(rb"^>$")

# Line 1 of the RV response: "Copyright (c) Micro Wizard 2002-2009"
_COPYRIGHT = re.compile(rb"micro\s*wizard", re.IGNORECASE)
# Line 2, in the two forms real firmware produces:
#   "K2 Version 2.3A  Serial Number29284"      (no space before the number)
#   "K3 Version 1.05A  Serial Number 15985"    (a space, from a K3 recording)
# The prober needs the whole banner to match in order, so demanding the digits
# immediately after "Number" meant it could not identify a K3 at all.
_VERSION = re.compile(rb"^K\d\s+Version\s+\S+\s+Serial\s*Number\s*\d+$", re.IGNORECASE)

# 'AC' answers MG; '*' answers N1, N2, LR and the per-lane mask commands.
_AC = re.compile(rb"^AC$")
_STAR = re.compile(rb"^\*$")


MICROWIZARD = TimerProfile(
    name="MicroWizard K1/K2/K3",
    key="microwizard",
    provenance=(
        "Written against the Micro Wizard protocol documentation and DerbyNet's "
        "FastTrack profile, and checked against a recorded K3 session — its "
        "banner, its lane masking and a six-lane result with two DNFs all read "
        "correctly. Never driven live: no heat has been run through it."
    ),
    baud_rate=9600,
    delimiter=b"\r",
    immediate_chars=(b"@", b">"),
    # N2, in `setup` below, turns on real-time gate feedback, so the device
    # reports both edges and READY is reachable.
    gate_state_is_knowable=True,
    max_lanes=6,
    # The device silently discards results and resets if no finish is detected
    # within 10 seconds of the gate opening. It sends no notification.
    result_timeout_seconds=10.0,
    # RV asks for the two-line banner below. The prober sends it, because the
    # prober only ever runs with nothing connected and no heat in progress.
    #
    # `on_connect` is deliberately left empty: it fires on every reconnect,
    # including one that happens mid-event, and interrogating a timer in the
    # middle of a heat is a good way to confuse it. Sending RV there also used
    # to cause a re-initialization loop on reboot, which is why it was removed.
    # A live connection waits for the device to say something instead — any
    # parseable line, banner or result, takes it out of CONNECTED.
    probe=(b"RV",),
    on_connect=(),
    identification=(_COPYRIGHT, _VERSION),
    # N1 selects the new result format, N2 real-time gate feedback.
    setup=(b"N1", b"N2"),
    # MG clears every lane mask, M<letter> masks one lane out, LR arms.
    heat_prep=HeatPrep(unmask=b"MG", mask=b"M", first_lane=b"A", arm=b"LR"),
    # LR resets, arms or aborts depending on context.
    abort=(b"LR",),
    # RA reports every lane immediately.
    force_results=(b"RA",),
    # LG releases the start gate — but only on a track fitted with Micro
    # Wizard's light tree and automatic gate release, which is an accessory
    # rather than part of the timer. Nothing in the protocol says whether it is
    # there: DerbyNet gates the command behind a command-line flag, and here it
    # is behind the track's `remote_start_installed` setting. Sending LG to a
    # timer without the accessory does nothing; offering the operator a button
    # that does nothing is the failure worth avoiding.
    remote_start=(b"LG",),
    acks=(
        Ack(re.compile(rb"^MG$", re.IGNORECASE), _AC),
        Ack(re.compile(rb"^(N1|N2|LR|M[A-P])$", re.IGNORECASE), _STAR),
    ),
    matchers=(
        Matcher(_GATE_OPEN, Event.RACE_STARTED),
        Matcher(_GATE_CLOSED, Event.GATE_CLOSED),
        Matcher(_COPYRIGHT, Event.IGNORE),
        Matcher(_VERSION, Event.IGNORE),
        Matcher(_AC, Event.UNEXPECTED),
        Matcher(_STAR, Event.UNEXPECTED),
        Matcher(
            _MULTI_LANE,
            Event.LANE_RESULT,
            lane=Group(1, lane_letter),
            time=Group(2, seconds),
            place=Group(3, place_symbol),
            repeat=True,
        ),
        Matcher(
            _SINGLE_LANE,
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, seconds),
            place=Group(3, place_number),
        ),
    ),
)
