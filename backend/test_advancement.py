import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend import models, scoring
from backend.main import app, get_db

# Use separate SQLite for this test file

# client = TestClient(app) # Remove global client to use fixture


def test_full_advancement_flow(client, default_track):
    # 1. Setup: Create race, den, and racers
    group_resp = client.post("/groups/", json={"name": "Pack 123"})
    group_id = group_resp.json()["id"]

    race_resp = client.post(
        "/races/",
        json={
            "name": "Championship Test",
            "group_id": group_id,
            "track_id": default_track,
            "car_numbering_strategy": "MANUAL",
        },
    )
    race_id = race_resp.json()["id"]

    den_resp = client.post(
        f"/races/{race_id}/dens", json={"name": "Bears", "color": "#ff0000"}
    )
    den_id = den_resp.json()["id"]

    # Create 4 racers
    racer_ids = []
    for i in range(4):
        resp = client.post(
            "/racers/",
            json={
                "first_name": f"Racer",
                "last_name": str(i),
                "car_number": 100 + i,
                "den_id": den_id,
                "race_id": race_id,
            },
        )
        racer_ids.append(resp.json()["id"])

    # 2. Run Wizard: 1 PACK round + 1 Championship (Top 2)
    wizard_config = {
        "general_round": {"type": "PACK", "runs_per_lane": 1},
        "championship_rounds": [
            {
                "name": "Finals",
                "source": "PACK",
                "num_top_racers": 2,
                "runs_per_lane": 1,
            }
        ],
    }
    client.post(f"/races/{race_id}/wizard", json=wizard_config)

    rounds = client.get(f"/races/{race_id}/rounds").json()
    assert len(rounds) == 2
    round1_id = rounds[0]["id"]
    round2_id = rounds[1]["id"]

    # 3. Verify placeholders in Round 2
    heats_all = client.get(f"/races/{race_id}/heats").json()
    heats_r2 = [h for h in heats_all if h["round_id"] == round2_id]
    assert len(heats_r2) == 2

    res0 = json.loads(heats_r2[0]["lane_results"])
    assert res0[0]["racer_id"] < 0  # Placeholder!

    # 4. Check Status: Should be NOT ready because R1 is not finished
    status_resp = client.get(f"/races/{race_id}/rounds/{round2_id}/advancement_status")
    status = status_resp.json()
    assert status["is_ready"] is False
    assert status["requires_advancement"] is True
    assert status["already_advanced"] is False

    # 5. Record results for Round 1
    heats_r1 = [h for h in heats_all if h["round_id"] == round1_id]

    for h in heats_r1:
        lane_res = json.loads(h["lane_results"])
        for res in lane_res:
            rid = res["racer_id"]
            if rid == racer_ids[0]:
                res["time"] = 1.0  # RID 1
            elif rid == racer_ids[1]:
                res["time"] = 2.0  # RID 2
            elif rid == racer_ids[2]:
                res["time"] = 3.0  # RID 3
            else:
                res["time"] = 4.0  # RID 4
            res["place"] = 1
        client.put(
            f"/heats/{h['id']}",
            json={
                "race_id": race_id,
                "round_id": round1_id,
                "heat_number": h["heat_number"],
                "lane_results": json.dumps(lane_res),
            },
        )

    # 6. Check Status: Should be READY and show Racer 0 and 1 as advancing
    status_resp = client.get(f"/races/{race_id}/rounds/{round2_id}/advancement_status")
    status = status_resp.json()
    assert status["is_ready"] is True

    # Filter for those marked as advancing
    advancing_list = [r for r in status["advancing_racers"] if r["is_advancing"]]
    assert len(advancing_list) == 2

    top_ids = [r["racer_id"] for r in advancing_list]
    assert racer_ids[0] in top_ids
    assert racer_ids[1] in top_ids

    # 7. Advance!
    adv_resp = client.post(f"/races/{race_id}/rounds/{round2_id}/advance")
    assert adv_resp.status_code == 200

    # 8. Verify Round 2 heats no longer have placeholders
    heats_after = client.get(f"/races/{race_id}/heats").json()
    heats_r2_after = [h for h in heats_after if h["round_id"] == round2_id]

    res0_after = json.loads(heats_r2_after[0]["lane_results"])
    assert res0_after[0]["racer_id"] in [racer_ids[0], racer_ids[1]]
    assert res0_after[0]["racer_id"] > 0

    # Check already_advanced status
    status_resp = client.get(f"/races/{race_id}/rounds/{round2_id}/advancement_status")
    assert status_resp.json()["already_advanced"] is True
