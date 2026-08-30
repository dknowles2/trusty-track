"""The layering rules for custom terminology (#496, stage 3).

Pure, so these run without a database — the point of `domain/`. The GraphQL
wiring is covered in `test_terminology.py`.
"""

from backend.domain.terminology import (
    DEFAULT_TERMINOLOGY,
    Terminology,
    TerminologyOverrides,
    resolve_terminology,
)


class TestNoOverrides:
    def test_nothing_set_anywhere_gives_the_built_in_words(self) -> None:
        assert resolve_terminology() == DEFAULT_TERMINOLOGY

    def test_an_organization_with_every_field_none_is_the_same_as_absent(
        self,
    ) -> None:
        assert resolve_terminology(organization=TerminologyOverrides()) == (
            DEFAULT_TERMINOLOGY
        )


class TestOrganizationDefault:
    def test_an_organization_override_replaces_the_built_in_word(self) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(
                racing_group_singular="Class", racing_group_plural="Classes"
            )
        )
        assert result.racing_group_singular == "Class"
        assert result.racing_group_plural == "Classes"

    def test_an_organization_override_leaves_the_other_term_alone(self) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(racing_group_singular="Class")
        )
        assert result.organization_singular == DEFAULT_TERMINOLOGY.organization_singular
        assert result.organization_plural == DEFAULT_TERMINOLOGY.organization_plural

    def test_a_field_left_none_inherits_the_built_in_word_even_when_a_sibling_is_set(
        self,
    ) -> None:
        # Singular set, plural not — the plural should not silently become
        # "" or None, it should fall all the way through to the default.
        result = resolve_terminology(
            organization=TerminologyOverrides(racing_group_singular="Class")
        )
        assert result.racing_group_plural == DEFAULT_TERMINOLOGY.racing_group_plural


class TestRaceOverride:
    def test_a_race_override_beats_the_organization_default(self) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(
                racing_group_singular="Class", racing_group_plural="Classes"
            ),
            race=TerminologyOverrides(
                racing_group_singular="Team", racing_group_plural="Teams"
            ),
        )
        assert result.racing_group_singular == "Team"
        assert result.racing_group_plural == "Teams"

    def test_a_race_field_left_none_falls_through_to_the_organization_default(
        self,
    ) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(
                racing_group_singular="Class", racing_group_plural="Classes"
            ),
            race=TerminologyOverrides(organization_singular="Club"),
        )
        assert result.racing_group_singular == "Class"
        assert result.racing_group_plural == "Classes"

    def test_a_race_field_left_none_falls_through_an_unset_organization(
        self,
    ) -> None:
        result = resolve_terminology(
            organization=None,
            race=TerminologyOverrides(organization_singular="Club"),
        )
        assert result.racing_group_singular == DEFAULT_TERMINOLOGY.racing_group_singular
        assert result.organization_singular == "Club"

    def test_every_field_can_be_overridden_independently(self) -> None:
        result = resolve_terminology(
            race=TerminologyOverrides(
                racing_group_singular="Team",
                racing_group_plural="Teams",
                organization_singular="Club",
                organization_plural="Clubs",
                vehicle_singular="Rocket",
                vehicle_plural="Rockets",
            )
        )
        assert result == Terminology(
            racing_group_singular="Team",
            racing_group_plural="Teams",
            organization_singular="Club",
            organization_plural="Clubs",
            vehicle_singular="Rocket",
            vehicle_plural="Rockets",
        )


class TestVehicleTerm:
    """The third configurable term (#551) — layers exactly like the other
    two, so this pins only what is specific to it rather than repeating
    every case above."""

    def test_the_built_in_word_is_car(self) -> None:
        assert DEFAULT_TERMINOLOGY.vehicle_singular == "Car"
        assert DEFAULT_TERMINOLOGY.vehicle_plural == "Cars"

    def test_an_organization_override_replaces_the_built_in_word(self) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(
                vehicle_singular="Rocket", vehicle_plural="Rockets"
            )
        )
        assert result.vehicle_singular == "Rocket"
        assert result.vehicle_plural == "Rockets"
        # Left alone.
        assert result.racing_group_singular == DEFAULT_TERMINOLOGY.racing_group_singular

    def test_a_race_override_beats_the_organization_default(self) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(
                vehicle_singular="Rocket", vehicle_plural="Rockets"
            ),
            race=TerminologyOverrides(vehicle_singular="Boat", vehicle_plural="Boats"),
        )
        assert result.vehicle_singular == "Boat"
        assert result.vehicle_plural == "Boats"

    def test_a_race_field_left_none_falls_through_to_the_organization_default(
        self,
    ) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(
                vehicle_singular="Rocket", vehicle_plural="Rockets"
            ),
            race=TerminologyOverrides(organization_singular="Club"),
        )
        assert result.vehicle_singular == "Rocket"
        assert result.vehicle_plural == "Rockets"


class TestVehicleArtworkKey:
    """The vehicle artwork key (#551, stage 4) — layers exactly like every
    other terminology field, so this pins only what is specific to it."""

    def test_the_built_in_key_is_car(self) -> None:
        assert DEFAULT_TERMINOLOGY.vehicle_artwork_key == "car"

    def test_nothing_set_anywhere_gives_the_built_in_key(self) -> None:
        assert resolve_terminology().vehicle_artwork_key == "car"

    def test_an_organization_override_replaces_the_built_in_key(self) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(vehicle_artwork_key="rocket")
        )
        assert result.vehicle_artwork_key == "rocket"
        # Left alone.
        assert result.vehicle_singular == DEFAULT_TERMINOLOGY.vehicle_singular

    def test_a_race_override_beats_the_organization_default(self) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(vehicle_artwork_key="rocket"),
            race=TerminologyOverrides(vehicle_artwork_key="boat"),
        )
        assert result.vehicle_artwork_key == "boat"

    def test_a_race_field_left_none_falls_through_to_the_organization_default(
        self,
    ) -> None:
        result = resolve_terminology(
            organization=TerminologyOverrides(vehicle_artwork_key="rocket"),
            race=TerminologyOverrides(organization_singular="Club"),
        )
        assert result.vehicle_artwork_key == "rocket"

    def test_the_artwork_key_is_independent_of_the_word(self) -> None:
        """An operator can pick the rocket picture without the word being
        literally "Rocket" — the two are separate columns for exactly this
        reason, not one derived from the other."""
        result = resolve_terminology(
            organization=TerminologyOverrides(
                vehicle_singular="Speedster",
                vehicle_plural="Speedsters",
                vehicle_artwork_key="rocket",
            )
        )
        assert result.vehicle_singular == "Speedster"
        assert result.vehicle_artwork_key == "rocket"
