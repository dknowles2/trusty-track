"""Which Display/Printables theme a race actually shows (#1081).

A pack that runs a regular derby in Field Uniform and a space-themed
"Rocket Derby" the same season wants the second event's wall display and pit
passes to look like that event, without re-theming the install before and
after. `Organization.display_theme`/`printables_theme` (#498) already choose
these install-wide, in `System Settings → Appearance`; this adds a second,
narrower layer above them, the same shape `domain.terminology` and
`domain.name_display` already use for their own two scopes.

Two scopes, layered:

- an **organization** default, set once for the install (`setThemes`) —
  always a real value, `"MATCH_APP"` or a `ThemeKey`, never null;
- a **race** override (`Race.display_theme`/`printables_theme`), null where
  a race has not chosen its own and simply shows whatever the install is set
  to. Unlike `Organization`'s columns, `"MATCH_APP"` here is an *ordinary*
  value in the same vocabulary — "this race is pinned to Field Uniform
  regardless of what the install picks later" — not the inherit state.
  Inheriting is null, the same distinction `Race.name_display`'s explicit
  `"FULL"` makes against its own null.

One function, because the layering is exactly "the closer scope wins, or
fall through" with nothing else to compute — there is no built-in default
below the organization layer the way `resolve_terminology` falls all the way
to the built-in Scouting words, since `Organization.display_theme` already
carries its own non-null default (`"MATCH_APP"`) at the database level. The
frontend must not merge these two layers itself, the same reasoning that
kept the live heat view and the terminology layering server-side (#7): two
screens (or a screen and a printed page) resolving the same layers
independently is two chances to disagree about what a race looks like.
"""

from __future__ import annotations

__all__ = ["resolve_theme_setting"]


def resolve_theme_setting(organization_setting: str, race_override: str | None) -> str:
    """A race's own theme choice, or the install's, if it has not made one.

    `organization_setting` is `Organization.display_theme` or
    `Organization.printables_theme` — always a real value. `race_override`
    is the matching column on `Race` — null means "inherit", any other
    string (including `"MATCH_APP"`) is a real choice made for this race
    alone and wins outright.
    """
    return race_override if race_override is not None else organization_setting
