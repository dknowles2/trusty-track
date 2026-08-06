"""Foreign keys are actually enforced (#125).

SQLite defaults enforcement **off**, and the default is per *connection* rather
than per database, so for most of this project's life every ``ForeignKey`` in
``models.py`` was documentation: a heat naming a race that had been deleted, a
lane naming a racer who had, a round on a race that never existed — all written
without complaint.

``database._enforce_foreign_keys`` turns it on for every connection. These
tests exist because that is a single ``PRAGMA`` whose absence changes nothing
visible: with it removed the schema still builds, the app still runs, and the
rest of the suite still passes. The only thing that notices is a constraint
being violated, which is exactly what nobody was noticing.

Deliberately at four levels, because a listener can be right in one and wrong
in the next:

- the pragma is set on a connection;
- a violation raises on the suite's own engine, which is not the app's;
- a violation raises on an engine built from scratch, which is what
  ``TimerManager``'s own ``SessionLocal`` (#9) and the Alembic CLI use;
- and it survives ``init_db()``, which the suite never calls and the operator
  always does.

That last one is not hypothetical. Migrations suspend enforcement, and the
restore does not stick — ``PRAGMA foreign_keys`` is a no-op inside a
transaction, and the migration run has opened one by the time the suspension
ends. The connection went back to the pool with enforcement off and every
session handed out afterwards inherited it, so the app ran with foreign keys
disabled while the whole suite reported them enforced. Caught by hand rather
than by any of the tests above it, which is why it is now one of them.
"""

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from backend.db import crud, models, schemas
from backend.db.database import Base
from backend.domain import lanes


def test_the_pragma_is_on_for_a_connection_from_the_suites_engine(engine):
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1


def test_the_pragma_is_on_for_an_engine_built_from_scratch(tmp_path):
    """The listener is on the ``Engine`` class, not on one instance.

    ``TimerManager`` writes through its own ``SessionLocal`` outside the request
    lifecycle (#9) and the Alembic CLI builds its own engine, so a listener
    attached to ``database.engine`` alone would leave both unenforced — a
    guarantee holding everywhere except where it is being relied on.
    """
    other = create_engine(f"sqlite:///{tmp_path / 'other.db'}")
    with other.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1


def test_a_heat_lane_cannot_name_a_racer_who_does_not_exist(db):
    """The violation #72 step 4 is waiting on.

    ``heat_lanes.racer_id`` gets ``ON DELETE SET NULL`` when the table becomes
    authoritative, replacing the two ``crud._remove_racer_from_*`` helpers that
    hand-walk the blob today. That clause is a no-op while enforcement is off,
    which is why this had to land first.
    """
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)

    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
    crud.set_heat_lanes(heat, [lanes.Lane(lane=1, racer_id=99999)])
    db.add(heat)

    # Matched on the message because a NOT NULL or UNIQUE failure raises the
    # same exception class, and a test that accepts any IntegrityError passes
    # for the wrong reason — which is how the last test in this file first
    # went green.
    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        db.commit()
    db.rollback()


def test_a_race_cannot_name_a_group_that_does_not_exist(db):
    db.add(
        models.Race(
            name="Orphan",
            group_id=99999,
            car_numbering_strategy=models.CarNumberingStrategy.MANUAL,
        )
    )

    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        db.commit()
    db.rollback()


def test_a_fresh_database_enforces_too(tmp_path):
    """The schema as it is actually created, not as the suite's fixture makes it.

    An in-memory database built by ``create_all`` and a file one built by
    migrations can differ, and enforcement is a property of the connection
    rather than of the schema — so this checks the combination the operator
    gets.
    """
    other = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    Base.metadata.create_all(bind=other)
    session = sessionmaker(bind=other)()
    try:
        session.add(
            models.Race(
                name="Orphan",
                group_id=99999,
                car_numbering_strategy=models.CarNumberingStrategy.MANUAL,
            )
        )
        with pytest.raises(IntegrityError, match="FOREIGN KEY"):
            session.commit()
    finally:
        session.rollback()
        session.close()
        other.dispose()


def test_enforcement_survives_init_db(tmp_path, monkeypatch):
    """The path the operator takes, which no other test in the tree goes down.

    ``init_db()`` runs the migrations, and migrations suspend enforcement. The
    suite builds its schema with ``create_all`` instead, so it never sees what
    that leaves behind on the pooled connection every later session borrows.

    Reloading the module is the only honest way to ask this: ``engine`` and
    ``SessionLocal`` are module-level and bound to the data directory read at
    import time.
    """
    import importlib

    monkeypatch.setenv("TRUSTYTRACK_DATA_DIR", str(tmp_path))
    database = importlib.reload(importlib.import_module("backend.db.database"))
    try:
        database.init_db()

        session = database.SessionLocal()
        try:
            assert session.execute(text("PRAGMA foreign_keys")).scalar() == 1
        finally:
            session.close()
    finally:
        database.engine.dispose()
        # Leave the module bound to the suite's data directory again, or every
        # test importing it afterwards writes into this tmp_path.
        monkeypatch.undo()
        importlib.reload(database)
