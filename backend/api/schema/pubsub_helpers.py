import typing
from datetime import datetime, timezone
from typing import Any

import strawberry
from sqlalchemy.orm import Session, object_session

from backend.db import models
from backend.domain import displays as domain_displays
from backend.services import displays as displays_service
from backend.services import replays as replays_service

from .common import RACES_LIST_CHANNEL, _get_pubsub
from .enums import RaceChangeKind
from .types_display import ApplySceneResult, SceneApplyOutcome
from .types_race import Heat, Intermission, Racer, _as_heat_lanes, _intermission_type


async def _publish_heat_replay(race_id: int) -> None:
    """Wake a race's `heatReplay` subscribers to re-read the current clip set."""
    await _get_pubsub().publish(f"heat_replay:{race_id}", None)


async def _purge_older_replays(db: Session, race_id: int, keep_heat_id: int) -> None:
    """Discard every other heat's clips for *race_id* (#177 stage 1a) —
    unless stored retention (#177 stage 2) is on, in which case nothing is
    deleted here at all.

    Called both when a heat's result is recorded (an *earlier* heat's clip is
    now stale — this heat's own clip has not been uploaded yet, so it is
    never what this call removes) and when the next heat is armed (the heat
    that just finished has had its turn). See
    `services.replays.discard_or_retain`.

    Publishes afterward, always — even when nothing was actually removed.
    A connected display's `heatReplay` subscription only re-reads the store
    on a wake-up (`_current_heat_replay`, a snapshot re-read, never the
    payload itself), so a purge that changed the store without publishing
    would leave an already-open screen holding a stale `HeatReplay` —
    including a `url` for a file that has just been deleted — until some
    unrelated clip upload for the same race happened to wake it.
    """
    replays_service.discard_or_retain(db, race_id, keep_heat_id)
    await _publish_heat_replay(race_id)


async def _publish_displays(race_id: int) -> None:
    """Tell the operator's list that something about a display changed."""
    await _get_pubsub().publish(f"displays:{race_id}", None)


async def _publish_race_display_theme_change(race_id: int) -> None:
    """Nudge every display currently pointed at this race to re-read its
    theme (#1081) — the race-scoped sibling of
    `_broadcast_display_theme_change` below, for `updateRace`'s own
    `displayTheme`/`printablesTheme` rather than `setThemes`'s
    install-wide pair.

    Only the displays `DisplayRegistry.for_race` says are pointed at this
    race can possibly be showing its override, unlike the organization-wide
    setting, which every display needs to hear about regardless of which
    race it happens to be on — so this reaches for `for_race` rather than
    `all_ids`. Same trick as `_broadcast_display_theme_change`: publishing
    `None` on a display's own `display_assignment:{id}` channel is enough,
    since that subscription re-reads this race's row on *every* event on
    its channel, whatever raised it.
    """
    for display in displays_service.registry.for_race(race_id):
        await _get_pubsub().publish(f"display_assignment:{display.display_id}", None)


async def _broadcast_display_theme_change() -> None:
    """Nudge every connected display to re-read the Display theme (#586).

    For `Organization.display_theme` — `setThemes`'s own field, which
    applies to every race at once — not for a race's own override
    (`Race.display_theme`, #1081), which is scoped to the displays already
    pointed at that one race and reaches them through
    `_publish_race_display_theme_change` above instead. This one is not
    `_publish_displays`'s job either — that channel is per-race and tells
    the *operator's* list something changed, not a screen showing it. An
    organization-wide change has to reach every screen currently open
    regardless of which race it happens to be pointed at, which is what
    `DisplayRegistry.all_ids` is for.

    Publishing `None` on each display's own `display_assignment:{id}` channel
    is enough: `display_assignment` re-reads this race's row on *every*
    event on that channel, whatever raised it, so this doubles as "you have
    mail" rather than needing to carry a payload of its own.
    """
    for display_id in displays_service.registry.all_ids():
        await _get_pubsub().publish(f"display_assignment:{display_id}", None)


