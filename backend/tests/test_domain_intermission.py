"""`domain/intermission.py` (#592) — pure, no database.

Complements `test_intermission.py`, which drives the same rule through
`crud` and the GraphQL mutations end to end.
"""

from datetime import datetime, timedelta, timezone

import pytest

from backend.domain import intermission

NOW = datetime(2026, 9, 2, 12, 0, 0, tzinfo=timezone.utc)


def test_no_intermission_resolves_inactive():
    resolved = intermission.resolve(intermission.NONE, NOW)
    assert resolved.active is False
    assert resolved.remaining_seconds == 0
    assert resolved.paused is False
    assert resolved.label is None
    assert resolved.ends_at is None


class TestStart:
    def test_starts_a_running_countdown(self):
        state = intermission.start(300, "Snack break", NOW)
        resolved = intermission.resolve(state, NOW)
        assert resolved.active is True
        assert resolved.remaining_seconds == 300
        assert resolved.paused is False
        assert resolved.label == "Snack break"
        assert resolved.ends_at == state.ends_at

    def test_a_label_is_optional(self):
        state = intermission.start(60, None, NOW)
        assert intermission.resolve(state, NOW).label is None

    def test_refuses_a_non_positive_duration(self):
        with pytest.raises(ValueError):
            intermission.start(0, None, NOW)
        with pytest.raises(ValueError):
            intermission.start(-5, None, NOW)

    def test_restarting_an_active_one_is_allowed(self):
        """No precondition — a fresh click from the round-summary modal, or
        the operator changing their mind about the duration, is ordinary."""
        state = intermission.start(60, "First", NOW)
        restarted = intermission.start(600, "Second", NOW)
        resolved = intermission.resolve(restarted, NOW)
        assert resolved.remaining_seconds == 600
        assert resolved.label == "Second"
        assert restarted != state


class TestResolveOverTime:
    def test_remaining_seconds_counts_down(self):
        state = intermission.start(300, None, NOW)
        later = NOW + timedelta(seconds=100)
        assert intermission.resolve(state, later).remaining_seconds == 200

    def test_expires_on_its_own_once_the_time_is_up(self):
        """No sweep clears the column — this is asked fresh every time,
        against the caller's own now, the same "computed on demand" rule the
        standings and awards already follow."""
        state = intermission.start(60, "Snack break", NOW)
        after = NOW + timedelta(seconds=61)
        resolved = intermission.resolve(state, after)
        assert resolved.active is False
        assert resolved.remaining_seconds == 0
        assert resolved.label is None

    def test_exactly_zero_remaining_is_inactive(self):
        state = intermission.start(60, None, NOW)
        at_deadline = NOW + timedelta(seconds=60)
        assert intermission.resolve(state, at_deadline).active is False


class TestExtend:
    def test_adds_seconds_to_a_running_countdown(self):
        state = intermission.start(60, None, NOW)
        extended = intermission.extend(state, 300, NOW)
        assert intermission.resolve(extended, NOW).remaining_seconds == 360

    def test_adds_seconds_to_a_paused_one(self):
        state = intermission.start(60, None, NOW)
        paused = intermission.pause(state, NOW)
        extended = intermission.extend(paused, 300, NOW)
        resolved = intermission.resolve(extended, NOW)
        assert resolved.paused is True
        assert resolved.remaining_seconds == 360

    def test_refuses_when_nothing_is_active(self):
        with pytest.raises(ValueError):
            intermission.extend(intermission.NONE, 60, NOW)

    def test_refuses_once_expired(self):
        state = intermission.start(60, None, NOW)
        after = NOW + timedelta(seconds=120)
        with pytest.raises(ValueError):
            intermission.extend(state, 60, after)

    def test_refuses_a_non_positive_amount(self):
        state = intermission.start(60, None, NOW)
        with pytest.raises(ValueError):
            intermission.extend(state, 0, NOW)


class TestPause:
    def test_freezes_the_remaining_time(self):
        state = intermission.start(300, "Break", NOW)
        later = NOW + timedelta(seconds=100)
        paused = intermission.pause(state, later)
        resolved = intermission.resolve(paused, later)
        assert resolved.paused is True
        assert resolved.remaining_seconds == 200
        assert resolved.ends_at is None
        assert resolved.label == "Break"

    def test_the_remaining_time_does_not_move_while_paused(self):
        state = intermission.start(300, None, NOW)
        paused = intermission.pause(state, NOW + timedelta(seconds=100))
        much_later = NOW + timedelta(hours=3)
        assert intermission.resolve(paused, much_later).remaining_seconds == 200

    def test_is_idempotent(self):
        state = intermission.start(300, None, NOW)
        paused = intermission.pause(state, NOW)
        paused_again = intermission.pause(paused, NOW + timedelta(seconds=5))
        assert paused_again == paused

    def test_refuses_when_nothing_is_running(self):
        with pytest.raises(ValueError):
            intermission.pause(intermission.NONE, NOW)

    def test_refuses_an_already_expired_countdown(self):
        state = intermission.start(60, None, NOW)
        after = NOW + timedelta(seconds=120)
        with pytest.raises(ValueError):
            intermission.pause(state, after)


class TestResume:
    def test_restarts_the_countdown_from_where_it_paused(self):
        state = intermission.start(300, "Break", NOW)
        paused = intermission.pause(state, NOW + timedelta(seconds=100))
        resumed_at = NOW + timedelta(minutes=10)
        resumed = intermission.resume(paused, resumed_at)
        resolved = intermission.resolve(resumed, resumed_at)
        assert resolved.paused is False
        assert resolved.remaining_seconds == 200
        assert resolved.label == "Break"

    def test_is_idempotent(self):
        state = intermission.start(300, None, NOW)
        resumed = intermission.resume(state, NOW)
        assert resumed == state

    def test_refuses_when_nothing_is_paused(self):
        with pytest.raises(ValueError):
            intermission.resume(intermission.NONE, NOW)


class TestEnd:
    def test_clears_a_running_intermission(self):
        intermission.start(300, "Break", NOW)
        assert intermission.end() == intermission.NONE
        assert intermission.resolve(intermission.end(), NOW).active is False

    def test_is_idempotent(self):
        assert intermission.end() == intermission.end() == intermission.NONE
