"""Opening a GrandPrix Race Manager database and reading its roster (#618).

This is the file half; `domain/gprm.py` is the rule and says where the
schema knowledge came from. One entry point, `parse_gprm_database`, which
either returns a `ParsedRoster` or raises `RosterImportError` with the
sentence the operator should read.

Two refusals, each with its own sentence, because the operator's next move
differs:

- **An Access `.mdb`** is what GPRM wrote before v18 (2018). It has the same
  tables, and reading it would need either `mdbtools` on the machine or a
  pure-Python Access parser — a dependency this stage does not take on. The
  message says what it is and that a current GPRM opens and re-saves it as
  SQLite, which is the route with no new software in it.
- **Anything else** is not a GPRM database at all: a CSV, a zip, a photo.

The parser takes a path rather than bytes: `sqlite3` opens files, not
buffers, and the mutation that arrives in a later stage writes its upload to
a temporary file before calling this — the same shape the backup restore
already uses for an uploaded archive.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from backend.domain.gprm import looks_like_gprm, roster_from_tables
from backend.domain.roster_import import ParsedRoster, RosterImportError
from backend.services.importers.sqlite_tables import file_kind, open_sqlite_tables

ACCESS_MESSAGE = (
    "This is a Microsoft Access database, the format GrandPrix Race Manager "
    "used before version 18 (2018). Open it in a current version of GPRM, which "
    "saves as SQLite, and import that file instead."
)
NOT_A_DATABASE_MESSAGE = (
    "That file is not a GrandPrix Race Manager database. GPRM keeps its data as "
    "a single SQLite file, by default under Documents > Lisano Enterprises > "
    "GrandPrix Race Manager > Data."
)
NO_ROSTER_MESSAGE = (
    "That database has no racer table (RegistrationInfo), so it is not a "
    "GrandPrix Race Manager database."
)


def parse_gprm_database(path: Path | str, vehicle_word: str = "Car") -> ParsedRoster:
    """The roster in the GPRM database at `path`.

    `vehicle_word` reaches the problem sentences (#551); the caller supplies
    the resolved one and the default is the built-in Scouting word.
    """
    file = Path(path)
    kind = file_kind(file)
    if kind == "access":
        raise RosterImportError(ACCESS_MESSAGE)
    if kind != "sqlite":
        raise RosterImportError(NOT_A_DATABASE_MESSAGE)
    try:
        with open_sqlite_tables(file) as tables:
            if not looks_like_gprm(tables):
                raise RosterImportError(NO_ROSTER_MESSAGE)
            return roster_from_tables(tables, vehicle_word)
    except sqlite3.DatabaseError as error:
        # A file that starts like SQLite and is not one all the way through —
        # truncated, or a page of it overwritten.
        raise RosterImportError(NOT_A_DATABASE_MESSAGE) from error
