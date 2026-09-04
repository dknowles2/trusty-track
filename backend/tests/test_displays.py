"""Audience displays: who is connected, and what each is showing (#174).

Presence is in memory rather than the database, so these tests are about a
registry rather than rows — see `services/displays.py` for why a screen that
was on a wall last March is not something worth storing.
"""

import pytest

from backend.domain import displays as domain
from backend.services import displays as displays_service
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

    def test_standings_only_defaults_to_paging(self):
        assert domain.Assignment().scroll_behavior is domain.DEFAULT_SCROLL_BEHAVIOR
        assert domain.DEFAULT_SCROLL_BEHAVIOR is domain.ScrollBehavior.PAGING

    def test_standings_only_says_how_it_scrolls(self):
        paging = domain.describe(
            domain.Assignment(
                view=domain.DisplayView.STANDINGS_ONLY,
                cycle_seconds=15,
                scroll_behavior=domain.ScrollBehavior.PAGING,
            )
        )
        assert "15s" in paging
        assert "paging" in paging.lower()

        smooth = domain.describe(
            domain.Assignment(
                view=domain.DisplayView.STANDINGS_ONLY,
                cycle_seconds=15,
                scroll_behavior=domain.ScrollBehavior.SMOOTH,
            )
        )
        assert "15s" in smooth
        assert "scrolling" in smooth.lower()

    def test_checkin_says_whether_it_lists_everybody_or_only_the_missing(self):
        everybody = domain.describe(
            domain.Assignment(view=domain.DisplayView.CHECKIN, show_checked_in=True)
        )
        assert "pending" not in everybody.lower()

        pending_only = domain.describe(
            domain.Assignment(view=domain.DisplayView.CHECKIN, show_checked_in=False)
        )
        assert "pending" in pending_only.lower()

    def test_qr_target_defaults_to_this_races_own_standings(self):
        # Every race has standings to point at; only some ever turn voting
        # on, so the live display is the safer default.
        assert domain.DEFAULT_QR_TARGET is domain.QRTarget.STANDINGS
        assert domain.Assignment().qr_target is domain.QRTarget.STANDINGS

    def test_qrcode_says_which_page_it_points_at(self):
        standings = domain.describe(
            domain.Assignment(
                view=domain.DisplayView.QRCODE, qr_target=domain.QRTarget.STANDINGS
            )
        )
        assert "standings" in standings.lower()

        vote = domain.describe(
            domain.Assignment(
                view=domain.DisplayView.QRCODE, qr_target=domain.QRTarget.VOTE
            )
        )
        assert "vot" in vote.lower()


