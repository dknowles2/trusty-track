from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend import models
from backend.main import app, get_db
import uuid
import pytest


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def create_test_race_and_racers(
    client, track_id: int, num_racers: int = 10, dens: list = None
):
    # Setup group
    group_name = get_unique_name("Wizard Group")
    resp_group = client.post("/groups/", json={"name": group_name})
    group_id = resp_group.json()["id"]

    # Setup race
    race_name = get_unique_name("Wizard Race")
    resp_race = client.post(
        "/races/",
        json={
            "name": race_name,
            "group_id": group_id,
            "car_numbering_strategy": "MANUAL",
            "lane_count": 4,
            "track_id": track_id,
        },
    )
    race_id = resp_race.json()["id"]

    # Setup dens
    den_ids = []
    if dens:
        for den_name in dens:
            resp_den = client.post(
                f"/races/{race_id}/dens", json={"name": den_name, "color": "#FF0000"}
            )
            den_ids.append(resp_den.json()["id"])
    else:
        # Default single den
        resp_den = client.post(
            f"/races/{race_id}/dens", json={"name": "Pack", "color": "#0000FF"}
        )
        den_ids.append(resp_den.json()["id"])

    # Setup racers
    racer_ids = []
    for i in range(num_racers):
        den_id = den_ids[i % len(den_ids)]
        resp_racer = client.post(
            "/racers/",
            json={
                "first_name": f"Racer",
                "last_name": str(i),
                "car_number": 100 + i,
                "den_id": den_id,
                "race_id": race_id,
            },
        )
        racer_ids.append(resp_racer.json()["id"])

    return race_id, den_ids, racer_ids


def test_wizard_pack_round(client, default_track):
    race_id, den_ids, racer_ids = create_test_race_and_racers(
        client, default_track, num_racers=8
    )

    wizard_config = {
        "general_round": {"type": "PACK", "runs_per_lane": 1},
        "championship_rounds": [],
    }

    resp = client.post(f"/races/{race_id}/wizard", json=wizard_config)
    assert resp.status_code == 200

    # Verify rounds
    rounds = client.get(f"/races/{race_id}/rounds").json()
    assert len(rounds) == 1
    assert rounds[0]["name"] == "All Pack"

    # Verify heats (8 racers, 4 lanes, 1 run per lane = 8 heats in PPC)
    heats = client.get(f"/races/{race_id}/heats").json()
    assert len(heats) == 8


def test_wizard_den_rounds(client, default_track):
    race_id, den_ids, racer_ids = create_test_race_and_racers(
        client, default_track, num_racers=8, dens=["Den A", "Den B"]
    )

    wizard_config = {
        "general_round": {"type": "DEN", "runs_per_lane": 1},
        "championship_rounds": [],
    }

    resp = client.post(f"/races/{race_id}/wizard", json=wizard_config)
    assert resp.status_code == 200

    # Verify rounds (one per den)
    rounds = client.get(f"/races/{race_id}/rounds").json()
    assert len(rounds) == 2
    round_names = [r["name"] for r in rounds]
    assert "Den A" in round_names
    assert "Den B" in round_names

    # Verify heats (4 racers per den -> 4 heats per den, total 8)
    heats = client.get(f"/races/{race_id}/heats").json()
    assert len(heats) == 8


def test_wizard_championship_round(client, default_track):
    race_id, den_ids, racer_ids = create_test_race_and_racers(
        client, default_track, num_racers=12
    )

    wizard_config = {
        "general_round": {"type": "NONE", "runs_per_lane": 1},
        "championship_rounds": [
            {"name": "Championship Round", "num_top_racers": 4, "runs_per_lane": 1}
        ],
    }

    resp = client.post(f"/races/{race_id}/wizard", json=wizard_config)
    assert resp.status_code == 200

    # Verify rounds
    rounds = client.get(f"/races/{race_id}/rounds").json()
    assert len(rounds) == 1
    assert rounds[0]["name"] == "Championship Round"

    # Verify heats (4 placeholders, 4 lanes, 1 run per lane = 4 heats)
    heats = client.get(f"/races/{race_id}/heats").json()
    assert len(heats) == 4

    # Verify placeholders are negative
    import json

    heat_data = heats[0]
    lane_results = json.loads(heat_data["lane_results"])

    for result in lane_results:
        assert result["racer_id"] < 0


def test_wizard_full_flow(client, default_track):
    race_id, den_ids, racer_ids = create_test_race_and_racers(
        client, default_track, num_racers=8, dens=["Den A", "Den B"]
    )

    wizard_config = {
        "general_round": {"type": "DEN", "runs_per_lane": 1},
        "championship_rounds": [
            {"name": "Championship Round", "num_top_racers": 4, "runs_per_lane": 1}
        ],
    }

    resp = client.post(f"/races/{race_id}/wizard", json=wizard_config)
    assert resp.status_code == 200

    # Verify rounds (2 den rounds + 1 championship)
    rounds = client.get(f"/races/{race_id}/rounds").json()
    assert len(rounds) == 3

    # Verify heats (8 heats for general + 4 heats for championship = 12 total)
    heats = client.get(f"/races/{race_id}/heats").json()
    assert len(heats) == 12


def test_wizard_championship_per_den(client, default_track):
    race_id, den_ids, racer_ids = create_test_race_and_racers(
        client, default_track, num_racers=8, dens=["Den A", "Den B"]
    )

    wizard_config = {
        "general_round": {"type": "NONE", "runs_per_lane": 1},
        "championship_rounds": [
            {
                "name": "Championship Round",
                "source": "DEN",
                "num_top_racers": 2,  # 2 per den = 4 total
                "runs_per_lane": 1,
            }
        ],
    }

    resp = client.post(f"/races/{race_id}/wizard", json=wizard_config)
    assert resp.status_code == 200

    # Verify rounds
    rounds = client.get(f"/races/{race_id}/rounds").json()
    assert len(rounds) == 1

    # Verify heats (2 dens * 2 top racers = 4 placeholders -> 4 heats)
    heats = client.get(f"/races/{race_id}/heats").json()
    assert len(heats) == 4