async def _apply_assignments(
    assignments: list[tuple[str, str, domain_displays.Assignment]],
    *,
    expected_race_id: int | None = None,
) -> ApplySceneResult:
    """Bulk-assign a list of ``(display_id, display_name, Assignment)``
    against the live presence registry, publish each display's own channel
    plus one nudge to every affected race's operator list, and report which
    ones were actually reachable.

    The one place a scene (saved or a preset) actually touches
    `services/displays.py` and `api/pubsub.py` — `backend/db/crud.py` never
    does, the same boundary `assignDisplay` already draws between the stored
    record and the live broadcast.

    ``expected_race_id``, when given, refuses to touch a display that is
    currently connected under a *different* race (#756). `DisplayRegistry`
    keys a display purely by its own `display_id`, and `.connect` overwrites
    `race_id` whenever a known id reconnects — correct behaviour for a kiosk
    that legitimately moved from one race's `/observation` to another's,
    keeping its `localStorage` device id. Without this check, applying a
    scene saved for race A could reach across and reconfigure a screen that
    now belongs to race B, with race A's operator none the wiser (a success
    reported) and race B's screen hijacked with no explanation. Treated the
    same as "not connected at all" — the same best-effort shape, since from
    the scene's own point of view the display it named is equally
    unreachable either way.
    """
    outcomes: list[SceneApplyOutcome] = []
    changed_race_ids: set[int] = set()
    for display_id, display_name, assignment in assignments:
        current = displays_service.registry.get(display_id)
        if current is None or (
            expected_race_id is not None and current.race_id != expected_race_id
        ):
            # Named by a saved scene but not currently reachable for this
            # scene's own race — gone quiet, the server has restarted since,
            # or (#756) reconnected under this id to a different race. See
            # `SceneAssignment.display_name` for why there is still
            # something to report.
            outcomes.append(
                SceneApplyOutcome(
                    display_id=display_id, display_name=display_name, applied=False
                )
            )
            continue
        display = displays_service.registry.assign(
            display_id,
            assignment.view,
            assignment.cycle_seconds,
            assignment.scroll_behavior,
            assignment.show_checked_in,
            assignment.qr_target,
            assignment.show_standings_ticker,
        )
        assert display is not None  # just confirmed connected, above
        outcomes.append(
            SceneApplyOutcome(
                display_id=display_id, display_name=display.name, applied=True
            )
        )
        changed_race_ids.add(display.race_id)
        await _get_pubsub().publish(f"display_assignment:{display_id}", None)
    for race_id in changed_race_ids:
        await _publish_displays(race_id)
    return ApplySceneResult(scene_id=None, outcomes=outcomes)


async def _publish_races_list() -> None:
    """Tell every tab's navigation that the race list itself changed.

    Deliberately a signal on its own channel rather than a sentinel `race_id`
    on `race_state:{race_id}` (#300) — the navigation's race selector and the
    browser tab's title aren't scoped to one race the way everything else
    subscribed to `raceStateChanged` is, and overloading that channel would
    mean every existing subscriber filtering out an event meant for a screen
    that isn't there. The payload carries nothing: `racesChanged` is a nudge
    to re-run `GET_RACES_NAV`, not a copy of the list down the wire a second
    way that would have to be kept in step with the query.
    """
    await _get_pubsub().publish(RACES_LIST_CHANNEL, None)


class _HeatSnapshot:
    """A detached copy of a Heat, safe to resolve after the request ends.

    Events are published from a mutation whose session is closed before any
    subscriber renders the payload, and the subscription resolves fields in its
    own context. Handing out a live ORM object across that boundary risks a
    ``DetachedInstanceError`` on the first lazy load. Strawberry types here are
    duck-typed shells, so a plain object with the right attributes serves.
    """

    __slots__ = (
        "id",
        "race_id",
        "round_id",
        "heat_number",
        "round",
        "captured_lanes",
    )

    def __init__(self, heat: models.Heat) -> None:
        self.id = heat.id
        self.race_id = heat.race_id
        self.round_id = heat.round_id
        self.heat_number = heat.heat_number
        # `Heat.round_number` and `Heat.round_name` read through this.
        self.round = (
            _RoundSnapshot(heat.round.round_number, heat.round.name)
            if heat.round
            else None
        )
        # `Heat.lanes` reads through this. Resolved now, while a session still
        # exists — and it must be, not left to the subscriber: the normalized
        # client cache merges this payload into the heat it already holds, so a
        # payload that omitted `lanes` would leave the old lanes in place and
        # the screen would show a result against a stale schedule.
        session = object_session(heat)
        self.captured_lanes = (
            _as_heat_lanes(
                session.query(models.HeatLane)
                .filter(models.HeatLane.heat_id == heat.id)
                .order_by(models.HeatLane.lane)
                .all()
            )
            if session is not None
            else []
        )


class _RoundSnapshot:
    __slots__ = ("round_number", "name")

    def __init__(self, round_number: int, name: str | None) -> None:
        self.round_number = round_number
        self.name = name


