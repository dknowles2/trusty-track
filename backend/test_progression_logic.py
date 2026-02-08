import pytest
from sqlalchemy.orm import Session
from . import crud, models, schemas
import json

def test_championship_rounds_populate_sequentially(db: Session):
    # 1. Setup Race and Config
    config = schemas.InitialConfigCreate(
        group_name="Progression Test Group",
        lane_count=4,
        length_feet=40,
        timer_type="FAKE"
    )
    # Clear existing if any (simplification for test env)
    db.query(models.Heat).delete()
    db.query(models.Round).delete()
    db.query(models.Racer).delete()
    db.query(models.Race).delete()
    db.query(models.Group).delete()
    db.query(models.Track).delete()
    db.commit()

    crud.create_initial_config(db, config)
    
    # Create the race explicitly
    race_in = schemas.RaceCreate(name="Progression Test Race", group_id=db.query(models.Group).first().id)
    crud.create_race(db, race_in)
    
    race = db.query(models.Race).first()
    
    # 2. Create Racers (16 racers)
    for i in range(16):
        crud.create_racer(db, schemas.RacerCreate(
            first_name=f"Racer{i}",
            last_name="Test",
            car_number=i+1,
            race_id=race.id
        ))
        
    # 3. Setup Rounds: 
    # Round 1: General (All Pack)
    # Round 2: Semifinals (Top 8)
    # Round 3: Finals (Top 4)
    
    # Round 1 created via "Wizard" logic usually, but manual here is fine
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "General Round")
    crud.generate_heats_for_round(db, r1.id)
    
    # Round 2
    r2 = crud.create_round(db, race.id, 2, models.SchedulingStrategy.PPC, "Semifinals", advancement_source="PACK", advancement_num_racers=8)
    # Populate with placeholders
    crud.generate_heats_for_round(db, r2.id, num_placeholders=8)
    
    # Round 3
    r3 = crud.create_round(db, race.id, 3, models.SchedulingStrategy.PPC, "Finals", advancement_source="PACK", advancement_num_racers=4)
    # Populate with placeholders
    crud.generate_heats_for_round(db, r3.id, num_placeholders=4)
    
    # 4. Run Round 1
    heats = crud.get_heats(db, race.id)
    r1_heats = [h for h in heats if h.round_id == r1.id]
    
    # Fake results for Round 1
    # We need to assign times such that we have clear winners
    # Racers 0-7 get fast times (1.0s), others get slow (2.0s)
    
    from .main import update_heat, _check_and_advance_championship
    
    for heat in r1_heats:
        results = json.loads(heat.lane_results)
        new_results = []
        for lane in results:
            racer_id = lane['racer_id']
            # Racers are created with IDs likely 1-16.
            # But let's look up racer by ID if needed, or just assume ID order.
            # Actually crude logic: if racer_id <= 8 (assuming IDs start at 1), give fast time.
            
            # Note: IDs might not be sequential from 1 due to other tests, but let's assume they are unique and consistent within this session fixture
            
            # Just give random times but ensure we have valid results
            import random
            time = 1.0 + (random.random() * 0.1) # Fastish
            
            # To insure consistent winners, let's make racers with car_number 1-8 fast
            racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
            if racer and racer.car_number and racer.car_number <= 8:
                time = 1.0
            else:
                time = 5.0
                
            lane['time'] = time
            lane['place'] = 1 # Dummy place
            new_results.append(lane)
            
        heat_update = schemas.HeatCreate(
            heat_number=heat.heat_number,
            lane_results=json.dumps(new_results),
            race_id=race.id,
            round_id=r1.id
        )
        # Update heat (which triggers _check_and_advance_championship in main.py logic if we called the endpoint)
        # But here we are calling crud or main directly.
        # Calling crud.update_heat doesn't trigger side effects.
        # We need to simulate the API call or call the check function manually.
        crud.update_heat(db, heat.id, heat_update)
        
    # Trigger the advancement check manually as if the last heat just finished
    _check_and_advance_championship(db, race.id)
    
    # 5. Verify Logic
    
    # Round 2 should be populated (no placeholders)
    r2_heats = db.query(models.Heat).filter(models.Heat.round_id == r2.id).all()
    r2_has_placeholders = False
    for h in r2_heats:
        res = json.loads(h.lane_results)
        for r in res:
            if r['racer_id'] is not None and r['racer_id'] < 0:
                r2_has_placeholders = True
    
    assert not r2_has_placeholders, "Round 2 (Semifinals) should be populated with real racers"
    
    # Round 3 should STILL HAVE PLACEHOLDERS!
    r3_heats = db.query(models.Heat).filter(models.Heat.round_id == r3.id).all()
    r3_has_placeholders = False
    for h in r3_heats:
        res = json.loads(h.lane_results)
        for r in res:
            if r['racer_id'] is not None and r['racer_id'] < 0:
                r3_has_placeholders = True
                
    assert r3_has_placeholders, "Round 3 (Finals) should NOT be populated yet! It should still have placeholders."

