import base64
import binascii
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import strawberry
from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.domain import roster_import
from backend.domain import terminology as domain_terminology
from backend.services.importers.derbynet import parse_derbynet_database
from backend.services.importers.gprm import parse_gprm_database

from .common import (
    MAX_DERBYNET_IMPORT_BYTES,
    MAX_GPRM_IMPORT_BYTES,
    _terminology_overrides,
)


@strawberry.type
class GprmImportGroup:
    """A racing group `domain.gprm.roster_from_tables` found, before it is written."""

    name: str
    division: str | None


@strawberry.type
class GprmImportRacer:
    """A racer `domain.gprm.roster_from_tables` found, before it is written."""

    first_name: str
    last_name: str
    car_number: int | None
    car_name: str | None
    car_weight: float | None
    passed_inspection: bool
    group: str | None
    excluded_from_standings: bool
    #: The other program's own id, so a problem naming this racer (below) can
    #: be matched back to the row it is about — see `ImportedRacer.source_id`.
    source_id: str | None


@strawberry.type
class GprmImportProblem:
    """One sentence about what will not import as the operator might expect."""

    message: str
    blocking: bool
    source_id: str | None


@strawberry.type
class GprmImportPreview:
    """Everything an uploaded GrandPrix Race Manager database would import
    (#618), without writing any of it.

    `confirmGprmImport` re-parses the same upload rather than trusting this
    value back from the client — there is no session on the server holding
    the file between the two calls, so what gets written can never drift
    from what this preview showed.
    """

    groups: list[GprmImportGroup]
    racers: list[GprmImportRacer]
    #: In-file duplicates (`domain.roster_import.duplicate_number_problems`)
    #: and collisions with a racer already on this race's roster
    #: (`domain.roster_import.existing_number_problems`) are both here,
    #: in that order — the reader has no reason to care which rule found it.
    problems: list[GprmImportProblem]
    can_import: bool


def _decode_upload(
    file_data: str, max_bytes: int, program_name: str = "GrandPrix Race Manager"
) -> bytes:
    """A base64 data URL — the same shape `uploadImage`'s `dataUrl` takes —
    to raw bytes, refusing anything absurdly large before it is written
    anywhere. Shared by every importer's preview and confirm so none of them
    can disagree about what counts as too big.

    `program_name` reaches the one message that names a program (#661) —
    the same reason `domain.gprm.roster_from_tables` takes it.
    """
    if "," not in file_data:
        raise ValueError("That file could not be read.")
    _, encoded = file_data.split(",", 1)
    try:
        raw = base64.b64decode(encoded)
    except (ValueError, binascii.Error) as error:
        raise ValueError("That file could not be read.") from error
    if len(raw) > max_bytes:
        raise ValueError(
            f"That file is larger than {program_name} writes for a roster "
            "database — it is probably not one."
        )
    return raw


def _race_vehicle_word(db: Session, race: models.Race) -> str:
    """This race's own resolved vehicle word (#551), for the parser's
    problem sentences — the same layering `Race.terminology` resolves,
    computed here because a mutation has no GraphQL field resolver to read
    it from.
    """
    organization = (
        db.query(models.Organization)
        .filter(models.Organization.id == race.organization_id)
        .first()
    )
    resolved = domain_terminology.resolve_terminology(
        organization=_terminology_overrides(organization) if organization else None,
        race=_terminology_overrides(race),
    )
    return resolved.vehicle_singular


def _parse_gprm_upload(
    db: Session, race: models.Race, file_data: str
) -> tuple[roster_import.ParsedRoster, str]:
    """Decode an uploaded GPRM database and parse it (#618).

    `sqlite3` opens files, not buffers (see `services/importers/gprm.py`), so
    the decoded bytes are written to a temporary file — removed in a
    `finally` — before `parse_gprm_database` ever sees them, the same shape
    `services/backup.py`'s restore uses for an uploaded archive. Raises
    `ValueError` rather than `RosterImportError`, so every failure reaching
    the operator through this mutation is the same shape as `importRacers`'
    own "Race not found": a GraphQL error carrying the sentence to show.
    """
    raw = _decode_upload(file_data, MAX_GPRM_IMPORT_BYTES)
    vehicle_word = _race_vehicle_word(db, race)
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as handle:
        handle.write(raw)
        temp_path = Path(handle.name)
    try:
        try:
            roster = parse_gprm_database(temp_path, vehicle_word=vehicle_word)
        except roster_import.RosterImportError as error:
            raise ValueError(str(error)) from error
        return roster, vehicle_word
    finally:
        os.unlink(temp_path)


def _gprm_import_preview(
    db: Session, race_id: int, roster: roster_import.ParsedRoster, vehicle_word: str
) -> GprmImportPreview:
    existing_holders = crud.existing_car_number_holders(db, race_id)
    extra_problems = roster_import.existing_number_problems(
        roster.racers, existing_holders, vehicle_word
    )
    # A name match against the roster already in this race (#1021) — the
    # rule an unnumbered racer still has to answer to, since the number
    # rule above never sees one.
    existing_names = crud.existing_racer_names(db, race_id)
    name_problems = roster_import.existing_racer_problems(roster.racers, existing_names)
    problems = list(roster.problems) + extra_problems + name_problems
    return GprmImportPreview(
        groups=[
            GprmImportGroup(name=group.name, division=group.division)
            for group in roster.groups
        ],
        racers=[
            GprmImportRacer(
                first_name=racer.first_name,
                last_name=racer.last_name,
                car_number=racer.car_number,
                car_name=racer.car_name,
                car_weight=racer.car_weight,
                passed_inspection=racer.passed_inspection,
                group=racer.group,
                excluded_from_standings=racer.excluded_from_standings,
                source_id=racer.source_id,
            )
            for racer in roster.racers
        ],
        problems=[
            GprmImportProblem(
                message=problem.message,
                blocking=problem.blocking,
                source_id=problem.source_id,
            )
            for problem in problems
        ],
        can_import=not any(problem.blocking for problem in problems),
    )


