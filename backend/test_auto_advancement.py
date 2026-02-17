from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .database import Base
from .main import get_db, app
from . import models, schemas
import pytest
import json


client = TestClient(app)


def test_auto_advancement_with_placeholders(db):
    """
    Regression test for bug where existing placeholder heats prevented auto-advancement.
    Verifies that championship rounds are populated even if they have initialized placeholder heats.
    """
    # 1. Setup Race with Wizard (General + Championship)
    # Create Group & Track
    group = models.Group(name="Auto Advance Group")
    db.add(group)
    track = models.Track(lane_count=4, length_feet=40, timer_type="FAKE")
    db.add(track)
    db.commit()

    # Create Race
    race = models.Race(name="Auto Advance Race", group_id=group.id)
    db.add(race)
    db.commit()

    # Create Racers (4 racers)
    den = models.Den(name="Den 1", race_id=race.id)
    db.add(den)
    db.commit()

    racers = []
    for i in range(4):
        r = models.Racer(
            first_name=f"R{i}", last_name=f"D{i}", race_id=race.id, den_id=den.id
        )
        db.add(r)
        racers.append(r)
    db.commit()

    # Create Rounds via Wizard
    # General: PACK, 1 run/lane
    # Champ: Top 2 from PACK
    payload = {
        "general_round": {"type": "PACK", "runs_per_lane": 1},
        "championship_rounds": [
            {
                "name": "Championship",
                "source": "PACK",
                "num_top_racers": 2,
                "runs_per_lane": 1,
            }
        ],
    }
    response = client.post(f"/races/{race.id}/wizard", json=payload)
    if response.status_code != 200:
        print(f"Wizard failed: {response.json()}")
    assert response.status_code == 200

    # Verify rounds created
    rounds = (
        db.query(models.Round)
        .filter(models.Round.race_id == race.id)
        .order_by(models.Round.round_number)
        .all()
    )
    assert len(rounds) == 2
    gen_round = rounds[0]
    champ_round = rounds[1]

    # Verify Champ round has placeholder heats
    champ_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == champ_round.id).all()
    )
    assert len(champ_heats) > 0
    # Check for placeholders in results
    placeholder_found = False
    for h in champ_heats:
        results = json.loads(h.lane_results)
        for r in results:
            if r.get("racer_id") is not None and r.get("racer_id") < 0:
                placeholder_found = True
                break
    assert placeholder_found, "Championship round should have placeholders initially"

    # 2. Run all General Heats
    gen_heats = db.query(models.Heat).filter(models.Heat.round_id == gen_round.id).all()
    assert len(gen_heats) > 0

    # Assign arbitrary times to simulate completion
    # Note: Wizard generates heats with proper lane assignments.

    for i, heat in enumerate(gen_heats):
        # Construct valid results based on assignment
        current_results = json.loads(heat.lane_results)
        updated_results = []
        for lane_res in current_results:
            racer_id = lane_res.get("racer_id")
            if racer_id:
                # Assign time based on racer ID to determine winner deterministically
                # R0=1.0, R1=1.1, etc. R0 and R1 should win.
                lane_res["time"] = 1.0 + (racer_id * 0.1)
                lane_res["place"] = 1  # simplified
            updated_results.append(lane_res)

        # Update via API to trigger auto-advancement logic
        update_payload = {
            "heat_number": heat.heat_number,
            "lane_results": json.dumps(updated_results),
            "race_id": race.id,
            "round_id": gen_round.id,
        }

        res = client.put(f"/heats/{heat.id}", json=update_payload)
        assert res.status_code == 200

    # 3. Verify Championship Advancement
    # Fetch champ heats again
    db.expire_all()
    champ_heats_after = (
        db.query(models.Heat).filter(models.Heat.round_id == champ_round.id).all()
    )

    # Check if placeholders are gone
    placeholders_remaining = False
    valid_racers_found = False

    for h in champ_heats_after:
        results = json.loads(h.lane_results)
        for r in results:
            rid = r.get("racer_id")
            if rid is not None:
                if rid < 0:
                    placeholders_remaining = True
                else:
                    valid_racers_found = True

    assert not placeholders_remaining, "Championship round still has placeholders!"
    assert valid_racers_found, "Championship round was not populated with real racers!"

    print("Regression test passed!")
