import typing
from typing import Any

import strawberry
from strawberry.types import Info

from backend import demo_mode
from backend.api import auth
from backend.api.demo_policy import REFUSED_MUTATIONS as DEMO_REFUSED_MUTATIONS
from backend.db import crud, models
from backend.domain import scenes as domain_scenes
from backend.domain.schedulers import SCHEDULERS
from backend.services import displays as displays_service
from backend.services import network
from backend.services.timer.devices import ALL_PROFILES

from .common import (
    _loaders,
    _name_display_status_kwargs,
    _replay_status_kwargs,
    _require_operator_role,
    _terminology_status_kwargs,
)
from .enums import AuditCategoryEnum
from .types_config import (
    AuditLogEntry,
    HeatSession,
    InitialConfigStatus,
    SchedulingAlgorithmOption,
    TimerModel,
    TimerStatus,
    _build_heat_session,
    _timer_status_from_manager,
)
from .types_display import (
    Display,
    HeatReplay,
    Scene,
    ScenePresetInfo,
    _current_heat_replay,
    _display,
    _scene,
)
from .types_race import (
    AdvancementStatus,
    FreeRaceHeat,
    FreeRaceLaneAssignment,
    HeatHighlight,
    HeatResultRow,
    LaneTimeStat,
    Organization,
    Race,
    Racer,
    RacerStat,
    RaceStats,
    RacingGroupStat,
    Round,
    TimesPerLane,
    Track,
    TrackRecord,
    _advancement_status,
    _free_race_heats,
)


