"""Backing the event up and putting it back (#176).

The service is exercised against a temporary data directory rather than the
install's own, which is what `backup.py` taking an engine and two paths is for.
The endpoint tests cover the half that cannot be reached that way: who is
allowed to call it, and that a refusal leaves the running event alone.
"""

from __future__ import annotations

import io
import sqlite3
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from backend.api import auth
from backend.db import models
from backend.db.database import Base, known_revisions
from backend.services import backup


def _head_revision() -> str:
    from alembic.script import ScriptDirectory

    from backend.db.database import _alembic_config

    return ScriptDirectory.from_config(_alembic_config()).get_current_head()


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    (tmp_path / "uploads").mkdir()
    (tmp_path / "staging").mkdir()
    return tmp_path


@pytest.fixture
def source_engine(data_dir: Path):
    """A real file-backed database, stamped at the current head."""
    path = data_dir / "trusty-track.db"
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR)"))
        connection.execute(
            text("INSERT INTO alembic_version VALUES (:rev)"), {"rev": _head_revision()}
        )
        connection.execute(
            text("INSERT INTO groups (name, debug_mode) VALUES ('Pack 42', 0)")
        )
    yield engine
    engine.dispose()


def _make_archive(data_dir: Path, source_engine) -> Path:
    archive = data_dir / "backup.zip"
    backup.write_archive(
        archive,
        engine=source_engine,
        upload_dir=data_dir / "uploads",
        app_version="1.2.3",
        staging_dir=data_dir / "staging",
    )
    return archive


class TestWritingAnArchive:
    def test_it_holds_the_database_the_photos_and_a_manifest(
        self, data_dir: Path, source_engine
    ) -> None:
        (data_dir / "uploads" / "racer.png").write_bytes(b"a photograph")
        (data_dir / "uploads" / "car.png").write_bytes(b"another")

        manifest = _make_archive(data_dir, source_engine)
        with zipfile.ZipFile(data_dir / "backup.zip") as zf:
            names = set(zf.namelist())

        assert names == {
            "manifest.json",
            "trusty-track.db",
            "uploads/racer.png",
            "uploads/car.png",
        }
        assert manifest.exists()

    def test_the_manifest_records_the_schema_the_archive_actually_holds(
        self, data_dir: Path, source_engine
    ) -> None:
        # Read out of the archived database rather than asserted by the writer:
        # the revision is what the schema is keyed on, so it has to come from
        # the thing being described.
        manifest = backup.write_archive(
            data_dir / "backup.zip",
            engine=source_engine,
            upload_dir=data_dir / "uploads",
            app_version="1.2.3",
            staging_dir=data_dir / "staging",
        )
        assert manifest.schema_revision == _head_revision()
        assert manifest.app_version == "1.2.3"
        assert manifest.format == backup.ARCHIVE_FORMAT

    def test_the_snapshot_opens_and_holds_the_rows(
        self, data_dir: Path, source_engine
    ) -> None:
        _make_archive(data_dir, source_engine)
        with zipfile.ZipFile(data_dir / "backup.zip") as zf:
            (data_dir / "extracted.db").write_bytes(zf.read("trusty-track.db"))

        connection = sqlite3.connect(data_dir / "extracted.db")
        try:
            assert connection.execute("SELECT name FROM groups").fetchall() == [
                ("Pack 42",)
            ]
        finally:
            connection.close()

    def test_it_survives_an_install_that_has_taken_no_photographs(
        self, data_dir: Path, source_engine
    ) -> None:
        manifest = backup.write_archive(
            data_dir / "backup.zip",
            engine=source_engine,
            upload_dir=data_dir / "missing-entirely",
            app_version="1.2.3",
            staging_dir=data_dir / "staging",
        )
        assert manifest.upload_count == 0

    def test_it_leaves_no_snapshot_behind(self, data_dir: Path, source_engine) -> None:
        # The staging directory is inside the data directory, which on a Pi is
        # the SD card the backup exists to protect.
        _make_archive(data_dir, source_engine)
        assert list((data_dir / "staging").iterdir()) == []


