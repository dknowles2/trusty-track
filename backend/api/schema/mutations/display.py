import strawberry
from strawberry.types import Info

from backend.db import crud
from backend.domain import displays as domain_displays
from backend.domain import scenes as domain_scenes
from backend.services import displays as displays_service

from ..common import _get_pubsub
from ..enums import DisplayViewEnum, QRTargetEnum, ScenePresetEnum, ScrollBehaviorEnum
from ..pubsub_helpers import _apply_assignments, _publish_displays
from ..types_display import (
    ApplySceneResult,
    Display,
    Scene,
    _assignment_from_scene_row,
    _display,
    _scene,
)


@strawberry.type
class DisplayMutations:
    # Racer Mutations
    @strawberry.mutation
    async def assign_display(
        self,
        view: DisplayViewEnum,  # type: ignore[valid-type]
        display_id: str,
        cycle_seconds: int | None = None,
        scroll_behavior: ScrollBehaviorEnum | None = None,  # type: ignore[valid-type]
        show_checked_in: bool | None = None,
        qr_target: QRTargetEnum | None = None,  # type: ignore[valid-type]
        show_standings_ticker: bool | None = None,
        replays: bool | None = None,
    ) -> Display | None:
        """Tell an audience display what to show (#174).

        Operator-only, and the display is the thing being told: it never asks
        for this, it is handed the answer over the subscription it already
        holds. Returns null for a display nobody has seen, which is what the
        operator gets if a screen was forgotten between listing and clicking.

        ``replays`` (#177 stage 1a) is the same "omitted means keep the
        current one" rider shape as `show_standings_ticker` above.
        """
        if cycle_seconds is not None and cycle_seconds < 1:
            raise ValueError("cycle_seconds must be at least 1")
        display = displays_service.registry.assign(
            display_id,
            view,
            cycle_seconds,
            scroll_behavior,
            show_checked_in,
            qr_target,
            show_standings_ticker,
            replays,
        )
        if display is None:
            return None
        await _get_pubsub().publish(f"display_assignment:{display_id}", None)
        await _publish_displays(display.race_id)
        return _display(display)

    @strawberry.mutation
    async def set_camera_track(self, display_id: str, track_id: int) -> Display | None:
        """Tell a camera which track's timer it should listen to (#177 stage 1a).

        Operator-only, the same bucket as the other display mutations — a
        camera holds no PIN and makes no GraphQL call of its own, so this
        travels the operator's own Displays panel rather than the camera page
        choosing for itself. Returns null for a display nobody has seen, or
        one that is not a `CAMERA`: `track_id` means nothing on an ordinary
        screen.
        """
        display = displays_service.registry.set_camera_track(display_id, track_id)
        if display is None:
            return None
        await _get_pubsub().publish(f"display_assignment:{display_id}", None)
        await _publish_displays(display.race_id)
        return _display(display)

    @strawberry.mutation
    async def set_camera_order(self, display_id: str, order: int) -> Display | None:
        """Tell a camera where its clip plays among several (#177 stage 4).

        Operator-only, the same bucket as `setCameraTrack` and for the
        identical reason — a camera holds no PIN and makes no GraphQL call
        of its own, so this travels the Displays panel's own per-row ↑/↓
        rather than the camera page choosing for itself. Returns null for a
        display nobody has seen, or one that is not a `CAMERA`: an order
        means nothing on an ordinary screen. `heatReplay`/`Heat.replays`
        both read the new order the moment it is set — see
        `_order_replay_clips` — so there is nothing else to publish beyond
        the display's own row.
        """
        display = displays_service.registry.set_camera_order(display_id, order)
        if display is None:
            return None
        await _get_pubsub().publish(f"display_assignment:{display_id}", None)
        await _publish_displays(display.race_id)
        return _display(display)

    @strawberry.mutation
    async def advance_display(self, display_id: str, delta: int) -> Display | None:
        """Step a screen's awards ceremony from the operator's list.

        The ceremony is paced by a person, and until now that person had to be
        standing at the screen — which is the one place the operator is not,
        having just assigned it from across the room.

        A **step**, not a slide number: the display owns the index, because it
        is the only thing that knows which trophy is up, and it holds no PIN
        so it can report nothing back (#15). Stepping composes with the keys
        and the presenter remote at the screen, which go on working.
        """
        if delta == 0:
            # A step of nowhere still bumps the counter, so every screen would
            # obey a command that means nothing.
            raise ValueError("A ceremony step must move forwards or backwards.")
        display = displays_service.registry.advance(display_id, delta)
        if display is None:
            return None
        await _get_pubsub().publish(f"display_assignment:{display_id}", None)
        return _display(display)

    @strawberry.mutation
    async def identify_display(self, display_id: str) -> Display | None:
        """Flash a screen's own name across it, so the operator can tell which
        row on the list is which physical screen (#495).

        A memorable name is only half of it — somebody still has to learn
        which row is the projector at the back. Bumping the counter is the
        whole of it: the display is what shows the flash, the same split as
        `advanceDisplay`'s steps, and it is a **step**, not a state, for the
        same reason — see `services/displays.Display.identify_seq`.
        """
        display = displays_service.registry.identify(display_id)
        if display is None:
            return None
        await _get_pubsub().publish(f"display_assignment:{display_id}", None)
        return _display(display)

    @strawberry.mutation
    async def rename_display(self, display_id: str, name: str) -> Display | None:
        """Give a display a name the operator will recognise — "gym north"."""
        display = displays_service.registry.rename(display_id, name)
        if display is None:
            return None
        await _publish_displays(display.race_id)
        return _display(display)

    @strawberry.mutation
    async def forget_display(self, display_id: str) -> bool:
        """Drop a display from the list.

        The only way one leaves it. A screen that is switched off looks exactly
        like one whose wifi dropped, so nothing but a person can tell them
        apart — and guessing either way is worse than a row somebody clears.

        If the screen is actually still open, this must not strand it (#758):
        nudging its own `display_assignment:{id}` channel — the same one
        every other display mutation publishes to — wakes its still-running
        `displayAssignment` subscription, which notices the row is gone and
        re-registers itself as a fresh, unassigned display. That is exactly
        the state a screen is in on a genuine first connect, so the operator
        recovers a working, listed row rather than a screen frozen on its
        last view with nothing server-side able to reach it again.
        """
        display = displays_service.registry.get(display_id)
        race_id = display.race_id if display else None
        removed = displays_service.registry.forget(display_id)
        if removed and race_id is not None:
            await _get_pubsub().publish(f"display_assignment:{display_id}", None)
            await _publish_displays(race_id)
        return removed

    # Scene Mutations (#613)
    @strawberry.mutation
    async def create_scene(self, info: Info, race_id: int, name: str) -> Scene:
        """Save a new scene, snapshotting every display currently known for
        this race — connected or not, the same population `Query.displays`
        already lists — into a named, reusable layout.

        This is "capture what the screens are showing right now", the
        quickest way to build a scene: compose the room by hand once with
        the ordinary per-screen controls, then save the result under a name
        rather than repeating those clicks for the rest of the event. A
        scene with no displays yet (nothing connected) is still created —
        entries can be added afterwards with `updateSceneDisplay`.
        """
        db = info.context["db"]
        captured = [
            (d.display_id, d.name, d.assignment)
            for d in displays_service.registry.for_race(race_id)
        ]
        scene = crud.create_scene(db, race_id, name, captured)
        return _scene(scene)

    @strawberry.mutation
    async def rename_scene(self, info: Info, id: int, name: str) -> Scene | None:
        db = info.context["db"]
        scene = crud.rename_scene(db, id, name)
        return _scene(scene) if scene else None

    @strawberry.mutation
    async def delete_scene(self, info: Info, id: int) -> bool:
        """The only way a scene leaves the list. Deleting one never touches
        any display's *current* view — a scene is a saved recipe, not a
        live link to the screens it once described."""
        db = info.context["db"]
        return crud.delete_scene(db, id)

    @strawberry.mutation
    async def update_scene_display(
        self,
        info: Info,
        scene_id: int,
        display_id: str,
        display_name: str,
        view: DisplayViewEnum,  # type: ignore[valid-type]
        cycle_seconds: int | None = None,
        scroll_behavior: ScrollBehaviorEnum | None = None,  # type: ignore[valid-type]
        show_checked_in: bool | None = None,
        qr_target: QRTargetEnum | None = None,  # type: ignore[valid-type]
        show_standings_ticker: bool | None = None,
    ) -> Scene | None:
        """Add or edit one display's entry within a saved scene (#613,
        "customize scene mappings for custom venue setups").

        The same argument shape as `assignDisplay`, on purpose: an omitted
        rider keeps whatever this entry already had (or the ordinary
        default, for a display new to the scene), so the scene editor can
        reuse the exact same per-display controls the live Displays panel
        already offers rather than inventing a second set for the saved
        version.
        """
        if cycle_seconds is not None and cycle_seconds < 1:
            raise ValueError("cycle_seconds must be at least 1")
        db = info.context["db"]
        scene_row = crud.get_scene(db, scene_id)
        if scene_row is None:
            return None
        current = next(
            (a for a in scene_row.assignments if a.display_id == display_id), None
        )
        assignment = domain_displays.Assignment(
            view=view,
            cycle_seconds=(
                cycle_seconds
                if cycle_seconds is not None
                else (current.cycle_seconds if current else 10)
            ),
            scroll_behavior=(
                scroll_behavior
                if scroll_behavior is not None
                else (
                    current.scroll_behavior
                    if current
                    else domain_displays.DEFAULT_SCROLL_BEHAVIOR
                )
            ),
            show_checked_in=(
                show_checked_in
                if show_checked_in is not None
                else (current.show_checked_in if current else True)
            ),
            qr_target=(
                qr_target
                if qr_target is not None
                else (
                    current.qr_target if current else domain_displays.DEFAULT_QR_TARGET
                )
            ),
            show_standings_ticker=(
                show_standings_ticker
                if show_standings_ticker is not None
                else (current.show_standings_ticker if current else True)
            ),
        )
        scene = crud.upsert_scene_display(
            db, scene_id, display_id, display_name, assignment
        )
        return _scene(scene) if scene else None

    @strawberry.mutation
    async def remove_scene_display(
        self, info: Info, scene_id: int, display_id: str
    ) -> Scene | None:
        """Drop one display from a saved scene — it no longer changes when
        the scene is applied, without deleting the scene itself."""
        db = info.context["db"]
        scene = crud.remove_scene_display(db, scene_id, display_id)
        return _scene(scene) if scene else None

    @strawberry.mutation
    async def apply_scene(self, info: Info, scene_id: int) -> ApplySceneResult | None:
        """Apply every entry of a saved scene to the live displays it
        names, atomically from the operator's point of view — one click
        reconfigures every screen in the room at once.

        Not atomic in the database sense, deliberately: presence is
        best-effort by design (`services/displays.py`), and a scene naming
        a screen that has since gone quiet — or reconnected under its id to
        a *different* race (#756) — is the ordinary case, not a failure
        that should block the other five screens from updating. Every such
        entry is skipped and reported rather than applied — see
        `ApplySceneResult`.
        """
        db = info.context["db"]
        scene_row = crud.get_scene(db, scene_id)
        if scene_row is None:
            return None
        assignments = [
            (row.display_id, row.display_name, _assignment_from_scene_row(row))
            for row in scene_row.assignments
        ]
        result = await _apply_assignments(
            assignments, expected_race_id=scene_row.race_id
        )
        result.scene_id = scene_row.id
        return result

    @strawberry.mutation
    async def apply_scene_preset(
        self,
        race_id: int,
        preset: ScenePresetEnum,  # type: ignore[valid-type]
    ) -> ApplySceneResult:
        """Quick-apply one of the four built-in scene recipes (#613) against
        whichever displays this process currently knows for this race —
        connected or not, the same population `Query.displays` lists —
        nothing is saved, the same "code, not data" reasoning
        `backend/domain/scenes.py` gives every preset. The role order is the
        operator's own list order (connected first, then by name), so the
        first role goes to whichever screen sorts first there.
        """
        preset_def = domain_scenes.preset_by_key(preset)
        if preset_def is None:
            raise ValueError(f"Unknown scene preset: {preset}")
        ordered = displays_service.registry.for_race(race_id)
        recipe = domain_scenes.assignments_for_preset(
            preset_def, [d.display_id for d in ordered]
        )
        by_id = {d.display_id: d for d in ordered}
        assignments = [
            (display_id, by_id[display_id].name, assignment)
            for display_id, assignment in recipe
        ]
        # `ordered` is already scoped to this race by `for_race`, so this is
        # belt-and-braces rather than load-bearing here — but it costs
        # nothing to state the same rule `apply_scene` now enforces (#756)
        # rather than relying on the caller above never changing.
        return await _apply_assignments(assignments, expected_race_id=race_id)
