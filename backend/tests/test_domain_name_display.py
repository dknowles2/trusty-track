"""The layering rules for the name-display setting (#552).

Pure, so these run without a database — the same reason
`test_domain_terminology.py` exists. The GraphQL wiring is covered in
`test_name_display.py`.
"""

from backend.domain.name_display import (
    DEFAULT_NAME_DISPLAY,
    NAME_DISPLAY_VALUES,
    format_display_name,
    resolve_name_display,
)


class TestDefault:
    def test_the_default_is_full(self) -> None:
        assert DEFAULT_NAME_DISPLAY == "FULL"

    def test_nothing_set_anywhere_gives_full(self) -> None:
        assert resolve_name_display() == "FULL"

    def test_the_recognised_values_include_the_default(self) -> None:
        assert DEFAULT_NAME_DISPLAY in NAME_DISPLAY_VALUES
        assert NAME_DISPLAY_VALUES == ("FULL", "LAST_INITIAL", "FIRST_ONLY")


class TestOrganizationDefault:
    def test_an_organization_override_replaces_full(self) -> None:
        assert resolve_name_display(organization="LAST_INITIAL") == "LAST_INITIAL"

    def test_an_organization_override_of_first_only(self) -> None:
        assert resolve_name_display(organization="FIRST_ONLY") == "FIRST_ONLY"

    def test_an_explicit_full_organization_value_is_still_full(self) -> None:
        assert resolve_name_display(organization="FULL") == "FULL"

    def test_none_and_explicit_full_resolve_the_same(self) -> None:
        assert resolve_name_display(organization=None) == resolve_name_display(
            organization="FULL"
        )


class TestRaceOverride:
    def test_a_race_override_beats_the_organization_default(self) -> None:
        result = resolve_name_display(organization="LAST_INITIAL", race="FIRST_ONLY")
        assert result == "FIRST_ONLY"

    def test_a_race_override_of_full_beats_a_non_full_organization_default(
        self,
    ) -> None:
        """The one case that makes the race column's null-vs-FULL distinction
        matter: a race that wants full names even though the organization's
        default abbreviates."""
        result = resolve_name_display(organization="LAST_INITIAL", race="FULL")
        assert result == "FULL"

    def test_race_none_falls_through_to_the_organization_default(self) -> None:
        result = resolve_name_display(organization="LAST_INITIAL", race=None)
        assert result == "LAST_INITIAL"

    def test_race_none_falls_through_an_unset_organization(self) -> None:
        assert resolve_name_display(organization=None, race=None) == "FULL"


class TestUnrecognisedValues:
    """A value this module does not know about — an old install upgraded
    into a build with fewer choices, or a future value reaching an older
    one — resolves as though it were absent, the same "fall back rather
    than crash" rule `resolve_terminology` follows for its own vocabulary
    fields."""

    def test_an_unrecognised_organization_value_falls_back_to_full(self) -> None:
        assert resolve_name_display(organization="SOMETHING_ELSE") == "FULL"

    def test_an_unrecognised_race_value_falls_through_to_the_organization(
        self,
    ) -> None:
        result = resolve_name_display(organization="LAST_INITIAL", race="NONSENSE")
        assert result == "LAST_INITIAL"


class TestFormatDisplayName:
    """The Python twin of `displayName.ts`'s `formatDisplayName`, used only
    by `Subscription.timing_stats` — see the module doc comment for why that
    one surface needs a server-side formatter when everything else does not.
    Mirrors that module's test cases exactly."""

    def test_full_prints_the_whole_name(self) -> None:
        assert format_display_name("FULL", "Jordan", "Mitchell") == "Jordan Mitchell"

    def test_full_with_no_last_name(self) -> None:
        assert format_display_name("FULL", "Jordan", "") == "Jordan"

    def test_an_unrecognised_value_behaves_like_full(self) -> None:
        assert (
            format_display_name("SOMETHING_ELSE", "Jordan", "Mitchell")
            == "Jordan Mitchell"
        )

    def test_last_initial(self) -> None:
        assert format_display_name("LAST_INITIAL", "Jordan", "Mitchell") == "Jordan M."

    def test_last_initial_with_no_last_name_falls_back_to_first(self) -> None:
        assert format_display_name("LAST_INITIAL", "Jordan", "") == "Jordan"

    def test_last_initial_with_no_first_name(self) -> None:
        assert format_display_name("LAST_INITIAL", "", "Mitchell") == "M."

    def test_last_initial_on_a_hyphenated_surname(self) -> None:
        assert (
            format_display_name("LAST_INITIAL", "Jordan", "Garcia-Lopez") == "Jordan G."
        )

    def test_last_initial_on_a_multi_part_surname(self) -> None:
        assert (
            format_display_name("LAST_INITIAL", "Jordan", "de la Cruz") == "Jordan D."
        )

    def test_first_only(self) -> None:
        assert format_display_name("FIRST_ONLY", "Jordan", "Mitchell") == "Jordan"

    def test_first_only_falls_back_to_last_name(self) -> None:
        assert format_display_name("FIRST_ONLY", "", "Mitchell") == "Mitchell"
