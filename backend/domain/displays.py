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
    "ScrollBehavior",
    "QRTarget",
    "Assignment",
    "DEFAULT_VIEW",
    "DEFAULT_SCROLL_BEHAVIOR",
    "DEFAULT_QR_TARGET",
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
    #: The leaderboard alone, filling the whole screen — no Now Racing / On
    #: Deck panels (#663). For a pack big enough that the standings need the
    #: room those panels would otherwise take, on a screen dedicated to
    #: nothing else. See ``ScrollBehavior`` for how it gets through a list
    #: longer than one screen can hold at once.
    STANDINGS_ONLY = "STANDINGS_ONLY"
    #: Who has checked in and who has not, grouped by racing group — a
    #: "Please Check In" kiosk for the gym wall or the entrance before racing
    #: starts (#612). See ``Assignment.show_checked_in`` for the one setting
    #: specific to it.
    CHECKIN = "CHECKIN"
    #: A large, high-contrast QR code that opens this race on a phone (#614)
    #: — the answer to "how do I get fifty parents in a gym onto the right
    #: address" that shouting an IP address never was. See ``QRTarget`` for
    #: the one thing specific to it: which page the code actually opens.
    QRCODE = "QRCODE"
    #: A transparent broadcast graphic for an OBS Studio Browser Source
    #: (#616): a lower-third bar (round/heat, the lane line-up, a live
    #: status badge) plus a finish banner that reveals and lingers once a
    #: heat completes. Unlike every other view, this one's consumer is
    #: streaming software rather than a person in the room — nothing here
    #: paints the screen's own background, so a camera feed composited
    #: underneath it in OBS shows through everywhere this view does not
    #: draw a panel of its own. See ``Assignment.show_standings_ticker`` for
    #: the one thing specific to it.
    OVERLAY = "OVERLAY"


class ScrollBehavior(str, Enum):
    """How ``STANDINGS_ONLY`` works through a list too long for one screen.

    A ``str`` enum for the same reason as ``DisplayView``: it crosses into
    GraphQL and the client unchanged. Carried on the assignment the same way
    ``cycle_seconds`` is — set once, and it survives a screen being switched
    away from ``STANDINGS_ONLY`` and back.
    """

    #: The list in pages, advancing to the next one every ``cycle_seconds``.
    PAGING = "PAGING"
    #: One continuous pass from top to bottom, timed to take ``cycle_seconds``.
    SMOOTH = "SMOOTH"


class QRTarget(str, Enum):
    """Which page ``QRCODE`` points a phone at.

    A screen full of `#614 <https://github.com/dknowles2/trusty-track/issues/614>`_
    scans to somewhere, and "somewhere" is the one genuine choice this view
    has — everything else about it (rendering a code, showing the address as
    text) is the same regardless. Two rather than a general URL: opening this
    up to an arbitrary address would make the display list a way to point a
    kiosk at anything, which is not a control a screen with no PIN should be
    handed.
    """

    #: This race's own audience display (``/race/{id}/observation``) — live
    #: standings and the current heat, on a phone rather than a wall.
    STANDINGS = "STANDINGS"
    #: The voting ballot (``/race/{id}/vote``), for the one screen a
    #: `VIEWER` may act through at all (#305).
    VOTE = "VOTE"


#: What a display shows when nobody has told it anything. Standings rather than
#: nothing: an unassigned screen is a screen somebody has just plugged in, and
#: a blank one reads as broken.
DEFAULT_VIEW = DisplayView.STANDINGS

#: Paging over smooth-scrolling, because it is the more familiar of the two —
#: closer to what "flip to the next page" already means on every other paced
#: view here.
DEFAULT_SCROLL_BEHAVIOR = ScrollBehavior.PAGING

#: The live audience display over the voting ballot: every race has
#: standings to point at, and only some ever turn voting on.
DEFAULT_QR_TARGET = QRTarget.STANDINGS


@dataclass(frozen=True)
class Assignment:
    """What one display has been told to show.

    ``cycle_seconds`` applies to ``CYCLE``, ``SLIDESHOW`` and
    ``STANDINGS_ONLY``, and is carried regardless, so an operator flipping a
    screen to standings and back does not lose the interval they chose.
    ``scroll_behavior`` is the same shape, for ``STANDINGS_ONLY`` alone.
    ``show_checked_in`` is ``CHECKIN``'s own rider, for the same reason: a
    large pack's screen switched away from ``CHECKIN`` and back keeps
    whichever choice the operator made.
    """

    view: DisplayView = DEFAULT_VIEW
    cycle_seconds: int = 10
    scroll_behavior: ScrollBehavior = DEFAULT_SCROLL_BEHAVIOR
    #: Whether ``CHECKIN`` lists a group's already-checked-in racers or only
    #: the ones still pending. Defaults to listing everybody — DerbyNet's own
    #: kiosk does, and a pack small enough to fit is the common case; a pack
    #: big enough that the full roster does not fit one screen is what the
    #: pending-only mode is for (#612).
    show_checked_in: bool = True
    #: ``QRCODE``'s own rider (#614), the same shape as ``show_checked_in``
    #: above: carried regardless of the current view, so a screen switched
    #: away from ``QRCODE`` and back keeps whichever page it was pointed at.
    qr_target: QRTarget = DEFAULT_QR_TARGET
    #: ``OVERLAY``'s own rider (#616), the same shape as ``show_checked_in``
    #: and ``qr_target`` above: carried regardless of the current view, so a
    #: screen switched away from ``OVERLAY`` and back keeps whichever choice
    #: the operator made. Defaults to on — a compact top-5 ticker is what
    #: fills the screen between heats, the gaps a lower-third bar alone
    #: leaves empty; a streamer who wants the bar and nothing else turns it
    #: off deliberately rather than the reverse.
    show_standings_ticker: bool = True

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
    if assignment.view is DisplayView.STANDINGS_ONLY:
        if assignment.scroll_behavior is ScrollBehavior.SMOOTH:
            return f"Standings only, scrolling every {assignment.cycle_seconds}s"
        return f"Standings only, paging every {assignment.cycle_seconds}s"
    if assignment.view is DisplayView.CHECKIN:
        if assignment.show_checked_in:
            return "Check-in progress"
        return "Check-in progress — pending only"
    if assignment.view is DisplayView.QRCODE:
        if assignment.qr_target is QRTarget.VOTE:
            return "QR code — voting ballot"
        return "QR code — live standings"
    if assignment.view is DisplayView.OVERLAY:
        if assignment.show_standings_ticker:
            return "Broadcast overlay — with standings ticker"
        return "Broadcast overlay — heat only"
    return {
        DisplayView.STANDINGS: "Standings",
        DisplayView.TIMING: "Last heat's times",
        DisplayView.PROJECTOR: "Projector — now racing and on deck",
        DisplayView.AWARDS: "Awards ceremony",
        DisplayView.SLIDESHOW: "Racer photos",
    }[assignment.view]
