import typing
from typing import Any

import strawberry
from pydantic import ValidationError
from strawberry.types import Info

from backend.api import auth
from backend.db import crud, models, schemas
from backend.domain import terminology as domain_terminology

from ..common import (
    _apply_name_display,
    _apply_pins,
    _apply_replay_retention,
    _apply_terminology,
    _apply_themes,
    _device_for,
    _manager_for,
    _name_display_status_kwargs,
    _publish_race_state_pkg,
    _replay_status_kwargs,
    _revalidate_timers,
    _start_backend_direct_pkg,
    _terminology_status_kwargs,
    _validation_sentence,
)
from ..enums import RaceChangeKind
from ..pubsub_helpers import _broadcast_display_theme_change
from ..types_config import InitialConfigInput, InitialConfigStatus


@strawberry.type
class InitialConfigMutations:
    @strawberry.mutation
    def create_initial_config(
        self, info: Info, config: InitialConfigInput
    ) -> InitialConfigStatus:
        """Initialize the system with organization name and tracks."""
        db = info.context["db"]
        if crud.get_tracks(db):
            raise ValueError("System already initialized")

        config_dict = strawberry.asdict(config)
        try:
            config_in = schemas.InitialConfigCreate.model_validate(config_dict)
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
        organization, tracks = crud.create_initial_config(db, config_in)
        _apply_pins(organization, config)
        _apply_terminology(organization, config)
        db.commit()
        db.refresh(organization)

        # Register a TimerManager for each newly created track so that
        # prepare_heat works immediately without requiring a server restart.
        timer_managers = info.context.get("timer_managers", {})
        for track in tracks:
            if track.id not in timer_managers:
                timer_managers[track.id] = _manager_for(track, info)

        # Link existing races if any
        if tracks:
            db.query(models.Race).filter(models.Race.track_id.is_(None)).update(
                {models.Race.track_id: tracks[0].id}
            )
            db.commit()

        from backend.version import __version__ as _version

        return InitialConfigStatus(
            initialized=True,
            version=_version,
            organization_name=organization.name,
            debug_mode=organization.debug_mode,
            tracks=typing.cast(Any, tracks),
            pin_required=bool(organization.operator_pin_hash),
            checkin_pin_set=bool(organization.checkin_pin_hash),
            # The caller who just set the PIN keeps the role they had for this
            # response; the next request resolves it from what they send.
            # `createInitialConfig` is operator-only, so the caller already
            # held that role to reach here.
            is_operator=True,
            role=auth.Role.OPERATOR,
            display_theme=organization.display_theme,
            printables_theme=organization.printables_theme,
            **_terminology_status_kwargs(organization),
            **_name_display_status_kwargs(organization),
            **_replay_status_kwargs(organization),
        )


@strawberry.type
class TimerResetMutations:
    @strawberry.mutation
    async def reset_timer(self, info: Info, track_id: int) -> bool:
        """Manually reset the timer to IDLE state."""
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr:
            await mgr.reset()
            return True
        return False


