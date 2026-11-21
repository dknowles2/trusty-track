import strawberry
from sqlalchemy.orm import Session, joinedload

from backend.db import models
from backend.domain import displays as domain_displays
from backend.domain import replays as domain_replays
from backend.domain import theme as domain_theme
from backend.services import displays as displays_service
from backend.services import replays as replays_service

from .enums import (
    DisplayRoleEnum,
    DisplayViewEnum,
    QRTargetEnum,
    ScenePresetEnum,
    ScrollBehaviorEnum,
)


@strawberry.type
class Display:
    """One audience display, and what it has been told to show (#174).

    Presence lives in memory rather than the database — see
    `services/displays.py` for why a screen that was on a wall last March is
    not a row worth keeping.
    """

    display_id: str
    name: str
    race_id: int
    view: DisplayViewEnum  # type: ignore[valid-type]
    cycle_seconds: int
    #: How `STANDINGS_ONLY` gets through a list too long for one screen
    #: (#663) — paging or a continuous scroll. Carried regardless of `view`,
    #: the same reasoning as `cycle_seconds`: a screen switched away from
    #: `STANDINGS_ONLY` and back keeps the choice it was given.
    scroll_behavior: ScrollBehaviorEnum  # type: ignore[valid-type]
    #: `CHECKIN`'s own rider (#612) — whether it lists every racer, checked
    #: in or not, or only the ones still pending. Carried regardless of
    #: `view`, the same reasoning as `scroll_behavior`.
    show_checked_in: bool
    #: `QRCODE`'s own rider (#614) — which page the code opens. Carried
    #: regardless of `view`, the same reasoning as `scroll_behavior` and
    #: `show_checked_in`.
    qr_target: QRTargetEnum  # type: ignore[valid-type]
    #: `OVERLAY`'s own rider (#616) — whether the broadcast overlay's
    #: compact top-5 ticker is shown alongside its lower-third bar. Carried
    #: regardless of `view`, the same reasoning as `scroll_behavior`,
    #: `show_checked_in` and `qr_target`.
    show_standings_ticker: bool
    #: Whether this display plays a heat's replay clip after its results
    #: overlay (#177 stage 1a). Carried regardless of `view`, the same
    #: reasoning as `show_standings_ticker`.
    replays: bool
    #: Whether this device is an ordinary screen or a `/camera` page (#177
    #: stage 1a). See `domain.displays.DisplayRole`.
    role: DisplayRoleEnum  # type: ignore[valid-type]
    #: Which track a `CAMERA` listens to for its clip boundaries — null until
    #: `setCameraTrack` picks one, and meaningless for an ordinary display.
    track_id: int | None
    #: ISO 8601 UTC, the last time a clip from this camera landed — null
    #: until the first one does, and meaningless for an ordinary display.
    #: What Race Control's camera badge reads to say "last clip 2s ago".
    last_clip_at: str | None
    #: This camera's own place among several, for the results-flow player
    #: and the Schedule/Race Control ▶ modal's camera picker (#177 stage 4)
    #: — lower plays first, ties broken by `displayId`. Meaningless for an
    #: ordinary display; `0` until `setCameraOrder` picks one.
    camera_order: int
    connected: bool
    #: Whether an operator has told this display anything. False means it is
    #: still following its own URL, which is what every display did before
    #: #174 — see `services/displays.py`.
    assigned: bool
    #: What it is showing, in words, so the operator's list does not have to
    #: reimplement the vocabulary to render a row.
    description: str
    #: Whether this view waits for a person. Only the ceremony does, and a
    #: screen assigned to it that nobody drives simply sits on one trophy.
    paced_by_a_person: bool
    #: The operator's last ceremony step for this screen, as a **step** and a
    #: counter saying it is a new one — never a slide number, which only the
    #: screen knows. See `services/displays.Display.slide_seq`.
    #:
    #: The ceremony page applies `slide_delta` when `slide_seq` changes, and
    #: ignores the value it arrives holding: an opening payload is a
    #: reconnection, not an instruction, and obeying it would jump the screen
    #: a trophy every time the wifi hiccuped.
    slide_seq: int
    slide_delta: int
    #: The operator's last "flash your name" command, as a counter rather
    #: than a boolean (#495) — the same shape as `slide_seq` and for the same
    #: reason. `identifyOverlay.ts` applies the same `seen === null` rule as
    #: the ceremony's steps: the value a screen arrives holding, on connect
    #: or reconnect, is history rather than an instruction.
    identify_seq: int
    #: The organization's stored Display theme setting (#498, #586) —
    #: `"MATCH_APP"` or a `ThemeKey`, unresolved: the frontend already owns
    #: `resolveDisplayTheme`, and shipping the resolved tokens here as well
    #: would be a second copy of that vocabulary free to disagree with it.
    #:
    #: Only `displayAssignment` resolves this for real, because that is the
    #: one subscription a live screen holds open for the whole event (#174's
    #: "leash") — carrying the theme on it is what lets a change reach an
    #: already-open screen with no new socket. Every other place this type is
    #: built (the operator's own `displays` list and panel mutations) leaves
    #: the default: the operator's screen is not itself styled by the Display
    #: theme, and none of those documents select this field, so the default
    #: never reaches a client to disagree with the subscription's real value.
    display_theme_setting: str = "MATCH_APP"


