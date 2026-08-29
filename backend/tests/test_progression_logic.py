from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.services import scoring
from backend.tests.helpers import as_lanes, lane_dicts


def test_championship_rounds_populate_sequentially(db: Session):
    # 1. Setup Race and Config
    config = schemas.InitialConfigCreate(
        organization_name="Progression Test Organization",
        tracks=[
            schemas.TrackCreate(
                name="Progressive Track",
                lane_count=4,
                length_feet=40,
                timer_type=models.TimerType.FAKE,
            )
        ],
    )
    crud.create_initial_config(db, config)

    # Create the race explicitly
    group = db.query(models.Organization).first()
    track = db.query(models.Track).first()
    race_in = schemas.RaceCreate(
        name="Progression Test Race", organization_id=group.id, track_id=track.id
    )
    crud.create_race(db, race_in)

    race = db.query(models.Race).first()

    # 2. Create Racers (16 racers)
    for i in range(16):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=i + 1,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )

    # 3. Setup Rounds:
    # Round 1: General (All Pack)
    # Round 2: Semifinals (Top 8)
    # Round 3: Finals (Top 4)

    r1 = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.PPC, "General Round"
    )
    crud.generate_heats_for_round(db, r1.id)

    # Round 2
    r2 = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Semifinals",
        advancement_source="ALL",
        advancement_num_racers=8,
    )
    # Populate with placeholders
    crud.generate_heats_for_round(db, r2.id, num_placeholders=8)

    # Round 3
    r3 = crud.create_round(
        db,
        race.id,
        3,
        models.SchedulingStrategy.PPC,
        "Finals",
        advancement_source="ALL",
        advancement_num_racers=4,
    )
    # Populate with placeholders
    crud.generate_heats_for_round(db, r3.id, num_placeholders=4)

    # 4. Run Round 1
    heats = crud.get_heats(db, race.id)
    r1_heats = [h for h in heats if h.round_id == r1.id]

    # Fake results for Round 1
    # We need to assign times such that we have clear winners
    # Racers 0-7 get fast times (1.0s), others get slow (2.0s)

    # We need to know which racer IDs correspond to which index for our fake logic
    racers = crud.get_racers(db, race_id=race.id)
    # Sort by ID to match creation order
    racers.sort(key=lambda x: x.id)
    fast_racers = {r.id for r in racers[:8]}

    for heat in r1_heats:
        results = lane_dicts(db, heat)
        for r in results:
            rid = r.get("racer_id")
            if rid in fast_racers:
                r["time"] = 1.0
            else:
                r["time"] = 2.0
            r["place"] = 1 if rid in fast_racers else 2  # Simplification

        crud.record_heat_result(
            db, heat.id, as_lanes(results), source=audit.ResultSource.OPERATOR
        )

    # 5. Check Advancement to Round 2
    # In the new logic, we manually trigger advancement or check if they CAN advance.
    # The previous test relied on automatic advancement.
    # Here we will simulate the "Advance" mutation logic.

    # Check winners
    winners_r2 = scoring.get_advancing_racers(
        db, race.id, r2.advancement_source, r2.advancement_num_racers
    )
    assert len(winners_r2) == 8

    # Actually advance them
    crud.resolve_round_placeholders(db, r2.id, winners_r2)

    # Verify Round 2 heats have real racers now
    r2_heats = [h for h in crud.get_heats(db, race.id) if h.round_id == r2.id]
    r2_participants = set()
    for h in r2_heats:
        results = lane_dicts(db, h)
        for r in results:
            if r["racer_id"] is not None and r["racer_id"] > 0:
                r2_participants.add(r["racer_id"])

    assert len(r2_participants) == 8
    assert r2_participants == fast_racers

    # 6. Run Round 2
    # Racers 0-3 get fast times (0.5s), others get slow (1.5s)
    fastest_racers = {r.id for r in racers[:4]}

    for heat in r2_heats:
        results = lane_dicts(db, heat)
        for r in results:
            rid = r.get("racer_id")
            if rid in fastest_racers:
                r["time"] = 0.5
            else:
                r["time"] = 1.5
        crud.record_heat_result(
            db, heat.id, as_lanes(results), source=audit.ResultSource.OPERATOR
        )

    # 7. Check Advancement to Round 3
    winners_r3 = scoring.get_advancing_racers(
        db, race.id, r3.advancement_source, r3.advancement_num_racers
    )
    assert len(winners_r3) == 4

    crud.resolve_round_placeholders(db, r3.id, winners_r3)

    # Verify Round 3
    r3_heats = [h for h in crud.get_heats(db, race.id) if h.round_id == r3.id]
    r3_participants = set()
    for h in r3_heats:
        results = lane_dicts(db, h)
        for r in results:
            if r["racer_id"] is not None and r["racer_id"] > 0:
                r3_participants.add(r["racer_id"])

    assert len(r3_participants) == 4
    assert r3_participants == fastest_racers
