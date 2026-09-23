"""#1329: `RaceStats.hasRecordedTimes` and `Race.hasRecordedTimes` are the
one derived fact ("has this race ever recorded a time") both the Stats page
and the Displays panel ask, rather than each re-deriving it — see
`backend.domain.scoring.has_any_recorded_time` and
`RequestLoaders.has_recorded_time_for_race`. The table here is the same one
`test_domain_scoring.py::TestHasAnyRecordedTime` pins at the pure-function
level, exercised end to end through the GraphQL types both surfaces read.
"""

from backend.tests.helpers import record_heat_result
from backend.tests.test_race_stats import _create_round_and_get_heats, _setup_race

STATS_QUERY = """
query($raceId: Int!) {
  raceStats(raceId: $raceId) { hasRecordedTimes }
}
"""

RACE_QUERY = """
query($raceId: Int!) {
  race(raceId: $raceId) { hasRecordedTimes }
}
"""


def _both(client, race_id) -> tuple[bool, bool]:
    """(RaceStats.hasRecordedTimes, Race.hasRecordedTimes) — must agree,
    since both read the identical loader-backed predicate."""
    stats_resp = client.post(
        "/graphql", json={"query": STATS_QUERY, "variables": {"raceId": race_id}}
    )
    assert stats_resp.status_code == 200, stats_resp.text
    race_resp = client.post(
        "/graphql", json={"query": RACE_QUERY, "variables": {"raceId": race_id}}
    )
    assert race_resp.status_code == 200, race_resp.text
    return (
        stats_resp.json()["data"]["raceStats"]["hasRecordedTimes"],
        race_resp.json()["data"]["race"]["hasRecordedTimes"],
    )


def test_no_heats_at_all(client, db):
    """A brand-new race with no round generated yet."""
    race_id, _racer_ids, _racing_group_ids = _setup_race(client, db)
    assert _both(client, race_id) == (False, False)


def test_heats_scheduled_but_none_run(client, db):
    race_id, _racer_ids, _racing_group_ids = _setup_race(client, db)
    _create_round_and_get_heats(client, race_id)
    assert _both(client, race_id) == (False, False)


def test_heats_run_with_places_and_no_times(client, db):
    """A pure POINTS race: every lane gets a place typed in, no time ever
    recorded. Fully raced, and still `False` here — this is the
    configuration #1329 is about."""
    race_id, racer_ids, _racing_group_ids = _setup_race(client, db)
    heats = _create_round_and_get_heats(client, race_id)
    for heat in heats:
        record_heat_result(
            client,
            heat["id"],
            [
                {"lane": i + 1, "racer_id": racer_id, "place": i + 1}
                for i, racer_id in enumerate(racer_ids)
            ],
        )
    assert _both(client, race_id) == (False, False)


def test_heats_with_times(client, db):
    race_id, racer_ids, _racing_group_ids = _setup_race(client, db)
    heats = _create_round_and_get_heats(client, race_id)
    record_heat_result(
        client,
        heats[0]["id"],
        [
            {"lane": i + 1, "racer_id": racer_id, "time": 3.1 + i, "place": i + 1}
            for i, racer_id in enumerate(racer_ids)
        ],
    )
    assert _both(client, race_id) == (True, True)


def test_one_time_among_many_blanks(client, db):
    """A race WITH recorded times: one heat carries places and no times,
    a later heat carries one hand-typed time among otherwise-blank lanes."""
    race_id, racer_ids, _racing_group_ids = _setup_race(client, db)
    heats = _create_round_and_get_heats(client, race_id)
    record_heat_result(
        client,
        heats[0]["id"],
        [
            {"lane": i + 1, "racer_id": racer_id, "place": i + 1}
            for i, racer_id in enumerate(racer_ids)
        ],
    )
    if len(heats) > 1:
        record_heat_result(
            client,
            heats[1]["id"],
            [
                {"lane": 1, "racer_id": racer_ids[0], "time": 3.5, "place": 1},
                *(
                    {"lane": i + 2, "racer_id": racer_id}
                    for i, racer_id in enumerate(racer_ids[1:])
                ),
            ],
        )
    else:
        # Only one heat was scheduled (a 4-racer, 4-lane round runs one
        # heat) — correct it in place to add the one time.
        record_heat_result(
            client,
            heats[0]["id"],
            [
                {"lane": 1, "racer_id": racer_ids[0], "time": 3.5, "place": 1},
                *(
                    {"lane": i + 2, "racer_id": racer_id, "place": i + 2}
                    for i, racer_id in enumerate(racer_ids[1:])
                ),
            ],
        )
    assert _both(client, race_id) == (True, True)