class TestRefusingAnArchive:
    """Everything refusable is refused before anything is moved."""

    def _restore(self, archive, data_dir: Path, revisions=None):
        return backup.restore_archive(
            archive,
            database_path=data_dir / "trusty-track.db",
            upload_dir=data_dir / "uploads",
            staging_dir=data_dir / "staging",
            known_revisions=revisions if revisions is not None else known_revisions(),
        )

    def test_a_file_that_is_not_a_zip(self, data_dir: Path) -> None:
        with pytest.raises(backup.ArchiveError, match="not a readable"):
            self._restore(io.BytesIO(b"this is a photograph, not a backup"), data_dir)

    def test_a_zip_with_no_manifest(self, data_dir: Path) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("something.txt", "hello")
        buffer.seek(0)
        with pytest.raises(backup.ArchiveError, match="no manifest"):
            self._restore(buffer, data_dir)

    def test_an_archive_from_a_newer_trusty_track(
        self, data_dir: Path, source_engine
    ) -> None:
        # The case that matters. A newer archive holds a schema this install has
        # no migrations for, and there is no downgrade path to walk it back —
        # restoring it would leave a database the app cannot open.
        archive = _make_archive(data_dir, source_engine)
        with pytest.raises(backup.ArchiveError, match="newer version"):
            self._restore(archive, data_dir, revisions={"0001_baseline"})

    def test_an_older_archive_is_accepted(self, data_dir: Path, source_engine) -> None:
        # The mirror of the above, and the reason the check is "known" rather
        # than "equal to head": an older archive is restored and then upgraded
        # forward, which is the path a legacy database already takes.
        archive = _make_archive(data_dir, source_engine)
        manifest = backup.read_manifest(archive)
        backup.check_restorable(
            manifest, {manifest.schema_revision, "some_later_revision"}
        )

    def test_an_archive_whose_database_disagrees_with_its_manifest(
        self, data_dir: Path, source_engine
    ) -> None:
        # A manifest is only a claim the archive makes about itself. The
        # database packaged alongside it is what actually becomes live, so a
        # manifest that claims a known revision must not be enough to let a
        # database at an unknown one through — tampered, hand-edited, or
        # built by a tool that never ran the real writer.
        archive = _make_archive(data_dir, source_engine)
        with zipfile.ZipFile(archive) as zf:
            raw_db = zf.read("trusty-track.db")

        tampered_db = data_dir / "tampered.db"
        tampered_db.write_bytes(raw_db)
        connection = sqlite3.connect(tampered_db)
        try:
            connection.execute(
                "UPDATE alembic_version SET version_num = ?", ("9999_future",)
            )
            connection.commit()
        finally:
            connection.close()

        buffer = io.BytesIO()
        with (
            zipfile.ZipFile(archive) as source_zf,
            zipfile.ZipFile(buffer, "w") as tampered_zf,
        ):
            tampered_zf.writestr("manifest.json", source_zf.read("manifest.json"))
            tampered_zf.write(tampered_db, "trusty-track.db")
        buffer.seek(0)

        manifest = backup.read_manifest(buffer)
        # The manifest itself still claims a known revision — the fast
        # pre-check alone would let this through.
        assert manifest.schema_revision != "9999_future"
        buffer.seek(0)

        with pytest.raises(backup.ArchiveError, match="schema 9999_future"):
            self._restore(buffer, data_dir)

    def test_a_member_that_would_write_outside_the_data_directory(
        self, data_dir: Path, source_engine
    ) -> None:
        archive = _make_archive(data_dir, source_engine)
        with zipfile.ZipFile(archive, "a") as zf:
            zf.writestr("uploads/../../etc/passwd", "nope")
        with pytest.raises(backup.ArchiveError, match="unexpected file"):
            self._restore(archive, data_dir)

    def test_an_archive_with_no_database(self, data_dir: Path) -> None:
        buffer = io.BytesIO()
        manifest = backup.Manifest(
            format=backup.ARCHIVE_FORMAT,
            schema_revision=_head_revision(),
            app_version="1.2.3",
            created_at="2026-08-08T00:00:00+00:00",
            upload_count=0,
        )
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("manifest.json", manifest.to_json())
        buffer.seek(0)
        with pytest.raises(backup.ArchiveError, match="no database"):
            self._restore(buffer, data_dir)

    def test_a_refusal_leaves_the_running_event_untouched(self, data_dir: Path) -> None:
        live = data_dir / "trusty-track.db"
        live.write_bytes(b"the event, mid-flight")
        (data_dir / "uploads" / "racer.png").write_bytes(b"a photograph")

        with pytest.raises(backup.ArchiveError):
            self._restore(io.BytesIO(b"not a backup"), data_dir)

        assert live.read_bytes() == b"the event, mid-flight"
        assert (data_dir / "uploads" / "racer.png").read_bytes() == b"a photograph"