def _display(
    display: displays_service.Display, display_theme_setting: str = "MATCH_APP"
) -> Display:
    return Display(
        display_id=display.display_id,
        name=display.name,
        race_id=display.race_id,
        view=display.assignment.view,
        cycle_seconds=display.assignment.cycle_seconds,
        scroll_behavior=display.assignment.scroll_behavior,
        show_checked_in=display.assignment.show_checked_in,
        qr_target=display.assignment.qr_target,
        show_standings_ticker=display.assignment.show_standings_ticker,
        replays=display.assignment.replays,
        role=display.role,
        track_id=display.track_id,
        last_clip_at=display.last_clip_at,
        camera_order=display.camera_order,
        connected=display.connected,
        assigned=display.assigned,
        description=domain_displays.describe(display.assignment),
        paced_by_a_person=domain_displays.is_paced_by_a_person(display.assignment.view),
        slide_seq=display.slide_seq,
        slide_delta=display.slide_delta,
        identify_seq=display.identify_seq,
        display_theme_setting=display_theme_setting,
    )


@strawberry.type
class ReplayClip:
    """One camera's clip for one heat (#177 stage 1a).

    `url` is the credential-free `GET /replay/<name>` route — the name is a
    UUID, and that is the whole of the access control, the same shape
    `POST /upload/`'s photographs already use (#552's reasoning extended to
    video). `cameraId` is the uploading display's own `displayId`, so a
    display showing two cameras' clips for one heat can tell them apart or
    order them, though stage 1 builds no ordering rule of its own.
    """

    camera_id: str
    url: str
    duration_ms: int
    t0_offset_ms: int


@strawberry.type
class HeatReplay:
    """The current heat's clips, for whichever displays have `replays` on
    (#177 stage 1a).

    Keyed the same way `resultsOverlay.ts`'s `observeHeatResult` already
    keys a result: `heatId` plus the exact `recordedAt` the heat carried at
    the moment the clip was captured. A display compares this pair against
    the last one it acted on — never the `heatReplay` subscription's own
    opening payload, which is a reconnection and not an instruction, the
    same `seen === null` rule `identifyOverlay.ts` and the ceremony's steps
    already follow — so a screen reconnecting mid-event does not replay a
    heat from ten minutes ago.
    """

    heat_id: int
    recorded_at: str
    clips: list[ReplayClip]


def _replay_clip(clip: domain_replays.ReplayClip) -> ReplayClip:
    return ReplayClip(
        camera_id=clip.camera_id,
        url=f"/replay/{clip.path}",
        duration_ms=clip.duration_ms,
        t0_offset_ms=clip.t0_offset_ms,
    )


def _stored_replay_clip(row: "models.HeatReplay") -> ReplayClip:
    """A persisted `HeatReplay` row (#177 stage 2), in the same shape the
    live subscription's `_replay_clip` above already produces — one type on
    the wire either way, since `Heat.replays` and `heatReplay` answer the
    same question ("what can play for this heat") from two different
    stores.
    """
    return ReplayClip(
        camera_id=row.camera_id,
        url=f"/replay/{row.path}",
        duration_ms=row.duration_ms,
        t0_offset_ms=row.t0_offset_ms,
    )


def _order_replay_clips(clips: list[ReplayClip]) -> list[ReplayClip]:
    """Multiple cameras' clips for one heat, in the operator's own order
    (#177 stage 4) — replacing stage 1's `orderClipsByCameraId`, which had
    no operator-facing control and simply sorted by `cameraId`.

    `Display.camera_order` (default `0`) lives on the in-memory registry,
    not the database — the same place `role`/`track_id` already live, and
    for the identical reason: it is a fact about a connected device, not
    about the heat or the race. A camera the registry has since forgotten
    (a restart, or `forgetDisplay`) sorts as if its order were still `0`,
    which is exactly where an untouched camera already sorts — nothing
    breaks by falling back to the default rather than refusing to sort at
    all. Ties — including two untouched cameras, both at `0` — break on
    `cameraId`, so the order is always fully determined and stable.
    """

    def order_key(clip: ReplayClip) -> tuple[int, str]:
        display = displays_service.registry.get(clip.camera_id)
        order = display.camera_order if display is not None else 0
        return (order, clip.camera_id)

    return sorted(clips, key=order_key)


