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
# Line 2: "K2 Version 2.3A  Serial Number29284"
_VERSION = re.compile(rb"^K\d\s+Version\s+\S+\s+Serial\s*Number\d+$", re.IGNORECASE)

# 'AC' answers MG; '*' answers N1, N2, LR and the per-lane mask commands.
_AC = re.compile(rb"^AC$")
_STAR = re.compile(rb"^\*$")


MICROWIZARD = TimerProfile(
    name="MicroWizard K1/K2/K3",
    key="microwizard",
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
    # RV would draw the identification banner out, but the device also sends it
    # unprompted on reboot, and asking for it during a run is a good way to
    # confuse a timer mid-heat. A live connection waits rather than probes; the
    # port prober is what sends this (issue #89).
    probe=(),
    identification=(_COPYRIGHT, _VERSION),
    # N1 selects the new result format, N2 real-time gate feedback.
    setup=(b"N1", b"N2"),
    # MG clears every lane mask, M<letter> masks one lane out, LR arms.
    heat_prep=HeatPrep(unmask=b"MG", mask=b"M", first_lane=b"A", arm=b"LR"),
    # LR resets, arms or aborts depending on context.
    abort=(b"LR",),
    # RA reports every lane immediately.
    force_results=(b"RA",),
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
