"""Regression tests for delete_heat (#750).

Verifies that:
1. Finished heats cannot be deleted (recorded_at is set, results exist, or all
   lanes are skipped/finished).
2. Recorded heats preserve their heat_number when a pending heat is deleted.
3. Races with master_running_order enabled leave remaining heat numbers alone
   when a heat is deleted.
4. Races without master_running_order renumber only pending heats.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import lanes


def _setup_race(
    db: Session,
    lane_count: int = 4,
    master_running_order: bool = False,
) -> tuple[models.Race, models.Round, list[models.Racer]]:
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 1"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Track 1", lane_count=lane_count, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Race 1",
            organization_id=org.id,
            track_id=track.id,
        ),
    )
    if master_running_order:
        race.master_running_order = True
        db.commit()
        db.refresh(race)
    round_obj = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.PPC, "Round 1"
    )
    racers = [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        for i in range(lane_count)
    ]
    return race, round_obj, racers


def _create_heat(
    db: Session,
    race: models.Race,
    round_obj: models.Round,
    heat_number: int,
    lane_assignments: list[lanes.Lane],
    recorded: bool = False,
) -> models.Heat:
    recorded_at = datetime.now(timezone.utc).isoformat() if recorded else None
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=heat_number,
        recorded_at=recorded_at,
    )
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, lane_assignments)
    db.commit()
    db.refresh(heat)
    return heat


class TestDeleteHeatFinishedGuard:
    """A heat with recorded_at, results, or all lanes skipped must not be deleted."""

    def test_refuses_deletion_if_recorded_at_is_set(self, db: Session) -> None:
        race, round_obj, racers = _setup_race(db)
        heat = _create_heat(
            db,
            race,
            round_obj,
            heat_number=1,
            lane_assignments=[
                lanes.Lane(lane=1, racer_id=racers[0].id),
                lanes.Lane(lane=2, racer_id=racers[1].id),
            ],
            recorded=True,
        )
        with pytest.raises(ValueError, match="Cannot delete heat: it has results."):
            crud.delete_heat(db, heat.id)

    def test_refuses_deletion_if_lanes_have_results(self, db: Session) -> None:
        race, round_obj, racers = _setup_race(db)
        heat = _create_heat(
            db,
            race,
            round_obj,
            heat_number=1,
            lane_assignments=[
                lanes.Lane(lane=1, racer_id=racers[0].id, time=3.14, place=1),
                lanes.Lane(lane=2, racer_id=racers[1].id, time=3.20, place=2),
            ],
            recorded=False,
        )
        with pytest.raises(ValueError, match="Cannot delete heat: it has results."):
            crud.delete_heat(db, heat.id)

    def test_refuses_deletion_if_all_lanes_skipped(self, db: Session) -> None:
        race, round_obj, racers = _setup_race(db)
        heat = _create_heat(
            db,
            race,
            round_obj,
            heat_number=1,
            lane_assignments=[
                lanes.Lane(lane=1, racer_id=racers[0].id, skipped=True),
                lanes.Lane(lane=2, racer_id=racers[1].id, skipped=True),
            ],
            recorded=False,
        )
        with pytest.raises(ValueError, match="Cannot delete heat: it has results."):
            crud.delete_heat(db, heat.id)


class TestDeleteHeatRenumbering:
    """Renumbering rules when a pending heat is deleted."""

    def test_recorded_heat_keeps_heat_number_when_pending_heat_deleted(
        self, db: Session
    ) -> None:
        race, round_obj, racers = _setup_race(db, master_running_order=False)
        heat1 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=1,
            lane_assignments=[
                lanes.Lane(lane=1, racer_id=racers[0].id),
                lanes.Lane(lane=2, racer_id=racers[1].id),
            ],
            recorded=False,
        )
        heat2 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=2,
            lane_assignments=[
                lanes.Lane(lane=1, racer_id=racers[2].id, time=3.5, place=1),
                lanes.Lane(lane=2, racer_id=racers[3].id, time=3.6, place=2),
            ],
            recorded=True,
        )

        # Deleting pending heat 1 must NOT renumber recorded heat 2 to 1
        assert crud.delete_heat(db, heat1.id) is True
        db.refresh(heat2)
        assert heat2.heat_number == 2

    def test_master_running_order_leaves_heat_numbers_untouched(
        self, db: Session
    ) -> None:
        race, round_obj, racers = _setup_race(db, master_running_order=True)
        heat1 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=10,
            lane_assignments=[lanes.Lane(lane=1, racer_id=racers[0].id)],
        )
        heat2 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=20,
            lane_assignments=[lanes.Lane(lane=1, racer_id=racers[1].id)],
        )
        heat3 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=30,
            lane_assignments=[lanes.Lane(lane=1, racer_id=racers[2].id)],
        )

        assert crud.delete_heat(db, heat2.id) is True
        db.refresh(heat1)
        db.refresh(heat3)
        assert heat1.heat_number == 10
        assert heat3.heat_number == 30

    def test_renumbers_only_pending_heats_when_master_order_disabled(
        self, db: Session
    ) -> None:
        race, round_obj, racers = _setup_race(db, master_running_order=False)
        heat1 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=1,
            lane_assignments=[
                lanes.Lane(lane=1, racer_id=racers[0].id, time=3.1, place=1)
            ],
            recorded=True,
        )
        heat2 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=2,
            lane_assignments=[lanes.Lane(lane=1, racer_id=racers[1].id)],
            recorded=False,
        )
        heat3 = _create_heat(
            db,
            race,
            round_obj,
            heat_number=3,
            lane_assignments=[lanes.Lane(lane=1, racer_id=racers[2].id)],
            recorded=False,
        )

        assert crud.delete_heat(db, heat2.id) is True
        db.refresh(heat1)
        db.refresh(heat3)
        assert heat1.heat_number == 1
        assert heat3.heat_number == 2
