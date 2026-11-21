import typing
from typing import Any

import strawberry
from pydantic import ValidationError
from strawberry.types import Info

from backend import demo_mode
from backend.db import crud, models, schemas
from backend.services import replays as replays_service

from ..common import (
    _TERMINOLOGY_FIELDS,
    DEMO_POPULATE_MAX_COUNT,
    _publish_race_state_pkg,
    _revalidate_timers,
    _validation_sentence,
)
from ..enums import RaceChangeKind
from ..pubsub_helpers import (
    _publish_race_display_theme_change,
    _publish_races_list,
)
from ..types_race import PopulateTestDataInput, Race, RaceInput, RaceUpdateInput


@strawberry.type
class RaceMutations:
    @strawberry.mutation
    async def create_race(self, info: Info, race: RaceInput) -> Race:
        """Create a new race."""
        try:
            race_in = schemas.RaceCreate(**typing.cast(Any, strawberry.asdict(race)))
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
        new_race = typing.cast(Any, crud.create_race(info.context["db"], race_in))
        await _publish_race_state_pkg(new_race.id, kind=RaceChangeKind.RACE_SETTINGS)
        await _publish_races_list()
        return new_race

    @strawberry.mutation
    async def update_race(
        self, info: Info, id: int, race: RaceUpdateInput
    ) -> Race | None:
        """Update an existing race."""
        db = info.context["db"]
        data = strawberry.asdict(race)
        clear_weight_limit = data.pop("clear_weight_limit", False)
        clear_terminology = data.pop("clear_terminology", False)
        clear_name_display = data.pop("clear_name_display", False)
        clear_display_theme = data.pop("clear_display_theme", False)
        clear_printables_theme = data.pop("clear_printables_theme", False)
        filtered_data = {k: v for k, v in data.items() if v is not None}
        # Explicit removal beats an absent field, which means "leave alone"
        # here for every other column (#205, following #192).
        if clear_weight_limit:
            filtered_data["weight_limit_oz"] = None
        # Same trap, for the per-race terminology override (#496 stage 3):
        # absent already means "inherit whatever this race had", so getting
        # back to null needs its own explicit flag.
        if clear_terminology:
            for field in _TERMINOLOGY_FIELDS:
                filtered_data[field] = None
        # Same trap again, for the per-race name-display override (#552):
        # "FULL" here is a real override, not the inherit state, so getting
        # back to null needs its own explicit flag too.
        if clear_name_display:
            filtered_data["name_display"] = None
        # Same trap again, for the per-race Display/Printables theme
        # override (#1081): `"MATCH_APP"` here is a real override (Field
        # Uniform, pinned to this race), not the inherit state, so getting
        # back to null needs its own explicit flag too.
        if clear_display_theme:
            filtered_data["display_theme"] = None
        if clear_printables_theme:
            filtered_data["printables_theme"] = None
        try:
            race_update = schemas.RaceUpdate(**typing.cast(Any, filtered_data))
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
        # Captured before the write, for the theme-change check below.
        # `RaceForm` resends the whole race on every save — `clearDisplayTheme`/
        # `clearPrintablesTheme` arrive as an ordinary `True`/`False` on
        # every request, following the same "resend everything" shape
        # `is_lock_only_update`'s own docstring describes, not only when the
        # operator actually touched Appearance. Checking "is display_theme
        # in filtered_data" was wrong for exactly that reason: a race with
        # no override already sends `clearDisplayTheme: true` on *every*
        # save (`updateInput.display_theme == null` is true whether or not
        # anything changed), which put `display_theme` in `filtered_data`
        # — as `None`, the value it already was — and nudged every display
        # on the race for an unrelated field's edit. Comparing the race's
        # actual stored value before and after is the only check that
        # answers the real question, the same reasoning `setThemes` already
        # uses for its own install-wide broadcast.
        existing = db.query(models.Race).filter(models.Race.id == id).first()
        previous_display_theme = existing.display_theme if existing else None
        previous_printables_theme = existing.printables_theme if existing else None
        updated = typing.cast(
            Any, crud.update_race(db, race_id=id, race_update=race_update)
        )
        if updated is not None:
            # A rename is what the browser tab's title reads (#300) — the
            # rest of `race` (dates, location…) is not shown in the nav, but
            # there is no cheap way to tell a rename from any other field
            # changing, and a signal nobody needed is far cheaper than one
            # that is missing.
            await _publish_races_list()
            # The race-scoped channel (#319): this is the mutation that
            # actually changes name, scoring_strategy, auto_advance_heat,
            # championship_trophies and the weight limit — exactly what
            # RACE_SETTINGS exists to announce. Without it, an audience
            # display's `leaderboard` subscription keeps showing standings
            # computed under the old scoring strategy until the next heat
            # result happens to fire the channel.
            await _publish_race_state_pkg(updated.id, kind=RaceChangeKind.RACE_SETTINGS)
            theme_fields_changed = (
                updated.display_theme != previous_display_theme
                or updated.printables_theme != previous_printables_theme
            )
            if theme_fields_changed:
                # A race's own Display/Printables theme override changed
                # (#1081) — the race-scoped sibling of
                # `_broadcast_display_theme_change`: only the displays
                # already pointed at *this* race can be showing it, unlike
                # the organization-wide setting `setThemes` writes, which
                # every display needs to hear about regardless of race.
                await _publish_race_display_theme_change(updated.id)
        return updated

    @strawberry.mutation
    async def delete_race(self, info: Info, id: int) -> bool:
        """Delete a race."""
        db = info.context["db"]
        # A stored clip's file (#177 stage 2) has to go before the heats
        # naming it do — `ON DELETE CASCADE` removes the `HeatReplay` rows
        # at the same moment, leaving nothing in the table to ask
        # afterward, and SQLite cannot also delete a file for us.
        replays_service.discard_clips_for_race(db, id)
        deleted = crud.delete_race(db, race_id=id)
        if deleted:
            # Removes every heat of both kinds, which can take the one just
            # armed with it — a shared track can be running a second race
            # (#309).
            await _revalidate_timers(info)
            await _publish_races_list()
        return deleted

    @strawberry.mutation
    async def start_intermission(
        self,
        info: Info,
        race_id: int,
        duration_seconds: int,
        label: str | None = None,
        highlights: bool = False,
    ) -> Race:
        """Begin (or restart) a break.

        No precondition on the current state — a fresh click while one is
        already running restarts it with the new duration and label, which
        covers both an on-the-fly change of mind and the round-summary
        modal's "Take a break" row offering the same presets after a round
        finishes.

        ``highlights`` asks for the current round's stored replay clips
        (#177 stage 3) instead of the ordinary next-up preview. Refused —
        not silently downgraded — unless `Organization.keepReplays` is on
        and this race already has at least one stored clip
        (`crud.start_intermission`): `IntermissionControl.tsx` only offers
        the checkbox under those same two conditions, so a caller reaching
        this with `highlights: true` outside them is a client that has
        drifted from the server's own rule, and failing loudly is what
        catches that rather than quietly serving a break with nothing to
        play.
        """
        db = info.context["db"]
        race = crud.start_intermission(db, race_id, duration_seconds, label, highlights)
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def extend_intermission(self, info: Info, race_id: int, seconds: int) -> Race:
        """Add time to the break under way, running or paused."""
        db = info.context["db"]
        race = crud.extend_intermission(db, race_id, seconds)
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def pause_intermission(self, info: Info, race_id: int) -> Race:
        """Freeze the countdown where it stands."""
        db = info.context["db"]
        race = crud.pause_intermission(db, race_id)
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def resume_intermission(self, info: Info, race_id: int) -> Race:
        """Start the countdown again from wherever it was paused."""
        db = info.context["db"]
        race = crud.resume_intermission(db, race_id)
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)

    @strawberry.mutation
    async def end_intermission(self, info: Info, race_id: int) -> Race:
        """End the break now. Idempotent — ending one that has already
        expired on its own is an ordinary click, not a race to catch."""
        db = info.context["db"]
        race = crud.end_intermission(db, race_id)
        await _publish_race_state_pkg(
            race_id, kind=RaceChangeKind.INTERMISSION, intermission_race=race
        )
        return typing.cast(Race, race)


