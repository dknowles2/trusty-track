# Sample databases from other derby programs

The `.sql` files here build the databases `test_gprm_import.py` and
`test_derbynet_import.py` parse. They are text rather than the binary files
themselves so a change to one is reviewable in a diff, and so the schema each
one claims is written out where a reader can check it.

**Neither file is a real pack's roster, and #694 does not close that gap.**
That still needs a real `.sqlite` from a GPRM or DerbyNet install, from any
pack, anonymised before it is committed — see "What would still close it"
below. What #694 changed is *how* `derbynet.sql`'s table shape is arrived at.

## Where the schema came from

**`derbynet.sql` is now schema-derived: its tables are transcribed from
DerbyNet's own committed DDL, not from reading its documentation.** Two
files, from [DerbyNet](https://github.com/jeffpiazza/derbynet) (MIT, ©
Jeff Piazza) at commit
[`ddf91117751d42fe1e331227d6cfd7e1dc928143`](https://github.com/jeffpiazza/derbynet/blob/ddf91117751d42fe1e331227d6cfd7e1dc928143/website/sql/sqlite/schema.inc):

- [`website/sql/sqlite/schema.inc`](https://github.com/jeffpiazza/derbynet/blob/ddf91117751d42fe1e331227d6cfd7e1dc928143/website/sql/sqlite/schema.inc) — `Classes`, `Ranks`, `RegistrationInfo`, `RaceInfo`
- [`website/sql/sqlite/partitions.inc`](https://github.com/jeffpiazza/derbynet/blob/ddf91117751d42fe1e331227d6cfd7e1dc928143/website/sql/sqlite/partitions.inc) — `Partitions`

**Not literally executed — resolved by hand, and shown as such.** No PHP
interpreter was available in the environment this work was done in
(`packaging/`-style userspace, no root). `schema.inc` builds each
`CREATE TABLE` string by concatenation with version-gated ternaries —
`expected_schema_version() < N ? "" : "..."` — and that function
([`website/inc/schema_version.inc`](https://github.com/jeffpiazza/derbynet/blob/ddf91117751d42fe1e331227d6cfd7e1dc928143/website/inc/schema_version.inc))
is a hardcoded `return 10` at this commit, not something read from a
database. Because the input to every ternary is therefore one fixed number,
resolving them by hand is deterministic rather than a guess: `derbynet.sql`'s
own header quotes each one and states which side it resolves to, so the
transcription can be checked against the real source line by line rather
than trusted. This is weaker than literally running the file — a
mistranscription is possible in a way a real PHP run would foreclose — and
stronger than writing the schema from the two prose guides ("Advanced
Database Set-Up", "Sharing a Database With GPRM") the way the previous
version of this fixture did, because every column name, type and
nullability constraint below is now a direct copy of a specific committed
line rather than a paraphrase of what a guide said the schema was "broadly
compatible" with.

`Partitions` needed no resolution at all — `partitions.inc` carries no
version gates — and it already matched our prior guess exactly, column for
column.

## What running it against our prior assumptions found

Every column `domain/gprm.py` and `domain/derbynet.py` actually read —
`Classes.class`/`sortorder`, `Ranks.rank`/`classid`/`sortorder`, and on
`RegistrationInfo` `racerid`/`carnumber`/`carname`/`lastname`/`firstname`/
`classid`/`rankid`/`passedinspection`/`imagefile`/`carphoto`/`exclude`, plus
`Partitions` in full — **match the real schema exactly**: same name, same
type, same nullability, same default. Nothing the importer reads was wrong.
That is a real result of running the DDL, not an absence of looking — say so
plainly rather than manufacturing a discrepancy where there isn't one.

Two things did differ, and neither is a bug because neither importer reads
either of them (`SqliteTables.rows` in
`backend/services/importers/sqlite_tables.py` reads a whole row by column
name, so an unread column is inert whatever it holds):

- **Five columns exist in the real schema that our prior fixture omitted**:
  `Classes.durable`, `Classes.ntrophies`, `Ranks.ntrophies`,
  `RegistrationInfo.checkin_time` and `RegistrationInfo.note`.
  `checkin_time` is recent — it was added at the same schema version
  (`REGISTRATION_CHECKIN_SCHEMA = 10`) this fixture resolves against, and it
  sits alongside the boolean `passedinspection` our importer already reads.
  Neither it nor `note` maps to anything in Trusty Track's model today; this
  is a documentation note, not something the importer needed fixing to
  handle, and `derbynet.sql` now carries both with values on one row so the
  fixture proves they come through as ordinary, harmlessly-unread values
  rather than merely omitting the temptation to choke on them.
- **`RegistrationInfo.partitionid` is `NOT NULL` in the real schema**; our
  prior fixture left it nullable. Every row in `derbynet.sql` already
  supplies one, so this changed nothing about the existing scenario — it
  matters only to a future reader extending the fixture with an
  unpartitioned racer, who will now get a real constraint violation instead
  of a silently-accepted row that no genuine DerbyNet database could hold.

`backend/tests/test_derbynet_import.py`'s "the real schema (#694)" section
pins both of the above, plus a test that runs `domain.gprm.roster_from_tables`
— the mapping GPRM's own importer uses — directly against this same
real-schema-derived database, bypassing `domain/derbynet.py`'s `Partitions`
rename. That is the closest either importer has come to running against a
database shaped like a real one, and it is what "run both importers against
it" in #694 means in practice: `domain/derbynet.py` adds nothing but that one
rename in front of `domain/gprm.py`'s mapping, so there is one shared code
path to exercise, not two.

## `gprm-v18.sql` is unchanged, and here is why it could not get the same treatment

**GrandPrix Race Manager has no public repository.** DerbyNet's schema is
real, committed, versioned source; GPRM's is a closed-source Windows
application, and nothing above closes that gap — `gprm-v18.sql` remains
exactly what it was: the same table family, inferred from DerbyNet's
documentation describing the two as deliberately compatible, not from
GPRM's own DDL. What changed is confidence by association rather than by
direct evidence: every column the shared mapping reads is now independently
confirmed correct against DerbyNet's *real* schema, and DerbyNet's own
source contains comments describing its schema as inherited from GPRM's
(`website/inc/data.inc`: "stores individual configuration settings *from
GPRM*"; `website/inc/newracer.inc`: "a mis-design inherited from GPRM"). That
is corroborating context, not proof of GPRM's own file — GPRM predates
several of the columns confirmed above (`Partitions` chief among them, per
`domain/derbynet.py`'s own docstring) and there is no way to know, without a
real GPRM file, which of DerbyNet's newer columns (or their absence) a
current GPRM v18+ install's own schema actually carries.

## What a schema alone cannot settle, even now

Two questions #694 was explicitly not able to close, because they are about
how packs actually use the software, not about column definitions:

- **Whether a rank name repeated across two classes ("Den 1" under both
  Wolves and Bears) actually occurs in practice.** Nothing in either
  program's source constrains this either way — it depends on how an
  operator names their dens — so only a real file can show whether the
  importer's class-prefixing rule is solving a real collision or a
  hypothetical one.
- **Whether `Exclude` is used the way #548's `excluded_from_standings` is.**
  This one *is* now better evidence than a schema check alone would give:
  reading DerbyNet's own PHP (`website/inc/standings.inc`,
  `website/ajax/action.racer.bulk.inc`, `website/import-roster.php`) shows
  its standings and trophy queries filter on `passedinspection = 1 AND
  exclude = 0`, a separate query counts how many "ineligible" racers were
  left off the page, and the roster-import screen itself labels the column
  "Ineligible for Award?" — a racer with `exclude = 1` still races and still
  has `passedinspection = 1`, only the trophy table skips them. That is
  DerbyNet's own *intended* behaviour, confirmed from its source rather than
  guessed from its schema, and it lines up with `excluded_from_standings`
  exactly. It is still not the same claim as "a real pack's file uses the
  checkbox this way" — software can be used against its own intent, and only
  a real file settles that a pack didn't.

## What would still close it

A real `.sqlite` from either program, from any pack, committed to
`backend/tests/roster_imports/` after being anonymised. That would be the
first evidence in this area not written by us at all — exactly the role
`timer_recordings/` plays for the timer profiles, where the first real
recording immediately found that our MicroWizard profile could not identify
a K3. Nothing in #694 substitutes for it: a schema tells you the columns a
program *could* fill in, not which ones a given pack's data actually
populated, how consistently, or in what shape. The two questions above are
exactly the kind a schema cannot answer and a real file answers on sight.
