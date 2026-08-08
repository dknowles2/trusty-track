"""Writes a heat's lanes into ``heat_lanes``.

Issue #5, step two, and #72 to its conclusion. The table was backfilled by
migration ``0003``, projected from the ``lane_results`` blob while that was
still the source of truth, and is now the only copy — the column was dropped in
``0013``.

Immediate, except when there is no id yet
-----------------------------------------
``crud.set_heat_lanes`` — the one door for a heat's lanes since #119 — calls
:func:`stage`, which writes the rows straight away for a heat that is already
persistent. A heat that has just been constructed has no id, and the rows need
one, so its values are left on the instance and written by the ``after_flush``
listener below, which is the first moment the id exists.

That split used to be invisible, and getting it wrong was silent. While
``lane_results`` was written alongside, *that* assignment is what made the
instance dirty and pulled it into the flush the listener watches. ``STAGED`` is
not a mapped attribute, so once the column went, an update to an existing heat
marked nothing dirty — and ``Session.commit`` does not flush a clean session.

Deletion is not this module's problem
------------------------------------
It used to be, twice: an ``after_flush`` pass over ``session.deleted`` for
heats removed as ORM objects, and a ``do_orm_execute`` listener for those
removed by a bulk ``query(...).delete()``, which never loads the rows. The
first was ordered wrong — ``after_flush`` runs after the ``DELETE FROM heats``
that a real constraint refuses — and neither was needed once
``heat_lanes.heat_id`` got ``ON DELETE CASCADE`` (#125). The rule is in the
schema now, where it covers every writer including ones that never touch this
session.

Nothing verifies this against a second copy any more, because there is not one.
``test_heat_lanes_write.py`` holds the property earlier instead: nothing outside
this module writes a ``heat_lanes`` row.
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, event, insert
from sqlalchemy.orm import Session, object_session

from backend.db import models

logger = logging.getLogger(__name__)


#: Where a writer leaves the lanes it wants stored, for the flush to pick up.
#:
#: An instance attribute rather than an argument because a transient heat has
#: no id until the flush has run, and the rows need one. Not a mapped column,
#: so SQLAlchemy neither persists nor expires it.
STAGED = "_tt_staged_lanes"


def stage(heat: models.Heat, heat_lanes) -> None:
    """Store this heat's lanes — now if it has an id, otherwise on the flush.

    Deferring was never the goal; it was the price of a heat that does not have
    an id yet, and the rows need one. A heat that is already persistent has an
    id, so its rows are written immediately.

    That distinction used to be invisible, because ``lane_results`` was written
    alongside and *that* is what made the instance dirty and pulled it into the
    flush the listener watches. ``STAGED`` is not a mapped attribute, so with
    the column gone (#72) an update to an existing heat marked nothing dirty —
    and ``Session.commit`` does not flush a clean session, so the listener never
    ran and the lanes were silently dropped.
    """
    values = list(heat_lanes)
    session = object_session(heat)
    if heat.id is not None and session is not None:
        _project(session, heat.id, values)
        return
    setattr(heat, STAGED, values)


def _rows_for(heat_id: int, parsed) -> list[dict]:
    """Lane values as ``heat_lanes`` rows.

    ``placeholder_slot`` is read off the lane rather than re-derived from a
    negative racer id: the sign convention has one home, and a foreign key
    cannot express it.
    """
    return [
        {
            "heat_id": heat_id,
            "lane": lane.lane,
            "racer_id": lane.real_racer_id,
            "placeholder_slot": lane.placeholder_slot,
            "time_seconds": lane.seconds,
            "place": lane.place,
            "skipped": lane.skipped,
        }
        for lane in parsed
    ]


def _project(session: Session, heat_id: int, parsed) -> None:
    """Replace this heat's rows. Volumes are one row per lane, so a rewrite is
    simpler and no slower than diffing."""
    session.execute(delete(models.HeatLane).where(models.HeatLane.heat_id == heat_id))
    rows = _rows_for(heat_id, parsed)
    if rows:
        session.execute(insert(models.HeatLane), rows)


@event.listens_for(Session, "after_flush")
def _sync_heat_lanes(session: Session, _flush_context) -> None:
    """Project every heat whose blob was touched in this flush.

    ``after_flush`` rather than ``before_flush`` because a newly created heat
    has no id until the flush has run. Emitting core SQL here is supported; what
    is not supported is adding new ORM objects, which is why this writes through
    ``session.execute`` rather than constructing ``HeatLane`` instances.
    """
    # Deletion is the database's job since #125: `heat_lanes.heat_id` carries
    # `ON DELETE CASCADE`. This module used to cascade twice in Python — once
    # here for ORM-object deletes and once in a `do_orm_execute` listener for
    # bulk ones — and the first was ordered wrong, running after the
    # `DELETE FROM heats` that a real constraint refuses.
    for obj in list(session.new) + list(session.dirty):
        if obj in session.deleted or not isinstance(obj, models.Heat):
            continue

        staged = getattr(obj, STAGED, None)
        if staged is None:
            continue
        # Cleared before writing, so a heat flushed again without a lane change
        # does not rewrite rows it did not touch.
        delattr(obj, STAGED)
        _project(session, obj.id, staged)
