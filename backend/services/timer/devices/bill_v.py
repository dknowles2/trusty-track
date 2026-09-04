"""Bill V's Derby Timers — an Arduino-based two-lane racetrack timer.

Issue #632 carries the whole protocol, transcribed from the reporter's own
notes on the vendor's documented commands (the manufacturer's page is
https://billvsderbytimers.weebly.com/pwd-main.html). **Nothing here has run
against the hardware.** The protocol is short and unambiguous, which is a
different claim from "checked against a real device" — a two-minute timer
test would tell us how it actually behaves.

Three judgment calls, none of them settled by the protocol notes themselves:

* ``GSW`` ("Gate Switch in wrong state") and ``TRK``/``TRK, x, y, ...``
  ("Track Status" — an obstructed optical lane sensor) are fault conditions,
  and the event vocabulary in ``base.py`` has no fault event wired up to any
  matcher today — ``DeviceError`` exists as a ``TimerEvent`` and
  ``TimerManager`` already knows how to land it in ``FAULT``, but no
  ``Event`` member reaches it, and adding one is a change to shared,
  cross-profile machinery that this single profile should not be the reason
  for. So both are read as ``Event.IGNORE`` — recognised, so they do not read
  as an unidentified device, but producing nothing, exactly what ``IGNORE``
  is documented to mean ("traffic we understand and have no event for"). A
  future profile that needs a real fault event should wire ``DeviceError``
  up properly rather than each device inventing its own workaround.
* ``FIN`` ("all cars crossed or 10-second timeout") announces that the race
  is over; the actual times arrive on the separate ``Times:`` line below. It
  carries no data of its own, so it is also ``Event.IGNORE`` — the results
  themselves are what drives ``TimerManager`` out of ``RUNNING``, the same
  relationship ``FIN`` and ``Times:`` have to each other that the
  MicroWizard's silence between the gate opening and its own result line has.
* The results line, ``Times: h-a.aaaa j-b.bbbb``, reports exactly two lanes
  with no lane letter or number of their own — ``h`` and ``j`` are each
  lane's *finish order* (place), not an identifier. The protocol says the
  first pair is always lane 1 and the second always lane 2, which is a
  ``base.Positional`` lane rather than a captured one: see that class's
  docstring for why ``repeat``'s ordinary self-identifying-lane shape (the
  MicroWizard's ``A=...``, the Champ's ``C=...``) does not fit here.

There is no documented command for forcing an overdue result, so
``force_results`` and ``Event.RESULTS_OVERDUE`` are left unset — the device's
own 10-second timeout is the only way this model ever gives up on a straggler,
and ``TimerManager``'s watchdog covers the case where even that never arrives.
Likewise there is no remote-start command in the protocol, so this track can
never offer one.

There is also no command that reports the timer's own lane count — unlike a
device with a ``LANE_COUNT`` matcher or a ``lane_count_query``, this one has
nothing to ask. ``max_lanes=2`` is what tells the mask-building code (
``prepare_heat_commands``) this is a two-lane device; nothing here reports it
back.
"""

import re

from .base import (
    Event,
    Group,
    HeatPrep,
    Matcher,
    Positional,
    TimerProfile,
    place_number,
    seconds,
)

# `Times: h-a.aaaa j-b.bbbb` -- one repeating fragment, `<place>-<time>`, with
# the lane implied by which occurrence this is (first is always lane 1,
# second always lane 2) rather than anything captured. No other message in
# this protocol has a digit-dash-decimal shape, so this cannot be confused
# with RDY/NRD/RAC/FIN/GSW/TRK.
_RESULT_FRAGMENT = re.compile(rb"(\d)-(\d+\.\d+)")

# `TRK` alone, or `TRK, 1`, `TRK, 1, 2`, ... naming the obstructed lanes.
_TRACK_STATUS = re.compile(rb"^TRK(?:,\s*\d+)*$")


BILL_V = TimerProfile(
    name="Bill V's Derby Timer",
    key="bill-v",
    provenance=(
        "Support was written from the protocol the reporter transcribed from "
        "the manufacturer's own documentation in issue #632 "
        "(billvsderbytimers.weebly.com). It has never been tried with the "
        "real device, and no recording of one exists to check it against — a "
        "two-minute timer test would tell us how it really behaves."
    ),
    baud_rate=9600,
    data_bits=8,
    stop_bits=1,
    parity="N",
    max_lanes=2,
    # RDY and NRD are pushed unprompted, the same shape as the MicroWizard's
    # `@`/`>` -- both edges volunteered, so there is no gate_watcher to poll
    # with, and gate_open_starts_race stays False: RAC is this device's own
    # matcher for a race starting, not an inference from the gate.
    gate_state_is_knowable=True,
    # "all cars crossed or 10-second timeout" is the device's own documented
    # figure, not a guess made for symmetry with another profile's watchdog.
    result_timeout_seconds=10.0,
    probe=(b"CC",),
    identification=(re.compile(rb"^@TM$"),),
    # No documented format-selection command, unlike the MicroWizard's N1/N2
    # -- R puts the device into a known, idle state at connect.
    setup=(b"R",),
    # U unmasks every lane; M1/M2 mask lanes 1 and 2 by name, not by an
    # offset letter -- `first_lane=b"1"` is what makes
    # `prepare_heat_commands` build exactly "M1"/"M2" rather than "MA"/"MB".
    # There is no documented arm command distinct from the mask sequence
    # itself, so `arm` is left empty, the same shape DERBY_TIMER's heat_prep
    # takes.
    heat_prep=HeatPrep(unmask=b"U", mask=b"M", first_lane=b"1"),
    # R also resets a heat that needs abandoning -- the protocol names no
    # separate abort command.
    abort=(b"R",),
    matchers=(
        Matcher(re.compile(rb"^RDY$"), Event.GATE_CLOSED),
        Matcher(re.compile(rb"^NRD$"), Event.GATE_OPEN),
        Matcher(re.compile(rb"^RAC$"), Event.RACE_STARTED),
        # See the module docstring: FIN and the two fault lines are
        # recognised traffic with nothing here to turn them into.
        Matcher(re.compile(rb"^FIN$"), Event.IGNORE),
        Matcher(re.compile(rb"^GSW$"), Event.IGNORE),
        Matcher(_TRACK_STATUS, Event.IGNORE),
        Matcher(
            _RESULT_FRAGMENT,
            Event.LANE_RESULT,
            lane=Positional(base=1),
            place=Group(1, place_number),
            time=Group(2, seconds),
            repeat=True,
        ),
    ),
)
