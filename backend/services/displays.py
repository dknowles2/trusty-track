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

from backend.domain.displays import DEFAULT_VIEW, Assignment, DisplayView

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
            name=name or self._auto_name(race_id),
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

    def _auto_name(self, race_id: int) -> str:
        taken = {d.name for d in self._displays.values() if d.race_id == race_id}
        n = 1
        while f"Display {n}" in taken:
            n += 1
        return f"Display {n}"

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

    # -- writing ----------------------------------------------------------

    def assign(
        self,
        display_id: str,
        view: DisplayView,
        cycle_seconds: int | None = None,
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
        )
        display.assigned = True
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
