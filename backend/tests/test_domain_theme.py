"""`domain.theme.resolve_theme_setting` (#1081) — race override, install,
what's left once neither has chosen: nothing, since the organization column
always carries a real value.
"""

import pytest

from backend.domain.theme import resolve_theme_setting


@pytest.mark.parametrize(
    "organization_setting,race_override,expected",
    [
        # No race override at all: the install's own setting wins, whatever
        # it is.
        ("MATCH_APP", None, "MATCH_APP"),
        ("under-the-lights", None, "under-the-lights"),
        # A race override beats the install, whatever the install is set to.
        ("MATCH_APP", "newsprint", "newsprint"),
        ("under-the-lights", "newsprint", "newsprint"),
        # `"MATCH_APP"` is an ordinary race-level value (Field Uniform,
        # pinned for this race), not the inherit sentinel — it still beats a
        # differently-themed install.
        ("under-the-lights", "MATCH_APP", "MATCH_APP"),
        # A race explicitly set to the same value the install already has —
        # an ordinary case, not special-cased away.
        ("old-glory", "old-glory", "old-glory"),
    ],
)
def test_resolve_theme_setting(
    organization_setting: str, race_override: str | None, expected: str
) -> None:
    assert (
        resolve_theme_setting(
            organization_setting=organization_setting, race_override=race_override
        )
        == expected
    )