@strawberry.type
class ConfigMutations:
    @strawberry.mutation
    async def update_initial_config(
        self, info: Info, config: InitialConfigInput
    ) -> InitialConfigStatus:
        """Update system organization name and tracks.

        A shrinking `lane_count` here is the same problem `updateTrack`
        solves for (#325): existing heats can hold racers on lanes that no
        longer exist. This is the settings page's own **Save Settings**
        button — the way an operator ordinarily changes a lane count — so it
        gets the same reconciliation (`crud.apply_outages_to_scheduled_heats`,
        an awaited `_revalidate_timers`, a published race state) rather than
        writing the new count and stopping (#903).

        It also gets `crud.guard_against_stranding_a_round` (#877) — but
        checked once, over every track in the submission, *before* the
        organization name or any track is written. This form carries the
        organization name, both PINs and every track at once, so a refusal
        reached partway through (as `updateTrack`'s own ahead-of-write check
        would be if simply copied into this function's per-track loop) would
        still leave earlier tracks and the organization update committed.
        Checking every shrink first is what keeps a refusal here total
        rather than partial.

        Debugging Mode and the Display/Printables themes are **not** carried
        here (#1079, #1080) — `setDebugMode` and `setThemes` write those
        columns on their own, one mutation per field, so the demo can refuse
        this whole form (it also carries the PINs and reconfigures tracks —
        real ways to end the demo for everyone else) while still letting a
        visitor flip the one harmless checkbox and try the harmless colour
        pickers.

        A blank terminology word gets the same ahead-of-write treatment
        (#905): `crud.update_organization` commits the organization name on
        its own, independently of the terminology, PIN, name-display and
        track writes still to come, so a rename submitted alongside a
        whitespace-only word used to stick while everything else in the same
        submission — including every track — was silently discarded when
        `_apply_terminology` refused it afterwards. Every other field this
        mutation writes is validated by the settings page itself before it
        ever submits (`sections.ts`'s `firstProblem` for the organization
        name and each track's lane count; `SystemSettings.tsx` coerces a
        non-positive scale ratio before sending it; a lane colour can only
        come from a native `<input type="color">`); the terminology words
        are the one exception, since HTML's `required` accepts a single
        space and `firstProblem` never looks at them.

        A track's own Pydantic validators (`lane_count`, `scale_ratio`, a
        lane colour) get the same ahead-of-write treatment, for the
        identical reason and by the identical mechanism (#1023): every
        track's `TrackCreate`/`TrackBase` is built in one pass before the
        organization or any track is written, so a bad value on the third
        track cannot leave the first two, or the organization rename,
        already committed. The built objects are reused in the write loop
        below rather than parsed a second time.
        """
        db = info.context["db"]

        # #905: a blank terminology word used to be caught by `_apply_terminology`
        # *after* the organization name/`debugMode` write below had already
        # committed on its own (`crud.update_organization` commits
        # immediately) — so a rename submitted alongside a whitespace-only
        # word (HTML's `required` accepts a single space; `firstProblem`
        # never checks these words at all) left the rename applied and every
        # other field in the same submission, tracks included, silently
        # discarded. Checked here, before anything is written, for the same
        # reason the lane-shrink guard below is: a refusal must be total.
        if not config.clear_terminology:
            for field in domain_terminology.TERMINOLOGY_WORD_FIELDS:
                value = getattr(config, field, None)
                if value is not None:
                    domain_terminology.reject_blank_word(field, value)

        # #1023: every track's schema object is built — and so validated —
        # before anything is written, the same "refuse first, write once"
        # shape as the terminology check above and the stranding guard
        # below. Without this, a `ValidationError` on (say) the third
        # track's lane count used to surface only after the first two
        # tracks, and the organization rename, had already committed.
        track_schemas: list[schemas.TrackCreate | schemas.TrackBase] = []
        for input_track in config.tracks:
            payload = typing.cast(Any, strawberry.asdict(input_track))
            try:
                if input_track.id is None:
                    track_schemas.append(schemas.TrackCreate(**payload))
                else:
                    track_schemas.append(schemas.TrackBase(**payload))
            except ValidationError as exc:
                raise ValueError(_validation_sentence(exc)) from exc

        db_tracks_by_id = {t.id: t for t in crud.get_tracks(db)}
        for input_track in config.tracks:
            if input_track.id is None:
                continue
            db_track = db_tracks_by_id.get(input_track.id)
            if db_track is None:
                continue  # reported below, once matching is done for real
            if input_track.lane_count < db_track.lane_count:
                crud.guard_against_stranding_a_round(
                    db,
                    input_track.id,
                    lane_count=input_track.lane_count,
                    out_of_service=crud.lane_outages_for_track(db, input_track.id),
                )

        organization = db.query(models.Organization).first()
        if organization and organization.name != config.organization_name:
            existing = crud.get_organization_by_name(db, config.organization_name)
            if existing:
                raise ValueError(
                    f"Organization '{config.organization_name}' already exists"
                )
            crud.update_organization(db, organization, config.organization_name)
            db.refresh(organization)

        if organization:
            _apply_pins(organization, config)
            _apply_terminology(organization, config)
            _apply_name_display(organization, config)
            _apply_replay_retention(organization, config)
            db.commit()

        # Tracks are matched to database rows by id, not by list position
        # (#318): the form can reorder or remove a track from the middle of
        # the list, and matching by index would then update the wrong row —
        # renaming and reconfiguring it into whichever track happened to
        # follow, and deleting the track actually meant to survive.
        #
        # Reuses the snapshot the guard check above already took: no track
        # row has been written since (only the organization has), so it is
        # still current, and re-querying it would risk disagreeing about
        # which tracks exist.
        db_tracks = list(db_tracks_by_id.values())
        input_tracks = config.tracks
        timer_managers = info.context.get("timer_managers", {})

        matched_ids: set[int] = set()
        # Tracks whose lane_count just shrank, reconciled once every track
        # in the submission has been written (#903).
        shrunk_track_ids: set[int] = set()

        for index, input_track in enumerate(input_tracks):
            # Already built and validated above, before anything was
            # written — reused here rather than parsed a second time.
            track_schema = track_schemas[index]
            if input_track.id is None:
                # Add new track
                track_in = typing.cast(schemas.TrackCreate, track_schema)
                new_track = crud.create_track(db, track_in)

                # Register TimerManager
                mgr = _manager_for(new_track, info)
                timer_managers[new_track.id] = mgr
                if new_track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                    _start_backend_direct_pkg(mgr, new_track.serial_port)
                continue

            db_track = db_tracks_by_id.get(input_track.id)
            if db_track is None:
                raise ValueError(
                    f"Track {input_track.id} no longer exists; reload the page "
                    "and try again."
                )
            matched_ids.add(db_track.id)

            # Update existing track inline
            old_timer_type = db_track.timer_type
            old_serial_port = db_track.serial_port
            old_profile = db_track.timer_profile
            old_lane_count = db_track.lane_count
            track_update = typing.cast(schemas.TrackBase, track_schema)
            crud.update_track(db, db_track, track_update)

            if input_track.lane_count < old_lane_count:
                # Same reconciliation `updateTrack` makes for the same shrink
                # (#325); the guard above has already refused anything this
                # would strand, so it is safe to apply here.
                crud.apply_outages_to_scheduled_heats(db, db_track.id)
                shrunk_track_ids.add(db_track.id)

            mgr = timer_managers.get(db_track.id)
            if mgr:
                await mgr.set_remote_start_installed(input_track.remote_start_installed)
                mgr.set_lane_translation(
                    lane_count=input_track.lane_count,
                    reverse_lanes=input_track.reverse_lanes,
                )
                device = _device_for(db_track)
                if (
                    input_track.timer_type != old_timer_type
                    or input_track.timer_profile != old_profile
                ):
                    await mgr.set_device(device)
                if input_track.timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                    if (
                        input_track.serial_port != old_serial_port
                        or input_track.timer_type != old_timer_type
                        or input_track.timer_profile != old_profile
                    ):
                        _start_backend_direct_pkg(
                            mgr,
                            input_track.serial_port,
                            device if input_track.timer_profile else None,
                        )
                elif old_timer_type == models.TimerType.AUTO_DETECT_BACKEND:
                    await mgr.stop()

        # Delete tracks the operator removed from the list. The manager is
        # stopped only once `crud.delete_track` actually succeeds — stopping
        # it first left a track that survived a refused delete (it has races
        # against it) with no running TimerManager until the server
        # restarted, while the mutation reported success either way.
        delete_failures: list[str] = []
        for db_track in db_tracks:
            if db_track.id in matched_ids:
                continue
            try:
                crud.delete_track(db, db_track.id)
            except ValueError:
                delete_failures.append(db_track.name)
                continue
            mgr = timer_managers.pop(db_track.id, None)
            if mgr:
                await mgr.stop()

        if delete_failures:
            names = ", ".join(f'"{name}"' for name in delete_failures)
            raise ValueError(
                f"Could not remove {names}: still has races recorded against it."
            )

        if shrunk_track_ids:
            # Regenerating a round replaces its heats, so anything armed
            # against the old ids has to be told (#50) — the same await
            # `updateTrack` makes for the same reason. One call covers every
            # shrunk track in this submission: `_revalidate_timers` checks
            # every manager itself rather than being told which track.
            await _revalidate_timers(info)
            for shrunk_race in db.query(models.Race).filter(
                models.Race.track_id.in_(shrunk_track_ids)
            ):
                await _publish_race_state_pkg(shrunk_race.id)

        db.commit()
        tracks = crud.get_tracks(db)

        # Notify active races
        race = db.query(models.Race).first()
        if race:
            await _publish_race_state_pkg(race.id, kind=RaceChangeKind.RACE_SETTINGS)

        from backend.version import __version__ as _version

        return InitialConfigStatus(
            initialized=True,
            version=_version,
            organization_name=organization.name if organization else None,
            debug_mode=organization.debug_mode if organization else False,
            tracks=typing.cast(Any, tracks),
            pin_required=bool(organization and organization.operator_pin_hash),
            checkin_pin_set=bool(organization and organization.checkin_pin_hash),
            # `updateInitialConfig` is operator-only, so the caller already
            # held that role to reach here.
            is_operator=True,
            role=auth.Role.OPERATOR,
            display_theme=organization.display_theme if organization else "MATCH_APP",
            printables_theme=organization.printables_theme
            if organization
            else "MATCH_APP",
            **_terminology_status_kwargs(organization),
            **_name_display_status_kwargs(organization),
            **_replay_status_kwargs(organization),
        )

    @strawberry.mutation
    def set_debug_mode(self, info: Info, enabled: bool) -> InitialConfigStatus:
        """Turn Debugging Mode on or off (#1079).

        A dedicated mutation rather than a demo exemption carved out of
        `updateInitialConfig`'s refusal — that mutation also sets both PINs
        and reconfigures tracks, real ways to end the public demo for
        everyone else, and this flag is an ordinary boolean with no such
        hazard. Not on `demo_policy.REFUSED_MUTATIONS`, so a demo visitor can
        turn it on and see the timer's own state-machine transitions
        (`TimerStatus.transitions`) the same as any real install's operator.

        The organization already exists by the time Settings can render this
        checkbox — there is no create-time equivalent the way
        `createInitialConfig` briefly had one, since that mutation's own
        `InitialConfigInput` never carried this field either.
        """
        db = info.context["db"]
        organization = db.query(models.Organization).first()
        if organization is None:
            raise ValueError("System is not yet configured")
        organization.debug_mode = enabled
        db.commit()
        db.refresh(organization)

        from backend.version import __version__ as _version

        return InitialConfigStatus(
            initialized=True,
            version=_version,
            organization_name=organization.name,
            debug_mode=organization.debug_mode,
            is_operator=True,
            role=auth.Role.OPERATOR,
            display_theme=organization.display_theme,
            printables_theme=organization.printables_theme,
            **_terminology_status_kwargs(organization),
            **_name_display_status_kwargs(organization),
            **_replay_status_kwargs(organization),
        )

    @strawberry.mutation
    async def set_themes(
        self, info: Info, display_theme: str, printables_theme: str
    ) -> InitialConfigStatus:
        """Write the Display and Printables themes on their own (#1080).

        Same shape and the same reason as `setDebugMode` just above: these
        two columns used to travel inside `updateInitialConfig`'s bundle,
        which the demo refuses whole because the rest of that form can set
        the PINs and reconfigure tracks. A colour scheme cannot do either, so
        it gets its own door — not on `demo_policy.REFUSED_MUTATIONS` — and
        calls the same `_apply_themes`/`_broadcast_display_theme_change` pair
        `updateInitialConfig` already used for this field, so an already-open
        Observation page re-themes without a reload exactly as it did before
        (#586) whichever mutation changed the setting.

        There is no clear flag or absent-means-leave-alone here, unlike the
        old bundled field: both arguments are required, and `"MATCH_APP"` is
        itself the reachable "off" state a caller sends explicitly to reset.
        """
        db = info.context["db"]
        organization = db.query(models.Organization).first()
        if organization is None:
            raise ValueError("System is not yet configured")
        previous_display_theme = organization.display_theme
        _apply_themes(organization, display_theme, printables_theme)
        db.commit()
        db.refresh(organization)
        if organization.display_theme != previous_display_theme:
            await _broadcast_display_theme_change()

        from backend.version import __version__ as _version

        return InitialConfigStatus(
            initialized=True,
            version=_version,
            organization_name=organization.name,
            debug_mode=organization.debug_mode,
            is_operator=True,
            role=auth.Role.OPERATOR,
            display_theme=organization.display_theme,
            printables_theme=organization.printables_theme,
            **_terminology_status_kwargs(organization),
            **_name_display_status_kwargs(organization),
            **_replay_status_kwargs(organization),
        )
