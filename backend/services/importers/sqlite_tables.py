"""A SQLite file as a `domain.gprm.TableSet`, opened read-only.

GPRM from v18 on and DerbyNet both keep their database as a single SQLite
file, so one reader serves both importers. Everything here is about the file
and nothing about what its tables mean.

**Read-only is not a nicety.** The operator is handing over the only copy of
years of rosters; a parser that so much as creates a journal beside it has
touched something it should not. The connection is opened with `mode=ro`
through a URI, and `test_gprm_import.py` checks the bytes are unchanged after
a parse.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

from backend.domain.gprm import Row

#: The first sixteen bytes of every SQLite 3 database.
SQLITE_MAGIC = b"SQLite format 3\x00"

#: Microsoft Access files carry their engine name at offset 4: Jet for `.mdb`,
#: ACE for `.accdb`. Pre-v18 GPRM wrote the former.
ACCESS_MAGICS = (b"Standard Jet DB", b"Standard ACE DB")
_ACCESS_OFFSET = 4


def file_kind(path: Path) -> str:
    """`"sqlite"`, `"access"` or `"unknown"`, from the file's own header.

    By content rather than extension: GPRM's SQLite file is not necessarily
    named `.sqlite`, and a `.mdb` renamed to look right is still a `.mdb`.
    """
    with path.open("rb") as handle:
        header = handle.read(32)
    if header.startswith(SQLITE_MAGIC):
        return "sqlite"
    if any(header[_ACCESS_OFFSET:].startswith(magic) for magic in ACCESS_MAGICS):
        return "access"
    return "unknown"


class SqliteTables:
    """`TableSet` over an open connection. Table names match case-insensitively."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection
        self._connection.row_factory = sqlite3.Row
        self._names: dict[str, str] = {
            str(name).lower(): str(name)
            for (name,) in connection.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
            )
        }

    def has_table(self, name: str) -> bool:
        return name.lower() in self._names

    def rows(self, name: str) -> Sequence[Row]:
        actual = self._names.get(name.lower())
        if actual is None:
            return []
        quoted = actual.replace('"', '""')
        cursor = self._connection.execute(f'SELECT * FROM "{quoted}"')
        return [dict(row) for row in cursor.fetchall()]


@contextmanager
def open_sqlite_tables(path: Path) -> Iterator[SqliteTables]:
    """The file's tables, read-only, closed on exit."""
    uri = f"{path.resolve().as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    try:
        yield SqliteTables(connection)
    finally:
        connection.close()
