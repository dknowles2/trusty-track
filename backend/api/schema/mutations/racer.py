import base64
import binascii
import typing
from typing import Any

import strawberry
from pydantic import ValidationError
from strawberry.types import Info

from backend.db import crud, models, schemas
from backend.db.database import UPLOAD_DIR
from backend.services.image_processing import store_uploaded_image

from ..common import (
    _RACER_CLEAR_FLAGS,
    _admit_late_racers,
    _get_max_upload_bytes,
    _photo_field_updates,
    _publish_race_state_pkg,
    _race_id_for_racers,
    _revalidate_timers,
    _validation_sentence,
)
from ..enums import RaceChangeKind
from ..types_race import (
    PhotoAssignmentInput,
    Racer,
    RacerInput,
    RacingGroup,
    RacingGroupInput,
)


@strawberry.type
class RacerMutations:
    @strawberry.mutation
    async def create_racer(self, info: Info, racer: RacerInput) -> Racer:
        """Create a new racer."""
        db = info.context["db"]
        data = strawberry.asdict(racer)
        # The six `clear*` flags (#747) exist for `updateRacer` alone — a
        # racer being created has nothing set yet to clear, the same reason
        # `RaceInput` (create) carries none of `RaceUpdateInput`'s clear
        # flags either. `RacerCreate` has no fields for them, so they would
        # be silently ignored either way; popped here so that is not left
        # to Pydantic's default "ignore extra kwargs" behaviour.
        for flag in _RACER_CLEAR_FLAGS:
            data.pop(flag, None)
        try:
            racer_in = schemas.RacerCreate(**typing.cast(Any, data))
        except ValidationError as exc:
            raise ValueError(_validation_sentence(exc)) from exc
        # `crud.create_racer` refuses a `race_id` that names no race (#819)
        # rather than guessing one, so there is nothing to check for `None`
        # here any more — a bad id surfaces as a `ValueError` the same way
        # `_validate_racing_group_membership` already does for this mutation.
        new_racer = crud.create_racer(db, racer_in)
        if new_racer.car_passed_inspection:
            # A racer created already inspected — the check-in desk adding
            # somebody who was never on the roster, which is the commonest way
            # a latecomer actually arrives.
            await _admit_late_racers(info, new_racer.race_id)
        await _publish_race_state_pkg(
            new_racer.race_id, kind=RaceChangeKind.ROSTER, racer=new_racer
        )
        return new_racer

    @strawberry.mutation
    async def update_racer(
        self, info: Info, id: int, racer: RacerInput
    ) -> Racer | None:
        """Update an existing racer."""
        db = info.context["db"]
        data = strawberry.asdict(racer)
        # Explicit removal beats an absent field, the same shape
        # `updateRace`'s `clearWeightLimit`/`clearTerminology`/
        # `clearNameDisplay` already use (#205, #496, #552) — absent means
        # "leave alone" for every field below, so a way back to null needs
        # its own flag (#747).
        clear_racing_group = data.pop("clear_racing_group", False)
        clear_car_number = data.pop("clear_car_number", False)
        clear_car_name = data.pop("clear_car_name", False)
        clear_car_weight = data.pop("clear_car_weight", False)
        clear_racer_image = data.pop("clear_racer_image", False)
        clear_car_image = data.pop("clear_car_image", False)
        clear_home_unit = data.pop("clear_home_unit", False)
        # The original/edit pair follows the same "absent means leave
        # alone" convention as every other field here (#1241) — see
        # `_photo_field_updates`'s own docstring for why an earlier,
        # unconditional-reapply version of this was a real hole, caught by
        # review before it shipped: a payload naming only `carWeight`
        # could silently wipe a racer's entire crop history. Popped ahead
        # of the general filter below because a "leave alone" answer here
        # is "add nothing to `filtered_data`," not "add `None`."
        for key in (
            "racer_image_url",
            "car_image_url",
            "racer_image_original_url",
            "car_image_original_url",
            "racer_image_edit",
            "car_image_edit",
        ):
            data.pop(key, None)
        filtered_data = {k: v for k, v in data.items() if v is not None}
        filtered_data.update(
            _photo_field_updates(
                "racer",
                racer.racer_image_url,
                racer.racer_image_original_url,
                racer.racer_image_edit,
            )
        )
        filtered_data.update(
            _photo_field_updates(
                "car",
                racer.car_image_url,
                racer.car_image_original_url,
                racer.car_image_edit,
            )
        )
        if clear_racing_group:
            filtered_data["racing_group_id"] = None
        if clear_car_number:
            filtered_data["car_number"] = None
        if clear_car_name:
            filtered_data["car_name"] = None
        if clear_car_weight:
            filtered_data["car_weight"] = None
        if clear_racer_image:
            # The original and the crop that produced it are cleared with
            # the derived image (#1241) — a stray original left behind
            # would let a later Rotate / Recrop reopen on a photo the
            # operator just cleared.
            filtered_data["racer_image_url"] = None
            filtered_data["racer_image_original_url"] = None
            filtered_data["racer_image_edit"] = None
        if clear_car_image:
            filtered_data["car_image_url"] = None
            filtered_data["car_image_original_url"] = None
            filtered_data["car_image_edit"] = None
        if clear_home_unit:
            filtered_data["home_unit"] = None
        racer_update = schemas.RacerUpdate(**typing.cast(Any, filtered_data))
        updated = typing.cast(
            Any, crud.update_racer(db, racer_id=id, racer_update=racer_update)
        )
        if updated:
            # Both directions: a check-in admits (#172), an un-check
            # withdraws (#228). The helper is idempotent either way.
            await _admit_late_racers(info, updated.race_id)
            await _publish_race_state_pkg(
                updated.race_id, kind=RaceChangeKind.RACER, racer=updated
            )
        return updated

    @strawberry.mutation
    async def delete_racer(self, info: Info, id: int) -> bool:
        """Delete a racer."""
        db = info.context["db"]
        racer = db.query(models.Racer).filter(models.Racer.id == id).first()
        race_id = racer.race_id if racer else None
        result = crud.delete_racer(db, racer_id=id) is not None
        if race_id:
            # `_vacate_lanes` can regenerate an unraced round underneath the
            # deleted racer's lanes, the same #50 risk every other re-fielding
            # path already guards (#309).
            await _revalidate_timers(info)
            await _publish_race_state_pkg(race_id, kind=RaceChangeKind.ROSTER)
        return result

    @strawberry.mutation
    async def check_in_racer(
        self,
        info: Info,
        id: int,
        passed_inspection: bool,
        weight: float | None,
        racer_image_url: str | None = None,
        car_image_url: str | None = None,
    ) -> Racer | None:
        """Check in a racer."""
        db = info.context["db"]
        # Absent means leave alone (#192/#205's convention): only a caller
        # that actually supplies a weight or a photo should overwrite one
        # already on file. Passing every kwarg to RacerUpdate unconditionally
        # would make `model_dump(exclude_unset=True)` treat an omitted value
        # as an explicit null and erase it — e.g. a photo `bulkAssignPhotos`
        # placed, on a check-in that doesn't re-supply it.
        update_fields: dict[str, Any] = {"car_passed_inspection": passed_inspection}
        if weight is not None:
            update_fields["car_weight"] = weight
        if racer_image_url is not None:
            update_fields["racer_image_url"] = racer_image_url
        if car_image_url is not None:
            update_fields["car_image_url"] = car_image_url
        racer_update = schemas.RacerUpdate(**update_fields)
        updated = typing.cast(
            Any, crud.update_racer(db, racer_id=id, racer_update=racer_update)
        )
        if updated:
            # Both directions — un-checking is how a withdrawal is recorded
            # (#228), and it has to reach the schedule like a check-in does.
            await _admit_late_racers(info, updated.race_id)
            await _publish_race_state_pkg(
                updated.race_id, kind=RaceChangeKind.RACER, racer=updated
            )
        return updated

    # RacingGroup Mutations
    @strawberry.mutation
    async def create_racing_group(
        self, info: Info, race_id: int, racing_group: RacingGroupInput
    ) -> RacingGroup:
        """Create a new racing group."""
        db = info.context["db"]
        racing_group_in = schemas.RacingGroupCreate(
            **typing.cast(Any, strawberry.asdict(racing_group))
        )
        new_racing_group = typing.cast(
            Any, crud.create_racing_group(db, racing_group_in, race_id=race_id)
        )
        await _publish_race_state_pkg(race_id)
        return new_racing_group

    @strawberry.mutation
    async def update_racing_group(
        self, info: Info, id: int, racing_group: RacingGroupInput
    ) -> RacingGroup | None:
        """Update an existing racing group."""
        db = info.context["db"]
        racing_group_update = schemas.RacingGroupUpdate(
            **typing.cast(Any, strawberry.asdict(racing_group))
        )
        updated = typing.cast(
            Any,
            crud.update_racing_group(
                db, racing_group_id=id, racing_group_update=racing_group_update
            ),
        )
        if updated:
            await _publish_race_state_pkg(updated.race_id)
        return updated

    @strawberry.mutation
    async def delete_racing_group(self, info: Info, id: int) -> bool:
        """Delete a racing group.

        Unlike `deleteRound` or `deleteRunOffHeat` — each refused for exactly
        one reason, which the mutation's own name already says — this can
        refuse for two unrelated reasons: a round scoped to it, or an award
        scoped to it (#755). Catching `crud.delete_racing_group`'s
        `ValueError` and returning a bare `false` left the operator with
        "a round or an award" and no way to tell which without a hunt
        through two screens (#823). It is let through as an ordinary
        GraphQL error instead, carrying the specific round's or award's own
        name — the same shape `createRunOffHeat`'s validation already takes.
        """
        db = info.context["db"]
        racing_group = (
            db.query(models.RacingGroup).filter(models.RacingGroup.id == id).first()
        )
        race_id = racing_group.race_id if racing_group else None
        result = crud.delete_racing_group(db, racing_group_id=id) is not None
        if race_id:
            await _publish_race_state_pkg(race_id)
        return result


