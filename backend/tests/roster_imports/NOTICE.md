# Sample databases from other derby programs

The `.sql` files here build the databases `test_gprm_import.py` parses. They are
text rather than the binary files themselves so a change to one is reviewable
in a diff, and so the schema each one claims is written out where a reader can
check it.

## Where the schema came from

**None of these was recorded from the program it names.** No GrandPrix Race
Manager install was available. `gprm-v18.sql` carries the table and column
names of DerbyNet's GPRM-compatible SQLite schema —
[`website/sql/sqlite/schema.inc`](https://github.com/jeffpiazza/derbynet/blob/master/website/sql/sqlite/schema.inc)
in [DerbyNet](https://github.com/jeffpiazza/derbynet), MIT-licensed, © Jeff
Piazza — which DerbyNet's own "Advanced Database Set-Up" guide describes as
"broadly compatible" with the SQLite database GPRM v18 and later write, and
which its "Sharing a Database With GPRM" guide pointed at the Access `.mdb`
earlier versions wrote. That is the whole of the evidence: which of those
columns GPRM itself fills in, and whether it carries any DerbyNet does not,
is inferred.

## What that does and does not prove

A test written from the same notes as the parser agrees with the parser's
mistakes — the reason `timer_recordings/` holds real device output rather than
lines we typed from a protocol document. These fixtures prove the parser reads
the schema *as DerbyNet describes it*; they cannot prove a real GPRM file reads
the same way. The first database from a pack that actually ran GPRM belongs in
this directory, and would be the first evidence here that did not come from us.
