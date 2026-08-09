"""Audience displays: who is connected, and what each is showing (#174).

Presence is in memory rather than the database, so these tests are about a
registry rather than rows — see `services/displays.py` for why a screen that
was on a wall last March is not something worth storing.
"""

import pytest

from backend.domain import displays as domain
from backend.services.displays import DisplayRegistry


@pytest.fixture
def registry():
    return DisplayRegistry()


class TestTheVocabulary:
    def test_a_display_nobody_has_told_anything_shows_the_standings(self):
        # Not nothing: an unassigned screen is one somebody has just plugged
        # in, and a blank one reads as broken.
        assert domain.DEFAULT_VIEW is domain.DisplayView.STANDINGS
        assert domain.Assignment().view is domain.DisplayView.STANDINGS

    def test_only_the_ceremony_waits_for_a_person(self):
        # The observation views rotate because nobody is driving them; the
        # ceremony is paced by whoever holds the microphone, and the operator
        # screen has to say so.
        assert domain.is_paced_by_a_person(domain.DisplayView.AWARDS)
        for view in domain.DisplayView:
            if view is not domain.DisplayView.AWARDS:
                assert not domain.is_paced_by_a_person(view)

    def test_every_view_can_be_described(self):
        # The operator's list renders this string. A view added to the enum
        # and forgotten here would raise on the screen that lists it.
        for view in domain.DisplayView:
            assert domain.describe(domain.Assignment(view=view))

    def test_cycling_says_how_often(self):
        assert "20s" in domain.describe(
            domain.Assignment(view=domain.DisplayView.CYCLE, cycle_seconds=20)
        )

    def test_an_interval_below_a_second_is_refused(self):
        # Zero is a busy loop and a negative is a `setInterval` that fires
        # continuously; neither is a screen anybody can read.
        for bad in (0, -5):
            with pytest.raises(ValueError):
                domain.Assignment(view=domain.DisplayView.CYCLE, cycle_seconds=bad)


class TestPresence:
    def test_a_display_appears_when_it_connects(self, registry):
        registry.connect("abc", race_id=1)

        assert [d.display_id for d in registry.for_race(1)] == ["abc"]

    def test_it_is_named_so_the_list_is_usable_immediately(self, registry):
        first = registry.connect("abc", race_id=1)
        second = registry.connect("def", race_id=1)

        assert first.name != second.name
        assert first.name and second.name

    def test_a_display_stays_listed_after_it_goes_quiet(self, registry):
        # The screen that has dropped off the wifi is the one the operator most
        # wants to see. A row that vanishes tells them nothing.
        registry.connect("abc", race_id=1)
        registry.disconnect("abc")

        listed = registry.for_race(1)
        assert [d.display_id for d in listed] == ["abc"]
        assert listed[0].connected is False

    def test_reconnecting_keeps_the_name_and_the_assignment(self, registry):
        # The whole reason the display chooses its own id: the operator names a
        # screen once, and it survives the reload when somebody bumps the
        # trolley.
        registry.connect("abc", race_id=1)
        registry.rename("abc", "Gym north")
        registry.assign("abc", domain.DisplayView.PROJECTOR)
        registry.disconnect("abc")

        again = registry.connect("abc", race_id=1)

        assert again.name == "Gym north"
        assert again.assignment.view is domain.DisplayView.PROJECTOR
        assert again.connected

    def test_two_connections_from_one_display_need_two_disconnects(self, registry):
        # A reload can overlap: the new socket opens before the old one closes,
        # and a single disconnect would mark a live screen as gone.
        registry.connect("abc", race_id=1)
        registry.connect("abc", race_id=1)

        registry.disconnect("abc")
        assert registry.get("abc").connected

        registry.disconnect("abc")
        assert not registry.get("abc").connected

    def test_disconnecting_something_unknown_is_not_an_error(self, registry):
        registry.disconnect("never-seen")

    def test_displays_are_listed_per_race(self, registry):
        registry.connect("abc", race_id=1)
        registry.connect("def", race_id=2)

        assert [d.display_id for d in registry.for_race(1)] == ["abc"]
        assert [d.display_id for d in registry.for_race(2)] == ["def"]

    def test_connected_displays_are_listed_first(self, registry):
        # The order the operator scans in: the live screens are the ones they
        # are about to change.
        registry.connect("quiet", race_id=1, name="A quiet one")
        registry.connect("live", race_id=1, name="Z live one")
        registry.disconnect("quiet")

        assert [d.display_id for d in registry.for_race(1)] == ["live", "quiet"]

    def test_a_display_that_moved_race_is_listed_under_the_new_one(self, registry):
        # One screen, one venue, two races in a day.
        registry.connect("abc", race_id=1)
        registry.connect("abc", race_id=2)

        assert registry.for_race(1) == []
        assert [d.display_id for d in registry.for_race(2)] == ["abc"]


