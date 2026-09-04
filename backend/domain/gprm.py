"""Reading a GrandPrix Race Manager roster out of its tables (#618).

GPRM has been the dominant commercial derby program for a quarter of a
century, and a pack moving from it has years of rosters, car numbers and den
assignments in its database. This is the rule for turning those tables into
a `ParsedRoster`. It sees plain rows — a `TableSet` is anything that can say
whether a table exists and hand back its rows as mappings — and no file, so
`services/importers/gprm.py` owns opening the database and this stays
importable with nothing but the standard library.

## Where the schema came from, and how sure it is

No GPRM database was available to write this against. What it is written
against is DerbyNet: DerbyNet's own database format was designed to be
*shared* with GPRM — its "Sharing a Database With GPRM" and "Advanced
Database Set-Up" guides walk an operator through pointing DerbyNet at the
GPRM file — and its schema (`website/sql/access/schema.inc` for the Access
form, `website/sql/sqlite/schema.inc` for the SQLite one; MIT, © Jeff
Piazza) is the GPRM-compatible one. Two facts from those guides shape this
module:

- **GPRM v18 (2018) and later store a SQLite database**, by default under
  `Documents\\Lisano Enterprises\\GrandPrix Race Manager\\Data` on Windows.
  Earlier versions used a Microsoft Access `.mdb`, with the same tables in
  PascalCase. Only the SQLite form is read today; the Access form is refused
  with a sentence saying so (see the service module).
- **The tables are the same family in both**: `RegistrationInfo` holds the
  racers, `Classes` the groups, `Ranks` the subgroups within a class. Column
  names are read case-insensitively because the two forms differ only in
  case (`CarNumber` against `carnumber`), and a SQLite file written by an
  older program may carry either.

Which columns GPRM itself populates — as against those DerbyNet added to its
copy of the schema — is *inferred*, and each optional column is read as
absent-means-absent so a file without it still imports. `Exclude` and
`CarWeight` in particular are read if present and not assumed. The fixture
under `backend/tests/roster_imports/` is synthesised from the schema, not
recorded from a GPRM install; a real file from a pack that has one would be
the first evidence here that did not come from us, exactly as
`timer_recordings/` was for the timers.

## The mapping

GPRM's `Class` is the unit that races together (its rounds and rosters are
per class); its `Rank` is a subgroup within one, used for awards. Trusty
Track has one level, a `RacingGroup`, plus a free-text category
(`division`). The rule: **a racing group per rank, categorised by its
class** — the rank is the finer unit, which is where a den lives, and the
class is the broader label the den sits under. Two adjustments:

- A rank named the same as its class (GPRM's own default, one rank per
  class carrying the class's name) gets no category — "Wolves" under
  "Wolves" is not a classification.
- A rank name shared across two classes ("Den 1" under both Wolves and
  Bears) is prefixed with its class so the two groups stay distinct;
  `importRacers` matches racing groups by name, and a merge here would be
  silent.

A class with no ranks at all still becomes a group, and a racer whose rank
no longer exists falls back to their class rather than to no group.

## Shared with DerbyNet (#661)

Everything above reads the table family both programs write, so
`domain/derbynet.py` calls `roster_from_tables` directly rather than
duplicating it — see that module for what DerbyNet adds (a `Partitions`
table naming its own dens) and why the mapping above already gets a
DerbyNet database's groups right without reading it. `program_name` below
exists only so the one problem message naming a program says the right
one.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Protocol

from backend.domain.roster_import import (
    ImportedGroup,
    ImportedRacer,
    ImportProblem,
    ParsedRoster,
    duplicate_number_problems,
)

Row = Mapping[str, object]


class TableSet(Protocol):
    """A database as a set of named tables, however it is stored.

    `has_table` and `rows` match table names case-insensitively, since the
    Access form writes `RegistrationInfo` and the SQLite form has been seen
    both ways. Row keys may be in any case; this module normalises them.
    """

    def has_table(self, name: str) -> bool: ...

    def rows(self, name: str) -> Sequence[Row]: ...


#: The one table a roster cannot be read without.
RACERS_TABLE = "RegistrationInfo"
GROUPS_TABLE = "Classes"
SUBGROUPS_TABLE = "Ranks"

#: Column names that could hold a car's weight. DerbyNet's schema has none,
#: so this is a guess at what a GPRM export might carry; a file without any
#: of them imports with no weights, which is what the CSV path does too.
WEIGHT_COLUMNS = ("carweight", "weight")

_TRUTHY_STRINGS = frozenset({"true", "yes", "y", "1", "-1", "x", "passed", "pass"})


def looks_like_gprm(tables: TableSet) -> bool:
    """Whether these tables are the GPRM/DerbyNet family at all."""
    return tables.has_table(RACERS_TABLE)


def _lower(row: Row) -> dict[str, object]:
    return {key.lower(): value for key, value in row.items()}


def _text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    text = str(value).strip()
    return text or None


def _truthy(value: object) -> bool:
    """A BIT/TINYINT/"True" column, whichever form the file uses.

    Access stores a set BIT as -1, SQLite as 1, and a hand-exported file may
    carry the words. Anything not recognised is False, the same fallback the
    CSV path's yes/no reading makes.
    """
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, bytes):
        return any(value)
    return str(value).strip().lower() in _TRUTHY_STRINGS


def _integer(value: object) -> int | None:
    """A whole number, or None when the value is not one.

    Distinct from "absent": the caller decides whether an unreadable value
    is worth a sentence, and this only says whether it read.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number.is_integer() else None