@strawberry.type
class RacerBulkMutations:
    # Bulk Mutations
    @strawberry.mutation
    async def bulk_auto_number(self, info: Info, racer_ids: list[int]) -> int:
        """Bulk auto-number racers."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return 0
        count = crud.auto_number_racers(db, race_id, racer_ids)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.RACER)
        return count

    @strawberry.mutation
    async def bulk_clear_numbers(self, info: Info, racer_ids: list[int]) -> bool:
        """Bulk clear car numbers."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return False
        crud.bulk_clear_car_numbers(db, race_id, racer_ids)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.RACER)
        return True

    @strawberry.mutation
    async def bulk_check_in(
        self, info: Info, racer_ids: list[int], passed_inspection: bool = True
    ) -> bool:
        """Bulk check-in racers."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return False
        crud.bulk_check_in_racers(db, race_id, racer_ids, passed_inspection)
        # Once for the batch, not once per racer: both directions are
        # idempotent and look at everybody, so a per-racer call would
        # regenerate an unraced round sixty times over a desk queue. Runs for
        # un-checks too — that is how a bulk withdrawal reaches the schedule
        # (#228).
        await _admit_late_racers(info, race_id)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.RACER)
        return True

    @strawberry.mutation
    async def bulk_set_excluded_from_standings(
        self, info: Info, racer_ids: list[int], excluded: bool = True
    ) -> bool:
        """Bulk set whether racers race but are not ranked (#548).

        Check-in is unchanged — a sibling or parent's car set here still
        fields in heats exactly as before, and still shows on the audience
        display. Only `services/scoring.get_leaderboard` reads the flag, so
        nothing here touches the schedule; no `_admit_late_racers` or
        `_revalidate_timers` call, unlike `bulk_check_in` beside it.
        """
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return False
        crud.bulk_set_excluded_from_standings(db, race_id, racer_ids, excluded)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.RACER)
        return True

    @strawberry.mutation
    async def bulk_move_to_racing_group(
        self, info: Info, racer_ids: list[int], racing_group_id: int | None
    ) -> bool:
        """Bulk move racers to a racing group."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return False
        crud.bulk_move_racers_to_racing_group(db, race_id, racer_ids, racing_group_id)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.ROSTER)
        return True

    @strawberry.mutation
    async def bulk_delete_racers(self, info: Info, racer_ids: list[int]) -> bool:
        """Bulk delete racers."""
        db = info.context["db"]
        race_id = _race_id_for_racers(db, racer_ids)
        if race_id is None:
            return False
        crud.bulk_delete_racers(db, race_id, racer_ids)
        # Same #50 risk as a single delete, and this is the desk's bulk
        # path onto it (#309).
        await _revalidate_timers(info)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.ROSTER)
        return True

    @strawberry.mutation
    async def bulk_assign_photos(
        self,
        info: Info,
        assignments: list[PhotoAssignmentInput],
    ) -> int:
        """Assign uploaded photo URLs to racers in bulk. Returns count updated."""
        db = info.context["db"]
        if not assignments:
            return 0
        assignment_dicts = [
            {"racer_id": a.racer_id, "url": a.url, "photo_type": a.photo_type}
            for a in assignments
        ]
        count = crud.bulk_assign_racer_photos(db, assignment_dicts)
        racer = (
            db.query(models.Racer)
            .filter(models.Racer.id == assignments[0].racer_id)
            .first()
        )
        if racer:
            await _publish_race_state_pkg(racer.race_id, kind=RaceChangeKind.RACER)
        return count


