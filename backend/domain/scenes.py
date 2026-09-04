"""Named collections of what every audience display should show at once (#613).

An operator reassigning three or six screens one row at a time between the
phases of an event — check-in, racing, an intermission, the ceremony — is the
same handful of clicks every time, done under time pressure, with the wrong
screen an easy mistake. A scene is that handful of clicks saved: one name that
means "every screen goes to its configured view, right now."

Two kinds, and they answer different questions:

``ScenePreset``
    A **built-in recipe**, not a display's worth of stored state. It names a
    small ordered list of roles ("main", "staging", "aux", ...) and is applied
    live against whichever displays are actually connected for a race, in the
    same connected-first, then-by-name order the operator's own list already
    sorts by (`DisplayRegistry.for_race`) — there is nothing here to persist,
    because a preset is code, not something an operator created. See
    ``assignments_for_preset``.

``Scene``
    A **named, operator-created** mapping from a specific display (by its
    ``display_id``, the same stable identity `identifyDisplay` and
    `renameDisplay` already key on) to the exact ``Assignment`` it should
    hold — persisted, because unlike a display's own live presence
    (`services/displays.py`'s whole reason for staying in memory) a scene is
    something the operator spent real time composing and wants to reuse
    across the rest of the event, including after a restart. See
    ``backend/db/models.py::Scene``/``SceneAssignment`` for the storage and
    ``backend/db/crud.py`` for the persistence I/O this module stays free of.

Every entry in either kind carries a **whole ``Assignment``** — the view and
its riders (``scroll_behavior``, ``show_checked_in``, ``qr_target``,
``show_standings_ticker``) — not the view alone. A scene's whole point is
"put this screen into a fully-known state in one click": an Awards scene that
only set ``view=QRCODE`` and left ``qr_target`` as whatever the screen
happened to be showing before would sometimes point the code at the voting
ballot and sometimes at the live standings, defeating the one thing a scene
promises over clicking the view dropdown by hand. ``assignDisplay`` already
treats the two as inseparable for exactly this reason — a caller who omits a
rider keeps the display's *current* one rather than resetting it, which is
right for an incremental edit and wrong for "this is the state I am recalling
by name."
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from backend.domain.displays import (
    DEFAULT_SCROLL_BEHAVIOR,
    Assignment,
    DisplayView,
)

__all__ = [
    "ScenePreset",
    "PRESETS",
    "preset_by_key",
    "assignments_for_preset",
]


class ScenePreset(str, Enum):
    """One built-in recipe's key. A ``str`` enum whose values equal their
    names, the same shape as `DisplayView` and every other vocabulary that
    crosses into GraphQL — `api/schema.py` wraps this one directly rather
    than re-declaring it, so there is one copy of the four names.
    """

    CHECK_IN = "CHECK_IN"
    RACING = "RACING"
    INTERMISSION = "INTERMISSION"
    AWARDS = "AWARDS"


@dataclass(frozen=True)
class _Preset:
    key: ScenePreset
    label: str
    #: Role assignments in priority order — the first connected display gets
    #: `roles[0]`, the second `roles[1]`, and so on. A race with more
    #: displays than roles repeats the last role rather than leaving the
    #: extra screens untouched: an operator running six screens through a
    #: three-role "Racing" preset almost certainly wants the spares showing
    #: the same thing as the third, not whatever they already had.
    roles: tuple[Assignment, ...]


#: DerbyNet's own four defaults (the issue's "What DerbyNet does"), adapted to
#: this app's view vocabulary rather than copied literally — there is no
#: separate "on deck" view here the way DerbyNet's kiosk has; `PROJECTOR`
#: already shows now-racing and on-deck together, which is what "Staging TV
#: -> On Deck" is reaching for.
PRESETS: tuple[_Preset, ...] = (
    _Preset(
        key=ScenePreset.CHECK_IN,
        label="Check-In",
        roles=(
            Assignment(view=DisplayView.CHECKIN),
            Assignment(view=DisplayView.SLIDESHOW),
        ),
    ),
    _Preset(
        key=ScenePreset.RACING,
        label="Racing",
        roles=(
            Assignment(view=DisplayView.PROJECTOR),
            Assignment(
                view=DisplayView.STANDINGS_ONLY,
                scroll_behavior=DEFAULT_SCROLL_BEHAVIOR,
            ),
            Assignment(view=DisplayView.STANDINGS),
        ),
    ),
    _Preset(
        key=ScenePreset.INTERMISSION,
        label="Intermission",
        # Every screen the same thing, deliberately: an intermission has no
        # "main" screen the way racing does; the room is looking at whichever
        # screen is nearest. A scheduled break's own banner (#592) already
        # overlays on top of any view, so this is about what fills the screen
        # underneath it, not about the break itself.
        roles=(Assignment(view=DisplayView.SLIDESHOW),),
    ),
    _Preset(
        key=ScenePreset.AWARDS,
        label="Awards",
        roles=(
            Assignment(view=DisplayView.AWARDS),
            Assignment(view=DisplayView.STANDINGS),
        ),
    ),
)


def preset_by_key(key: ScenePreset) -> _Preset | None:
    for preset in PRESETS:
        if preset.key == key:
            return preset
    return None


def assignments_for_preset(
    preset: _Preset, display_ids_in_order: list[str]
) -> list[tuple[str, Assignment]]:
    """What every display in ``display_ids_in_order`` should be told, for
    this preset.

    Pure — the caller supplies the order (`DisplayRegistry.for_race`'s own
    connected-first, then-by-name sort, the same order the operator's list
    already renders in) rather than this function reaching for the registry
    itself, which is what lets the role-assignment rule be checked with no
    server at all (`test_domain_scenes.py`).
    """
    if not display_ids_in_order:
        return []
    last = len(preset.roles) - 1
    return [
        (display_id, preset.roles[min(index, last)])
        for index, display_id in enumerate(display_ids_in_order)
    ]