class TestAssignment:
    def test_a_new_display_has_not_been_told_anything(self, registry):
        # Distinct from "its assignment is the default". A display nobody has
        # assigned must keep following its own URL, which is how every screen
        # behaved before #174 — and the opening payload always carries *an*
        # assignment, so without this flag it silently overrode the URL on
        # every screen the moment it connected. The end-to-end spec found it.
        display = registry.connect("abc", race_id=1)

        assert display.assigned is False
        assert display.assignment.view is domain.DEFAULT_VIEW

    def test_being_told_anything_marks_it_assigned(self, registry):
        registry.connect("abc", race_id=1)

        # Even to the view it already had: the operator has now said so.
        registry.assign("abc", domain.DEFAULT_VIEW)

        assert registry.get("abc").assigned is True

    def test_an_assignment_survives_a_reconnect(self, registry):
        registry.connect("abc", race_id=1)
        registry.assign("abc", domain.DisplayView.PROJECTOR)
        registry.disconnect("abc")

        assert registry.connect("abc", race_id=1).assigned is True

    def test_a_display_can_be_told_what_to_show(self, registry):
        registry.connect("abc", race_id=1)

        registry.assign("abc", domain.DisplayView.TIMING)

        assert registry.get("abc").assignment.view is domain.DisplayView.TIMING

    def test_the_cycle_interval_survives_a_change_of_view(self, registry):
        # An operator flipping a screen to standings and back should not lose
        # the interval they chose.
        registry.connect("abc", race_id=1)
        registry.assign("abc", domain.DisplayView.CYCLE, cycle_seconds=30)

        registry.assign("abc", domain.DisplayView.STANDINGS)
        registry.assign("abc", domain.DisplayView.CYCLE)

        assert registry.get("abc").assignment.cycle_seconds == 30

    def test_assigning_something_unknown_reports_it_rather_than_inventing_it(
        self, registry
    ):
        # A display forgotten between listing and clicking. Creating one here
        # would put a screen in the list that does not exist.
        assert registry.assign("never-seen", domain.DisplayView.TIMING) is None
        assert registry.for_race(1) == []

    def test_an_unassigned_display_reports_the_default(self, registry):
        assert registry.assignment_for("never-seen").view is domain.DEFAULT_VIEW


class TestNaming:
    def test_a_display_can_be_renamed(self, registry):
        registry.connect("abc", race_id=1)

        registry.rename("abc", "Gym north")

        assert registry.get("abc").name == "Gym north"

    def test_an_empty_name_is_refused(self, registry):
        # The list is how a screen is identified; a blank row is one nobody can
        # pick out.
        registry.connect("abc", race_id=1, name="Gym north")

        assert registry.rename("abc", "   ") is None
        assert registry.get("abc").name == "Gym north"

    def test_surrounding_space_is_trimmed(self, registry):
        registry.connect("abc", race_id=1)

        registry.rename("abc", "  Gym north  ")

        assert registry.get("abc").name == "Gym north"


class TestForgetting:
    def test_the_operator_can_drop_a_display(self, registry):
        registry.connect("abc", race_id=1)
        registry.disconnect("abc")

        assert registry.forget("abc") is True
        assert registry.for_race(1) == []

    def test_forgetting_something_unknown_says_so(self, registry):
        assert registry.forget("never-seen") is False