class TestPresence:
    def test_a_display_appears_when_it_connects(self, registry):
        registry.connect("abc", race_id=1)

        assert [d.display_id for d in registry.for_race(1)] == ["abc"]

    def test_it_is_named_so_the_list_is_usable_immediately(self, registry):
        first = registry.connect("abc", race_id=1)
        second = registry.connect("def", race_id=1)

        assert first.name != second.name
        assert first.name and second.name

    def test_the_auto_name_is_derived_from_the_display_id(self, registry):
        # #495: not a random draw, or the name would be re-invented on every
        # restart. `_auto_name` is a thin wrapper around
        # `domain.display_names.whimsical_name`, and this pins the wiring
        # rather than re-testing the function itself.
        from backend.domain.display_names import whimsical_name

        display = registry.connect("laptop-at-the-scale", race_id=1)

        assert display.name == whimsical_name("laptop-at-the-scale", taken=set())

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

    def test_all_ids_spans_every_race(self, registry):
        # The Display theme (#498) is install-wide, not race-scoped, so the
        # one thing that has to reach every screen regardless of which race
        # it is pointed at (#586) needs a walk `for_race` cannot give it.
        registry.connect("abc", race_id=1)
        registry.connect("def", race_id=2)

        assert sorted(registry.all_ids()) == ["abc", "def"]


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

    def test_the_scroll_behavior_survives_a_change_of_view(self, registry):
        # Same shape as the cycle interval above: an operator flipping a
        # screen away from STANDINGS_ONLY and back should not lose the choice
        # they made.
        registry.connect("abc", race_id=1)
        registry.assign(
            "abc",
            domain.DisplayView.STANDINGS_ONLY,
            scroll_behavior=domain.ScrollBehavior.SMOOTH,
        )

        registry.assign("abc", domain.DisplayView.STANDINGS)
        registry.assign("abc", domain.DisplayView.STANDINGS_ONLY)

        assert (
            registry.get("abc").assignment.scroll_behavior
            is domain.ScrollBehavior.SMOOTH
        )

    def test_a_new_display_defaults_to_paging(self, registry):
        registry.connect("abc", race_id=1)

        assert (
            registry.get("abc").assignment.scroll_behavior
            is domain.DEFAULT_SCROLL_BEHAVIOR
        )

    def test_a_new_display_defaults_to_showing_everybody_checked_in(self, registry):
        registry.connect("abc", race_id=1)

        assert registry.get("abc").assignment.show_checked_in is True

    def test_show_checked_in_survives_a_change_of_view(self, registry):
        # Same shape as the cycle interval and the scroll behaviour above: a
        # screen flipped away from CHECKIN and back should not lose the
        # pending-only choice a large pack made to save room.
        registry.connect("abc", race_id=1)
        registry.assign("abc", domain.DisplayView.CHECKIN, show_checked_in=False)

        registry.assign("abc", domain.DisplayView.STANDINGS)
        registry.assign("abc", domain.DisplayView.CHECKIN)

        assert registry.get("abc").assignment.show_checked_in is False

    def test_a_new_display_defaults_to_the_standings_qr_target(self, registry):
        registry.connect("abc", race_id=1)

        assert registry.get("abc").assignment.qr_target is domain.DEFAULT_QR_TARGET

    def test_qr_target_survives_a_change_of_view(self, registry):
        # Same shape as `show_checked_in` above: a screen flipped away from
        # QRCODE and back should not lose which page it was pointed at.
        registry.connect("abc", race_id=1)
        registry.assign(
            "abc", domain.DisplayView.QRCODE, qr_target=domain.QRTarget.VOTE
        )

        registry.assign("abc", domain.DisplayView.STANDINGS)
        registry.assign("abc", domain.DisplayView.QRCODE)

        assert registry.get("abc").assignment.qr_target is domain.QRTarget.VOTE


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


class TestSuggestingAName:
    """`DisplayRegistry.suggest_name` — the rename form's reroll (#521).

    Before this the reroll drew from a hand-copied word list on the
    frontend, filtered only against the one name being edited — it had no
    way to see any *other* row on screen and could, and did, hand back a
    name a second display was already using. This runs the same
    collision-avoiding walk `_auto_name` runs on first connect, against the
    same taken set, so there is one vocabulary and one rule rather than two.
    """

    def test_never_repeats_a_name_already_on_another_row(self, registry):
        registry.connect("first", race_id=1, name="Bold Beaver")
        registry.connect("second", race_id=1)

        suggestion = registry.suggest_name("second")

        assert suggestion != "Bold Beaver"
        assert "beaver" not in suggestion.lower()

    def test_a_display_does_not_collide_with_its_own_current_name(self, registry):
        # Self must be excluded from the taken set, or the very first
        # candidate — which is what a fresh display is auto-named — would
        # always be skipped as "already in use" by itself.
        from backend.domain.display_names import whimsical_name

        display = registry.connect("abc", race_id=1)
        assert display.name == whimsical_name("abc", taken=set())

        assert registry.suggest_name("abc") == display.name

    def test_avoid_keeps_a_second_press_from_repeating_the_first(self, registry):
        registry.connect("abc", race_id=1)

        first = registry.suggest_name("abc")
        second = registry.suggest_name("abc", avoid=first)

        assert second != first

    def test_is_deterministic_given_the_same_inputs(self, registry):
        # Not a random draw — seeded from the display id, the same as the
        # auto name, so asking twice with nothing new to avoid answers the
        # same both times. The frontend relies on this to walk forward
        # rather than jump around: each press passes the previous
        # suggestion as `avoid`, which is what actually varies the answer.
        registry.connect("abc", race_id=1)

        assert registry.suggest_name("abc") == registry.suggest_name("abc")

    def test_a_display_in_another_race_cannot_collide(self, registry):
        registry.connect("other-race", race_id=2, name="Bold Beaver")
        registry.connect("abc", race_id=1)

        # Nothing here should raise or refuse — a same-named screen two
        # gyms over is not this race's problem.
        assert registry.suggest_name("abc")

    def test_a_display_nobody_has_connected_still_gets_a_suggestion(self, registry):
        # No race to check against yet, so nothing to collide with — the
        # panel never actually asks for one that does not exist, but the
        # method should not require it either.
        assert registry.suggest_name("never-seen")


