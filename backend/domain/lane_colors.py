"""Matching a lane's software identity to the colour painted on the track
(#611, stage 1).

Real pinewood derby tracks — aluminium, wood, or a Freedom/BestTrack kit —
almost universally paint or sleeve each lane a different colour, and the
wranglers, staging crew and audience call cars by it: "put car #12 in the
blue lane". Trusty Track has only ever known lanes by number. This module is
the pure rule for turning a track's *configured* colours (a plain sequence of
colour tokens, one per physical lane) into the colour for one lane — nothing
about storage, GraphQL, or rendering.

Nothing here knows about the database or a `Track` row; a later stage wires
this to `Track.lane_colors` the same way `scale_speed.scale_mph` (#610) was
wired to `Track.scale_ratio` a column at a time, once this rule existed on
its own.

## Lane identity, and why this needs no translation for reverse lanes

A lane's identity throughout this codebase — `HeatLane.lane`, what
`usable_lanes_for_race` enumerates, what a schedule assigns a racer to — is
the *track's own* lane number: the one printed on the schedule, spoken by
the announcer, and (this issue's whole premise) painted on the ground. See
"Heat scheduling (PPC)" in `CLAUDE.md`: `generate_ppc` is handed *which*
lanes exist, not how many, because that number is not dense once a lane has
an outage (`LaneOutage`) or `lane_count` has been turned down (#325) — so
`color_for_lane` below is keyed on that same number and makes no assumption
that every lane from 1 to some count is present or usable.

`Track.reverse_lanes` (#553) sounds like it should matter here and does
not. It corrects a mismatch between the *finish-line device's own channel
numbering* and the track's lane numbering — a fact about which physical
lane a length of cable happens to be plugged into — and `TimerManager`
documents its own scope precisely: the mirror is applied only at the two
places a lane number crosses the wire, `_translate_incoming` (a device
result becoming a track lane number) and `_device_lane_mask` (a track lane
becoming the bits a `HeatPrep` command addresses). Everywhere else in the
application — including `HeatLane.lane`, which is what a lane colour is
looked up by — already holds the track's own number, the one that matches
the paint. A second translation here would un-cross what the timer manager
correctly crossed once, and colour lane 1 with lane 4's paint on a reversed
venue. Nothing in this module takes a `reverse_lanes` argument for that
reason; if a future caller is tempted to add one, that is the sign
something upstream stopped passing a track lane number.

## Storage shape, decided here rather than left to stage 2

The issue's own text offers two shapes — "a JSON array of string colour
identifiers or hex tokens... or a comma-separated list". A comma-separated
list in a string column is exactly the shape issue #5 spent a release
removing from this codebase (see "Heat scheduling (PPC)" on
`LaneOutage` for the same call made once already), so stage 2 should store
a JSON array, one hex string per physical lane, index 0 meaning lane 1 —
which is what every function below takes as `lane_colors`. An empty string
(or a short list that does not reach a given lane) means "no colour
configured for this lane", not an error.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

__all__ = [
    "LaneColor",
    "STANDARD_4_LANE_COLORS",
    "STANDARD_6_LANE_COLORS",
    "LANE_COLOR_PRESETS",
    "color_for_lane",
    "is_valid_lane_color",
    "preset_for_lane_count",
]


@dataclass(frozen=True)
class LaneColor:
    """One named colour: a human-readable label plus the hex value it
    stores as.

    The name travels alongside the hex deliberately. A badge that is only a
    coloured dot fails anyone who cannot distinguish the hues involved — the
    same reasoning that gave the Clear Sight theme a solid border instead of
    a colour alone (see "Themes" in `CLAUDE.md`) — so a renderer has a word
    ("Red") to pair with the swatch, not just a value nobody without normal
    colour vision can read.
    """

    name: str
    hex: str


#: The standard BSA four-lane colour order (see the issue this module
#: implements): red, white, blue, yellow, lane 1 through 4. These are the
#: hex values a stage-2 preset picker writes into `Track.lane_colors`; nothing
#: about the *values* is load-bearing beyond being distinct, readable hex.
STANDARD_4_LANE_COLORS: tuple[LaneColor, ...] = (
    LaneColor("Red", "#E53935"),
    LaneColor("White", "#FAFAFA"),
    LaneColor("Blue", "#1E88E5"),
    LaneColor("Yellow", "#FDD835"),
)

#: The standard six-lane extension: the four above, plus green and orange
#: for lanes 5 and 6.
STANDARD_6_LANE_COLORS: tuple[LaneColor, ...] = STANDARD_4_LANE_COLORS + (
    LaneColor("Green", "#43A047"),
    LaneColor("Orange", "#FB8C00"),
)

#: Keyed by lane count so a stage-2 picker can offer "the standard scheme
#: for this track" without restating which one that is. Only the two counts
#: the issue names have a standard scheme; a track running some other lane
#: count is offered no preset here; `preset_for_lane_count` below is what
#: decides whether one still applies (truncated) or not.
LANE_COLOR_PRESETS: Mapping[int, tuple[LaneColor, ...]] = {
    4: STANDARD_4_LANE_COLORS,
    6: STANDARD_6_LANE_COLORS,
}

_HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def color_for_lane(lane_colors: Sequence[str], lane: int) -> str | None:
    """Return the configured colour for one lane, or ``None``.

    ``lane_colors`` is indexed by the track's own lane number, one-based —
    the same number `HeatLane.lane` holds and the same number a lane colour
    is painted under; see the module docstring for why no reverse-lane
    translation belongs here. ``None`` covers every case that is not a real,
    configured colour: a lane number below 1, a lane past the end of
    ``lane_colors`` (an unconfigured track defaults to an empty sequence,
    and a `lane_count` raised since the colours were set reaches lanes with
    nothing recorded for them), and a blank string held at that index (the
    shape an operator gets by clearing one lane's picker without clearing
    the rest). A caller reading ``None`` falls back to the plain numbered
    badge Trusty Track has always shown — this feature is additive, per the
    issue's own "optional" rule.
    """
    if lane < 1:
        return None
    index = lane - 1
    if index >= len(lane_colors):
        return None
    value = lane_colors[index]
    return value or None


def is_valid_lane_color(value: str) -> bool:
    """Whether ``value`` is a hex colour token lane colours can store.

    Three or six hex digits after a leading ``#``, matching what
    `STANDARD_4_LANE_COLORS`/`STANDARD_6_LANE_COLORS` themselves store — a
    custom colour a stage-2 form accepts is validated against the same rule
    the presets already satisfy, rather than a second, looser one. A blank
    string is not a valid *colour* (see `color_for_lane`, where blank means
    "not configured" and is handled separately, before this would ever be
    asked); the empty string is deliberately refused here.
    """
    return bool(_HEX_COLOR.match(value))


def preset_for_lane_count(lane_count: int) -> tuple[LaneColor, ...] | None:
    """The standard colour scheme for a track of this many lanes, if any.

    An exact match in `LANE_COLOR_PRESETS` is returned whole. Failing that,
    the smallest preset with enough colours is truncated to `lane_count` —
    a 3-lane track gets red/white/blue off the 4-lane scheme rather than no
    preset at all, since the first three colours of the standard order are
    still the standard order. A track with more lanes than any preset
    covers (more than six) gets `None`: inventing a seventh "standard"
    colour is not this module's call to make, and a stage-2 form is free to
    offer manual selection instead.
    """
    exact = LANE_COLOR_PRESETS.get(lane_count)
    if exact is not None:
        return exact
    if lane_count < 1:
        return None
    for preset_size in sorted(LANE_COLOR_PRESETS):
        if preset_size >= lane_count:
            return LANE_COLOR_PRESETS[preset_size][:lane_count]
    return None
