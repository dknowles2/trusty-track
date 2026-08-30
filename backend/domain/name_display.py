"""How much of a racer's name a public screen may show (#552).

A privacy setting, not a vocabulary word — which is why this is a sibling
module to `domain/terminology.py` rather than a fourth term grown onto it.
`terminology.py` is about what a screen *calls* a concept ("Den" vs "Class");
this is about how much of a specific child's *name* a stranger standing in
front of a gym-wall projector, or holding a printed pit pass, gets to read.
Different question, same layering shape, so it earns its own tiny module
rather than a `name_display` field bolted onto `Terminology` — a caller
resolving terminology has no reason to also resolve this, and vice versa.

Three values:

-   ``FULL`` — "Jordan Mitchell". The default, and today's only behaviour.
-   ``LAST_INITIAL`` — "Jordan M.". The common request (GPRM calls this
    "first name and last initial").
-   ``FIRST_ONLY`` — "Jordan". For a pack whose own policy says no surname
    on a public screen at all.

Two scopes, layered exactly like terminology: an **organization** default,
set once for the install, and a **race** override, for the one venue running
two different events under one install. Null means "inherit the layer
beneath" — all the way down to ``FULL``, which is what every install showed
before this setting existed.

Unlike `terminology.py`'s six fields, ``FULL`` *is* a reachable non-null
value here (there is nothing an operator could type instead of it — this is
a closed three-value choice, not free text), so the organization column can
double as both "unset" and "explicitly full" without a separate clear flag:
storing the literal string ``"FULL"`` and leaving the column null produce the
same resolved answer. The race column still needs a way back to null,
because a race override of ``"FULL"`` means something different from no
override at all (inherit whatever the organization has chosen) — that is
`api.schema`'s `RaceUpdateInput.clear_name_display`, following
`clearTerminology` exactly.

Almost every surface that renders a name does so client-side — the
printables are client-rendered HTML, the standings CSV is built in
`utils/csv.ts`, and every audience component reads `first_name`/`last_name`
off a query result it already holds — so `frontend/src/features/core/displayName.ts`
is where almost all of this resolves into a printed string, and
`NAME_DISPLAY_VALUES` here is documentation rather than an enforced
constraint, the same relationship `domain.terminology.VEHICLE_ARTWORK_KEYS`
has with `PrintDecor.tsx`.

One surface is the exception, which is why `format_display_name` below
exists at all: `Subscription.timing_stats` composes `TimingStatsLane.racer_name`
and `TrackRecordBreak.new_holder` as plain strings *inside the resolver*,
for the results overlay and the record-break banner on the projector — both
audience surfaces (#552's own list names "results overlay"). There is no
first/last pair for the frontend to reformat once that string exists, so the
abbreviation has to happen here, and `format_display_name` is the Python
twin of `displayName.ts`'s `formatDisplayName` — the two must stay in step
by hand, since a shared rule split across two languages has no single file
either can import.
"""

from __future__ import annotations

__all__ = [
    "DEFAULT_NAME_DISPLAY",
    "NAME_DISPLAY_VALUES",
    "format_display_name",
    "resolve_name_display",
]

#: The whole recognised vocabulary. `frontend/src/features/core/displayName.ts`
#: holds the one canonical copy of what each value means to render; a value
#: outside this set (an old install, a future build's value reaching an
#: older one) is treated as `FULL` by `resolve_name_display` below — the
#: same "fall back rather than crash" rule `resolve_terminology` follows.
NAME_DISPLAY_VALUES = ("FULL", "LAST_INITIAL", "FIRST_ONLY")

#: What every install showed before this setting existed, and what an
#: unconfigured install or an unconfigured race still shows today.
DEFAULT_NAME_DISPLAY = "FULL"


def resolve_name_display(
    organization: str | None = None, race: str | None = None
) -> str:
    """Layer a race override over an organization default over ``FULL``.

    Mirrors `domain.terminology.resolve_terminology`'s shape exactly, for one
    scalar instead of seven: the race value wins if set, otherwise the
    organization value, otherwise the default. A value this module does not
    recognise resolves as though it were absent — an old install with a
    future build's value stored should read as unset, not raise.
    """
    if race is not None and race in NAME_DISPLAY_VALUES:
        return race
    if organization is not None and organization in NAME_DISPLAY_VALUES:
        return organization
    return DEFAULT_NAME_DISPLAY


def format_display_name(name_display: str, first_name: str, last_name: str) -> str:
    """Turn a resolved setting plus a racer's stored name into the string
    ``Subscription.timing_stats`` should compose.

    Mirrors `displayName.ts`'s `formatDisplayName` exactly, edge case for
    edge case — see that module's doc comment for why each one is handled
    the way it is (a single-word name, an empty first name, a hyphenated or
    multi-part surname). Keep the two in step by hand.
    """
    first = first_name.strip()
    last = last_name.strip()

    if name_display == "FIRST_ONLY":
        return first or last
    if name_display == "LAST_INITIAL":
        if not last:
            return first
        initial = last[0].upper()
        return f"{first} {initial}." if first else f"{initial}."
    return " ".join(part for part in (first, last) if part)