@strawberry.type
class Query:
    """
    Root query type for fetching data.
    """

    @strawberry.field
    def displays(self, race_id: int) -> list[Display]:
        """Every audience display known for this race (#174).

        Includes ones that have gone quiet, deliberately: a screen that has
        dropped off the wifi is the one the operator most wants to see.
        """
        return [_display(d) for d in displays_service.registry.for_race(race_id)]

    @strawberry.field
    def scenes(self, info: Info, race_id: int) -> list[Scene]:
        """A race's saved display scenes (#613), oldest first."""
        db = info.context["db"]
        return [_scene(s) for s in crud.get_scenes(db, race_id)]

    @strawberry.field
    def scene_presets(self) -> list[ScenePresetInfo]:
        """The built-in scene recipes offered on the quick bar (#613) — code,
        not a race's own data, so this takes no `raceId`."""
        return [
            ScenePresetInfo(key=preset.key, label=preset.label)
            for preset in domain_scenes.PRESETS
        ]

    @strawberry.field
    def suggest_display_name(
        self, info: Info, display_id: str, avoid: str | None = None
    ) -> str:
        """A rerolled name suggestion for one display (#521).

        Operator-only, like the rest of the display panel's controls, and a
        query rather than a mutation because it changes nothing — the
        rerolled word only fills the rename form's draft input, the same way
        it did before this reached the server. Going through
        `DisplayRegistry.suggest_name` — which walks `whimsical_name` against
        the race's other display names — is the whole point: a suggestion
        drawn from a second, hand-copied word list on the frontend could not
        know what those names were and could hand back one already in use.
        """
        _require_operator_role(info)
        return displays_service.registry.suggest_name(display_id, avoid=avoid)

    @strawberry.field
    def audit_log(
        self,
        info: Info,
        race_id: int | None = None,
        limit: int = 200,
        before_id: int | None = None,
        categories: list[AuditCategoryEnum] | None = None,  # type: ignore[valid-type]
        noteworthy: bool = False,
    ) -> list[AuditLogEntry]:
        """The timeline, newest first (#219).

        Operator-only, and it says so itself: the role policy only guards
        mutations, and this query is exactly the sort a wall display must never
        be able to run.

        ``raceId`` narrows to one race. Entries that concern no particular race
        — setting up a track, restoring a backup — are then out of the way,
        which is what makes a race filter useful rather than merely a filter.

        ``categories`` and ``noteworthy`` (#1253) are applied in ``crud``
        *before* ``limit``/``beforeId``, not after: paging is cursor-based
        because the corpus is thousands of rows, and filtering only the page
        already fetched would silently miss everything not yet paged in —
        exactly wrong for "scanning a thousand rows for what went wrong".
        ``categories`` omitted or ``None`` means no filter, same as every
        category being selected; an empty list is likewise no filter, since a
        client that has deselected every chip means "show nothing" by
        collapsing the list to a page with no rows, not by asking the server
        for one, and the chip row itself never lets every chip go unselected.

        **A query and not a subscription**, which is a departure from every
        other live view here and is about layering rather than taste. Half the
        entries are written from ``crud`` — the timer records a heat through
        its own session, outside any request (#9) — and publishing from there
        would mean ``db`` importing the api layer's pub/sub to announce its own
        writes. The timeline refetches on ``raceStateChanged`` instead, which
        fires for everything a race-scoped log would want to show and which the
        client already subscribes to.
        """
        _require_operator_role(info)
        return typing.cast(
            Any,
            crud.get_audit_entries(
                info.context["db"],
                race_id=race_id,
                # Clamped on both ends: unclamped, a negative limit reaches
                # SQLite as `LIMIT -1`, which SQLite reads as "no limit at
                # all" rather than "zero rows" — the opposite of what a
                # negative number should ever mean here.
                limit=max(0, min(limit, 500)),
                before_id=before_id,
                # `strawberry.enum` decorates `audit.AuditCategory` in place
                # (see `HeatPhase`'s own comment above) rather than minting a
                # second type, so each `c` here already is one.
                categories=list(categories) if categories else None,
                noteworthy=noteworthy,
            ),
        )

    @strawberry.field
    def races(
        self, info: Info, skip: int = 0, limit: int = crud.NO_PRACTICAL_LIMIT
    ) -> list[Race]:
        """Get a list of races, newest first (#1129), with pagination.

        Ordering — `crud.get_races`'s `date_time` desc, `id` desc — is what
        actually fixes #1129: Home lists races with no `skip`/`limit` of its
        own, so before this a race past the hundredth ever created was
        simply never on the page. `limit`'s default matches
        `crud.NO_PRACTICAL_LIMIT` for the same reason — raised past anything
        a real install reaches, rather than giving Home paging furniture it
        does not have.

        Primes `registered_count`/`checked_in_count` and `status` for the
        whole page in a fixed number of grouped queries (#749, #847), rather
        than letting each row's field resolvers pay for their own.
        """
        races = crud.get_races(info.context["db"], skip=skip, limit=limit)
        race_ids = [race.id for race in races]
        _loaders(info).prime_racer_counts(race_ids)
        _loaders(info).prime_race_status(race_ids)
        return typing.cast(Any, races)

    @strawberry.field
    def practice_race(self, info: Info) -> Race | None:
        """The rehearsal already under way, if there is one (#588).

        Home reads this to decide whether its button should say "Resume
        practice race" instead of "Try a practice race", and whether it needs
        a second, smaller "Start new" action beside it — the same question
        `createPracticeRace` answers for itself before deciding whether to
        build anything. Answered once, here, rather than the frontend
        re-deriving the naming rule from the race list: two copies of a rule
        are two chances for them to disagree (#48).
        """
        return typing.cast(Any, crud.existing_practice_race(info.context["db"]))

    @strawberry.field
    def timer_models(self) -> list[TimerModel]:
        """Every timer model a track can be set to, in probe order.

        The fake timer is deliberately absent: it is chosen by setting
        ``timer_type`` to FAKE, not by naming a model, and offering it in both
        places would let a track ask for a fake timer over a real serial port.
        """
        return [
            TimerModel(
                key=profile.key,
                name=profile.name,
                provenance=profile.provenance,
                detectable=bool(profile.probe and profile.identification),
                baud_rate=profile.baud_rate,
                data_bits=profile.data_bits,
                stop_bits=profile.stop_bits,
                parity=profile.parity,
            )
            for profile in ALL_PROFILES
        ]

    @strawberry.field
    def scheduling_algorithms(
        self, racer_count: int, lane_count: int
    ) -> list[SchedulingAlgorithmOption]:
        """Every registered `GENERAL`-round scheduling algorithm, for the
        wizard's "How heats are built" choice (#1090, part D).

        In registry order — `SCHEDULERS` is `{"PPC": ..., "ROTATION": ...,
        "PERFECT_N": ...}`, a plain dict, so PPC (the default) is always
        first without this resolver having to say so again.
        `unavailableReason`/`heatCount` are both computed against the exact
        `(racerCount, laneCount)` shape asked for — the wizard already has
        both (the field it is about to schedule, and the track it is
        scheduling onto), and re-asks whenever either changes, since only
        Perfect-N's answer to either actually varies with the shape.
        """
        return [
            SchedulingAlgorithmOption(
                value=value,
                label=scheduler.label,
                guarantee=scheduler.guarantee,
                unavailable_reason=scheduler.available_for(racer_count, lane_count),
                absorbs_latecomer=scheduler.absorbs_latecomer,
                heat_count=scheduler.heat_count(racer_count, lane_count),
            )
            for value, scheduler in SCHEDULERS.items()
        ]

    @strawberry.field
    def version(self) -> str:
        """Get the current application version."""
        try:
            from backend.version import __version__

            return __version__
        except ImportError:
            return "unknown"

    @strawberry.field
    def network_addresses(self) -> list[str]:
        """Addresses this machine can be reached at from off itself (#414).

        For the voting page's share step: `window.location.origin` is
        `localhost` on the machine running Trusty Track, which a phone on the
        venue wifi cannot open. The frontend substitutes one of these in when
        that happens; an empty list means the backend could not find one, and
        the page has to say so rather than pretend `localhost` works.
        """
        return network.lan_addresses()

    @strawberry.field
    def mdns_hostname(self, info: Info) -> str | None:
        """The `.local` name this machine is actually advertising itself as
        over mDNS (#723, stages 1-3), or null.

        Null covers every reason `backend.services.discovery.start()`
        declined — demo mode, `TRUSTYTRACK_MDNS=off`, avahi already
        answering, no LAN address, or a saturated namespace — and, same as
        `networkAddresses`'s own `reachable` flag, this is never the name the
        app merely *asked* for: on a colliding LAN it is
        `"trustytrack-2.local"`, not `"trustytrack.local"`.

        Deliberately its own field rather than folded into
        `networkAddresses` — that is a list of IPv4 addresses whose only
        consumer takes `[0]`, and a hostname living in it would be a string
        that happens to parse differently, exactly the stringly-typed shape
        this project keeps removing.
        """
        return typing.cast(str | None, info.context.get("mdns_hostname"))

    @strawberry.field
    def race(self, info: Info, race_id: int) -> Race | None:
        """Get a single race by ID."""
        return typing.cast(Any, crud.get_race(info.context["db"], race_id=race_id))

    @strawberry.field
    def racers(
        self, info: Info, race_id: int | None = None, skip: int = 0, limit: int = 100
    ) -> list[Racer]:
        """Get a list of racers, optionally filtering by race_id."""
        return typing.cast(
            Any,
            crud.get_racers(
                info.context["db"], skip=skip, limit=limit, race_id=race_id
            ),
        )

    @strawberry.field
    def racer(self, info: Info, racer_id: int) -> Racer | None:
        """Get a single racer by ID."""
        return typing.cast(
            Any,
            (
                info.context["db"]
                .query(models.Racer)
                .filter(models.Racer.id == racer_id)
                .first()
            ),
        )

    @strawberry.field
    def tracks(self, info: Info) -> list[Track]:
        """Get all available tracks."""
        return typing.cast(Any, crud.get_tracks(info.context["db"]))

    @strawberry.field
    def organizations(self, info: Info) -> list[Organization]:
        """Get all registered organizations."""
        return typing.cast(Any, info.context["db"].query(models.Organization).all())

    @strawberry.field
    def initial_config(self, info: Info) -> InitialConfigStatus:
        """Get the system initialization status."""
        db = info.context["db"]
        tracks = crud.get_tracks(db)

        try:
            from backend.version import __version__ as _version
        except ImportError:
            _version = "unknown"

        if tracks:
            organization = db.query(models.Organization).first()
            race = db.query(models.Race).first()
            pin_required = bool(organization and organization.operator_pin_hash)
            # Resolved once here rather than left to the extension: this is a
            # *query*, so nothing has asked for a role yet, and the point is
            # to let the UI prompt before an action fails. `resolve_role`
            # remembers its answer on the context, so `role` below costs
            # nothing extra.
            role = auth.resolve_role(info.context)
            demo_on = demo_mode.enabled()
            return InitialConfigStatus(
                initialized=True,
                version=_version,
                demo_mode=demo_on,
                demo_refused_mutations=sorted(DEMO_REFUSED_MUTATIONS)
                if demo_on
                else [],
                organization_name=organization.name if organization else None,
                debug_mode=organization.debug_mode if organization else False,
                tracks=typing.cast(Any, tracks),
                current_race_id=race.id if race else None,
                pin_required=pin_required,
                checkin_pin_set=bool(organization and organization.checkin_pin_hash),
                is_operator=role is auth.Role.OPERATOR,
                role=role,
                display_theme=organization.display_theme
                if organization
                else "MATCH_APP",
                printables_theme=organization.printables_theme
                if organization
                else "MATCH_APP",
                **_terminology_status_kwargs(organization),
                **_name_display_status_kwargs(organization),
                **_replay_status_kwargs(organization),
            )
        # Reported on the unconfigured branch too. A demo seeds itself before
        # it serves, so this is only reachable if seeding failed — and a first
        # -run wizard is the one screen that must not be idled out from under
        # somebody halfway through it.
        demo_on = demo_mode.enabled()
        return InitialConfigStatus(
            initialized=False,
            version=_version,
            demo_mode=demo_on,
            demo_refused_mutations=sorted(DEMO_REFUSED_MUTATIONS) if demo_on else [],
            **_terminology_status_kwargs(None),
            **_name_display_status_kwargs(None),
            **_replay_status_kwargs(None),
        )

    @strawberry.field
    def rounds(self, info: Info, race_id: int) -> list[Round]:
        """Get all rounds for a specific race."""
        return typing.cast(Any, crud.get_rounds(info.context["db"], race_id=race_id))

    @strawberry.field
    def advancement_status(
        self, info: Info, race_id: int, round_id: int
    ) -> AdvancementStatus:
        """Check if a round is ready to advance."""
        return _advancement_status(info, race_id, round_id)

    @strawberry.field
    def free_race_heats(
        self, info: Info, race_id: int, limit: int = 10
    ) -> list[FreeRaceHeat]:
        """Get the most recent free race heats for a race."""
        return typing.cast(
            Any, crud.get_free_race_heats(info.context["db"], race_id, limit)
        )

    @strawberry.field
    def active_free_race_heat(self, info: Info, race_id: int) -> FreeRaceHeat | None:
        """The most recently started free race heat with no result yet.

        None if nothing is in progress. Used by the Observation page to show
        exhibition heats.

        "No result yet" used to be a null ``lane_results`` column. Since #6 a
        free heat holds its schedule there from the moment it is created, like
        an official one, so the question is whether any lane was timed — which
        cannot be asked in SQL of a JSON blob, hence the scan. Free heats are
        few and short-lived.
        """
        unrun = _free_race_heats(info.context["db"], race_id, recorded=False)
        return typing.cast(Any, unrun[0]) if unrun else None

    @strawberry.field
    def random_free_race_lanes(
        self,
        info: Info,
        race_id: int,
        shuffle: int = 0,
        enabled_lanes: list[int] | None = None,
    ) -> list[FreeRaceLaneAssignment]:
        """
        Return a random lane assignment over the race's usable lanes, using
        only checked-in racers. Frontend can display this as a preview
        before the operator commits to starting the heat.

        ``shuffle`` counts the re-shuffles the operator has asked for, and it
        exists because the draw may be seeded (`demo_seed`): the public demo
        sets ``TRUSTYTRACK_DEMO_SEED``, so without it every call keyed on the
        race alone returned the identical draw and the Re-shuffle button did
        nothing at all. Counting the draws keys each one separately, so a
        re-shuffle really re-shuffles while the *first* draw a screen shows
        stays the fixed one the screenshots and the demo want.

        ``enabled_lanes`` narrows the draw to a subset of the race's usable
        lanes (#303) — the Free Race screen's per-lane toggle is session-only
        and lives entirely on the client, so this is how a temporarily
        disabled lane keeps out of the preview without ever being written
        anywhere. Absent means every usable lane; a lane out of service is
        never offered even if named here, since usability is still decided
        by ``usable_lanes_for_race`` rather than trusted from the caller.
        """
        db = info.context["db"]
        usable = crud.usable_lanes_for_race(db, race_id)
        lane_numbers = (
            [lane for lane in enabled_lanes if lane in usable]
            if enabled_lanes is not None
            else usable
        )
        assignments = crud.get_random_lane_assignments(
            db, race_id, lane_numbers, shuffle=shuffle
        )
        return [
            FreeRaceLaneAssignment(lane=a["lane"], racer_id=a["racer_id"])
            for a in assignments
        ]

    @strawberry.field
    def timer_status(self, info: Info, track_id: int) -> TimerStatus | None:
        """Return the current timer state for a track."""
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        if mgr is None:
            return None
        return _timer_status_from_manager(mgr)

    @strawberry.field
    def heat_session(
        self, info: Info, track_id: int, heat_id: int | None = None
    ) -> HeatSession:
        """The live view of a track: the heat, merged with the timer (#7).

        ``heatId`` names the heat the caller is looking at. It is optional
        because the timer already knows which heat it was armed for, and the
        server answering on its own is the direction of #7 — but the operator
        screen selects the next heat before arming it, so during that window
        only the caller knows.
        """
        return _build_heat_session(
            info.context["db"],
            info.context.get("timer_managers", {}),
            track_id,
            heat_id,
        )

    @strawberry.field
    def heat_replay(self, race_id: int) -> HeatReplay | None:
        """A one-shot read of the same answer the `heatReplay` subscription
        gives, for a caller that wants to poll rather than hold a socket
        open (#1205's functional e2e specs, which need to know a clip has
        landed server-side without registering on the Vite dev proxy every
        upload already shares). Shells straight out to
        `_current_heat_replay` — one function, whether the caller is a
        subscription's wake-up or an ordinary query.
        """
        return _current_heat_replay(race_id)

    @strawberry.field
    def race_stats(self, info: Info, race_id: int) -> RaceStats | None:
        """Get racer stats, lane fairness, and highlights for a race."""
        from backend.services import stats as race_stats_module

        db = info.context["db"]
        data = race_stats_module.compute_race_stats(db, race_id)
        if data is None:
            return None

        # `compute_race_stats` returns a dict matching this type field-for-field
        # by design (see its docstring), so every nested list here is a
        # mechanical dict-to-dataclass conversion rather than a hand-copied
        # field list. `times_per_lane` is the one field that needs the same
        # treatment one level down.
        return RaceStats(
            race_id=data["race_id"],
            race_name=data["race_name"],
            scoring_strategy=data["scoring_strategy"],
            total_heats_scheduled=data["total_heats_scheduled"],
            total_heats_completed=data["total_heats_completed"],
            total_racers=data["total_racers"],
            lane_stats=[LaneTimeStat(**ls) for ls in data["lane_stats"]],
            racer_stats=[
                RacerStat(
                    **{
                        **rs,
                        "times_per_lane": [
                            TimesPerLane(**t) for t in rs["times_per_lane"]
                        ],
                    }
                )
                for rs in data["racer_stats"]
            ],
            highlights=[HeatHighlight(**hl) for hl in data["highlights"]],
            racing_group_stats=[
                RacingGroupStat(**ds) for ds in data["racing_group_stats"]
            ],
            heat_results=[HeatResultRow(**hr) for hr in data["heat_results"]],
            track_records=[TrackRecord(**tr) for tr in data["track_records"]],
            top_scale_mph=data["top_scale_mph"],
            has_recorded_times=_loaders(info).has_recorded_time_for_race(race_id),
        )
