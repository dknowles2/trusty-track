"""Pure tests for ``domain/lane_colors.py`` (#611 stage 1).

No database, no `Track` row — the point of the domain layer (see "The
domain layer" in ``CLAUDE.md``) is that this runs with nothing behind it.
"""

from backend.domain.lane_colors import (
    LANE_COLOR_PRESETS,
    STANDARD_4_LANE_COLORS,
    STANDARD_6_LANE_COLORS,
    color_for_lane,
    is_valid_lane_color,
    preset_for_lane_count,
)


class TestColorForLane:
    def test_reads_the_track_lane_number_one_based(self) -> None:
        colors = ["#E53935", "#FAFAFA", "#1E88E5", "#FDD835"]
        assert color_for_lane(colors, 1) == "#E53935"
        assert color_for_lane(colors, 4) == "#FDD835"

    def test_lane_zero_is_none(self) -> None:
        assert color_for_lane(["#E53935"], 0) is None

    def test_a_negative_lane_is_none(self) -> None:
        assert color_for_lane(["#E53935"], -1) is None

    def test_a_lane_past_the_end_of_the_list_is_none(self) -> None:
        assert color_for_lane(["#E53935"], 2) is None

    def test_an_unconfigured_empty_list_is_none_for_every_lane(self) -> None:
        assert color_for_lane([], 1) is None
        assert color_for_lane([], 6) is None

    def test_a_blank_entry_is_none_not_an_empty_string(self) -> None:
        assert color_for_lane(["", "#1E88E5"], 1) is None
        assert color_for_lane(["", "#1E88E5"], 2) == "#1E88E5"

    def test_non_contiguous_usable_lanes_are_not_assumed(self) -> None:
        # Lane 3's sensor is out of service; the colors are still stored for
        # every physical lane the track has. Nothing about looking one up
        # cares that lane 3 is not currently in the usable set.
        colors = ["#E53935", "#FAFAFA", "#1E88E5", "#FDD835"]
        assert color_for_lane(colors, 1) == "#E53935"
        assert color_for_lane(colors, 3) == "#1E88E5"
        assert color_for_lane(colors, 4) == "#FDD835"


class TestIsValidLaneColor:
    def test_a_six_digit_hex_color_is_valid(self) -> None:
        assert is_valid_lane_color("#E53935")

    def test_a_three_digit_hex_color_is_valid(self) -> None:
        assert is_valid_lane_color("#f00")

    def test_lowercase_and_uppercase_both_work(self) -> None:
        assert is_valid_lane_color("#abcdef")
        assert is_valid_lane_color("#ABCDEF")

    def test_missing_the_hash_is_invalid(self) -> None:
        assert not is_valid_lane_color("E53935")

    def test_the_wrong_digit_count_is_invalid(self) -> None:
        assert not is_valid_lane_color("#E5393")

    def test_a_named_css_color_is_invalid(self) -> None:
        # Deliberately not accepted: presets carry a name *and* a hex value,
        # and only the hex is what a lane colour stores (see the module
        # docstring's "Storage shape" section).
        assert not is_valid_lane_color("red")

    def test_the_empty_string_is_invalid(self) -> None:
        # Blank means "not configured" in `color_for_lane`, handled before
        # a value would ever reach validation, not a valid colour itself.
        assert not is_valid_lane_color("")

    def test_every_preset_color_is_itself_valid(self) -> None:
        for lane_color in STANDARD_4_LANE_COLORS + STANDARD_6_LANE_COLORS:
            assert is_valid_lane_color(lane_color.hex)


class TestPresetForLaneCount:
    def test_four_lanes_is_the_standard_four_lane_scheme(self) -> None:
        assert preset_for_lane_count(4) == STANDARD_4_LANE_COLORS

    def test_six_lanes_is_the_standard_six_lane_scheme(self) -> None:
        assert preset_for_lane_count(6) == STANDARD_6_LANE_COLORS

    def test_three_lanes_truncates_the_four_lane_scheme(self) -> None:
        assert preset_for_lane_count(3) == STANDARD_4_LANE_COLORS[:3]

    def test_five_lanes_truncates_the_six_lane_scheme(self) -> None:
        assert preset_for_lane_count(5) == STANDARD_6_LANE_COLORS[:5]

    def test_one_lane_truncates_to_a_single_color(self) -> None:
        assert preset_for_lane_count(1) == STANDARD_4_LANE_COLORS[:1]

    def test_more_than_six_lanes_has_no_preset(self) -> None:
        assert preset_for_lane_count(7) is None
        assert preset_for_lane_count(8) is None

    def test_zero_lanes_has_no_preset(self) -> None:
        assert preset_for_lane_count(0) is None

    def test_a_negative_lane_count_has_no_preset(self) -> None:
        assert preset_for_lane_count(-1) is None

    def test_the_preset_table_only_names_four_and_six(self) -> None:
        # Pinned so a third preset added later is a deliberate edit to this
        # test, not a silent change to what `preset_for_lane_count` truncates
        # from.
        assert set(LANE_COLOR_PRESETS) == {4, 6}
