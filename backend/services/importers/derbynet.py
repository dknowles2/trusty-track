"""Opening a DerbyNet database and reading its roster (#661).

This is the file half; `domain/derbynet.py` is the rule, and says where the
schema knowledge came from. One entry point, `parse_derbynet_database`,
which either returns a `ParsedRoster` or raises `RosterImportError` with the
sentence the operator should read — the same shape
`services/importers/gprm.py` already has for GPRM, sharing its
`open_sqlite_tables`/`file_kind` file layer since both write the same kind
of file.

**No Access-era refusal here, unlike GPRM's importer.** DerbyNet has always
been a web server backed by a single database file — SQLite by default,
though it also supports MySQL, which is not a file this importer could ever
be handed — so there is no older binary format to name and redirect away
from. One failure sentence covers "not a database at all" instead of GPRM's
two.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from backend.domain.derbynet import looks_like_derbynet, roster_from_derbynet_tables
from backend.domain.roster_import import ParsedRoster, RosterImportError
from backend.services.importers.sqlite_tables import file_kind, open_sqlite_tables

NOT_A_DATABASE_MESSAGE = (
    "That file is not a DerbyNet database. DerbyNet keeps its data as a "
    "single SQLite file — from its Administer Race page's Backup Database "
    "link, or the .sqlite file in its data directory."
)
NO_ROSTER_MESSAGE = (
    "That database has no racer table (RegistrationInfo), so it is not a "
    "DerbyNet database."
)


def parse_derbynet_database(
    path: Path | str, vehicle_word: str = "Car"
) -> ParsedRoster:
    """The roster in the DerbyNet database at `path`.

    `vehicle_word` reaches the problem sentences (#551), matching
    `parse_gprm_database`'s own parameter; the caller supplies the race's
    resolved word and the default is the built-in Scouting one.
    """
    file = Path(path)
    kind = file_kind(file)
    if kind != "sqlite":
        raise RosterImportError(NOT_A_DATABASE_MESSAGE)
    try:
        with open_sqlite_tables(file) as tables:
            if not looks_like_derbynet(tables):
                raise RosterImportError(NO_ROSTER_MESSAGE)
            return roster_from_derbynet_tables(tables, vehicle_word)
    except sqlite3.DatabaseError as error:
        # A file that starts like SQLite and is not one all the way through —
        # truncated, or a page of it overwritten.
        raise RosterImportError(NOT_A_DATABASE_MESSAGE) from error
