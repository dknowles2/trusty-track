import pytest

from backend.db import crud, schemas
from backend.tests.helpers import record_heat_result


def _setup_race(client, db):
    """Create group, track, race, 2 dens, 4 racers.

    Returns (race_id, racer_ids, den_ids).
    """
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
                    createDen(
                        raceId: {race_id},
                        den: {{ name: "{name}", color: "{color}" }}
                    ) {{ id }}
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
    record_heat_result(client, heat_id, results)


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
    heatResults {
      roundName heatNumber lane carNumber racerFirstName racerLastName time place
    }
  }
}
"""


def test_race_stats_no_results(client, db):
    """raceStats returns zeros before any heats are completed."""
    race_id, racer_ids, den_ids = _setup_race(client, db)
    _create_round_and_get_heats(client, race_id)

    resp = client.post(
        "/graphql", json={"query": RACE_STATS_QUERY, "variables": {"raceId": race_id}}
    )
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
    _record_heat_result(
        client,
        heat_id,
        [
            {"lane": 1, "racer_id": racer_ids[0], "time": 3.100, "place": 1},
            {"lane": 2, "racer_id": racer_ids[1], "time": 3.500, "place": 2},
            {"lane": 3, "racer_id": racer_ids[2], "time": 3.800, "place": 3},
            {"lane": 4, "racer_id": racer_ids[3], "time": 4.100, "place": 4},
        ],
    )

    resp = client.post(
        "/graphql", json={"query": RACE_STATS_QUERY, "variables": {"raceId": race_id}}
    )
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
    for h, t1, t2 in zip(heats[:2], [3.0, 4.0], [3.5, 4.5], strict=True):
        _record_heat_result(
            client,
            h["id"],
            [
                {"lane": 1, "racer_id": racer_ids[0], "time": t1, "place": 1},
                {"lane": 2, "racer_id": racer_ids[1], "time": t2, "place": 2},
            ],
        )

    resp = client.post(
        "/graphql", json={"query": RACE_STATS_QUERY, "variables": {"raceId": race_id}}
    )
    data = resp.json()["data"]["raceStats"]

    assert data["totalHeatsCompleted"] == 2

    r0 = next(rs for rs in data["racerStats"] if rs["racerId"] == racer_ids[0])
    assert r0["heatsCompleted"] == 2
    assert r0["meanTime"] == pytest.approx(3.5, abs=0.001)
    assert r0["stdDev"] is not None
    assert r0["stdDev"] == pytest.approx(0.5, abs=0.001)


def test_race_stats_unnamed_round_falls_back_to_round_number(client, db):
    """An unnamed round's heats are labelled by the round number, not the
    heat's own number within it (#315).

    The round is deliberately numbered differently from every heat number it
    holds, so the old `f"Round {heat.heat_number}"` fallback — which varies
    per heat — is distinguishable from the fixed `f"Round {round_number}"`
    one, which is the same for every heat in the round.
    """
    race_id, racer_ids, den_ids = _setup_race(client, db)

    round_obj = crud.create_round(db, race_id=race_id, round_number=5)
    assert round_obj.name is None
    crud.generate_heats_for_round(db, round_obj.id)

    resp = client.post(
        "/graphql",
        json={
            "query": """
            query($raceId: Int!) {
                race(raceId: $raceId) { heats { id heatNumber } }
            }
            """,
            "variables": {"raceId": race_id},
        },
    )
    heats = resp.json()["data"]["race"]["heats"]
    # Four racers on a four-lane track schedule one heat per racer (PPC), so
    # there is a heat numbered something other than the round number (5).
    heats_to_record = [h for h in heats if h["heatNumber"] != 5]
    assert heats_to_record

    for heat in heats_to_record:
        _record_heat_result(
            client,
            heat["id"],
            [
                {"lane": 1, "racer_id": racer_ids[0], "time": 3.1, "place": 1},
                {"lane": 2, "racer_id": racer_ids[1], "time": 3.5, "place": 2},
            ],
        )

    resp = client.post(
        "/graphql", json={"query": RACE_STATS_QUERY, "variables": {"raceId": race_id}}
    )
    data = resp.json()["data"]["raceStats"]

    recorded_heat_numbers = {h["heatNumber"] for h in heats_to_record}
    rows = [r for r in data["heatResults"] if r["heatNumber"] in recorded_heat_numbers]
    assert rows
    for row in rows:
        assert row["roundName"] == "Round 5"

    highlights = data["highlights"]
    assert highlights
    for h in highlights:
        assert h["roundName"] == "Round 5"


def test_race_stats_returns_none_for_missing_race(client):
    """raceStats returns null for a non-existent race ID."""
    resp = client.post(
        "/graphql",
        json={"query": RACE_STATS_QUERY, "variables": {"raceId": 99999}},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["raceStats"] is None


def test_the_closest_race_is_first_against_second_not_first_against_last():
    """#231. The margin used to be the whole field's spread, so a genuine
    photo finish with one straggler lost the highlight to a routine heat
    whose field happened to bunch."""
    from types import SimpleNamespace

    from backend.services.stats import _compute_highlights

    def heat(number, times):
        return {
            "heat": SimpleNamespace(heat_number=number),
            "round_name": "Round 1",
            "global_heat_number": number,
            "results": [
                {"lane": i + 1, "racer_id": i + 1, "time": t, "place": None}
                for i, t in enumerate(times)
            ],
        }

    photo_finish = heat(1, [3.000, 3.001, 5.0])  # 1st and 2nd split by 0.001
    bunched = heat(2, [3.5, 3.6, 3.7])  # spread 0.2, winning margin 0.1

    highlights = _compute_highlights([photo_finish, bunched], racer_map={})
    closest = next(h for h in highlights if h["type"] == "CLOSEST_RACE")

    assert closest["heat_number"] == 1
    assert closest["margin"] == pytest.approx(0.001)
