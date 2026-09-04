"""Which audience displays are connected, and what each is showing (#174).

**In memory, not in the database, and that is the design rather than a
shortcut.** A display is a browser tab that is open right now. A row recording
that a screen was taped to the north wall of a gym last March describes nothing
that still exists, and a table of them accumulates forever with no event that
would ever delete one — presence has no natural end other than the socket
closing, which is exactly what this holds.

The assignments go with it. Losing them on a restart is not a gap: an
unassigned display falls back to its own URL, which is what every display did
before this existed, so the failure mode is the previous behaviour rather than
a broken screen. That fallback is what lets the whole feature avoid a
migration, and it is worth keeping for that reason alone.

A display registers itself by *subscribing*, not by calling a mutation. That is
forced and correct: a screen holds no PIN and is a ``VIEWER``, and a ``VIEWER``
may make no mutation at all (#15). It is also the right shape — the display is
the thing being told, not the thing asking.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field, replace

from backend.domain.display_names import whimsical_name
from backend.domain.displays import (
    DEFAULT_VIEW,
    Assignment,
    DisplayView,
    QRTarget,
    ScrollBehavior,
)

__all__ = ["Display", "DisplayRegistry", "registry"]


@dataclass
class Display:
    """One connected screen."""

    #: Chosen by the display and kept in its own storage, so it is the same
    #: screen across a reload. The server never invents one: an id it handed
    #: out would be forgotten by the browser and the screen would arrive as a
    #: stranger every time somebody refreshed it.
    display_id: str
    race_id: int
    #: What the operator calls it. Auto-named on arrival so the list is usable
    #: before anybody has typed anything.
    name: str
    assignment: Assignment = field(default_factory=Assignment)
    #: Whether an operator has actually told this display anything.
    #:
    #: Distinct from "its assignment happens to be the default", and the
    #: distinction is load-bearing: a display that has been told nothing must
    #: keep following its own URL, which is how every screen behaved before
    #: #174 and what makes the feature safe to add. Without this flag the
    #: opening payload — which always carries *an* assignment — silently
    #: overrode the URL on every screen the moment it connected.
    assigned: bool = False
    #: Monotonic, because this is only ever compared with itself. A wall clock
    #: would jump when the Pi finally reaches an NTP server, which on a venue
    #: LAN is often minutes into the event.
    last_seen: float = 0.0
    connections: int = 0
    #: The operator's last "next"/"previous" for a screen showing the awards
    #: ceremony, as a **step** rather than a slide number, plus a counter that
    #: says it is a new one.
    #:
    #: A slide number would have to come from somewhere, and the only thing
    #: that knows which trophy is on screen is the screen — which holds no PIN
    #: and can call no mutation to report it (#15). Making the server the sole
    #: driver instead would break the presenter remote at the projector, which
    #: is how most ceremonies are actually run. A step composes with both: the
    #: display applies it to wherever it has got to, so the operator's Next is
    #: correct whether or not somebody at the screen has been pressing keys.
    #:
    #: The counter is what makes a step an event rather than a state. Without
    #: it a reconnecting screen could not tell a command it had already obeyed
    #: from a new one — and every payload carries these fields.
    slide_seq: int = 0
    slide_delta: int = 0
    #: The operator's last "flash your name" command, as a counter rather
    #: than a boolean — the same shape as `slide_seq` and for the same
    #: reason (#495). A boolean could not tell a second Identify from the
    #: first; a rising counter is what makes it an *event* a screen can
    #: compare itself against, rather than a state it might already be in.
    #: The screen ignores the value it arrives holding, on connect or
    #: reconnect, for `roundCompletion.ts`'s `seen === null` reason: an
    #: opening payload is a reconnection, not an instruction, and obeying it
    #: would flash the name on every wifi hiccup.
    identify_seq: int = 0

    @property
    def connected(self) -> bool:
        return self.connections > 0


class DisplayRegistry:
    """Who is connected, and what they have been told.

    Not thread-safe and does not need to be: every caller is a coroutine on the
    one event loop, in the single process this whole application is (#9 is
    about the timer's *database* session, not about concurrency here).
    """

    def __init__(self) -> None:
        self._displays: dict[str, Display] = {}

    # -- presence ---------------------------------------------------------

    def connect(
        self, display_id: str, race_id: int, name: str | None = None
    ) -> Display:
        """Register a display, or note that a known one is back.

        A reconnect keeps the assignment and the name. That is the point of the
        display choosing its own id: the operator names a screen once, and it
        survives the reload that happens when somebody bumps the trolley.
        """
        existing = self._displays.get(display_id)
        if existing is not None:
            existing.race_id = race_id
            existing.connections += 1
            existing.last_seen = time.monotonic()
            if name and existing.name != name:
                existing.name = name
            return existing

        display = Display(
            display_id=display_id,
            race_id=race_id,
            name=name or self._auto_name(display_id, race_id),
            last_seen=time.monotonic(),
            connections=1,
        )
        self._displays[display_id] = display
        return display

    def disconnect(self, display_id: str) -> None:
        """Note that one connection went away.

        The display is **kept**, not dropped. A screen that has gone quiet is
        the one the operator most wants to see in the list — it is how they
        find out the projector at the back has dropped off the wifi — and a row
        that vanishes tells them nothing at all.
        """
        display = self._displays.get(display_id)
        if display is None:
            return
        display.connections = max(0, display.connections - 1)
        display.last_seen = time.monotonic()

    def _auto_name(self, display_id: str, race_id: int) -> str:
        taken = {d.name for d in self._displays.values() if d.race_id == race_id}
        return whimsical_name(display_id, taken)

    # -- reading ----------------------------------------------------------

    def get(self, display_id: str) -> Display | None:
        return self._displays.get(display_id)

    def for_race(self, race_id: int) -> list[Display]:
        """Every display known for a race, connected first, then by name.

        Connected first because that is the order the operator scans in: the
        screens that are live are the ones they are about to change.
        """
        return sorted(
            (d for d in self._displays.values() if d.race_id == race_id),
            key=lambda d: (not d.connected, d.name.lower()),
        )

    def all_ids(self) -> list[str]:
        """Every display known to this process, regardless of race.

        For the one thing that is genuinely install-wide rather than
        race-scoped: the Display surface's theme (`Organization.display_theme`,
        #498) lives on the organization, not on a race, so a change to it has
        to reach every connected screen whatever race it happens to be
        pointed at — the ordinary `for_race` scoping would miss a screen left
        on a second race sharing the install.
        """
        return list(self._displays.keys())

    # -- writing ----------------------------------------------------------

    def assign(
        self,
        display_id: str,
        view: DisplayView,
        cycle_seconds: int | None = None,
        scroll_behavior: ScrollBehavior | None = None,
        show_checked_in: bool | None = None,
        qr_target: QRTarget | None = None,
        show_standings_ticker: bool | None = None,
    ) -> Display | None:
        """Tell a display what to show. Returns None for one nobody has seen."""
        display = self._displays.get(display_id)
        if display is None:
            return None
        current = display.assignment
        display.assignment = Assignment(
            view=view,
            cycle_seconds=(
                current.cycle_seconds if cycle_seconds is None else cycle_seconds
            ),
            scroll_behavior=(
                current.scroll_behavior if scroll_behavior is None else scroll_behavior
            ),
            show_checked_in=(
                current.show_checked_in if show_checked_in is None else show_checked_in
            ),
            qr_target=(current.qr_target if qr_target is None else qr_target),
            show_standings_ticker=(
                current.show_standings_ticker
                if show_standings_ticker is None
                else show_standings_ticker
            ),
        )
        display.assigned = True
        return display

    def advance(self, display_id: str, delta: int) -> Display | None:
        """Step a screen's ceremony forward or back from the operator's list.

        Records the step and bumps the counter; the display does the moving,
        because it is the only thing that knows which trophy is up. See
        ``Display.slide_seq`` for why this is a step rather than a slide
        number.

        The counter is bumped even for a screen showing something else —
        the operator's list only offers the control on a ceremony row, and a
        rule about *which* view may be stepped would be a second copy of that
        one. Nothing but the ceremony page acts on it.
        """
        display = self._displays.get(display_id)
        if display is None:
            return None
        display.slide_seq += 1
        display.slide_delta = delta
        return display

    def identify(self, display_id: str) -> Display | None:
        """Ask a screen to flash its own name (#495).

        A memorable name is only half of it — the operator still has to
        learn which row on the list is the projector at the back. Bumping the
        counter is the whole of it; the screen does the flashing, the same
        split as `advance` and the ceremony's steps, and for the same reason:
        this is an event the display reacts to, not a state the registry
        holds a picture of.
        """
        display = self._displays.get(display_id)
        if display is None:
            return None
        display.identify_seq += 1
        return display

    def rename(self, display_id: str, name: str) -> Display | None:
        """Give a display a name the operator will recognise.

        An empty name is refused rather than stored: the list is how a screen
        is identified, and a blank row is a screen nobody can pick out.
        """
        display = self._displays.get(display_id)
        if display is None or not name.strip():
            return None
        display.name = name.strip()
        return display

    def suggest_name(self, display_id: str, avoid: str | None = None) -> str:
        """A rerolled suggestion for one display's name (#521).

        Goes through `whimsical_name` — the same walk `_auto_name` runs on
        first connect — rather than a second copy of the animal vocabulary or
        its collision rule. `taken` is every *other* display's name in this
        one's race, so the result can never repeat a name already on a row
        the operator is looking at.

        `avoid` is the draft currently sitting in the rename input. Without
        it the walk is seeded from `display_id` alone and pressing the die
        twice would return the same word both times; passing the draft each
        press is what makes "give me another" actually give another.

        A display nobody has connected yet has no race to check against, so
        it gets an unconstrained suggestion — there is nobody for it to
        collide with.
        """
        display = self._displays.get(display_id)
        taken: set[str] = set()
        if display is not None:
            taken = {
                d.name
                for d in self._displays.values()
                if d.race_id == display.race_id and d.display_id != display_id
            }
        if avoid:
            taken = taken | {avoid}
        return whimsical_name(display_id, taken)

    def forget(self, display_id: str) -> bool:
        """Drop a display the operator says is gone.

        The one way a display leaves the list, because nothing else can decide
        it: a screen that is off is indistinguishable from one whose wifi has
        dropped, and guessing wrong in either direction is worse than leaving
        the row for a person to clear.
        """
        return self._displays.pop(display_id, None) is not None

    def clear(self) -> None:
        """For tests, and for a restore replacing the event underneath us."""
        self._displays.clear()

    # -- helpers ----------------------------------------------------------

    def assignment_for(self, display_id: str) -> Assignment:
        display = self._displays.get(display_id)
        return replace(display.assignment) if display else Assignment(view=DEFAULT_VIEW)


#: One per process, like the timer managers and the pub/sub broadcaster.
registry = DisplayRegistry()
