"""What a screen calls a racing group, and what it calls the organization
that holds them (#496, stage 3).

Two configurable terms, each stored as a singular and a plural — English
plurals are irregular, and deriving "Classes" from "Class" is a rule nobody
should own. The third field the issue considered, the racing group's
`division` (Cub Scout rank, school grade, ...), stays a fixed "Category"
label rather than becoming a third configurable term: it is branding on one
row, not vocabulary a whole screen is built from, and two terms are already
eight columns across the two scopes below.

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
    "Terminology",
    "TerminologyOverrides",
    "resolve_terminology",
]


@dataclass(frozen=True)
class Terminology:
    """The words a screen should use, fully resolved — never null."""

    racing_group_singular: str
    racing_group_plural: str
    organization_singular: str
    organization_plural: str


@dataclass(frozen=True)
class TerminologyOverrides:
    """One layer's worth of custom words.

    Every field is optional and independent of the others — a race can
    rename "Pack" without touching "Den", and an organization that has
    renamed neither is simply every field left `None`. This is the shape
    both `models.Organization` and `models.Race` store: four nullable
    columns apiece, read straight into this dataclass at the GraphQL
    boundary.
    """

    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None


#: The words every install showed before this existed, and what an
#: unconfigured install and an unconfigured race still show today.
DEFAULT_TERMINOLOGY = Terminology(
    racing_group_singular="Den",
    racing_group_plural="Dens",
    organization_singular="Pack",
    organization_plural="Packs",
)


def resolve_terminology(
    organization: TerminologyOverrides | None = None,
    race: TerminologyOverrides | None = None,
) -> Terminology:
    """Layer a race override over an organization default over the built-in
    Scouting words.

    Each of the four fields resolves independently: a race may override only
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
    )