class TestRestoring:
    def _restore(self, archive, data_dir: Path, **kwargs):
        return backup.restore_archive(
            archive,
            database_path=data_dir / "trusty-track.db",
            upload_dir=data_dir / "uploads",
            staging_dir=data_dir / "staging",
            known_revisions=known_revisions(),
            **kwargs,
        )

    @pytest.fixture
    def archive(self, data_dir: Path, source_engine) -> Path:
        (data_dir / "uploads" / "racer.png").write_bytes(b"the archived photograph")
        archive = data_dir / "backup.zip"
        backup.write_archive(
            archive,
            engine=source_engine,
            upload_dir=data_dir / "uploads",
            app_version="1.2.3",
            staging_dir=data_dir / "staging",
        )
        source_engine.dispose()
        return archive

    def test_the_database_comes_back(self, data_dir: Path, archive: Path) -> None:
        (data_dir / "trusty-track.db").write_bytes(b"a later, unwanted state")
        self._restore(archive, data_dir)

        connection = sqlite3.connect(data_dir / "trusty-track.db")
        try:
            assert connection.execute("SELECT name FROM groups").fetchall() == [
                ("Pack 42",)
            ]
        finally:
            connection.close()

    def test_the_photographs_come_back(self, data_dir: Path, archive: Path) -> None:
        (data_dir / "uploads" / "racer.png").write_bytes(b"a later, wrong photograph")
        (data_dir / "uploads" / "stray.png").write_bytes(b"not in the archive")

        self._restore(archive, data_dir)

        assert (data_dir / "uploads" / "racer.png").read_bytes() == (
            b"the archived photograph"
        )
        # The directory is replaced rather than merged: a photo taken after the
        # backup belongs to the state being discarded.
        assert not (data_dir / "uploads" / "stray.png").exists()

    def test_what_was_replaced_is_kept_beside_it(
        self, data_dir: Path, archive: Path
    ) -> None:
        # One level of undo, for the operator who restores the wrong file and
        # notices immediately.
        (data_dir / "trusty-track.db").write_bytes(b"a later, unwanted state")
        (data_dir / "uploads" / "stray.png").write_bytes(b"not in the archive")

        self._restore(archive, data_dir)

        assert (data_dir / "trusty-track.db.pre-restore").read_bytes() == (
            b"a later, unwanted state"
        )
        assert (data_dir / "uploads.pre-restore" / "stray.png").exists()

    def test_a_second_restore_does_not_accumulate_copies(
        self, data_dir: Path, archive: Path
    ) -> None:
        self._restore(archive, data_dir)
        self._restore(archive, data_dir)
        assert not (data_dir / "uploads.pre-restore.pre-restore").exists()

    def test_a_stale_write_ahead_log_is_removed(
        self, data_dir: Path, archive: Path
    ) -> None:
        # A -wal left beside a replaced database is read as that database's
        # uncommitted tail: a corrupt read rather than an error.
        (data_dir / "trusty-track.db").write_bytes(b"a later state")
        (data_dir / "trusty-track.db-wal").write_bytes(b"its write-ahead log")
        (data_dir / "trusty-track.db-shm").write_bytes(b"and its shared memory")

        self._restore(archive, data_dir)

        assert not (data_dir / "trusty-track.db-wal").exists()
        assert not (data_dir / "trusty-track.db-shm").exists()

    def test_the_connection_pool_is_dropped_before_the_swap(
        self, data_dir: Path, archive: Path
    ) -> None:
        # SQLAlchemy pools connections. Replacing the file underneath an open
        # one leaves it addressing a database that no longer exists, so the
        # order matters: dispose, then swap.
        order: list[str] = []
        original = backup.os.replace

        def record_replace(src, dst):
            order.append("replace")
            return original(src, dst)

        backup.os.replace = record_replace
        try:
            self._restore(archive, data_dir, dispose=lambda: order.append("dispose"))
        finally:
            backup.os.replace = original

        assert order[0] == "dispose"

    def test_the_staging_directory_is_cleaned_up(
        self, data_dir: Path, archive: Path
    ) -> None:
        self._restore(archive, data_dir)
        assert not (data_dir / "staging").exists()