def _number(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def _sort_key(row: dict[str, object], id_column: str) -> tuple[int, int]:
    """`sortorder` when the file has one, then the row's own id.

    Both DerbyNet schema forms added `sortorder` in a later version, so an
    older file has none and its groups come out in creation order.
    """
    order = _integer(row.get("sortorder"))
    row_id = _integer(row.get(id_column))
    return (order if order is not None else 0, row_id if row_id is not None else 0)


def _read_classes(tables: TableSet) -> list[tuple[int, str]]:
    """`(classid, name)` in display order, skipping DerbyNet's aggregates.

    DerbyNet builds an "aggregate class" (a class whose `constituents` names
    other classes) for a combined round, and it holds no racers of its own.
    GPRM has no such column, so this costs a GPRM file nothing and keeps a
    DerbyNet file (#661) from importing a phantom group.
    """
    if not tables.has_table(GROUPS_TABLE):
        return []
    classes: list[tuple[tuple[int, int], int, str]] = []
    for raw in tables.rows(GROUPS_TABLE):
        row = _lower(raw)
        class_id = _integer(row.get("classid"))
        name = _text(row.get("class"))
        if class_id is None or name is None:
            continue
        if _text(row.get("constituents")) is not None:
            continue
        classes.append((_sort_key(row, "classid"), class_id, name))
    classes.sort()
    return [(class_id, name) for _, class_id, name in classes]


def _read_ranks(tables: TableSet) -> list[tuple[int, int | None, str]]:
    """`(rankid, classid, name)` in display order."""
    if not tables.has_table(SUBGROUPS_TABLE):
        return []
    ranks: list[tuple[tuple[int, int], int, int | None, str]] = []
    for raw in tables.rows(SUBGROUPS_TABLE):
        row = _lower(raw)
        rank_id = _integer(row.get("rankid"))
        name = _text(row.get("rank"))
        if rank_id is None or name is None:
            continue
        ranks.append(
            (_sort_key(row, "rankid"), rank_id, _integer(row.get("classid")), name)
        )
    ranks.sort()
    return [(rank_id, class_id, name) for _, rank_id, class_id, name in ranks]


def _weight(row: dict[str, object]) -> float | None:
    for column in WEIGHT_COLUMNS:
        if column in row:
            weight = _number(row[column])
            if weight is not None and weight > 0:
                return weight
    return None


def roster_from_tables(
    tables: TableSet,
    vehicle_word: str = "Car",
    program_name: str = "GrandPrix Race Manager",
) -> ParsedRoster:
    """The roster these tables describe.

    Raises nothing: a table that is missing means an empty roster with no
    groups, and `looks_like_gprm` is the caller's question to ask first. Row
    problems come out in the order an operator scrolling the racers would
    meet them, then the duplicates, then one line about photographs.

    `program_name` names whoever wrote the file, for the one problem message
    that says so (#661) — DerbyNet's own importer passes its own name
    through here rather than this module growing a second, near-identical
    copy of the photo-warning sentence for a table family it already reads.
    """
    classes = _read_classes(tables)
    class_name = dict(classes)
    # Ranks in the order a GPRM screen lists them: under their class, in the
    # classes' order, then by their own `sortorder`. A rank whose class is
    # gone sorts after every class that exists.
    class_position = {class_id: index for index, (class_id, _) in enumerate(classes)}
    ranks = sorted(
        _read_ranks(tables),
        key=lambda rank: class_position.get(rank[1] or -1, len(class_position)),
    )

    # Rank names shared across classes need their class as a prefix; the
    # count is over every rank so the *first* holder is prefixed too, or the
    # two would still differ only by luck of ordering.
    holders_by_name: dict[str, int] = {}
    for _, _, rank_name in ranks:
        key = rank_name.casefold()
        holders_by_name[key] = holders_by_name.get(key, 0) + 1

    groups: list[ImportedGroup] = []
    group_by_rank: dict[int, str] = {}
    group_by_class: dict[int, str] = {}
    ranked_classes: set[int] = set()

    for rank_id, class_id, rank_name in ranks:
        parent = class_name.get(class_id) if class_id is not None else None
        same_as_class = parent is not None and parent.casefold() == rank_name.casefold()
        shared = holders_by_name[rank_name.casefold()] > 1
        name = (
            f"{parent} {rank_name}"
            if shared and parent and not same_as_class
            else rank_name
        )
        division = None if same_as_class or parent is None else parent
        groups.append(ImportedGroup(name=name, division=division))
        group_by_rank[rank_id] = name
        if class_id is not None:
            ranked_classes.add(class_id)

    for class_id, name in classes:
        if class_id in ranked_classes:
            continue
        groups.append(ImportedGroup(name=name))
        group_by_class[class_id] = name

    # A class that has ranks is still what a racer falls back to when their
    # rank is gone — a group named for the class, created only if needed.
    def class_fallback(class_id: int) -> str | None:
        if class_id in group_by_class:
            return group_by_class[class_id]
        name = class_name.get(class_id)
        if name is None:
            return None
        groups.append(ImportedGroup(name=name))
        group_by_class[class_id] = name
        return name

    racers: list[ImportedRacer] = []
    problems: list[ImportProblem] = []
    with_photos = 0

    raw_rows = tables.rows(RACERS_TABLE) if tables.has_table(RACERS_TABLE) else ()
    ordered = sorted(
        (_lower(raw) for raw in raw_rows),
        key=lambda row: _integer(row.get("racerid")) or 0,
    )
    for row in ordered:
        racer_id = _integer(row.get("racerid"))
        source_id = str(racer_id) if racer_id is not None else None
        first_name = _text(row.get("firstname"))
        last_name = _text(row.get("lastname"))
        if first_name is None or last_name is None:
            problems.append(
                ImportProblem(
                    message=(
                        "Missing a first or last name — this racer will be skipped."
                    ),
                    source_id=source_id,
                )
            )
            continue

        raw_number = row.get("carnumber")
        car_number: int | None = _integer(raw_number)
        if car_number is not None and car_number <= 0:
            # 0 is how a numbered column says "not numbered yet"; a negative
            # number is nothing a car has ever worn.
            car_number = None
        elif car_number is None and _text(raw_number) is not None:
            problems.append(
                ImportProblem(
                    message=(
                        f'{vehicle_word} number "{_text(raw_number)}" is not a whole '
                        "number — it will be left blank."
                    ),
                    source_id=source_id,
                )
            )

        group: str | None = None
        racer_rank = _integer(row.get("rankid"))
        racer_class = _integer(row.get("classid"))
        if racer_rank is not None and racer_rank in group_by_rank:
            group = group_by_rank[racer_rank]
        elif racer_class is not None:
            group = class_fallback(racer_class)
        if group is None and (racer_rank is not None or racer_class is not None):
            problems.append(
                ImportProblem(
                    message=(
                        f"{first_name} {last_name} is in a group the file no longer "
                        "describes — they will import with no group."
                    ),
                    source_id=source_id,
                )
            )

        if _text(row.get("imagefile")) or _text(row.get("carphoto")):
            with_photos += 1

        racers.append(
            ImportedRacer(
                first_name=first_name,
                last_name=last_name,
                car_number=car_number,
                car_name=_text(row.get("carname")),
                car_weight=_weight(row),
                passed_inspection=_truthy(row.get("passedinspection")),
                group=group,
                excluded_from_standings=_truthy(row.get("exclude")),
                source_id=source_id,
            )
        )

    problems.extend(duplicate_number_problems(racers, vehicle_word))

    if with_photos:
        # The database names the picture files; the pictures are beside it on
        # the other machine. Said once rather than per racer, since there is
        # nothing to do about it row by row.
        noun = "racer has" if with_photos == 1 else "racers have"
        problems.append(
            ImportProblem(
                message=(
                    f"{with_photos} {noun} photos in {program_name} that are stored "
                    "as separate files, not in the database — they will need "
                    "uploading again after the import."
                )
            )
        )

    return ParsedRoster(
        groups=tuple(groups), racers=tuple(racers), problems=tuple(problems)
    )
