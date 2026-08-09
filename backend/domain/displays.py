"""What an audience display can be told to show (#174).

Each screen used to pick its view from its own URL, so changing what one shows
meant finding it and driving its browser — with four taped around a gym, that
is the operator leaving the timer mid-event.

The vocabulary is here rather than in the resolver because it is a closed set
with rules attached, and because both ends need to agree on it exactly: the
operator screen offers these choices and the display acts on them.

Nothing here knows about transport. A display learns its assignment over the
subscription it already holds, which is why the whole feature needs no new
socket — see `services/displays.py` for the registry and `api/schema.py` for
the two channels.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

__all__ = [
    "DisplayView",
    "Assignment",
    "DEFAULT_VIEW",
    "is_paced_by_a_person",
    "describe",
]


class DisplayView(str, Enum):
    """What a screen is showing.

    A ``str`` enum whose values equal their names, like the others that cross
    this boundary — they pass through GraphQL and into the client unchanged,
    so there is no second copy of the vocabulary to keep in step.
    """

    #: The leaderboard, which is what most screens show most of the time.
    STANDINGS = "STANDINGS"
    #: The last recorded heat: who ran, in finishing order, with times.
    TIMING = "TIMING"
    #: Alternate between the two on a timer, for a screen nobody is watching
    #: continuously.
    CYCLE = "CYCLE"
    #: Full-bleed now-racing and on-deck, for the big screen at the front.
    PROJECTOR = "PROJECTOR"
    #: The awards ceremony, stepped through by whoever holds the microphone.
    AWARDS = "AWARDS"
    #: The racers' photographs, rotating (#175). Most of an event is the gaps
    #: between heats, and the audience is mostly families looking for their own
    #: child.
    SLIDESHOW = "SLIDESHOW"


#: What a display shows when nobody has told it anything. Standings rather than
#: nothing: an unassigned screen is a screen somebody has just plugged in, and
#: a blank one reads as broken.
DEFAULT_VIEW = DisplayView.STANDINGS


@dataclass(frozen=True)
class Assignment:
    """What one display has been told to show.

    ``cycle_seconds`` applies to ``CYCLE`` and is carried regardless, so an
    operator flipping a screen to standings and back does not lose the interval
    they chose.
    """

    view: DisplayView = DEFAULT_VIEW
    cycle_seconds: int = 10

    def __post_init__(self) -> None:
        if self.cycle_seconds < 1:
            # A zero interval is a busy loop and a negative one is a
            # `setInterval` that fires continuously; neither is a screen
            # anybody can read.
            raise ValueError("cycle_seconds must be at least 1")


def is_paced_by_a_person(view: DisplayView) -> bool:
    """Whether this view advances only when somebody drives it.

    The awards ceremony does: it is paced by whoever is holding the microphone,
    and a screen that advanced on its own would announce the next trophy over
    the applause for the last one. Everything else rotates or updates by
    itself. Worth stating because the operator screen has to say so — assigning
    a display to AWARDS and expecting it to progress on its own is the mistake
    the wording exists to prevent.
    """
    return view is DisplayView.AWARDS


def describe(assignment: Assignment) -> str:
    """One line naming what a screen is showing, for the operator's list."""
    if assignment.view is DisplayView.CYCLE:
        return f"Standings and timing, every {assignment.cycle_seconds}s"
    if assignment.view is DisplayView.SLIDESHOW:
        return f"Racer photos, every {assignment.cycle_seconds}s"
    return {
        DisplayView.STANDINGS: "Standings",
        DisplayView.TIMING: "Last heat's times",
        DisplayView.PROJECTOR: "Projector — now racing and on deck",
        DisplayView.AWARDS: "Awards ceremony",
        DisplayView.SLIDESHOW: "Racer photos",
    }[assignment.view]