class TestForgetting:
    def test_the_operator_can_drop_a_display(self, registry):
        registry.connect("abc", race_id=1)
        registry.disconnect("abc")

        assert registry.forget("abc") is True
        assert registry.for_race(1) == []

    def test_forgetting_something_unknown_says_so(self, registry):
        assert registry.forget("never-seen") is False


class TestSteppingTheCeremony:
    """The operator driving a ceremony on a screen across the room.

    A *step* rather than a slide number: only the display knows which trophy
    is up, and it holds no PIN to report it back (#15). See
    `services/displays.Display.slide_seq`.
    """

    def test_a_step_is_recorded_with_a_new_counter(self, registry):
        registry.connect("abc", race_id=1)

        registry.advance("abc", 1)

        assert registry.get("abc").slide_delta == 1
        assert registry.get("abc").slide_seq == 1

    def test_the_counter_rises_on_every_step(self, registry):
        # It is what tells a display a command is new; two Nexts in a row
        # carry the same delta and must both be obeyed.
        registry.connect("abc", race_id=1)

        registry.advance("abc", 1)
        registry.advance("abc", 1)

        assert registry.get("abc").slide_seq == 2

    def test_stepping_back_is_a_negative_step(self, registry):
        registry.connect("abc", race_id=1)

        registry.advance("abc", -1)

        assert registry.get("abc").slide_delta == -1

    def test_a_display_starts_with_nothing_to_obey(self, registry):
        # Zero is the value a screen arrives holding, and the ceremony page
        # ignores the first payload anyway — a reconnection is not an
        # instruction.
        registry.connect("abc", race_id=1)

        assert registry.get("abc").slide_seq == 0

    def test_stepping_something_unknown_says_so(self, registry):
        assert registry.advance("never-seen", 1) is None

    def test_a_step_leaves_the_assignment_alone(self, registry):
        # Driving a ceremony must not re-assign the screen; that was the shape
        # of the bug in the interval control (#275).
        registry.connect("abc", race_id=1)
        registry.assign("abc", domain.DisplayView.AWARDS)

        registry.advance("abc", 1)

        assert registry.get("abc").assignment.view is domain.DisplayView.AWARDS
        assert registry.get("abc").assigned is True


class TestIdentifying:
    """The operator asking a screen to flash its own name (#495).

    Same shape as `TestSteppingTheCeremony`, and for the same reason: this is
    a counter the display reacts to, not a state the registry pictures.
    """

    def test_identifying_bumps_the_counter(self, registry):
        registry.connect("abc", race_id=1)

        registry.identify("abc")

        assert registry.get("abc").identify_seq == 1

    def test_a_second_identify_rises_further(self, registry):
        registry.connect("abc", race_id=1)

        registry.identify("abc")
        registry.identify("abc")

        assert registry.get("abc").identify_seq == 2

    def test_a_display_starts_with_nothing_to_obey(self, registry):
        registry.connect("abc", race_id=1)

        assert registry.get("abc").identify_seq == 0

    def test_identifying_something_unknown_says_so(self, registry):
        assert registry.identify("never-seen") is None

    def test_identifying_leaves_the_assignment_and_name_alone(self, registry):
        registry.connect("abc", race_id=1)
        registry.rename("abc", "Gym north")
        registry.assign("abc", domain.DisplayView.PROJECTOR)

        registry.identify("abc")

        display = registry.get("abc")
        assert display.name == "Gym north"
        assert display.assignment.view is domain.DisplayView.PROJECTOR


