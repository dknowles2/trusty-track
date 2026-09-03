"""Whether a race is on a break right now, and for how long (#592).

Race day includes real breaks — a snack table, a stuck sprinkler, the gap
between the qualifying heats and the championship — and until now Race
Control had no way to say so beyond a shrug and a paused schedule screen the
audience never sees. This module is the rule for what an intermission *is*:
three plain stored fields (`Race.intermission_ends_at`,
`Race.intermission_label`, `Race.intermission_paused_remaining_seconds`) and
a set of pure functions turning them, plus the current time, into what the
operator screen and the audience display both need.

Race-scoped and stored, not in-memory
--------------------------------------
Every other piece of "what a screen is doing right now" in this app
(`domain/displays.py`'s `Assignment`) lives in memory, because presence is a
browser tab that is open right now and nothing would ever clean up a row for
a screen unplugged mid-event. An intermission is different: it describes the
*race*, not a screen, and every screen watching that race has to agree on it
after a refresh — the operator's own laptop included, if it reloads
mid-break. So it is three columns on `Race`, not a registry, and it rides on
the same `race_state:{race_id}` channel every other race-level change
already publishes on (see `_publish_race_state` in `api/schema.py`) — no new
pub/sub channel for a fourth kind of change.

Paused is a separate representation, not a flag
-------------------------------------------------
A running intermission's remaining time is implicit — `ends_at` minus now —
which is what lets every client compute a live countdown with no server
round trip once it has the timestamp. A paused one has no `ends_at` to
compute from (nothing is counting down), so the *remaining* seconds are
stored directly instead. Exactly one of the two is ever set at a time.
Storing both a boolean flag and an `ends_at` that means something different
depending on the flag was considered and rejected: a stale `ends_at` sitting
there unread while paused is a value a future reader could misuse by
accident, where "the column that is not null is the one that is live" cannot
be gotten wrong the same way.

An expired intermission is simply inactive, not a fourth state
-----------------------------------------------------------------
Nothing clears `ends_at` when the clock runs out — the same "computed on
demand" rule the standings, awards and track records already follow (#17):
`resolve` is asked fresh every time, against the caller's own `now`, and once
`remaining_seconds` reaches zero it reports `active=False` on its own. There
is no background job sweeping expired intermissions, and none is needed.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta

__all__ = [
    "State",
    "Intermission",
    "NONE",
    "resolve",
    "start",
    "extend",
    "pause",
    "resume",
    "end",
]


@dataclass(frozen=True)
class State:
    """The three stored columns, as a value.

    Exactly one of ``ends_at``/``paused_remaining_seconds`` is set while an
    intermission is in progress; both are ``None`` when there is none.
    """

    ends_at: str | None = None
    paused_remaining_seconds: int | None = None
    label: str | None = None


@dataclass(frozen=True)
class Intermission:
    """What a screen renders: is a break on, how long is left, is it paused.

    ``ends_at`` is carried through unresolved (an ISO 8601 timestamp, or
    ``None``) so a client can compute its own live countdown from its own
    clock rather than polling the server every second — it is the one field
    a running countdown actually needs. ``remaining_seconds`` is a
    convenience snapshot at resolution time for a caller with no interest in
    re-deriving it (an operator control's read-once display, a paused
    label).
    """

    active: bool
    remaining_seconds: int
    paused: bool
    label: str | None
    ends_at: str | None


#: No intermission — every race starts here, and `end` returns here too.
NONE = State()


def resolve(state: State, now: datetime) -> Intermission:
    """The state, plus the current time, as what a screen should show."""
    if state.paused_remaining_seconds is not None:
        remaining = max(0, state.paused_remaining_seconds)
        return Intermission(
            active=True,
            remaining_seconds=remaining,
            paused=True,
            label=state.label,
            ends_at=None,
        )
    if state.ends_at is not None:
        remaining = max(0, _seconds_until(state.ends_at, now))
        return Intermission(
            active=remaining > 0,
            remaining_seconds=remaining,
            paused=False,
            label=state.label if remaining > 0 else None,
            ends_at=state.ends_at,
        )
    return Intermission(
        active=False, remaining_seconds=0, paused=False, label=None, ends_at=None
    )


def start(duration_seconds: int, label: str | None, now: datetime) -> State:
    """Begin (or restart) an intermission running for ``duration_seconds``.

    Deliberately has no precondition on the current state — restarting a
    break already in progress with a fresh duration or a new label (the
    operator changing their mind about how long, or a second "Take a break"
    click from the round-summary modal) is an ordinary use, not an error.
    """
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")
    return State(
        ends_at=(now + timedelta(seconds=duration_seconds)).isoformat(),
        paused_remaining_seconds=None,
        label=label,
    )


def extend(state: State, seconds: int, now: datetime) -> State:
    """Add ``seconds`` to whatever time is left, running or paused."""
    if seconds <= 0:
        raise ValueError("seconds must be positive")
    if not resolve(state, now).active:
        raise ValueError("no active intermission to extend")
    if state.paused_remaining_seconds is not None:
        return replace(
            state, paused_remaining_seconds=state.paused_remaining_seconds + seconds
        )
    remaining = max(0, _seconds_until(state.ends_at, now)) if state.ends_at else 0
    return replace(
        state, ends_at=(now + timedelta(seconds=remaining + seconds)).isoformat()
    )


def pause(state: State, now: datetime) -> State:
    """Freeze the countdown where it stands.

    Idempotent against an already-paused intermission — a doubled click pauses
    what is already paused rather than raising. Refused only when there is
    nothing running to freeze.
    """
    if state.paused_remaining_seconds is not None:
        return state
    if state.ends_at is None or not resolve(state, now).active:
        raise ValueError("no active intermission to pause")
    remaining = max(0, _seconds_until(state.ends_at, now))
    return State(ends_at=None, paused_remaining_seconds=remaining, label=state.label)


def resume(state: State, now: datetime) -> State:
    """Start the countdown again from wherever it was paused.

    Idempotent against an already-running intermission, for the same reason
    `pause` is. Refused only when there is nothing paused to resume.
    """
    if state.ends_at is not None and resolve(state, now).active:
        return state
    if state.paused_remaining_seconds is None:
        raise ValueError("no paused intermission to resume")
    return State(
        ends_at=(now + timedelta(seconds=state.paused_remaining_seconds)).isoformat(),
        paused_remaining_seconds=None,
        label=state.label,
    )


def end() -> State:
    """Clear the break. Idempotent — ending one that has already ended, or
    never started, is not an error; "End now" on a countdown that just hit
    zero on its own is an ordinary click, not a race to catch."""
    return NONE


def _seconds_until(ends_at: str, now: datetime) -> int:
    target = datetime.fromisoformat(ends_at)
    if target.tzinfo is None:
        # Every writer here uses `datetime.now(timezone.utc).isoformat()`,
        # which always carries an offset — this is defensive for a value
        # from anywhere else rather than an expected path.
        target = target.replace(tzinfo=now.tzinfo)
    return int((target - now).total_seconds())
