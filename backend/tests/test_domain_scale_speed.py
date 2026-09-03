"""Pure arithmetic tests for ``domain/scale_speed.py`` (#610 stage 1).

No database involved — the point of the domain layer (see "The domain layer"
in ``CLAUDE.md``) is that this runs with nothing behind it.
"""

from backend.domain.scale_speed import DEFAULT_SCALE, scale_mph


class TestTheWorkedExample:
    def test_forty_feet_in_3_2_seconds_is_about_213_mph(self) -> None:
        result = scale_mph(40, 3.200)
        assert result is not None
        assert round(result, 1) == 213.1

    def test_the_default_scale_is_1_to_25(self) -> None:
        assert DEFAULT_SCALE == 25


class TestNoneCases:
    def test_a_zero_length_is_none(self) -> None:
        assert scale_mph(0, 3.2) is None

    def test_a_negative_length_is_none(self) -> None:
        assert scale_mph(-1, 3.2) is None

    def test_a_zero_time_is_the_dnf_marker_and_is_none(self) -> None:
        assert scale_mph(40, 0.0) is None

    def test_a_negative_time_is_none(self) -> None:
        assert scale_mph(40, -3.2) is None

    def test_a_none_length_is_none(self) -> None:
        assert scale_mph(None, 3.2) is None

    def test_a_none_time_is_none(self) -> None:
        assert scale_mph(40, None) is None

    def test_a_zero_scale_is_none(self) -> None:
        assert scale_mph(40, 3.2, scale=0) is None

    def test_a_negative_scale_is_none(self) -> None:
        assert scale_mph(40, 3.2, scale=-25) is None


class TestLinearInScale:
    def test_doubling_the_scale_doubles_the_result(self) -> None:
        base = scale_mph(40, 3.2, scale=25)
        doubled = scale_mph(40, 3.2, scale=50)
        assert base is not None
        assert doubled is not None
        assert doubled == base * 2

    def test_a_space_derby_or_regatta_scale_is_just_a_different_number(
        self,
    ) -> None:
        # Not 1:25 — a rocket or a boat is not built to a Pinewood Derby car's
        # ratio, and the function does not know or care.
        result = scale_mph(40, 3.2, scale=1)
        reference = scale_mph(40, 3.2, scale=25)
        assert result is not None
        assert reference is not None
        assert round(result, 4) == round(reference / 25, 4)