@strawberry.type
class PhotoUploadMutations:
    @strawberry.mutation
    def upload_image(self, data_url: str) -> str:
        """Upload an image from a Base64 data URL."""
        max_upload_bytes = _get_max_upload_bytes()
        max_b64_len = ((max_upload_bytes + 2) // 3) * 4
        max_mb = max_upload_bytes // (1024 * 1024)
        limit_desc = f"{max_mb} MB" if max_mb > 0 else f"{max_upload_bytes} bytes"

        # Refuse oversized payloads before splitting or base64 decoding to avoid
        # exhausting memory on the Raspberry Pi target (#744).
        if len(data_url) > max_b64_len + 1024:
            raise ValueError(f"Image is larger than {limit_desc}.")

        # Parse data URL: data:<mime>;base64,<data>
        if "," not in data_url:
            raise ValueError("Invalid data URL format")
        _, encoded = data_url.split(",", 1)

        if len(encoded) > max_b64_len:
            raise ValueError(f"Image is larger than {limit_desc}.")

        try:
            raw_data = base64.b64decode(encoded)
        except (ValueError, binascii.Error) as error:
            raise ValueError("Invalid data URL format") from error

        if len(raw_data) > max_upload_bytes:
            raise ValueError(f"Image is larger than {limit_desc}.")

        return store_uploaded_image(raw_data, UPLOAD_DIR)
