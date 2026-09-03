"""Reading rosters out of other derby programs' databases.

One module per program — `gprm.py` for GrandPrix Race Manager (#618), and
DerbyNet (#661) beside it when it lands — each owning only the *file*: what
kind of file it is, opening it, and refusing one that is not what it claims.
What the tables mean is a rule, and lives in `backend/domain/`
(`domain/gprm.py`), over the plain-rows `TableSet` protocol that
`sqlite_tables.py` here implements. Every parser returns a
`domain.roster_import.ParsedRoster`, which is the shape a preview renders and
a mutation writes without knowing which program it came from.
"""
