import typing
from typing import Any

import strawberry
from pydantic import ValidationError
from strawberry.types import Info

from backend.db import crud, models, schemas

from ..common import _publish_race_state_pkg, _validation_sentence
from ..types_race import (
    Award,
    AwardInput,
    HistoricalTrackRecord,
    HistoricalTrackRecordInput,
    _historical_record,
    _historical_record_input,
)


@strawberry.type
class AwardMutations:
    @strawberry.mutation
    def create_track_record(
        self, info: Info, track_id: int, record: HistoricalTrackRecordInput
    ) -> HistoricalTrackRecord:
        """Enter a track record from before Trusty Track was keeping them.

        It joins the record board as typed: a 2019 record at 2.89 seconds
        stands until a computed 2.88 beats it. The validation is
        `schemas.HistoricalTrackRecordBase`'s — a time of zero or less and a
        blank name are refused where they arrive.
        """
        db = info.context["db"]
        row = crud.create_historical_track_record(
            db, track_id, _historical_record_input(record)
        )
        if row is None:
            raise ValueError("That track no longer exists.")
        return _historical_record(row)

    @strawberry.mutation
    def update_track_record(
        self, info: Info, record_id: int, record: HistoricalTrackRecordInput
    ) -> HistoricalTrackRecord:
        """Correct a hand-entered track record — a typo in a time or a name."""
        db = info.context["db"]
        row = crud.update_historical_track_record(
            db, record_id, _historical_record_input(record)
        )
        if row is None:
            raise ValueError("That record no longer exists.")
        return _historical_record(row)

    @strawberry.mutation
    def delete_track_record(self, info: Info, record_id: int) -> bool:
        """Remove a hand-entered track record.

        Only the hand-entered ones can be removed — a computed record is the
        heats it came from, and goes when they do.
        """
        return crud.delete_historical_track_record(info.context["db"], record_id)

    # Award Mutations (#170)
    @strawberry.mutation
    async def create_award(self, info: Info, race_id: int, award: AwardInput) -> Award:
        """Add an award to a race, at the end of the running order."""
        db = info.context["db"]
        try:
            award_in = schemas.AwardCreate(**typing.cast(Any, strawberry.asdict(award)))
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
        created = typing.cast(Any, crud.create_award(db, race_id, award_in))
        await _publish_race_state_pkg(race_id)
        return created

    @strawberry.mutation
    async def update_award(
        self, info: Info, id: int, award: AwardInput
    ) -> Award | None:
        """Edit an award, including reassigning a special award's recipient."""
        db = info.context["db"]
        try:
            award_update = schemas.AwardUpdate(
                **typing.cast(Any, strawberry.asdict(award))
            )
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
        updated = typing.cast(
            Any, crud.update_award(db, award_id=id, award_update=award_update)
        )
        if updated:
            await _publish_race_state_pkg(updated.race_id)
        return updated

    @strawberry.mutation
    async def delete_award(self, info: Info, id: int) -> bool:
        """Remove an award."""
        db = info.context["db"]
        award = db.query(models.Award).filter(models.Award.id == id).first()
        race_id = award.race_id if award else None
        deleted = crud.delete_award(db, award_id=id) is not None
        if race_id:
            await _publish_race_state_pkg(race_id)
        return deleted

    @strawberry.mutation
    async def reorder_awards(
        self, info: Info, race_id: int, award_ids: list[int]
    ) -> list[Award]:
        """Set the order awards are presented in, first to last."""
        db = info.context["db"]
        reordered = typing.cast(Any, crud.reorder_awards(db, race_id, award_ids))
        await _publish_race_state_pkg(race_id)
        return reordered

    @strawberry.mutation
    async def seed_championship_awards(self, info: Info, race_id: int) -> list[Award]:
        """The Awards page's empty-state **Add the N championship trophies**
        button (#1082) — the same seeding `createRoundWizard` and
        `createRound` already do the moment a final round is created, for a
        race whose wizard was skipped or whose seeded set was deleted.

        `crud.seed_championship_awards_for_race` finds the race's own final
        for itself and raises if there is none — the button is shown only
        once a championship round exists, so this is a defensive check
        against a stale client, not the ordinary path. Idempotent the same
        way the round-creation seeding is: a race that already carries a
        `SPEED` award gets an empty list back, never a second set.
        """
        db = info.context["db"]
        created = typing.cast(Any, crud.seed_championship_awards_for_race(db, race_id))
        if created:
            await _publish_race_state_pkg(race_id)
        return created

    @strawberry.mutation
    def cast_vote(
        self, info: Info, award_id: int, racer_id: int, ballot_key: str
    ) -> str | None:
        """Vote for a car on a `SPECIAL` award (#305).

        The one mutation a caller with no PIN — a phone in the room — may
        run (`api.auth.VOTE_MUTATIONS`); `crud.cast_vote` is what actually
        enforces `Race.voting_open` and `Award.votable`. Returns null on
        success, or a sentence saying why the vote was refused — the same
        shape as `releaseStartGate`, so the ballot screen has something to
        show rather than a raw GraphQL error.

        Not published to any subscription: the operator's tally screen reads
        it as an ordinary query and refetches, the same choice `auditLog`
        makes and for the same reason — a room full of phones voting is not
        an event the rest of the app needs to react to live.
        """
        db = info.context["db"]
        return crud.cast_vote(
            db, award_id=award_id, racer_id=racer_id, ballot_key=ballot_key
        )
