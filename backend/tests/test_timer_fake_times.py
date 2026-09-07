"""The fake timer's times, and why they can be made to repeat.

Random by default, because a fake timer that reported 3.412 s every time you
re-ran the same heat reads as the app being broken rather than as the timer
being fake.

Repeatable on request, because the documentation screenshots race on it. With
a fresh time in every image, every screenshot differed on every run — so a
change to one page rewrote roughly fifty binary files, and two branches
touching the documentation conflicted on all fifty. None of that churn is
visible in a diff, which is what made it read as noise rather than as something
with a cause.
"""

import pytest

from backend import demo_seed
from backend.services.timer.devices import fake


@pytest.fixture
def seeded(monkeypatch):
    monkeypatch.setenv(demo_seed.SEED_VARIABLE, "a-fixed-seed")


class TestWithoutASeed:
    def test_two_runs_of_the_same_heat_differ(self, monkeypatch):
        monkeypatch.delenv(demo_seed.SEED_VARIABLE, raising=False)

        first = fake.lane_times([1, 2, 3, 4], key="Derby#1")
        second = fake.lane_times([1, 2, 3, 4], key="Derby#1")

        assert [t for _, t in first] != [t for _, t in second]


@pytest.mark.usefixtures("seeded")
class TestWithASeed:
    def test_the_same_heat_gets_the_same_times(self):
        assert fake.lane_times([1, 2, 3], key="Derby#1") == fake.lane_times(
            [1, 2, 3], key="Derby#1"
        )

    def test_a_different_heat_gets_different_times(self):
        """Otherwise every heat of the race would be a dead heat, and the
        standings screenshot would be a column of identical averages."""
        first = fake.lane_times([1, 2, 3], key="Derby#1")
        second = fake.lane_times([1, 2, 3], key="Derby#2")

        assert [t for _, t in first] != [t for _, t in second]

    def test_a_heat_does_not_depend_on_what_ran_before_it(self):
        """The property the key exists for.

        A single generator drawn from in the order heats happened to be run
        would give a spec regenerated on its own different times from the same
        spec regenerated alongside the others — so the screenshots would churn
        again, for a reason nobody could see in the diff.
        """
        alone = fake.lane_times([1, 2], key="Derby#7")

        for other in range(5):
            fake.lane_times([1, 2], key=f"Other Race#{other}")
        after_others = fake.lane_times([1, 2], key="Derby#7")

        assert alone == after_others


class TestTheTimesThemselves:
    def test_fastest_first_so_the_order_is_the_placement(self):
        times = [t for _, t in fake.lane_times([1, 2, 3, 4, 5, 6], key="k")]

        assert times == sorted(times)

    def test_every_lane_gets_one(self):
        assert {lane for lane, _ in fake.lane_times([2, 4, 5], key="k")} == {2, 4, 5}

    def test_they_land_in_the_window(self):
        for _, seconds in fake.lane_times(list(range(1, 9)), key="k"):
            assert fake.FASTEST_SECONDS <= seconds < fake.SLOWEST_SECONDS

    def test_no_lanes_is_no_times(self):
        assert fake.lane_times([], key="k") == []

    def test_times_are_rounded_like_a_real_device_rather_than_raw_float_noise(self):
        """Issue #763. Before the fix this was
        ``FASTEST_SECONDS + source.random() * span`` with nothing rounding
        it, so a heat's time could be ``3.41412257608823`` -- visible,
        digit for digit, in the Edit modal's input and in a CSV export.
        Every real timer profile reports a handful of decimal digits, never
        raw float noise, so the fake one should too.
        """
        for _, seconds in fake.lane_times(list(range(1, 9)), key="rounding"):
            assert round(seconds, 3) == seconds, (
                f"{seconds!r} carries more than three decimal places"
            )

    def test_rounding_never_pushes_a_time_up_to_the_window_s_edge(self):
        """A value at the very top of the window (e.g. 3.99961) rounds to
        4.0, which is `SLOWEST_SECONDS` itself -- exactly what
        `test_they_land_in_the_window` above says never happens. Repeated
        rather than assumed from one seed, since the failure only shows up
        within 0.0005 of the ceiling."""
        for offset in range(1, 1000):
            key = f"edge-{offset}"
            for _, seconds in fake.lane_times([1], key=key):
                assert fake.FASTEST_SECONDS <= seconds < fake.SLOWEST_SECONDS