class TestAdvanceDisplayMutation:
    """The GraphQL layer over `DisplayRegistry.advance` (#347).

    Everything above drives the registry directly; `advance_display` in
    `api/schema.py` is what the operator's list actually calls when someone
    presses Next across the room, and until now nothing but `displays.spec.ts`
    ever ran it — so a mistake in the resolver itself (the wrong registry
    method, a swallowed `ValueError`, the wrong field on the returned type)
    had no test below the browser.

    `displays_service.registry` is the process-wide singleton the resolver
    reads, unlike the ``registry`` fixture above — so each test owns it for
    its duration, the same way ``TIMER_MANAGERS`` tests own that dict.
    """

    MUTATION = """
    mutation($displayId: String!, $delta: Int!) {
        advanceDisplay(displayId: $displayId, delta: $delta) {
            displayId
            slideSeq
            slideDelta
        }
    }
    """

    @pytest.fixture(autouse=True)
    def clean_registry(self):
        saved = dict(displays_service.registry._displays)
        displays_service.registry.clear()
        yield
        displays_service.registry.clear()
        displays_service.registry._displays.update(saved)

    def _advance(self, client, display_id, delta):
        resp = client.post(
            "/graphql",
            json={
                "query": self.MUTATION,
                "variables": {"displayId": display_id, "delta": delta},
            },
        )
        assert resp.status_code == 200
        return resp.json()

    def test_a_display_nobody_has_seen_returns_null(self, client):
        # The one the wall screen could vanish behind between listing and
        # clicking Next — the resolver must report nothing rather than invent
        # a display to advance.
        body = self._advance(client, "unknown", 1)

        assert "errors" not in body, body.get("errors")
        assert body["data"]["advanceDisplay"] is None

    def test_steps_a_known_display_and_returns_its_new_counter(self, client):
        displays_service.registry.connect("gql-display", race_id=7)

        body = self._advance(client, "gql-display", 1)

        assert "errors" not in body, body.get("errors")
        data = body["data"]["advanceDisplay"]
        assert data == {
            "displayId": "gql-display",
            "slideSeq": 1,
            "slideDelta": 1,
        }
        assert displays_service.registry.get("gql-display").slide_seq == 1

    def test_a_second_step_carries_the_same_direction_further(self, client):
        # Two Nexts in a row must both land — the counter is what tells a
        # display a command is new even when the delta repeats.
        displays_service.registry.connect("gql-display", race_id=7)
        self._advance(client, "gql-display", 1)

        body = self._advance(client, "gql-display", 1)

        assert body["data"]["advanceDisplay"]["slideSeq"] == 2

    def test_a_step_of_zero_is_refused(self, client):
        # A step of nowhere would still bump the counter, so every screen
        # would obey a command that means nothing.
        displays_service.registry.connect("gql-display", race_id=7)

        body = self._advance(client, "gql-display", 0)

        assert body.get("errors"), "a step of zero should be refused, not silent"
        assert displays_service.registry.get("gql-display").slide_seq == 0


