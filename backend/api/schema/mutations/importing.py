import csv
import io

import strawberry
from strawberry.types import Info

from backend.db import crud, models, schemas
from backend.domain import roster_import

from ..common import (
    _TRUTHY_CSV_VALUES,
    _admit_late_racers,
    _get_max_upload_bytes,
    _publish_race_state_pkg,
)
from ..enums import RaceChangeKind
from ..types_import import (
    DerbynetImportPreview,
    GprmImportPreview,
    _derbynet_import_preview,
    _format_blocking_import_problems,
    _gprm_import_preview,
    _parse_derbynet_upload,
    _parse_gprm_upload,
    _StagedCsvRacer,
)


@strawberry.type
class ImportMutations:
    @strawberry.mutation
    async def import_racers(self, info: Info, race_id: int, csv_data: str) -> int:
        """Import racers from a CSV data string.

        Parses and stages rows first, then writes them in an atomic
        transaction (#864). If an error occurs, rolls back so no partial
        roster remains.

        Before anything is written, every staged row is checked by name
        against the roster already in this race and against every other
        staged row (#1021) — the same rule the GPRM/DerbyNet preview
        applies, since this importer has no preview screen of its own to
        show it on. A match refuses the whole import; nothing here offers
        the GPRM/DerbyNet importers' "Import N new, skip M" alternative —
        see `domain.roster_import.existing_racer_problems`'s docstring for
        why blocking was chosen instead.
        """
        max_upload_bytes = _get_max_upload_bytes()
        max_mb = max_upload_bytes // (1024 * 1024)
        limit_desc = f"{max_mb} MB" if max_mb > 0 else f"{max_upload_bytes} bytes"
        if len(csv_data) > max_upload_bytes:
            raise ValueError(f"CSV data is larger than {limit_desc}.")
        if len(csv_data.encode("utf-8")) > max_upload_bytes:
            raise ValueError(f"CSV data is larger than {limit_desc}.")

        db = info.context["db"]
        # Verification: ensure race exists
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        # Excel writes a UTF-8 BOM on every "CSV UTF-8" save. Left in place it
        # sticks to the first header (`﻿first_name`), which never matches
        # `first_name` in `get_val` below, so every row is silently skipped
        # and the mutation returns 0 with no error.
        f = io.StringIO(csv_data.lstrip("﻿"))
        reader = csv.DictReader(f)

        # Helper for case-insensitive and space-insensitive key search
        def get_val(row: dict[str | None, str | None], *aliases: str) -> str | None:
            for alias in aliases:
                # Direct match
                if alias in row:
                    return row[alias]
                # Normalized match
                norm_alias = alias.lower().replace(" ", "_")
                for key in row:
                    if key is not None:
                        norm_key = key.lower().replace(" ", "_")
                        if norm_key == norm_alias:
                            return row[key]
            return None

        staged_racers: list[_StagedCsvRacer] = []
        for row in reader:
            first_name = get_val(row, "first_name", "first")
            last_name = get_val(row, "last_name", "last")
            if not first_name or not last_name:
                continue

            raw_car_num = get_val(row, "car_number", "car_#", "number")
            stripped_car_num = raw_car_num.strip() if raw_car_num else None
            parsed_car_num = (
                int(stripped_car_num)
                if stripped_car_num and stripped_car_num.isdigit()
                else None
            )

            car_name = get_val(row, "car_name")
            passed = get_val(row, "car_passed_inspection", "passed_inspection")
            racing_group_val = get_val(row, "racing_group")
            home_unit_val = get_val(
                row, "home_unit", "pack", "unit", "home_pack", "troop"
            )

            staged_racers.append(
                _StagedCsvRacer(
                    first_name=first_name.strip(),
                    last_name=last_name.strip(),
                    car_number=parsed_car_num,
                    car_name=car_name.strip() or None if car_name else None,
                    # The column mapping normalizes to yes/no before sending, but a
                    # file posted straight to the mutation can hold anything.
                    car_passed_inspection=passed is not None
                    and passed.strip().lower() in _TRUTHY_CSV_VALUES,
                    racing_group_name=racing_group_val.strip()
                    if racing_group_val
                    else None,
                    home_unit=home_unit_val.strip() or None if home_unit_val else None,
                )
            )

        # A name match, in the file or against the roster already here
        # (#1021), refuses the whole import before anything is written —
        # the same atomic-refusal shape as every other check on this path.
        staged_as_imported = [
            roster_import.ImportedRacer(
                first_name=staged.first_name, last_name=staged.last_name
            )
            for staged in staged_racers
        ]
        blocking_problems = roster_import.duplicate_name_problems(staged_as_imported)
        if not blocking_problems:
            existing_names = crud.existing_racer_names(db, race_id)
            blocking_problems = roster_import.existing_racer_problems(
                staged_as_imported, existing_names
            )
        if blocking_problems:
            raise ValueError(_format_blocking_import_problems(blocking_problems))

        count = 0
        try:
            with db.begin_nested():
                group_cache: dict[str, int] = {}
                for staged in staged_racers:
                    racing_group_id: int | None = None
                    if staged.racing_group_name:
                        if staged.racing_group_name in group_cache:
                            racing_group_id = group_cache[staged.racing_group_name]
                        else:
                            db_racing_group = (
                                db.query(models.RacingGroup)
                                .filter(
                                    models.RacingGroup.race_id == race_id,
                                    models.RacingGroup.name == staged.racing_group_name,
                                )
                                .first()
                            )
                            if not db_racing_group:
                                db_racing_group = crud.create_racing_group(
                                    db,
                                    schemas.RacingGroupCreate(
                                        name=staged.racing_group_name, color="#808080"
                                    ),
                                    race_id,
                                    commit=False,
                                )
                            racing_group_id = db_racing_group.id
                            group_cache[staged.racing_group_name] = racing_group_id

                    racer_in = schemas.RacerCreate(
                        first_name=staged.first_name,
                        last_name=staged.last_name,
                        car_number=staged.car_number,
                        car_name=staged.car_name,
                        car_passed_inspection=staged.car_passed_inspection,
                        racing_group_id=racing_group_id,
                        home_unit=staged.home_unit,
                        race_id=race_id,
                    )
                    crud.create_racer(db, racer_in, commit=False)
                    count += 1
            db.commit()
        except Exception:
            db.rollback()
            raise

        # A row can arrive already checked in (the canonical CSV carries
        # passed_inspection), which is exactly the arrival #172 admits for —
        # once for the batch, the same reason bulkCheckIn calls it once.
        await _admit_late_racers(info, race_id)
        # An import creates racers, so the roster list changed.
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.ROSTER)
        return count

    @strawberry.mutation
    async def preview_gprm_import(
        self, info: Info, race_id: int, file_data: str
    ) -> GprmImportPreview:
        """Parse an uploaded GrandPrix Race Manager database without writing
        anything (#618, stage 3).

        The upload-preview-confirm shape the issue asked for: this call
        writes nothing, and `confirmGprmImport` is the only door that does.
        `GprmImportPreview.canImport` mirrors `ParsedRoster.can_import` —
        false when a *blocking* problem appears, which every row problem
        this parser itself produces never is (a row problem here is always
        a warning, the racer is simply skipped or a field left blank) — but
        `existing_racer_problems` (#1021) is blocking, so a file naming a
        racer already on this race's roster now flips this to false and
        `confirmGprmImport` refuses it too.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, vehicle_word = _parse_gprm_upload(db, race, file_data)
        return _gprm_import_preview(db, race_id, roster, vehicle_word)

    @strawberry.mutation
    async def confirm_gprm_import(
        self, info: Info, race_id: int, file_data: str
    ) -> int:
        """Write the roster from a GrandPrix Race Manager database (#618,
        stage 3).

        Re-parses `fileData` rather than trusting a preview handed back from
        the client — there is no session on the server holding the earlier
        upload, so what gets written can never drift from what the preview
        showed. Returns the number of racers created, the same contract
        `importRacers` (CSV) already has.

        Recomputes the preview's own problems too (#1021), and refuses if
        any is blocking — a second click on Import after a slow first one,
        or a bare GraphQL call skipping the preview screen entirely, must
        not duplicate a roster the preview would have refused.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, vehicle_word = _parse_gprm_upload(db, race, file_data)
        preview = _gprm_import_preview(db, race_id, roster, vehicle_word)
        if not preview.can_import:
            blocking = next(p.message for p in preview.problems if p.blocking)
            raise ValueError(blocking)
        count = crud.write_imported_roster(db, race_id, roster)

        # Same arrival #343 fixed for the CSV path: a GPRM roster can carry
        # already-checked-in racers (`PassedInspection`), and admission is
        # the batch's job, once, not per racer.
        await _admit_late_racers(info, race_id)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.ROSTER)
        return count

    @strawberry.mutation
    async def preview_derbynet_import(
        self, info: Info, race_id: int, file_data: str
    ) -> DerbynetImportPreview:
        """Parse an uploaded DerbyNet database without writing anything (#661).

        The DerbyNet twin of `previewGprmImport` — a sibling mutation rather
        than the same one taking a source argument, so that renaming an
        already-shipped, documented mutation is not the cost of adding a
        second importer (see `domain.derbynet`'s own docstring for why the
        parser itself needed almost nothing DerbyNet-specific; this pair is
        the "almost").
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, vehicle_word = _parse_derbynet_upload(db, race, file_data)
        return _derbynet_import_preview(db, race_id, roster, vehicle_word)

    @strawberry.mutation
    async def confirm_derbynet_import(
        self, info: Info, race_id: int, file_data: str
    ) -> int:
        """Write the roster from a DerbyNet database (#661).

        Re-parses `fileData` rather than trusting a preview handed back from
        the client, the same reason `confirmGprmImport` does. Returns the
        number of racers created, the same contract every importer here has.

        Recomputes the preview's own problems too (#1021), and refuses if
        any is blocking — see `confirmGprmImport`'s own docstring for why.
        """
        db = info.context["db"]
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")
        roster, vehicle_word = _parse_derbynet_upload(db, race, file_data)
        preview = _derbynet_import_preview(db, race_id, roster, vehicle_word)
        if not preview.can_import:
            blocking = next(p.message for p in preview.problems if p.blocking)
            raise ValueError(blocking)
        count = crud.write_imported_roster(db, race_id, roster)

        # Same arrival #343 fixed for the CSV and GPRM paths: a DerbyNet
        # roster can carry already-checked-in racers (`passedinspection`),
        # and admission is the batch's job, once, not per racer.
        await _admit_late_racers(info, race_id)
        await _publish_race_state_pkg(race_id, kind=RaceChangeKind.ROSTER)
        return count
