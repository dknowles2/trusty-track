import json

from backend import crud, schemas


def _setup_race(client, db):
    """Create group, track, race, 2 dens, 4 racers. Returns (race_id, racer_ids, den_ids)."""
    group = crud.create_group(db, schemas.GroupCreate(name="Stats Test Group"))
    track = crud.create_track(db, schemas.TrackCreate(name="Stats Track", lane_count=4))

    resp = client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                createRace(race: {{
                    name: "Stats Race",
                    groupId: {group.id},
                    trackId: {track.id}
                }}) {{ id }}
            }}
            """
        },
    )
    assert resp.status_code == 200
    race_id = resp.json()["data"]["createRace"]["id"]

    # Create 2 dens
    den_ids = []
    for name, color in [("Lions", "#FF0000"), ("Tigers", "#00FF00")]:
        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    createDen(raceId: {race_id}, den: {{ name: "{name}", color: "{color}" }}) {{ id }}
                }}
                """
            },
        )
        den_ids.append(resp.json()["data"]["createDen"]["id"])

    # Create 4 racers — 2 per den, all checked in
    racer_ids = []
    for i, den_id in enumerate(den_ids * 2):
        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    createRacer(racer: {{
                        firstName: "Racer",
                        lastName: "{i + 1}",
                        raceId: {race_id},
                        denId: {den_id},
                        carNumber: {i + 1},
                        carPassedInspection: true
                    }}) {{ id }}
                }}
                """
            },
        )
        racer_ids.append(resp.json()["data"]["createRacer"]["id"])

    return race_id, racer_ids, den_ids


def _create_round_and_get_heats(client, race_id):
    """Create a round via the wizard and return heat IDs."""
    resp = client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                createRoundWizard(raceId: {race_id}, config: {{
                    generalRound: {{ type: "PACK", runsPerLane: 1 }},
                    championshipRounds: []
                }}) {{ id }}
            }}
            """
        },
    )
    assert resp.status_code == 200

    resp = client.post(
        "/graphql",
        json={
            "query": f"""
            query {{
                race(raceId: {race_id}) {{
                    heats {{ id heatNumber }}
                }}
            }}
            """
        },
    )
    return resp.json()["data"]["race"]["heats"]


def _record_heat_result(client, heat_id, results):
    """Record results for a heat. results is a list of dicts."""
    results_str = json.dumps(results).replace('"', '\\"')
    resp = client.post(
        "/graphql",
        json={
            "query": f"""
            mutation {{
                updateHeatResult(heatId: {heat_id}, results: "{results_str}") {{ id }}
            }}
            """
        },
    )
    assert resp.status_code == 200


RACE_STATS_QUERY = """
query GetRaceStats($raceId: Int!) {
  raceStats(raceId: $raceId) {
    raceId
    raceName
    scoringStrategy
    totalHeatsScheduled
    totalHeatsCompleted
    totalRacers
    laneStats { lane avgTime heatCount relativeAdvantagePct }
    racerStats {
      racerId firstName lastName carNumber denName
      heatsCompleted heatsScheduled minTime maxTime meanTime stdDev
      timesPerLane { lane avgTime }
    }
    highlights { type roundName heatNumber racerName time margin }
    denStats { denId denName denColor racerCount avgScore bestRacerName }
    heatResults { roundName heatNumber lane carNumber racerFirstName racerLastName time place }
  }
}
"""


def test_race_stats_no_results(client, db):
    """raceStats returns zeros before any heats are completed."""
    race_id, racer_ids, den_ids = _setup_race(client, db)
    _create_round_and_get_heats(client, race_id)

    resp = client.post("/graphql", json={"query": RACE_STATS_QUERY, "variables": {"raceId": race_id}})
    assert resp.status_code == 200
    data = resp.json()["data"]["raceStats"]

    assert data["raceId"] == race_id
    assert data["raceName"] == "Stats Race"
    assert data["totalRacers"] == 4
    assert data["totalHeatsCompleted"] == 0
    assert data["totalHeatsScheduled"] > 0
    assert data["racerStats"] == []
    assert data["highlights"] == []