class TestWhoMayCall:
    """The role policy guards GraphQL mutations, and these are not GraphQL."""

    @pytest.fixture(autouse=True)
    def isolated_data_dir(self, tmp_path: Path, monkeypatch, source_engine):
        """Point the endpoints at a temporary install rather than the suite's.

        Not fastidiousness. The shared test data directory accumulates every
        image any test has ever uploaded, and an endpoint whose job is to zip
        that directory is the first thing in the suite to notice — the first
        run of this file took minutes and was killed, archiving several
        gigabytes of other tests' leftovers three times over.
        """
        uploads = tmp_path / "endpoint-uploads"
        uploads.mkdir()
        (uploads / "racer.png").write_bytes(b"a photograph")
        monkeypatch.setattr("backend.api.main.UPLOAD_DIR", str(uploads))
        monkeypatch.setattr("backend.api.main.DATA_DIR", str(tmp_path))
        monkeypatch.setattr("backend.api.main.engine", source_engine)
        monkeypatch.setattr(
            "backend.api.main.database_path",
            lambda: Path(source_engine.url.database),
        )
        # A refused restore stops the timer managers and rebuilds them, and
        # `init_db` would migrate the install's own database rather than this
        # one. Neither belongs to what these tests are asking.
        monkeypatch.setattr("backend.api.main.init_db", lambda: None)
        monkeypatch.setattr("backend.api.main.TIMER_MANAGERS", {})

    def test_an_unconfigured_install_may_back_up(self, client) -> None:
        # No PIN set means no enforcement anywhere (#15), and backup is no
        # exception — an install that has never set one keeps working.
        assert client.get("/api/backup").status_code == 200

    def test_a_viewer_may_not_back_up(self, client, db) -> None:
        # The archive holds every racer's name and photograph.
        db.add(models.Group(name="Pack 42", operator_pin_hash=auth.hash_pin("1234")))
        db.commit()
        assert client.get("/api/backup").status_code == 403

    def test_the_operator_may_back_up(self, client, db) -> None:
        db.add(models.Group(name="Pack 42", operator_pin_hash=auth.hash_pin("1234")))
        db.commit()
        response = client.get("/api/backup", headers={auth.PIN_HEADER: "1234"})
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"

    def test_the_check_in_desk_may_not_restore(self, client, db) -> None:
        db.add(
            models.Group(
                name="Pack 42",
                operator_pin_hash=auth.hash_pin("1234"),
                checkin_pin_hash=auth.hash_pin("5678"),
            )
        )
        db.commit()
        response = client.post(
            "/api/backup/restore",
            files={"file": ("backup.zip", b"anything", "application/zip")},
            headers={auth.PIN_HEADER: "5678"},
        )
        assert response.status_code == 403

    def test_a_damaged_archive_is_refused_with_a_readable_reason(self, client) -> None:
        response = client.post(
            "/api/backup/restore",
            files={"file": ("holiday.jpg", b"not a backup", "image/jpeg")},
        )
        assert response.status_code == 400
        assert "not a readable Trusty Track backup" in response.json()["detail"]

    def test_both_path_prefixes_are_served(self, client) -> None:
        # The Vite dev proxy strips `/api`, so registering only that form works
        # in production and 404s in development — the same trap the printables
        # barcode carries a comment about.
        assert client.get("/backup").status_code == 200