class _RacerSnapshot:
    """A detached copy of a Racer. See :class:`_HeatSnapshot`."""

    __slots__ = (
        "id",
        "first_name",
        "last_name",
        "car_number",
        "car_name",
        "car_passed_inspection",
        "car_weight",
        "racer_image_url",
        "car_image_url",
        "racing_group_id",
        "race_id",
    )

    def __init__(self, racer: models.Racer) -> None:
        for field in self.__slots__:
            setattr(self, field, getattr(racer, field))


@strawberry.type
class RaceStateChangedEvent:
    """Event emitted whenever a race's state is modified by a mutation.

    ``kind`` says what changed and the matching payload field carries it, so a
    subscriber can apply the change instead of re-querying the whole race. The
    payloads are typed as the real ``Heat`` and ``Racer`` types on purpose: a
    normalized client cache keys on ``__typename`` plus ``id``, so an event can
    merge straight into the entity a query already put there.

    Older clients that only read ``raceId`` keep working — the extra fields are
    additive, and ``OTHER`` still means "something changed, refetch".
    """

    race_id: int
    changed_at: str  # ISO 8601 UTC timestamp
    kind: RaceChangeKind = RaceChangeKind.OTHER
    heat: Heat | None = None
    racer: Racer | None = None
    round_id: int | None = None
    #: The fully resolved current state, for ``INTERMISSION`` (#592) — the
    #: same shape ``Race.intermission`` reads, so a subscriber applies it
    #: directly rather than treating this as a signal to refetch.
    intermission: Intermission | None = None


@strawberry.type
class TimingStatsLane:
    """Represents a single lane's result for the Timing Stats observation view."""

    lane_number: int
    racer_name: str
    car_name: str | None
    time: float | None
    place: int | None
    racer_image_url: str | None
    #: The scale speed this lane's time converts to (#610), or null when the
    #: track has scale speed turned off, has no configured length, or this
    #: lane has no time to convert. See `domain.scale_speed.scale_mph`.
    scale_mph: float | None


@strawberry.type
class TrackRecordBreak:
    """The heat that just finished beat the track's standing record.

    "Standing" means the record as it stood before this race began — earlier
    races on the track plus any hand-entered historical records — so a first
    event with no history never fires this, and one event can fire it more
    than once only by genuinely going faster each time. Derived from state on
    every payload rather than remembered as an event (#248's shape): a
    corrected time changes the answer, and the room has already had its
    moment either way.
    """

    new_seconds: float
    new_holder: str
    previous_seconds: float
    previous_holder: str
    #: The event the old record was set at, if known — a race's name, or the
    #: label typed on a historical record.
    previous_race_name: str | None


@strawberry.type
class TimingStats:
    """Completed heat results for Timing Stats observation."""

    heat_id: int
    round_name: str
    heat_number: int
    global_heat_number: int
    lanes: list[TimingStatsLane]
    #: Set when this heat broke the track record; a free race heat never
    #: does, because exhibition runs cannot hold records (#6).
    record_break: TrackRecordBreak | None
    #: When this result was saved. `heat_id` alone is not enough to notice a
    #: re-recorded heat on the observation display (#335) — the id is the
    #: same heat both times, and only this changes.
    recorded_at: str | None


async def _publish_race_state(
    race_id: int,
    kind: RaceChangeKind = RaceChangeKind.OTHER,
    heat: models.Heat | None = None,
    racer: models.Racer | None = None,
    round_id: int | None = None,
    intermission_race: models.Race | None = None,
) -> None:
    """Publish a RaceStateChangedEvent for *race_id* on the pub/sub bus.

    Pass the ORM object that changed and it is snapshotted here, so callers do
    not have to think about the session lifetime. ``kind`` defaults to ``OTHER``,
    which means every unclassified call site keeps its current behaviour.

    Args:
        race_id: ID of the race whose state changed.
        kind: What sort of change this was.
        heat: The heat that changed, for ``HEAT_RESULT``.
        racer: The racer that changed, for ``RACER``.
        round_id: The round affected, where one is identifiable.
        intermission_race: The race row to resolve `Intermission` from, for
            ``INTERMISSION`` (#592) — resolved at the same instant as
            ``changed_at`` so the two never disagree.
    """
    await _get_pubsub().publish(
        f"race_state:{race_id}",
        RaceStateChangedEvent(
            race_id=race_id,
            changed_at=datetime.now(timezone.utc).isoformat(),
            kind=kind,
            heat=typing.cast(Any, _HeatSnapshot(heat)) if heat is not None else None,
            racer=typing.cast(Any, _RacerSnapshot(racer))
            if racer is not None
            else None,
            round_id=round_id,
            intermission=(
                _intermission_type(intermission_race, datetime.now(timezone.utc))
                if intermission_race is not None
                else None
            ),
        ),
    )
