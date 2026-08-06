"""Keeps ``heat_lanes`` in step with the ``lane_results`` blobs.

Issue #5, step two. The table was backfilled by migration ``0003``, but the
application still writes only the blob — so without this the table would be
correct once and then decay from the first recorded result.

Why a session event rather than calls at each write site
--------------------------------------------------------
The blob is written from at least eight places across ``crud.py``, plus the
free-race helpers, plus ``TimerManager`` on its own session outside the request
lifecycle. Adding a call to each is a standing invitation to miss one, and a
missed one is invisible: the blob stays right, the table quietly drifts, and
nothing fails until the readers switch over.

Listening on the session catches every writer by construction, including any
added later.

Direction of truth
------------------
The rows now come from the lane *values* a writer supplied, not from parsing
the string it also wrote. ``crud.set_heat_lanes`` — the one door for a heat's
lanes since #119 — stages those values on the instance, and this module writes
them when the flush gives the heat an id.

That is the change of direction #72 asks for, less the last step: a malformed
or hand-edited blob can no longer reach ``heat_lanes``, and ``lane_results`` is
a derived column rather than the source. It is still *written*, so a rollback
has data and the readers can move one at a time.

Parsing the blob survives only as a fallback for a heat whose lanes were
written some other way. Nothing does that — ``test_heat_lanes_write.py`` walks
``crud.py``'s AST to keep it so — and the fallback exists because the failure
it prevents is silent.

:func:`lanes_out_of_sync` proves the two still agree, and ``conftest.py``
asserts it after every test in the suite.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete, event, insert, inspect, select
from sqlalchemy.orm import Session

from backend.db import models
from backend.domain import lanes as domain_lanes

logger = logging.getLogger(__name__)


#: Where a writer leaves the lanes it wants stored, for the flush to pick up.
#:
#: An instance attribute rather than an argument because a transient heat has
#: no id until the flush has run, and the rows need one. Not a mapped column,
#: so SQLAlchemy neither persists nor expires it.
STAGED = "_tt_staged_lanes"


def stage(heat: models.Heat, heat_lanes) -> None:
    """Hand this flush the lanes to store for ``heat``."""
    setattr(heat, STAGED, list(heat_lanes))


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


def _blob_changed(obj: Any, *fields: str) -> bool:
    state = inspect(obj)
    if state.transient or state.pending:
        return True
    return any(getattr(state.attrs, field).history.has_changes() for field in fields)


@event.listens_for(Session, "after_flush")
def _sync_heat_lanes(session: Session, _flush_context) -> None:
    """Project every heat whose blob was touched in this flush.

    ``after_flush`` rather than ``before_flush`` because a newly created heat
    has no id until the flush has run. Emitting core SQL here is supported; what
    is not supported is adding new ORM objects, which is why this writes through
    ``session.execute`` rather than constructing ``HeatLane`` instances.
    """
    for obj in session.deleted:
        if isinstance(obj, models.Heat):
            _project(session, obj.id, [])

    for obj in list(session.new) + list(session.dirty):
        if obj in session.deleted or not isinstance(obj, models.Heat):
            continue

        staged = getattr(obj, STAGED, None)
        if staged is not None:
            # Cleared before writing. Not because a replay would corrupt
            # anything — a second door call re-stages, and a flush with no lane
            # change would rewrite identical rows — but because leaving it set
            # would keep the fallback below from ever engaging for this heat,
            # which is the one case the fallback exists for.
            delattr(obj, STAGED)
            _project(session, obj.id, staged)
        elif _blob_changed(obj, "lane_results"):
            # Nobody should reach this. Kept because what it prevents — a heat
            # whose lanes were written some other way, leaving the table
            # holding the previous ones — fails silently.
            logger.warning(
                "Heat %s had its blob written without staging its lanes; "
                "falling back to parsing it. Use crud.set_heat_lanes.",
                obj.id,
            )
            _project(session, obj.id, domain_lanes.parse(obj.lane_results))


@event.listens_for(Session, "do_orm_execute")
def _cascade_bulk_heat_deletes(state) -> None:
    """Delete lanes for heats removed by a bulk ``query(...).delete()``.

    ``delete_race`` removes heats with a bulk delete, which never loads the rows
    and so never reaches ``after_flush``. Left alone, the orphaned lanes would be
    worse than untidy: SQLite reuses a deleted heat's id for the next insert, so
    a stale row would eventually reattach itself to an unrelated heat.

    Runs before the outer statement — the heats it selects still exist.
    """
    if not state.is_delete:
        return
    # By name, not identity: the statement carries its own copy of the table.
    table = getattr(state.statement, "table", None)
    if table is None or table.name != models.Heat.__tablename__:
        return

    # Built from the statement's table so the criteria keep referring to the
    # same columns they were compiled against.
    doomed = select(table.c.id)
    where = state.statement.whereclause
    if where is not None:
        doomed = doomed.where(where)

    state.session.execute(
        delete(models.HeatLane).where(models.HeatLane.heat_id.in_(doomed)),
        state.parameters or {},
    )


# --------------------------------------------------------------------------- #
# Verification                                                                 #
# --------------------------------------------------------------------------- #


def lanes_out_of_sync(session: Session) -> list[str]:
    """Every disagreement between the blobs and ``heat_lanes``.

    The safety net for the switch-over: while the blob is authoritative this
    should always be empty, and if it is not, the readers must not be moved.
    Returns human-readable descriptions rather than a bool so a failure says
    which heat and which lane.
    """
    problems: list[str] = []

    rows_by_heat: dict[int, dict] = {}
    for row in session.query(models.HeatLane).all():
        rows_by_heat.setdefault(row.heat_id, {})[row.lane] = row

    def compare(heat_id: int, parsed: Iterable) -> None:
        rows = rows_by_heat.get(heat_id, {})
        parsed = list(parsed)
        if len(rows) != len(parsed):
            problems.append(
                f"heat {heat_id}: {len(rows)} rows vs {len(parsed)} lanes in the blob"
            )
            return
        for lane in parsed:
            row = rows.get(lane.lane)
            if row is None:
                problems.append(f"heat {heat_id}: lane {lane.lane} missing")
                continue
            expected_racer = lane.racer_id if (lane.racer_id or 0) > 0 else None
            expected_slot = abs(lane.racer_id) if (lane.racer_id or 0) < 0 else None
            actual = (
                row.racer_id,
                row.placeholder_slot,
                row.time_seconds,
                row.place,
                row.skipped,
            )
            expected = (
                expected_racer,
                expected_slot,
                lane.seconds,
                lane.place,
                lane.skipped,
            )
            if actual != expected:
                problems.append(
                    f"heat {heat_id} lane {lane.lane}: row={actual} blob={expected}"
                )

    seen: set[int] = set()
    for heat in session.query(models.Heat).all():
        seen.add(heat.id)
        compare(heat.id, domain_lanes.parse(heat.lane_results))

    for heat_id in rows_by_heat.keys() - seen:
        problems.append(f"heat {heat_id}: rows for a heat that is gone")

    return problems
