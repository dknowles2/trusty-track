"""Backing the event up, and putting it back (#176).

The whole event is one SQLite file plus a directory of photographs. Recovering
from a failing SD card, a corrupted database or an operator mistake used to
require knowing that, having shell access to the machine, and having thought of
it beforehand — none of which is a safe assumption about a Raspberry Pi sitting
under a track in a school hall.

An archive is a zip holding three things:

``manifest.json``
    What this is and what wrote it, read *before* anything is unpacked.
``trusty-track.db``
    A consistent snapshot, taken through SQLite's own backup API rather than by
    copying the file. A copy taken while the timer is recording a heat can catch
    a half-written page; the backup API takes a read lock and produces a
    database that opens.
``uploads/``
    The racer and car photographs, which are referenced by name from the
    database and are worthless without it — hence one archive rather than two.

Nothing here imports the app. It takes an engine and two directories, which is
what lets the tests exercise a real restore against a temporary data directory
rather than the operator's own.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import IO

from sqlalchemy.engine import Engine

#: Bumped only when an older Trusty Track could not read the archive correctly.
#: Adding a file to the zip does not need a bump; changing what an existing one
#: means does.
ARCHIVE_FORMAT = 1

MANIFEST_NAME = "manifest.json"
DATABASE_NAME = "trusty-track.db"
UPLOADS_PREFIX = "uploads/"

#: Where the previous database and uploads go when a restore replaces them.
#: One level of undo, deliberately: the common mistake is restoring the wrong
#: file and noticing immediately, and an unbounded history of 60-photo
#: directories fills the SD card it is meant to protect.
PRE_RESTORE_SUFFIX = ".pre-restore"


class ArchiveError(Exception):
    """A refusal the operator is meant to read.

    Every message is worded for somebody standing at a track holding the wrong
    file, so it says what was expected as well as what arrived.
    """


@dataclass(frozen=True)
class Manifest:
    """What an archive says about itself."""

    format: int
    schema_revision: str | None
    app_version: str
    created_at: str
    upload_count: int

    def to_json(self) -> str:
        return json.dumps(
            {
                "format": self.format,
                "schema_revision": self.schema_revision,
                "app_version": self.app_version,
                "created_at": self.created_at,
                "upload_count": self.upload_count,
            },
            indent=2,
        )

    @classmethod
    def from_mapping(cls, raw: dict) -> Manifest:
        try:
            return cls(
                format=int(raw["format"]),
                schema_revision=raw.get("schema_revision"),
                app_version=str(raw.get("app_version", "unknown")),
                created_at=str(raw.get("created_at", "")),
                upload_count=int(raw.get("upload_count", 0)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ArchiveError(
                "This file's manifest is not readable, so it is either damaged "
                "or was not produced by Trusty Track."
            ) from exc


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _snapshot_database(engine: Engine, target: Path) -> None:
    """Copy the live database to ``target`` through SQLite's backup API.

    Not `shutil.copy`. The app is serving while this runs — the timer writes
    through its own session (#9) and a heat may be recorded mid-copy — and a
    file copy of a database being written to can land mid-page. The backup API
    holds a read lock and produces a file that opens.
    """
    raw = engine.raw_connection()
    try:
        source = raw.driver_connection
        if not isinstance(source, sqlite3.Connection):  # pragma: no cover
            raise ArchiveError(
                "Backups are only supported on SQLite, which is what every "
                "Trusty Track install uses."
            )
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        raw.close()


def _revision_of(database: Path) -> str | None:
    """The Alembic revision recorded in a database file, if it has one."""
    connection = sqlite3.connect(database)
    try:
        cursor = connection.execute("SELECT version_num FROM alembic_version")
        row = cursor.fetchone()
    except sqlite3.Error:
        return None
    finally:
        connection.close()
    return str(row[0]) if row else None


def write_archive(
    destination: Path,
    *,
    engine: Engine,
    upload_dir: Path,
    app_version: str,
    staging_dir: Path,
) -> Manifest:
    """Write a backup archive to ``destination`` and return its manifest.

    ``staging_dir`` holds the database snapshot while it is being written, and
    must be on the same filesystem as the archive so the snapshot is not copied
    across devices.
    """
    staging_dir.mkdir(parents=True, exist_ok=True)
    snapshot = staging_dir / DATABASE_NAME
    _snapshot_database(engine, snapshot)

    try:
        uploads = sorted(p for p in upload_dir.iterdir() if p.is_file())
    except FileNotFoundError:
        uploads = []

    manifest = Manifest(
        format=ARCHIVE_FORMAT,
        schema_revision=_revision_of(snapshot),
        app_version=app_version,
        created_at=_now(),
        upload_count=len(uploads),
    )

    try:
        with zipfile.ZipFile(
            destination, "w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            archive.writestr(MANIFEST_NAME, manifest.to_json())
            archive.write(snapshot, DATABASE_NAME)
            for upload in uploads:
                archive.write(upload, f"{UPLOADS_PREFIX}{upload.name}")
    finally:
        snapshot.unlink(missing_ok=True)

    return manifest


def read_manifest(archive: IO[bytes] | Path) -> Manifest:
    """The manifest of an archive, or an `ArchiveError` explaining why not."""
    try:
        with zipfile.ZipFile(archive) as zf, zf.open(MANIFEST_NAME) as handle:
            raw = json.loads(handle.read().decode("utf-8"))
    except KeyError as exc:
        raise ArchiveError(
            "This zip file has no manifest, so it was not produced by Trusty Track."
        ) from exc
    except (zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArchiveError("This file is not a readable Trusty Track backup.") from exc

    if not isinstance(raw, dict):
        raise ArchiveError("This file is not a readable Trusty Track backup.")
    return Manifest.from_mapping(raw)


def check_restorable(manifest: Manifest, known_revisions: Iterable[str]) -> None:
    """Refuse an archive this install cannot restore, before anything is moved.

    The version check is the one that matters. An archive from a *newer* Trusty
    Track holds a schema this install has no migrations for, and there is no
    downgrade path to walk it back — restoring it would leave a database the app
    cannot open and the operator no way back. An *older* archive is fine and
    common: it is upgraded forward afterwards, which is the same path a legacy
    database already takes at startup.

    Recognition is by revision rather than by version number because the
    revision is what the schema is actually keyed on, and it is recorded in the
    archived database itself rather than being asserted by the manifest.
    """
    if manifest.format != ARCHIVE_FORMAT:
        raise ArchiveError(
            f"This backup is in format {manifest.format} and this version of "
            f"Trusty Track reads format {ARCHIVE_FORMAT}."
        )

    if manifest.schema_revision is None:
        raise ArchiveError(
            "This backup's database records no schema version, so it cannot be "
            "matched against this install."
        )

    if manifest.schema_revision not in set(known_revisions):
        raise ArchiveError(
            f"This backup was taken from a newer version of Trusty Track "
            f"(schema {manifest.schema_revision}, which this install does not "
            f"know). Upgrade Trusty Track and try again — restoring it here "
            f"would leave a database this version cannot open."
        )


def _safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    """The archive's entries, refusing anything that would write outside it.

    An archive arrives from whoever is holding the operator PIN, and a zip entry
    named ``../../etc/something`` is the oldest trick there is. Names are
    checked rather than sanitised: a backup we wrote contains exactly three
    kinds of entry, so anything else is a reason to stop rather than to guess.
    """
    members: list[zipfile.ZipInfo] = []
    for info in archive.infolist():
        name = info.filename
        if name.endswith("/"):
            continue
        if name in (MANIFEST_NAME, DATABASE_NAME):
            members.append(info)
            continue
        if not name.startswith(UPLOADS_PREFIX):
            raise ArchiveError(f"This backup contains an unexpected file: {name}")
        relative = name[len(UPLOADS_PREFIX) :]
        if not relative or "/" in relative or "\\" in relative:
            raise ArchiveError(f"This backup contains an unexpected file: {name}")
        if relative in (".", "..") or Path(relative).is_absolute():
            raise ArchiveError(f"This backup contains an unexpected file: {name}")
        members.append(info)
    return members


def _replace_directory(source: Path, target: Path) -> None:
    """Move ``source`` onto ``target``, keeping the displaced copy aside once."""
    displaced = target.with_name(target.name + PRE_RESTORE_SUFFIX)
    if target.exists():
        if displaced.exists():
            shutil.rmtree(displaced)
        os.replace(target, displaced)
    os.replace(source, target)


def restore_archive(
    archive: IO[bytes] | Path,
    *,
    database_path: Path,
    upload_dir: Path,
    staging_dir: Path,
    known_revisions: Iterable[str],
    dispose: object = None,
) -> Manifest:
    """Replace the live database and uploads with the archive's copies.

    Everything that can be refused is refused before anything is moved: the
    manifest is read, the schema version is checked, and every member is
    unpacked into a staging directory. Only once all of that has succeeded is
    anything swapped, so a damaged archive leaves the running event untouched.

    ``dispose`` is called after staging and before the swap. It is the engine's
    `dispose`, and it matters: SQLAlchemy pools connections, so replacing the
    file underneath an open one leaves those connections addressing a database
    that no longer exists.

    The caller is responsible for bringing the restored database up to date
    afterwards — `init_db()` does it, and an older archive needs it.
    """
    manifest = read_manifest(archive)
    check_restorable(manifest, known_revisions)

    if hasattr(archive, "seek"):
        archive.seek(0)  # type: ignore[union-attr]

    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True)

    staged_uploads = staging_dir / "uploads"
    staged_uploads.mkdir()
    staged_database = staging_dir / DATABASE_NAME

    try:
        with zipfile.ZipFile(archive) as zf:
            members = _safe_members(zf)
            if not any(info.filename == DATABASE_NAME for info in members):
                raise ArchiveError(
                    "This backup contains no database, so there is nothing to restore."
                )
            for info in members:
                if info.filename == MANIFEST_NAME:
                    continue
                if info.filename == DATABASE_NAME:
                    with zf.open(info) as src, open(staged_database, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    continue
                name = info.filename[len(UPLOADS_PREFIX) :]
                with zf.open(info) as src, open(staged_uploads / name, "wb") as dst:
                    shutil.copyfileobj(src, dst)

        if _revision_of(staged_database) is None:
            raise ArchiveError(
                "This backup's database could not be opened, so it is damaged."
            )

        if callable(dispose):
            dispose()

        displaced_db = database_path.with_name(database_path.name + PRE_RESTORE_SUFFIX)
        if database_path.exists():
            os.replace(database_path, displaced_db)
        os.replace(staged_database, database_path)

        # A stale write-ahead log beside a replaced database is read as that
        # database's uncommitted tail, which is a corrupt read rather than an
        # error. They belong to the file that has just been moved aside.
        for sidecar in ("-wal", "-shm"):
            Path(str(database_path) + sidecar).unlink(missing_ok=True)

        _replace_directory(staged_uploads, upload_dir)
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)

    return manifest
