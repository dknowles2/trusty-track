"""What a screen calls a racing group, the organization that holds them, and
the thing being raced (#496, stage 3; #551 adds the third term).

Three configurable terms, each stored as a singular and a plural — English
plurals are irregular, and deriving "Classes" from "Class" is a rule nobody
should own. A racing group's `division` (Cub Scout rank, school grade, ...)
stays a fixed "Category" label rather than becoming a fourth configurable
term: it is branding on one row, not vocabulary a whole screen is built from,
and three terms are already twelve columns across the two scopes below.

The third term — what a racer's vehicle is called — is #551's own reason for
existing: a Space Derby races rockets, a Raingutter Regatta races boats, and
both were reading "Car #14" on every screen with no way to say otherwise. The
storage-layer columns (`car_number`, `car_name`, ...) and the `CarNumberingStrategy`
enum are deliberately *not* renamed — they are API and database identifiers,
not display copy, and #551 explicitly declines that migration for zero
user-visible gain. Only the word a screen shows is configurable.

`vehicle_artwork_key` (#551, stage 4) rides alongside the vehicle word rather
than being derived from it. The certificate seal, the pit pass footer and the
heat/results sheet mark all draw a small line-art glyph — a car by default —
and an operator who calls their vehicle "Speedster" still wants the rocket
picture, not a guess parsed out of a custom string. It is a *third* column
pair rather than folded into `vehicle_singular`, but a plain string exactly
like `Award.artwork_key`: `VEHICLE_ARTWORK_KEYS` is the whole recognised
vocabulary, and `frontend/src/features/printables/components/PrintDecor.tsx`
is the only place that turns a key into a picture. A key outside that set —
an old install, or a future build's key reaching an older one — renders the
neutral/blank treatment, the same "print blank rather than crash" rule
`AwardArtwork` already follows for an unrecognised award key.

Two scopes, layered:

- an **organization** default, set once for the install and rarely touched
  again;
- a **race** override, for the one venue running two different events (a
  pack derby in March, a school science fair in May) under one install and
  one organization.

Null means "inherit from the layer beneath", all the way down to the
built-in Scouting words this app has always shown. `resolve_terminology`
is the one place that layering happens — the frontend must not merge these
itself, the same reasoning that kept the live heat view server-side (#7).
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = [
    "DEFAULT_TERMINOLOGY",
    "VEHICLE_ARTWORK_KEYS",
    "Terminology",
    "TerminologyOverrides",
    "overrides_from_row",
    "resolve_terminology",
]

#: The whole recognised vocabulary for `vehicle_artwork_key` — a car (the
#: built-in default), a rocket (Space Derby) or a boat (Raingutter Regatta).
#: `frontend/src/features/printables/components/PrintDecor.tsx` is the only
#: place that turns one of these into a picture; a key outside this set
#: renders nothing there rather than raising, so this set is documentation
#: and a settings-picker vocabulary, not an enforced constraint — the same
#: relationship `services/timer` has with `TimerProfile.key`.
VEHICLE_ARTWORK_KEYS = ("car", "rocket", "boat")


@dataclass(frozen=True)
class Terminology:
    """The words a screen should use, fully resolved — never null."""

    racing_group_singular: str
    racing_group_plural: str
    organization_singular: str
    organization_plural: str
    vehicle_singular: str
    vehicle_plural: str
    #: Which line-art the vehicle word draws with — one of
    #: `VEHICLE_ARTWORK_KEYS`. Defaulted (rather than positional like the six
    #: above) so `Terminology(...)` literals written before this field
    #: existed — the domain tests build one by hand — still construct without
    #: naming it.
    vehicle_artwork_key: str = "car"


@dataclass(frozen=True)
class TerminologyOverrides:
    """One layer's worth of custom words.

    Every field is optional and independent of the others — a race can
    rename "Pack" without touching "Den", and an organization that has
    renamed neither is simply every field left `None`. This is the shape
    both `models.Organization` and `models.Race` store: six nullable
    columns apiece, read straight into this dataclass at the GraphQL
    boundary.
    """

    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    vehicle_artwork_key: str | None = None


#: The words every install showed before this existed, and what an
#: unconfigured install and an unconfigured race still show today.
DEFAULT_TERMINOLOGY = Terminology(
    racing_group_singular="Den",
    racing_group_plural="Dens",
    organization_singular="Pack",
    organization_plural="Packs",
    vehicle_singular="Car",
    vehicle_plural="Cars",
    vehicle_artwork_key="car",
)


def overrides_from_row(row: object) -> TerminologyOverrides:
    """Read one layer's six override columns off an ORM row.

    Works for both `models.Organization` and `models.Race` — they carry the
    same six column names for exactly this reason. Takes a duck-typed
    ``object`` rather than one of those ORM types so this module stays free
    of SQLAlchemy imports (#8); `getattr` with a `None` default reads a row
    that predates a column the same as one that has it and leaves it unset.
    """
    return TerminologyOverrides(
        racing_group_singular=getattr(row, "racing_group_singular", None),
        racing_group_plural=getattr(row, "racing_group_plural", None),
        organization_singular=getattr(row, "organization_singular", None),
        organization_plural=getattr(row, "organization_plural", None),
        vehicle_singular=getattr(row, "vehicle_singular", None),
        vehicle_plural=getattr(row, "vehicle_plural", None),
        vehicle_artwork_key=getattr(row, "vehicle_artwork_key", None),
    )


def resolve_terminology(
    organization: TerminologyOverrides | None = None,
    race: TerminologyOverrides | None = None,
) -> Terminology:
    """Layer a race override over an organization default over the built-in
    Scouting words.

    Each of the six fields resolves independently: a race may override only
    `organization_singular` and still inherit `racing_group_singular` from
    the organization (or, if the organization has not set it either, from
    `DEFAULT_TERMINOLOGY`). `organization` absent is the same as every field
    on it being `None` — there is no race with no organization, but a caller
    with nothing loaded yet (a fresh `InitialConfigStatus`) can pass nothing
    at either layer and get the built-in words back.
    """
    org = organization or TerminologyOverrides()
    rc = race or TerminologyOverrides()
    return Terminology(
        racing_group_singular=(
            rc.racing_group_singular
            if rc.racing_group_singular is not None
            else org.racing_group_singular
            if org.racing_group_singular is not None
            else DEFAULT_TERMINOLOGY.racing_group_singular
        ),
        racing_group_plural=(
            rc.racing_group_plural
            if rc.racing_group_plural is not None
            else org.racing_group_plural
            if org.racing_group_plural is not None
            else DEFAULT_TERMINOLOGY.racing_group_plural
        ),
        organization_singular=(
            rc.organization_singular
            if rc.organization_singular is not None
            else org.organization_singular
            if org.organization_singular is not None
            else DEFAULT_TERMINOLOGY.organization_singular
        ),
        organization_plural=(
            rc.organization_plural
            if rc.organization_plural is not None
            else org.organization_plural
            if org.organization_plural is not None
            else DEFAULT_TERMINOLOGY.organization_plural
        ),
        vehicle_singular=(
            rc.vehicle_singular
            if rc.vehicle_singular is not None
            else org.vehicle_singular
            if org.vehicle_singular is not None
            else DEFAULT_TERMINOLOGY.vehicle_singular
        ),
        vehicle_plural=(
            rc.vehicle_plural
            if rc.vehicle_plural is not None
            else org.vehicle_plural
            if org.vehicle_plural is not None
            else DEFAULT_TERMINOLOGY.vehicle_plural
        ),
        vehicle_artwork_key=(
            rc.vehicle_artwork_key
            if rc.vehicle_artwork_key is not None
            else org.vehicle_artwork_key
            if org.vehicle_artwork_key is not None
            else DEFAULT_TERMINOLOGY.vehicle_artwork_key
        ),
    )