def test_race_stats_with_results(client, db):
    """raceStats returns correct values after recording heat results."""
    race_id, racer_ids, den_ids = _setup_race(client, db)
    heats = _create_round_and_get_heats(client, race_id)
    assert len(heats) > 0

    heat_id = heats[0]["id"]

    # Record results: racer 0 in lane 1 (fastest), racer 1 in lane 2
    _record_heat_result(client, heat_id, [
        {"lane": 1, "racer_id": racer_ids[0], "time": 3.100, "place": 1},
        {"lane": 2, "racer_id": racer_ids[1], "time": 3.500, "place": 2},
        {"lane": 3, "racer_id": racer_ids[2], "time": 3.800, "place": 3},
        {"lane": 4, "racer_id": racer_ids[3], "time": 4.100, "place": 4},
    ])

    resp = client.post("/graphql", json={"query": RACE_STATS_QUERY, "variables": {"raceId": race_id}})
    assert resp.status_code == 200
    data = resp.json()["data"]["raceStats"]

    assert data["totalHeatsCompleted"] == 1
    assert data["totalHeatsScheduled"] >= 1

    # laneStats should have 4 entries (one per lane)
    assert len(data["laneStats"]) == 4
    lane1 = next(ls for ls in data["laneStats"] if ls["lane"] == 1)
    assert lane1["avgTime"] == pytest.approx(3.100, abs=0.001)
    assert lane1["heatCount"] == 1
    # Lane 1 had the fastest time, so relative advantage should be positive
    assert lane1["relativeAdvantagePct"] is not None
    assert lane1["relativeAdvantagePct"] > 0

    # racerStats sorted by mean_time ascending
    assert len(data["racerStats"]) == 4
    fastest_racer = data["racerStats"][0]
    assert fastest_racer["racerId"] == racer_ids[0]
    assert fastest_racer["minTime"] == pytest.approx(3.100, abs=0.001)
    assert fastest_racer["meanTime"] == pytest.approx(3.100, abs=0.001)
    assert fastest_racer["maxTime"] == pytest.approx(3.100, abs=0.001)
    assert fastest_racer["stdDev"] is None  # only 1 heat, no std dev

    # At least one FASTEST_HEAT highlight
    highlights = data["highlights"]
    assert any(h["type"] == "FASTEST_HEAT" for h in highlights)
    fh = next(h for h in highlights if h["type"] == "FASTEST_HEAT")
    assert fh["time"] == pytest.approx(3.100, abs=0.001)
    assert fh["racerName"] == "Racer 1"

    # CLOSEST_RACE highlight should exist (4 racers in one heat)
    assert any(h["type"] == "CLOSEST_RACE" for h in highlights)

    # heatResults should have 4 rows
    assert len(data["heatResults"]) == 4

    # denStats should have 2 dens
    assert len(data["denStats"]) == 2


def test_race_stats_multiple_heats(client, db):
    """std_dev is computed correctly across 2+ heats."""
    race_id, racer_ids, den_ids = _setup_race(client, db)
    heats = _create_round_and_get_heats(client, race_id)

    # Record results in 2 heats for racer 0 (times: 3.0, 4.0 → mean 3.5, std_dev ~0.5)
    for i, (h, t1, t2) in enumerate(zip(heats[:2], [3.0, 4.0], [3.5, 4.5])):
        _record_heat_result(client, h["id"], [
            {"lane": 1, "racer_id": racer_ids[0], "time": t1, "place": 1},
            {"lane": 2, "racer_id": racer_ids[1], "time": t2, "place": 2},
        ])

    resp = client.post("/graphql", json={"query": RACE_STATS_QUERY, "variables": {"raceId": race_id}})
    data = resp.json()["data"]["raceStats"]

    assert data["totalHeatsCompleted"] == 2

    r0 = next(rs for rs in data["racerStats"] if rs["racerId"] == racer_ids[0])
    assert r0["heatsCompleted"] == 2
    assert r0["meanTime"] == pytest.approx(3.5, abs=0.001)
    assert r0["stdDev"] is not None
    assert r0["stdDev"] == pytest.approx(0.5, abs=0.001)


def test_race_stats_returns_none_for_missing_race(client, db):
    """raceStats returns null for a non-existent race ID."""
    resp = client.post(
        "/graphql",
        json={"query": RACE_STATS_QUERY, "variables": {"raceId": 99999}},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["raceStats"] is None


import pytest