@strawberry.type
class DerbynetImportGroup:
    """A racing group `domain.derbynet.roster_from_derbynet_tables` found,
    before it is written."""

    name: str
    division: str | None


@strawberry.type
class DerbynetImportRacer:
    """A racer `domain.derbynet.roster_from_derbynet_tables` found, before
    it is written."""

    first_name: str
    last_name: str
    car_number: int | None
    car_name: str | None
    car_weight: float | None
    passed_inspection: bool
    group: str | None
    excluded_from_standings: bool
    #: DerbyNet's own id, so a problem naming this racer (below) can be
    #: matched back to the row it is about — see `ImportedRacer.source_id`.
    source_id: str | None


@strawberry.type
class DerbynetImportProblem:
    """One sentence about what will not import as the operator might expect."""

    message: str
    blocking: bool
    source_id: str | None


@strawberry.type
class DerbynetImportPreview:
    """Everything an uploaded DerbyNet database would import (#661), without
    writing any of it.

    The same shape as `GprmImportPreview` — a sibling type rather than a
    shared one, so the schema names which program a caller is previewing
    rather than a caller reading `previewDerbynetImport: GprmImportPreview`
    and wondering whether that is a typo. `confirmDerbynetImport` re-parses
    the same upload rather than trusting this value back from the client,
    for the identical reason `GprmImportPreview`'s own docstring gives.
    """

    groups: list[DerbynetImportGroup]
    racers: list[DerbynetImportRacer]
    problems: list[DerbynetImportProblem]
    can_import: bool


def _parse_derbynet_upload(
    db: Session, race: models.Race, file_data: str
) -> tuple[roster_import.ParsedRoster, str]:
    """Decode an uploaded DerbyNet database and parse it (#661).

    The DerbyNet twin of `_parse_gprm_upload` — see its own docstring for
    why the bytes land in a temporary file rather than a buffer, and why a
    `RosterImportError` is re-raised as a plain `ValueError`.
    """
    raw = _decode_upload(file_data, MAX_DERBYNET_IMPORT_BYTES, program_name="DerbyNet")
    vehicle_word = _race_vehicle_word(db, race)
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as handle:
        handle.write(raw)
        temp_path = Path(handle.name)
    try:
        try:
            roster = parse_derbynet_database(temp_path, vehicle_word=vehicle_word)
        except roster_import.RosterImportError as error:
            raise ValueError(str(error)) from error
        return roster, vehicle_word
    finally:
        os.unlink(temp_path)


def _derbynet_import_preview(
    db: Session, race_id: int, roster: roster_import.ParsedRoster, vehicle_word: str
) -> DerbynetImportPreview:
    existing_holders = crud.existing_car_number_holders(db, race_id)
    extra_problems = roster_import.existing_number_problems(
        roster.racers, existing_holders, vehicle_word
    )
    # A name match against the roster already in this race (#1021) — the
    # rule an unnumbered racer still has to answer to, since the number
    # rule above never sees one.
    existing_names = crud.existing_racer_names(db, race_id)
    name_problems = roster_import.existing_racer_problems(roster.racers, existing_names)
    problems = list(roster.problems) + extra_problems + name_problems
    return DerbynetImportPreview(
        groups=[
            DerbynetImportGroup(name=group.name, division=group.division)
            for group in roster.groups
        ],
        racers=[
            DerbynetImportRacer(
                first_name=racer.first_name,
                last_name=racer.last_name,
                car_number=racer.car_number,
                car_name=racer.car_name,
                car_weight=racer.car_weight,
                passed_inspection=racer.passed_inspection,
                group=racer.group,
                excluded_from_standings=racer.excluded_from_standings,
                source_id=racer.source_id,
            )
            for racer in roster.racers
        ],
        problems=[
            DerbynetImportProblem(
                message=problem.message,
                blocking=problem.blocking,
                source_id=problem.source_id,
            )
            for problem in problems
        ],
        can_import=not any(problem.blocking for problem in problems),
    )


@dataclass
class _StagedCsvRacer:
    """Staged parsed row from a racer CSV upload (#864)."""

    first_name: str
    last_name: str
    car_number: int | None
    car_name: str | None
    car_passed_inspection: bool
    racing_group_name: str | None
    #: A racer's own unit — "Pack 12" (#1076, stage 1). Absent when the
    #: uploaded file carries no matching column.
    home_unit: str | None = None


def _format_blocking_import_problems(
    problems: list[roster_import.ImportProblem],
) -> str:
    """One sentence for `importRacers`' own single-string refusal (#1021),
    built from the same per-racer `ImportProblem`s the GPRM/DerbyNet preview
    shows on a whole screen — the CSV importer has no such screen, so this
    is the only place the refusal reaches the operator. Named up to three;
    a longer list is summarised rather than printed in full, the same
    "say what to do, not everything that is wrong" shape a validation error
    elsewhere in this codebase already follows.
    """
    messages = [problem.message for problem in problems]
    if len(messages) > 3:
        messages = messages[:3] + [f"...and {len(messages) - 3} more."]
    return " ".join(messages)
