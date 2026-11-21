import typing
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any

import strawberry
from strawberry.types import Info

from backend.db import crud, models
from backend.domain import displays as domain_displays
from backend.domain import lanes
from backend.domain import name_display as domain_name_display
from backend.domain.scale_speed import scale_mph as domain_scale_mph
from backend.services import displays as displays_service
from backend.services import records as records_service
from backend.services import scoring

from .common import ON_DECK_DEPTH, RACES_LIST_CHANNEL, _get_pubsub, _loaders
from .enums import DisplayRoleEnum
from .pubsub_helpers import (
    RaceStateChangedEvent,
    TimingStats,
    TimingStatsLane,
    TrackRecordBreak,
    _publish_displays,
)
from .types_config import (
    HeatSession,
    TimerStateChangedEvent,
    _build_heat_session,
    _timer_status,
    _timer_status_from_manager,
)
from .types_display import (
    Display,
    HeatReplay,
    _current_heat_replay,
    _display,
    _display_theme_setting,
)
from .types_race import (
    FreeRaceHeat,
    Heat,
    LeaderboardEntry,
    Round,
    _free_race_heats,
    _stored_lanes,
    _unfinished,
)


@strawberry.type
class Subscription:
    """Root subscription type for real-time race state updates."""

    @strawberry.subscription
    async def timer_status(
        self, info: Info, track_id: int
    ) -> AsyncGenerator[TimerStateChangedEvent, None]:
        """Subscribe to timer state changes for a specific track.

        Emits a TimerStateChangedEvent on every timer state transition.
        Yields an initial event immediately with the current state.

        The snapshot is taken **inside** the subscription, not before it: a
        transition published in between would land on no queue and be lost, and
        the next one may be minutes away. See :func:`heat_session`.
        """
        timer_managers = info.context.get("timer_managers", {})
        mgr = timer_managers.get(track_id)
        async with _get_pubsub().subscribe(f"timer_state:{track_id}") as stream:
            if mgr is not None:
                yield TimerStateChangedEvent(
                    track_id=track_id,
                    status=_timer_status_from_manager(mgr),
                    changed_at=datetime.now(timezone.utc).isoformat(),
                )
            async for status_dc in stream:
                yield TimerStateChangedEvent(
                    track_id=track_id,
                    status=_timer_status(status_dc),
                    changed_at=datetime.now(timezone.utc).isoformat(),
                )

    @strawberry.subscription
    async def heat_session(
        self, info: Info, track_id: int, heat_id: int | None = None
    ) -> AsyncGenerator[HeatSession, None]:
        """Subscribe to the live view of a track (#7).

        Yields the current session immediately, then a fresh one on every event
        that could change it. Two sources have to be watched, which is what
        `pubsub.subscribe` takes several channels for:

        - the **timer**, for lane times arriving, arming, and aborts;
        - the **race**, for a result being saved or cleared — that is what turns
          RUNNING into RECORDED, and it does not come from the timer.

        The race is resolved once, from the heat this subscription is about.
        Changing heat means changing `heatId`, which is a variable, so the
        client opens a new subscription and the race is re-resolved with it.

        The snapshot is taken **inside** the subscription
        --------------------------------------------------
        `pubsub.subscribe` registers the queue on entry, so anything published
        before that reaches no queue. Building the snapshot first left a window
        — a database query wide — in which an arming published by the operator
        screen's own `prepareHeat` was dropped: the client had already rendered
        from the pre-arm fallback, and the correction never came. The screen sat
        at "Waiting for Timer…" with the start button disabled while the timer
        was in fact ARMED, until some later event happened to refresh it.

        Subscribing first can only duplicate a payload, which is harmless here
        because every emission is a full snapshot rather than a delta.
        """
        db = info.context["db"]
        timer_managers = info.context.get("timer_managers", {})

        # Which race to watch is a property of the heat, and it has to be known
        # before subscribing. Resolved without building the session, so that
        # the session the client receives is built after the queue exists.
        channels = [f"timer_state:{track_id}"]
        watched_heat_id = heat_id
        if watched_heat_id is None:
            manager = timer_managers.get(track_id)
            status = manager.status() if manager else None
            watched_heat_id = status.active_heat_id if status else None
        if watched_heat_id is not None:
            heat = (
                db.query(models.Heat).filter(models.Heat.id == watched_heat_id).first()
            )
            if heat is not None:
                channels.append(f"race_state:{heat.race_id}")

        async with _get_pubsub().subscribe(*channels) as stream:
            yield _build_heat_session(db, timer_managers, track_id, heat_id)
            async for _ in stream:
                # A subscription holds one context for the whole connection, so
                # without this it would answer from rows loaded when the socket
                # opened and replay a stale heat forever.
                db.expire_all()
                _loaders(info).clear()
                yield _build_heat_session(db, timer_managers, track_id, heat_id)

    @strawberry.subscription
    async def race_state_changed(
        self, race_id: int
    ) -> AsyncGenerator[RaceStateChangedEvent, None]:
        """Subscribe to state changes for a specific race.

        This is the second exception to `MAX_QUEUE_SIZE`'s snapshot premise
        (#896; the first is `display_assignment`, #881). Every other
        `race_state:{race_id}` subscriber (`heatSession`, `leaderboard`,
        `onDeck`, `currentlyRacing`, `timingStats`, `heats`,
        `freeRaceHeat`/`activeFreeRaceHeat`) treats a wake-up as "go re-read
        the database", so a bound queue dropping older wake-ups in favour of
        the newest is safe there. This resolver alone hands the raw
        `RaceStateChangedEvent` straight to the client, and `HEAT_RESULT`/
        `RACER` payloads are merged directly into the normalized cache
        (#12) rather than triggering a re-read — so an older one dropped in
        favour of a newer one is a genuine, irreplaceable update lost, not a
        superseded snapshot. `subscribe`'s `drop_oldest_when_full=False` is
        the same opt-out `displayAssignment` already uses, applied here for
        the same reason; see `api/pubsub.py`'s `MAX_QUEUE_SIZE` docstring.
        """
        async with _get_pubsub().subscribe(
            f"race_state:{race_id}", drop_oldest_when_full=False
        ) as stream:
            async for event in stream:
                yield event

    @strawberry.subscription
    async def races_changed(self) -> AsyncGenerator[bool, None]:
        """A nudge that the race list itself changed elsewhere (#300).

        Argument-free, unlike every other subscription here: the navigation's
        race selector and the browser tab's title aren't scoped to one race.
        The payload is a bare `True` rather than the new list, because the
        client already holds `GET_RACES_NAV` — re-executing it network-only
        is simpler than shipping the list down the socket a second way that
        would have to be kept in step with the query. No initial value: the
        query's own fetch on mount is the first answer.
        """
        async with _get_pubsub().subscribe(RACES_LIST_CHANNEL) as stream:
            async for _ in stream:
                yield True

    @strawberry.subscription
    async def leaderboard(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[list[LeaderboardEntry], None]:
        """Subscribe to the leaderboard for a specific race."""
        async with _get_pubsub().subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]
            db.commit()
            yield [LeaderboardEntry(**s) for s in scoring.get_leaderboard(db, race_id)]
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield [
                    LeaderboardEntry(**s) for s in scoring.get_leaderboard(db, race_id)
                ]

    @strawberry.subscription
    async def display_assignment(
        self,
        info: Info,
        display_id: str,
        race_id: int,
        name: str | None = None,
        role: DisplayRoleEnum = domain_displays.DisplayRole.DISPLAY,  # type: ignore[valid-type,assignment]
    ) -> AsyncGenerator[Display, None]:
        """What this display should be showing, pushed as it changes (#174).

        **Subscribing is how a display registers.** It holds no PIN and is a
        `VIEWER`, and a `VIEWER` may make no mutation at all (#15) — so
        presence cannot be announced by calling one. That constraint produces
        the right shape anyway: the display is the thing being told.

        The registration happens before the opening payload, and the payload is
        sent inside the `pubsub.subscribe` block, for the reason
        `test_subscription_snapshot_race.py` exists: this queue must be
        registered before anything it needs to hear can be published, or an
        assignment made in that window reaches no one and the screen sits on
        the wrong view for the rest of the event.

        **Also carries the Display surface's theme (#586, #1081).** This is
        the one subscription a live screen holds open for the whole event —
        the "leash" `Observation.tsx`'s own comment names — so it is also
        the seam that lets a theme change reach a screen that is already
        open, with no new socket and no polling. `setThemes` (install-wide)
        publishes to every connected display's own channel when either
        theme changes; `updateRace` (this race's own override) publishes
        only to the displays already pointed at this race
        (`_publish_race_display_theme_change`). On every event on this
        channel (a real assignment or either nudge) `_display_theme_setting`
        re-reads this race's row, joined to its organization, and resolves
        the two layers fresh — so a screen that was merely renamed picks up
        a theme changed a moment earlier for free, and vice versa.

        **Being forgotten while still connected does not strand this screen
        (#758).** `forget_display` nudges this same channel, and finding the
        row gone here means exactly that — not a theme-only nudge, since
        those never remove anything. Re-registering, live, is what an actual
        reconnect would do anyway; the alternative (stop yielding and leave
        the generator hanging with nothing left in the registry for any
        later mutation to publish to) is the bug. The screen lands back on
        an unassigned payload, the same "fall back to your own URL" state
        every display starts in, and the operator's list gets it back too.

        **This queue is not bounded (#881).** Every payload here is `None`,
        and on wake this loop re-reads `DisplayRegistry`'s *current* row
        rather than the payload — which reads as the same "it's a snapshot,
        drop the stale ones" shape every other subscription here relies on,
        but the row itself is not one: `Display.slide_delta` is overwritten
        by each `advanceDisplay` call rather than accumulated, and
        `AwardCeremony.tsx` applies it exactly once per distinct `slide_seq`
        it sees. Two operator "Next" clicks that land while this connection
        is backed up are two separate steps nothing else will ever resupply
        — dropping the older nudge in favour of the newer one silently
        erases one of them, not a stale-but-harmless duplicate. See
        `MAX_QUEUE_SIZE`'s own docstring in `api/pubsub.py`.

        **`role` registers a camera the same way (#177 stage 1a).** The
        `/camera` page opens this exact subscription with `role: CAMERA`
        rather than a second one — a camera is a device with a role, not a
        different kind of connection, so it appears in the operator's
        Displays list and answers Identify/rename/forget exactly like an
        ordinary screen. Defaulted to `DISPLAY` rather than made required so
        every existing display caller keeps working unchanged.
        """
        db = info.context["db"]
        async with _get_pubsub().subscribe(
            f"display_assignment:{display_id}", drop_oldest_when_full=False
        ) as stream:
            display = displays_service.registry.connect(
                display_id, race_id, name, role=role
            )
            await _publish_displays(race_id)
            try:
                yield _display(display, _display_theme_setting(db, display.race_id))
                async for _ in stream:
                    current = displays_service.registry.get(display_id)
                    if current is None:
                        current = displays_service.registry.connect(
                            display_id, race_id, name, role=role
                        )
                        await _publish_displays(race_id)
                    db.expire_all()
                    _loaders(info).clear()
                    yield _display(current, _display_theme_setting(db, current.race_id))
            finally:
                # The socket closing is the only signal that a screen has gone
                # away, so it has to be handled however the generator ends —
                # cancellation included, which is what a browser tab closing
                # produces.
                displays_service.registry.disconnect(display_id)
                await _publish_displays(race_id)

    @strawberry.subscription
    async def displays(self, race_id: int) -> AsyncGenerator[list[Display], None]:
        """The operator's list of displays, as screens come and go (#174)."""
        async with _get_pubsub().subscribe(f"displays:{race_id}") as stream:
            yield [_display(d) for d in displays_service.registry.for_race(race_id)]
            async for _ in stream:
                yield [_display(d) for d in displays_service.registry.for_race(race_id)]

    @strawberry.subscription
    async def heat_replay(
        self, race_id: int
    ) -> AsyncGenerator[HeatReplay | None, None]:
        """The current heat's replay clips, as cameras upload them (#177 stage 1a).

        **A snapshot, not a delta — the default bounded queue is the right
        one here.** Every wake re-reads `ReplayStore.latest_for_race`, the
        *current* clip set for whichever heat is the race's active one right
        now, rather than trusting the pubsub payload (always `None`) or
        accumulating anything client-side. Two cameras uploading close
        together publish two wake-ups; if the first is dropped for a full
        queue, the second still finds both clips already in the store — the
        newest read already supersedes the one that was dropped, which is
        exactly the premise `MAX_QUEUE_SIZE`'s docstring (`api/pubsub.py`)
        asks a new channel to meet. Contrast `display_assignment` above: a
        ceremony step's `slide_delta` is *overwritten* per call, so the only
        record two steps happened is two separate wake-ups: nothing here is
        overwritten in that sense, since a purge removes a whole key rather
        than mutating one in place, and a re-read after a purge correctly
        finds nothing to show.

        A display's own `replays` setting decides whether to *act* on this,
        not this subscription — every connected display for a race gets the
        same channel, the same shape `displays`/`onDeck`/`leaderboard`
        already use, since a per-display filter would be a second
        subscription per screen for a value the payload already carries
        nothing display-specific about.
        """
        async with _get_pubsub().subscribe(f"heat_replay:{race_id}") as stream:
            yield _current_heat_replay(race_id)
            async for _ in stream:
                yield _current_heat_replay(race_id)

    @strawberry.subscription
    async def on_deck(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[list[Heat], None]:
        """Subscribe to the heats after the current one, for a specific race.

        **Two of them, nearest first** (#209). One was not enough to stage
        with: the child it names is in the bleachers, not watching the screen,
        so by the time their heat is on it the announcer is already calling
        them. Two lets the announcer read names a heat early and have the cars
        at the track when they are wanted.

        A list rather than a second subscription: this is one question — what
        is coming — asked with a bit more depth, and a second socket would have
        to be kept in step with this one over the same channel. Empty is the
        ordinary answer at the end of a race.

        The heats, not their racers (#141). Handing back a racer list dropped
        the lane each one is in — `lanes.real_racer_ids` is dense, so a vacated
        lane or an undecided championship slot simply closed the gap — and the
        audience display, having nothing else to go on, numbered them by
        position. A car in lane 3 of a heat whose lane 2 is empty was announced
        as being in lane 2.

        Symmetric with :func:`currently_racing`, which returns the heat on the
        track. One shape for "what is on the track" and "what is next" is also
        one code path on the client.
        """
        async with _get_pubsub().subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_on_deck() -> list[Heat]:
                # One door for the running order (#549): under a master
                # running order the next heat is usually another round's,
                # and this display is the one staging depends on.
                sorted_heats = crud.heats_in_running_order(db, race_id)
                uncompleted = _unfinished(db, sorted_heats)
                # Index 0 is on the track; the two after it are what to stage.
                return typing.cast(Any, uncompleted[1 : 1 + ON_DECK_DEPTH])

            yield _get_on_deck()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_on_deck()

    @strawberry.subscription
    async def currently_racing(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[Heat | None, None]:
        """Subscribe to the current heat for a specific race."""
        async with _get_pubsub().subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_current():
                # Same door as `on_deck` (#549) — the two displays must
                # agree about where the race is up to.
                sorted_heats = crud.heats_in_running_order(db, race_id)
                uncompleted = _unfinished(db, sorted_heats)
                return uncompleted[0] if uncompleted else None

            yield _get_current()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_current()

    @strawberry.subscription
    async def timing_stats(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[TimingStats | None, None]:
        """Subscribe to the most recently completed heat's timing results."""
        async with _get_pubsub().subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_timing_stats():
                # Both kinds, ranked together. An exhibition run is the thing
                # that just happened when it is the thing that just happened; a
                # rule preferring official heats made free ones unreachable from
                # the first result onward (#59).
                #
                # Times, not `is_finished`: this view shows a heat's results, and
                # a skipped heat has none to show.
                race_heats = (
                    db.query(models.Heat).filter(models.Heat.race_id == race_id).all()
                )
                recorded = [
                    heat
                    for heat, heat_lanes in zip(
                        race_heats, crud.lanes_for_heats(db, race_heats), strict=True
                    )
                    if lanes.has_results(heat_lanes)
                ]
                if not recorded:
                    return None

                # `recorded_at` is when the result was saved, which is the only
                # thing an official heat and a free one can be compared on.
                # Rows recorded before the column existed hold null and fall back
                # to schedule order, behind anything stamped.
                def _most_recent(heat: models.Heat):
                    return (
                        heat.recorded_at or "",
                        heat.round.round_number if heat.round else 0,
                        heat.heat_number,
                    )

                target_heat = max(recorded, key=_most_recent)
                is_free = target_heat.kind is models.HeatKind.FREE
                # A run-off heat (#550) has no `round_id` either, the same
                # as a free heat — it belongs to no generated round, only to
                # the round its own `settles_round_id` names. Anything below
                # that dereferences `target_heat.round` has to treat the two
                # alike; only the record-break gate (further down) tells
                # them apart, since a run-off is a real run and a free heat
                # is not.
                has_no_round = target_heat.round_id is None

                heat_lanes = _stored_lanes(db, target_heat)
                racer_ids = lanes.real_racer_ids(heat_lanes)
                racers = (
                    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).all()
                )
                racer_map = {r.id: r for r in racers}

                # This subscription composes its own name strings rather
                # than handing back first/last for the client to format
                # (#552) — the results overlay and the record-break banner
                # are both audience surfaces, so `format_display_name` is
                # applied here, once, rather than at each of the two spots
                # below that build one.
                race_row = crud.get_race(db, race_id)
                organization_row = (
                    _loaders(info).organization_by_id(race_row.organization_id)
                    if race_row
                    else None
                )
                resolved_name_display = domain_name_display.resolve_name_display(
                    organization=organization_row.name_display
                    if organization_row
                    else None,
                    race=race_row.name_display if race_row else None,
                )

                # Loaded once, through the same per-operation cache the
                # record-break baseline's `race_row.track_id` lookup could
                # have used — a lane count's worth of tracks is one query,
                # not one per lane (#610, `test_query_counts.py`).
                track_row = (
                    _loaders(info).track_by_id(race_row.track_id)
                    if race_row and race_row.track_id
                    else None
                )

                def _scale_mph(seconds: float | None) -> float | None:
                    if track_row is None or not track_row.show_scale_speed:
                        return None
                    return domain_scale_mph(
                        track_row.length_feet, seconds, track_row.scale_ratio
                    )

                lane_stats = []
                for lane in heat_lanes:
                    racer = racer_map.get(lane.racer_id)
                    lane_stats.append(
                        TimingStatsLane(
                            lane_number=lane.lane,
                            racer_name=domain_name_display.format_display_name(
                                resolved_name_display,
                                racer.first_name,
                                racer.last_name,
                            )
                            if racer
                            else "Unknown",
                            car_name=racer.car_name if racer else None,
                            time=lane.seconds,
                            place=lane.place,
                            scale_mph=_scale_mph(lane.seconds),
                            racer_image_url=racer.racer_image_url if racer else None,
                        )
                    )

                if has_no_round:
                    global_num = 0
                else:
                    this_round = target_heat.round
                    before_count = (
                        models.official_heats(db.query(models.Heat))
                        .join(models.Round, models.Heat.round_id == models.Round.id)
                        .filter(models.Heat.race_id == race_id)
                        .filter(
                            (models.Round.round_number < this_round.round_number)
                            | (
                                (models.Round.round_number == this_round.round_number)
                                & (models.Heat.heat_number < target_heat.heat_number)
                            )
                        )
                        .count()
                    )
                    global_num = before_count + 1

                # Did this heat beat the record as it stood before this race?
                # Never for an exhibition run — a free heat cannot hold a
                # record, so it cannot break one either — and never for a
                # run-off (#550): its result is scoped to the cut it
                # settles, which is what keeps it out of a track record's
                # population in the first place (see `services.records`).
                record_break = None
                if (
                    target_heat.kind
                    not in (models.HeatKind.FREE, models.HeatKind.RUN_OFF)
                    and race_row
                    and race_row.track_id
                ):
                    baseline = records_service.track_records(
                        db, race_row.track_id, limit=1, exclude_race_id=race_id
                    )
                    winning = records_service.broken_record(
                        [lane.seconds for lane in heat_lanes if lane.seconds],
                        baseline[0] if baseline else None,
                    )
                    if winning is not None:
                        fastest = min(
                            (
                                lane
                                for lane in heat_lanes
                                if lane.seconds and lane.seconds > 0
                            ),
                            key=lambda lane: lane.seconds,
                        )
                        breaker = racer_map.get(fastest.racer_id)
                        previous = baseline[0]
                        record_break = TrackRecordBreak(
                            new_seconds=winning,
                            new_holder=domain_name_display.format_display_name(
                                resolved_name_display,
                                breaker.first_name,
                                breaker.last_name,
                            )
                            if breaker
                            else "Unknown",
                            previous_seconds=previous.time_seconds,
                            previous_holder=previous.racer_name,
                            previous_race_name=previous.race_name,
                        )

                if is_free:
                    round_name = "Exhibition"
                elif target_heat.kind is models.HeatKind.RUN_OFF:
                    round_name = "Run-off"
                else:
                    round_name = target_heat.round.name

                return TimingStats(
                    heat_id=target_heat.id,
                    round_name=round_name,
                    heat_number=0 if has_no_round else target_heat.heat_number,
                    global_heat_number=global_num,
                    lanes=lane_stats,
                    record_break=record_break,
                    recorded_at=target_heat.recorded_at,
                )

            yield _get_timing_stats()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_timing_stats()

    @strawberry.subscription
    async def heats(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[list[Round], None]:
        """Subscribe to all rounds and heats for a specific race."""
        async with _get_pubsub().subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_rounds():
                return (
                    db.query(models.Round)
                    .filter(models.Round.race_id == race_id)
                    .order_by(models.Round.round_number)
                    .all()
                )

            yield _get_rounds()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_rounds()

    @strawberry.subscription
    async def free_race_heat(
        self, info: Info, heat_id: int
    ) -> AsyncGenerator[FreeRaceHeat | None, None]:
        """Subscribe to updates for a specific free race heat.

        The snapshot is taken inside the subscription for the reason
        :func:`heat_session` gives: a change published before the queue exists
        reaches nobody.
        """
        db = info.context["db"]

        def _get_heat():
            return crud.get_free_race_heat(db, heat_id)

        # Which race to watch is a property of the heat. A heat that is not
        # there has no channel, so say so once and stop.
        heat = _get_heat()
        if not heat:
            yield None
            return

        async with _get_pubsub().subscribe(f"race_state:{heat.race_id}") as stream:
            yield _get_heat()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_heat()

    @strawberry.subscription
    async def active_free_race_heat(
        self, info: Info, race_id: int
    ) -> AsyncGenerator[FreeRaceHeat | None, None]:
        """Subscribe to the active (uncompleted) free race heat for a specific race."""
        async with _get_pubsub().subscribe(f"race_state:{race_id}") as stream:
            db = info.context["db"]

            def _get_active_free():
                unrun = _free_race_heats(db, race_id, recorded=False)
                return unrun[0] if unrun else None

            yield _get_active_free()
            async for _ in stream:
                db.expire_all()
                _loaders(info).clear()
                db.commit()
                yield _get_active_free()
