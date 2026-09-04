"""Reading a DerbyNet roster out of its tables (#661).

DerbyNet's own SQLite schema is the same table family GPRM's is — its
"Sharing a Database With GPRM" and "Advanced Database Set-Up" guides
describe the two as deliberately compatible, and `domain/gprm.py`'s own
docstring explains where that comes from and what it reads. `RegistrationInfo`
holds the racers, `Classes` the groups, `Ranks` the subgroups within a
class — identically for both programs — so this module does not duplicate
`gprm.roster_from_tables`. It calls it.

## What DerbyNet has that GPRM does not: `Partitions`

DerbyNet adds one table GPRM's schema carries no equivalent of:
`Partitions` (`partitionid`, `name`, `rankid`, `sortorder`) — the operator's
own den list, under whatever word DerbyNet's settings call it (`Den` is its
own default; the label itself is configurable there too, the same idea
Trusty Track's own terminology is). Reading DerbyNet's source
(`website/inc/partitions.inc`, `website/ajax/action.partition.*.inc`), a
partition is not a third level of grouping — it is a *view* onto a `Rank`
created and kept in step alongside it: creating a partition creates a
same-named rank for it, and DerbyNet's own "Renaming a partition should
rename the corresponding group" comment says the two stay matched on every
rename. Under DerbyNet's own default grouping rule ("by-partition"), the
partition's `Class` is created the same way, with the same name again — so
for the ordinary DerbyNet database, `Class.class == Rank.rank ==
Partition.name` for every den, and `gprm.roster_from_tables`'s existing
"a rank named the same as its class gets no category" rule (written for
GPRM's own analogous default) already resolves the group correctly with
`division=None`, exactly as it should: a den is a den, not a den inside a
category naming itself.

What reading `Ranks` alone cannot promise is that its name and sort
position still match the `Partitions` row that named it — independent
columns, normally identical, not guaranteed to stay that way across a
hand-edited database or an older schema version. Where a `Partitions` row
names a rank, this module prefers *that* name: `Partitions` is the table
DerbyNet's own den-management screen actually writes to, where `Ranks` is
the compatibility layer the GPRM sharing rides on. A rank with no matching
partition — an award-only subgroup, or a GPRM file with no `Partitions`
table at all — is read exactly as `gprm.roster_from_tables` already reads
it.

Not attempted here: DerbyNet's alternate grouping rules ("one-group",
"custom", read from its own `RaceInfo` key-value table). Under those, a
den's `Class` may not carry a meaningful category — every den could share
one pack-wide class — and `gprm.roster_from_tables`'s class-as-category
rule would then attach that shared name to every group as noise. Reading
`RaceInfo` to detect this is future work if a real file shows it matters;
the ordinary default is what this stage answers for.

## How sure this is

No DerbyNet database was available to test this against — the same
limitation #618's own docstring names for GPRM, and for the same reason:
this is read from DerbyNet's own schema and source files, not from a real
backup a pack actually raced with. `backend/tests/roster_imports/`'s
DerbyNet fixture is synthesised the same way its GPRM one is, and says so
in the same `NOTICE.md`. The preview screen tells the operator the mapping
is inferred for exactly this reason — it is worth a second look before
confirming, not assumed correct.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from backend.domain.gprm import SUBGROUPS_TABLE, TableSet, looks_like_gprm
from backend.domain.gprm import roster_from_tables as _gprm_roster_from_tables
from backend.domain.roster_import import ParsedRoster

Row = Mapping[str, object]

#: DerbyNet's own den table — see the module docstring for what it means
#: and why reading `Ranks` alone already gets the ordinary case right.
PARTITIONS_TABLE = "Partitions"

PROGRAM_NAME = "DerbyNet"


def looks_like_derbynet(tables: TableSet) -> bool:
    """Whether these tables are the DerbyNet/GPRM family at all.

    The same question `gprm.looks_like_gprm` asks — DerbyNet's schema is
    that family, so there is nothing DerbyNet-specific to check for here.
    Kept as its own name because the caller is asking about a DerbyNet
    upload and a reader should not have to know the two questions are
    identical to trust that this one was actually asked.
    """
    return looks_like_gprm(tables)


def _row_key(row: Row, name: str) -> str | None:
    """The row's own key spelling `name`, matched case-insensitively — the
    same tolerance every column in `gprm.py` gets via `_lower`.
    """
    for key in row:
        if key.lower() == name:
            return key
    return None


def _as_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else None


def _partition_names_by_rank(tables: TableSet) -> dict[int, str]:
    """`{rankid: the partition's own name}`, from DerbyNet's `Partitions`
    table — empty when the table is absent (a GPRM file, or an older
    DerbyNet schema) so the caller can skip the rest of the override
    entirely.

    Normally one partition per rank; if a database has more than one (only
    reachable through DerbyNet's "custom" grouping rule), the lowest
    `partitionid` wins, for a deterministic answer rather than one that
    depends on row order.
    """
    if not tables.has_table(PARTITIONS_TABLE):
        return {}
    names: dict[int, str] = {}
    chosen_partition_id: dict[int, int] = {}
    for raw in tables.rows(PARTITIONS_TABLE):
        rankid_key = _row_key(raw, "rankid")
        name_key = _row_key(raw, "name")
        if rankid_key is None or name_key is None:
            continue
        rank_id = _as_int(raw[rankid_key])
        if rank_id is None or raw[name_key] is None:
            continue
        name = str(raw[name_key]).strip()
        if not name:
            continue
        partitionid_key = _row_key(raw, "partitionid")
        partition_id = _as_int(raw[partitionid_key]) if partitionid_key else None
        current = chosen_partition_id.get(rank_id)
        if current is not None and partition_id is not None and partition_id >= current:
            continue
        names[rank_id] = name
        if partition_id is not None:
            chosen_partition_id[rank_id] = partition_id
    return names


class _PartitionNamedTables:
    """A `TableSet` that renames each `Ranks` row to its `Partitions` name,
    when one exists — every other table passes through untouched.

    This is the whole of DerbyNet's `Partitions` handling: rather than
    teaching `gprm._read_ranks` a second naming rule, the rows it reads are
    renamed before it ever sees them, so `gprm.roster_from_tables` needs no
    DerbyNet-specific branch at all.
    """

    def __init__(self, tables: TableSet, names_by_rank: Mapping[int, str]) -> None:
        self._tables = tables
        self._names_by_rank = names_by_rank

    def has_table(self, name: str) -> bool:
        return self._tables.has_table(name)

    def rows(self, name: str) -> Sequence[Row]:
        rows = self._tables.rows(name)
        if name.lower() != SUBGROUPS_TABLE.lower() or not self._names_by_rank:
            return rows
        renamed: list[Row] = []
        for raw in rows:
            rankid_key = _row_key(raw, "rankid")
            rank_key = _row_key(raw, "rank")
            rank_id = _as_int(raw[rankid_key]) if rankid_key else None
            override = self._names_by_rank.get(rank_id) if rank_id is not None else None
            if rank_key is None or override is None:
                renamed.append(raw)
                continue
            new_row = dict(raw)
            new_row[rank_key] = override
            renamed.append(new_row)
        return renamed


def roster_from_derbynet_tables(
    tables: TableSet, vehicle_word: str = "Car"
) -> ParsedRoster:
    """The roster these DerbyNet tables describe.

    `gprm.roster_from_tables` does the actual mapping — see the module
    docstring for why a `Partitions` table needs no rule of its own beyond
    the renaming this applies first.
    """
    names_by_rank = _partition_names_by_rank(tables)
    effective_tables: TableSet = (
        _PartitionNamedTables(tables, names_by_rank) if names_by_rank else tables
    )
    return _gprm_roster_from_tables(
        effective_tables, vehicle_word, program_name=PROGRAM_NAME
    )
