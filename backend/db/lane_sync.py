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
The blob is still authoritative. This module only projects it. Nothing reads
``heat_lanes`` yet; when the readers switch over, this projection is what they
will be reading, so :func:`lanes_out_of_sync` exists to prove the two agree.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete, event, insert, inspect, select
from sqlalchemy.orm import Session

from backend.db import models
from backend.domain import lanes as domain_lanes


def _rows_for(heat_id: int, kind: models.HeatKind, parsed) -> list[dict]:
    """Project parsed lanes into ``heat_lanes`` rows."""
    rows = []
    for lane in parsed:
        racer_id = lane.racer_id
        placeholder_slot = None
        if racer_id is not None and racer_id < 0:
            placeholder_slot = abs(racer_id)
            racer_id = None
        rows.append(
            {
                "heat_id": heat_id,
                "kind": kind,
                "lane": lane.lane,
                "racer_id": racer_id,
                "placeholder_slot": placeholder_slot,
                "time_seconds": lane.seconds,
                "place": lane.place,
                "skipped": lane.skipped,
            }
        )
    return rows


def _free_race_lanes(heat: models.FreeRaceHeat):
    """Free race keeps the schedule and the results in separate columns.

    Where a lane appears in both, the result wins; a lane that was never run
    keeps its assignment so the schedule is still visible.
    """
    merged: dict[Any, Any] = {}
    for lane in domain_lanes.parse(heat.lane_assignments):
        merged[lane.lane] = lane
    for lane in domain_lanes.parse(heat.lane_results):
        merged[lane.lane] = lane
    return list(merged.values())


def _project(session: Session, heat_id: int, kind: models.HeatKind, parsed) -> None:
    """Replace this heat's rows. Volumes are one row per lane, so a rewrite is
    simpler and no slower than diffing."""
    session.execute(
        delete(models.HeatLane).where(
            models.HeatLane.heat_id == heat_id, models.HeatLane.kind == kind
        )
    )
    rows = _rows_for(heat_id, kind, parsed)
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
            _project(session, obj.id, models.HeatKind.OFFICIAL, [])
        elif isinstance(obj, models.FreeRaceHeat):
            _project(session, obj.id, models.HeatKind.FREE, [])

    for obj in list(session.new) + list(session.dirty):
        if obj in session.deleted:
            continue
        if isinstance(obj, models.Heat) and _blob_changed(obj, "lane_results"):
            _project(
                session,
                obj.id,
                models.HeatKind.OFFICIAL,
                domain_lanes.parse(obj.lane_results),
            )
        elif isinstance(obj, models.FreeRaceHeat) and _blob_changed(
            obj, "lane_results", "lane_assignments"
        ):
            _project(session, obj.id, models.HeatKind.FREE, _free_race_lanes(obj))


#: Which ``heat_lanes.kind`` each heat table projects into. ``heat_id`` cannot
#: be a real foreign key while heats live in two tables (issue #6), so nothing
#: at the database level removes a heat's lanes when the heat goes.
_HEAT_TABLES = {
    models.Heat.__table__: models.HeatKind.OFFICIAL,
    models.FreeRaceHeat.__table__: models.HeatKind.FREE,
}


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
    table = getattr(state.statement, "table", None)
    kind = _HEAT_TABLES.get(table)
    if kind is None:
        return

    doomed = select(table.c.id)
    where = state.statement.whereclause
    if where is not None:
        doomed = doomed.where(where)

    state.session.execute(
        delete(models.HeatLane).where(
            models.HeatLane.kind == kind,
            models.HeatLane.heat_id.in_(doomed),
        ),
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

    rows_by_heat: dict[tuple, dict] = {}
    for row in session.query(models.HeatLane).all():
        rows_by_heat.setdefault((row.kind, row.heat_id), {})[row.lane] = row

    def compare(heat_id: int, kind: models.HeatKind, parsed: Iterable) -> None:
        rows = rows_by_heat.get((kind, heat_id), {})
        parsed = list(parsed)
        if len(rows) != len(parsed):
            problems.append(
                f"{kind.value} heat {heat_id}: {len(rows)} rows vs "
                f"{len(parsed)} lanes in the blob"
            )
            return
        for lane in parsed:
            row = rows.get(lane.lane)
            if row is None:
                problems.append(
                    f"{kind.value} heat {heat_id}: lane {lane.lane} missing"
                )
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
                    f"{kind.value} heat {heat_id} lane {lane.lane}: "
                    f"row={actual} blob={expected}"
                )

    seen: set[tuple] = set()
    for heat in session.query(models.Heat).all():
        seen.add((models.HeatKind.OFFICIAL, heat.id))
        compare(
            heat.id, models.HeatKind.OFFICIAL, domain_lanes.parse(heat.lane_results)
        )
    for heat in session.query(models.FreeRaceHeat).all():
        seen.add((models.HeatKind.FREE, heat.id))
        compare(heat.id, models.HeatKind.FREE, _free_race_lanes(heat))

    for kind, heat_id in rows_by_heat.keys() - seen:
        problems.append(f"{kind.value} heat {heat_id}: rows for a heat that is gone")

    return problems