def _current_heat_replay(race_id: int) -> HeatReplay | None:
    """The `HeatReplay` a race's `heatReplay` subscription should show right
    now, if any camera has uploaded a clip that has not since been purged.
    """
    found = replays_service.store.latest_for_race(race_id)
    if found is None:
        return None
    key, clips = found
    if not clips:
        return None
    return HeatReplay(
        heat_id=key.heat_id,
        recorded_at=key.recorded_at,
        clips=_order_replay_clips([_replay_clip(clip) for clip in clips]),
    )


def _display_theme_setting(db: Session, race_id: int) -> str:
    """The Display theme this screen should actually show, resolved (#1081).

    A race's own override (`Race.display_theme`) layered over the
    organization's install-wide setting — see
    `domain.theme.resolve_theme_setting`. Read fresh rather than cached:
    `display_assignment` holds its `db` open for the whole connection
    (#174), and a subscription that re-reads the database has to see a
    value another request just committed, not one the session had cached
    from opening the socket.

    One query joining `Race` to its `Organization`, not two separate ones —
    adding the race layer costs this subscription nothing extra per event
    (`test_query_counts.py`), the same one round trip `_display_theme_setting`
    already made before this existed, reading `Race` instead of
    `Organization` directly.
    """
    race = (
        db.query(models.Race)
        .options(joinedload(models.Race.organization))
        .filter(models.Race.id == race_id)
        .first()
    )
    if race is None or race.organization is None:
        return "MATCH_APP"
    return domain_theme.resolve_theme_setting(
        organization_setting=race.organization.display_theme,
        race_override=race.display_theme,
    )


@strawberry.type
class SceneDisplayAssignment:
    """One display's entry within a `Scene` (#613) — a whole assignment, not
    just a view. See `backend/domain/scenes.py` for why a scene carries the
    riders too.

    Embedded rather than its own entity: it has no identity outside the
    scene that holds it, the same shape as `HeatLane` inside a `Heat`.
    """

    display_id: str
    #: The display's name when this entry was last written, kept so a scene
    #: can still say something about a display the presence registry has
    #: since forgotten (a restart, or a screen that has not reconnected).
    display_name: str
    view: DisplayViewEnum  # type: ignore[valid-type]
    cycle_seconds: int
    scroll_behavior: ScrollBehaviorEnum  # type: ignore[valid-type]
    show_checked_in: bool
    qr_target: QRTargetEnum  # type: ignore[valid-type]
    show_standings_ticker: bool


@strawberry.type
class Scene:
    """A named, saved recipe for what every audience display should show at
    once (#613). See `backend/db/models.py::Scene` for why this is stored
    while a `Display`'s own live assignment is not."""

    id: int
    race_id: int
    name: str
    assignments: list[SceneDisplayAssignment]


def _scene_display_assignment(row: models.SceneAssignment) -> SceneDisplayAssignment:
    return SceneDisplayAssignment(
        display_id=row.display_id,
        display_name=row.display_name,
        view=row.view,
        cycle_seconds=row.cycle_seconds,
        scroll_behavior=row.scroll_behavior,
        show_checked_in=row.show_checked_in,
        qr_target=row.qr_target,
        show_standings_ticker=row.show_standings_ticker,
    )


def _scene(scene: models.Scene) -> Scene:
    return Scene(
        id=scene.id,
        race_id=scene.race_id,
        name=scene.name,
        assignments=[_scene_display_assignment(row) for row in scene.assignments],
    )


def _assignment_from_scene_row(
    row: models.SceneAssignment,
) -> domain_displays.Assignment:
    return domain_displays.Assignment(
        view=row.view,
        cycle_seconds=row.cycle_seconds,
        scroll_behavior=row.scroll_behavior,
        show_checked_in=row.show_checked_in,
        qr_target=row.qr_target,
        show_standings_ticker=row.show_standings_ticker,
    )


@strawberry.type
class ScenePresetInfo:
    """One built-in scene recipe, for the quick bar (#613). Served rather
    than hardcoded on the frontend for the same "one copy of the vocabulary"
    reason `viewOptionsFor` reads `DisplayView` off the schema instead of a
    second list — a preset's label lives in exactly one place,
    `backend/domain/scenes.py`."""

    key: ScenePresetEnum  # type: ignore[valid-type]
    label: str


@strawberry.type
class SceneApplyOutcome:
    """Whether one display in an applied scene was actually reachable
    (#613). A saved scene can name a display that has gone quiet since —
    presence is in memory and a restart forgets it entirely — and applying
    the rest must not silently pretend that one was told too."""

    display_id: str
    display_name: str
    applied: bool


@strawberry.type
class ApplySceneResult:
    """What happened when a scene (saved or a built-in preset) was applied
    (#613) — one outcome per display it named, so the operator's screen can
    say "5 of 6 screens updated" rather than a bare success."""

    scene_id: int | None
    outcomes: list[SceneApplyOutcome]

    @strawberry.field
    def applied_count(self) -> int:
        return sum(1 for o in self.outcomes if o.applied)

    @strawberry.field
    def skipped_count(self) -> int:
        return sum(1 for o in self.outcomes if not o.applied)