@strawberry.type
class RaceSetupMutations:
    @strawberry.mutation
    async def populate_race(
        self, info: Info, race_id: int, config: PopulateTestDataInput
    ) -> str:
        """Populate a race with test data.

        Allowed on the demo (#1092), unlike most bulk generators — filling a
        race with test racers is the single most natural thing a demo
        visitor tries, and refusing it left anyone who created their own
        race with no way to fill it. Two demo-only limits apply, both
        checked here rather than in `populate.generate_fake_racers` so an
        ordinary install's own behaviour (bounded only by
        `MAX_POPULATE_COUNT`) is untouched: `count` may not exceed
        `DEMO_POPULATE_MAX_COUNT`, and the photo flags are refused outright
        since a generated image is still a caller-triggered disk write on a
        host with no credential — the same reasoning `uploadImage` is
        refused for.
        """
        from backend.db import populate

        if demo_mode.enabled():
            if config.count > DEMO_POPULATE_MAX_COUNT:
                raise ValueError(
                    "The demo allows at most "
                    f"{DEMO_POPULATE_MAX_COUNT} racers per Populate Test "
                    "Data call."
                )
            if config.add_racer_photos or config.add_car_photos:
                raise ValueError("Photos can't be generated on the demo.")

        db = info.context["db"]
        populate.generate_fake_racers(
            db,
            race_id,
            count=config.count,
            add_racer_photos=config.add_racer_photos,
            add_car_photos=config.add_car_photos,
            assign_racing_groups=config.assign_racing_groups,
            check_in=config.check_in,
        )
        await _publish_race_state_pkg(race_id)
        return f"Populated race {race_id} with {config.count} racers"

    @strawberry.mutation
    async def create_practice_race(self, info: Info, start_new: bool = False) -> Race:
        """A whole event on a fake timer, ready to run (#201).

        Resumes the most recent rehearsal rather than building another one
        (#588): a double click, or simply visiting Home a second time, must
        not leave cruft in the races list. `startNew` is the deliberate
        override for an operator who really does want to start over — it
        gets a fresh race, counted up the usual way, rather than reopening
        one they are done with.

        One mutation rather than the five round trips a client would need —
        race, racing groups, roster, check-in, rounds — because a rehearsal that fails
        half way leaves the operator with a broken race to tidy up, which is
        the opposite of the confidence this exists to give.
        """
        db = info.context["db"]
        existing = None if start_new else crud.existing_practice_race(db)
        if existing is not None:
            return typing.cast(Any, existing)
        new_race = typing.cast(Any, crud.create_practice_race(db))
        # Inserts a race the same as createRace, and #300's signal is a rule
        # about every insert into `races`, not just the ones reached through
        # the ordinary form.
        await _publish_races_list()
        return new_race
