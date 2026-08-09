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