class TestIdentifyDisplayMutation:
    """The GraphQL layer over `DisplayRegistry.identify` (#495).

    Mirrors `TestAdvanceDisplayMutation` — the resolver is little more than a
    call to the registry method plus a publish, but it is what the operator's
    list actually calls, and nothing below the browser ran it before this.
    """

    MUTATION = """
    mutation($displayId: String!) {
        identifyDisplay(displayId: $displayId) {
            displayId
            identifySeq
        }
    }
    """

    @pytest.fixture(autouse=True)
    def clean_registry(self):
        saved = dict(displays_service.registry._displays)
        displays_service.registry.clear()
        yield
        displays_service.registry.clear()
        displays_service.registry._displays.update(saved)

    def _identify(self, client, display_id):
        resp = client.post(
            "/graphql",
            json={"query": self.MUTATION, "variables": {"displayId": display_id}},
        )
        assert resp.status_code == 200
        return resp.json()

    def test_a_display_nobody_has_seen_returns_null(self, client):
        body = self._identify(client, "unknown")

        assert "errors" not in body, body.get("errors")
        assert body["data"]["identifyDisplay"] is None

    def test_identifying_a_known_display_bumps_and_returns_its_counter(self, client):
        displays_service.registry.connect("gql-display", race_id=7)

        body = self._identify(client, "gql-display")

        assert "errors" not in body, body.get("errors")
        assert body["data"]["identifyDisplay"] == {
            "displayId": "gql-display",
            "identifySeq": 1,
        }
        assert displays_service.registry.get("gql-display").identify_seq == 1

    def test_a_second_identify_rises_further(self, client):
        displays_service.registry.connect("gql-display", race_id=7)
        self._identify(client, "gql-display")

        body = self._identify(client, "gql-display")

        assert body["data"]["identifyDisplay"]["identifySeq"] == 2

    def test_viewer_cannot_identify_a_display(self, client, db):
        # Operator-only, same asymmetry as the rest of the display mutations:
        # a display holds no PIN and is a VIEWER, so it never asks — it is
        # told. See `api/auth.py::OPERATOR_ONLY_MUTATIONS`.
        from backend.api import auth
        from backend.db import schemas
        from backend.db.crud import create_organization

        group = create_organization(db, schemas.OrganizationCreate(name="Pack"))
        group.operator_pin_hash = auth.hash_pin("1111")
        db.commit()
        displays_service.registry.connect("gql-display", race_id=7)

        resp = client.post(
            "/graphql",
            json={"query": self.MUTATION, "variables": {"displayId": "gql-display"}},
        )
        body = resp.json()

        assert body.get("errors"), "a viewer must not be able to identify a display"
        assert "VIEWER is not allowed" in body["errors"][0]["message"]
        assert displays_service.registry.get("gql-display").identify_seq == 0


class TestSuggestDisplayNameQuery:
    """The GraphQL layer over `DisplayRegistry.suggest_name` (#521).

    A query rather than a mutation — it changes nothing, it only answers —
    so `RolePolicyExtension` does not reach it and the resolver has to guard
    itself the same way `auditLog` does.
    """

    QUERY = """
    query($displayId: String!, $avoid: String) {
        suggestDisplayName(displayId: $displayId, avoid: $avoid)
    }
    """

    @pytest.fixture(autouse=True)
    def clean_registry(self):
        saved = dict(displays_service.registry._displays)
        displays_service.registry.clear()
        yield
        displays_service.registry.clear()
        displays_service.registry._displays.update(saved)

    def _suggest(self, client, display_id, avoid=None):
        resp = client.post(
            "/graphql",
            json={
                "query": self.QUERY,
                "variables": {"displayId": display_id, "avoid": avoid},
            },
        )
        assert resp.status_code == 200
        return resp.json()

    def test_returns_a_name_for_a_known_display(self, client):
        displays_service.registry.connect("gql-display", race_id=7)

        body = self._suggest(client, "gql-display")

        assert "errors" not in body, body.get("errors")
        assert body["data"]["suggestDisplayName"]

    def test_never_repeats_a_name_already_on_another_row(self, client):
        displays_service.registry.connect("first", race_id=7, name="Bold Beaver")
        displays_service.registry.connect("second", race_id=7)

        body = self._suggest(client, "second")

        assert "errors" not in body, body.get("errors")
        assert body["data"]["suggestDisplayName"] != "Bold Beaver"

    def test_a_display_nobody_has_seen_still_gets_an_answer(self, client):
        body = self._suggest(client, "unknown")

        assert "errors" not in body, body.get("errors")
        assert body["data"]["suggestDisplayName"]

    def test_viewer_cannot_reroll_a_display_name(self, client, db):
        # Same asymmetry as `identifyDisplay` and the rest of the panel's
        # controls: unlike those, this is a query, so the role policy never
        # sees it and the resolver checks for itself.
        from backend.api import auth
        from backend.db import schemas
        from backend.db.crud import create_organization

        group = create_organization(db, schemas.OrganizationCreate(name="Pack"))
        group.operator_pin_hash = auth.hash_pin("1111")
        db.commit()
        displays_service.registry.connect("gql-display", race_id=7)

        body = self._suggest(client, "gql-display")

        assert body.get("errors"), "a viewer must not be able to reroll a display name"
        assert body["data"] is None
