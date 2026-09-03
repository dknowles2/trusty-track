"""`race_stats` is a mechanical 1:1 mapping, and this pins that it stays one (#434).

`services/stats.py::compute_race_stats` documents its return value as "a dict
matching the RaceStats Strawberry type" — every key is a field on the
GraphQL type, one level deep or nested. The resolver in `api/schema.py`
used to defeat that contract with a second, hand-copied field list (~90
lines): every field name spelled out twice, so adding a field to one side
and forgetting the other would only surface once someone noticed it missing
from a screen.

The fix makes the resolver a mechanical `Type(**dict)` conversion, per field
group. A behavioral test can't see *how* the resolver is written, so instead
of asserting on individual fields (which would pass whether the mapping was
mechanical or hand-copied, as long as both were correct), this compares the
GraphQL payload against the service's own dict, field for field and
recursively — which fails the moment a field exists on one side and not the
other, the exact drift the hand-copy invited.
"""

import pytest

from backend.services import stats as race_stats_module
from backend.tests.test_race_stats import (
    _create_round_and_get_heats,
    _full_results,
    _record_heat_result,
    _setup_race,
)

# Every field on every `RaceStats` type, nested types included — deliberately
# broader than `test_race_stats.RACE_STATS_QUERY`, which only asks for the
# fields its own behavioral assertions read.
FULL_RACE_STATS_QUERY = """
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
      racerId firstName lastName carNumber racingGroupName
      heatsCompleted heatsScheduled minTime maxTime meanTime stdDev
      timesPerLane { lane avgTime }
    }
    highlights {
      type roundName heatNumber globalHeatNumber racerName time margin
    }
    racingGroupStats {
      racingGroupId racingGroupName racingGroupColor racerCount avgScore bestRacerName
    }
    heatResults {
      roundName heatNumber globalHeatNumber lane carNumber
      racerFirstName racerLastName time place
    }
    trackRecords {
      timeSeconds racerName carNumber raceId raceName raceDate
    }
    topScaleMph
  }
}
"""


def _camel(snake: str) -> str:
    """`snake_case` -> `camelCase`, the same convention Strawberry applies."""
    head, *tail = snake.split("_")
    return head + "".join(word.title() for word in tail)


def _assert_matches(service_value: object, graphql_value: object, path: str) -> None:
    """Recursively assert a service-layer value and its GraphQL twin agree.

    `service_value` is whatever `compute_race_stats` produced (dicts, lists,
    floats, ...); `graphql_value` is the JSON the query above returned. Every
    dict key is converted through the same `snake_case` -> `camelCase` rule
    Strawberry applies, and the *set* of keys is compared too — not just the
    values under keys both sides happen to share — so a field present on one
    side and absent from the other fails here rather than passing silently.
    """
    if isinstance(service_value, dict):
        assert isinstance(graphql_value, dict), f"{path}: expected an object"
        expected_keys = {_camel(k) for k in service_value}
        assert expected_keys == set(graphql_value), (
            f"{path}: field sets differ - "
            f"service only: {expected_keys - set(graphql_value)}, "
            f"graphql only: {set(graphql_value) - expected_keys}"
        )
        for key, value in service_value.items():
            _assert_matches(value, graphql_value[_camel(key)], f"{path}.{key}")
    elif isinstance(service_value, list):
        assert isinstance(graphql_value, list), f"{path}: expected a list"
        assert len(service_value) == len(graphql_value), (
            f"{path}: length differs - "
            f"service={len(service_value)} graphql={len(graphql_value)}"
        )
        for i, (sv, gv) in enumerate(zip(service_value, graphql_value, strict=True)):
            _assert_matches(sv, gv, f"{path}[{i}]")
    elif isinstance(service_value, float):
        assert graphql_value == pytest.approx(service_value), path
    else:
        assert service_value == graphql_value, path


def test_race_stats_payload_matches_the_service_dict_field_for_field(client, db):
    """The GraphQL `raceStats` payload is exactly `compute_race_stats`'s dict.

    Builds a race with enough shape to populate every branch of the
    payload — multiple racing_groups, a recorded heat (so `racerStats`, `laneStats`,
    `highlights`, `racingGroupStats` and `heatResults` are all non-empty) and a
    positive time on the race's own track (so `trackRecords` is too).
    """
    race_id, racer_ids, racing_group_ids = _setup_race(client, db)
    heats = _create_round_and_get_heats(client, race_id)
    assert heats

    heat_id = heats[0]["id"]
    results = _full_results(
        db,
        heat_id,
        {
            racer_ids[0]: {"time": 3.1, "place": 1},
            racer_ids[1]: {"time": 3.5, "place": 2},
            racer_ids[2]: {"time": 3.8, "place": 3},
            racer_ids[3]: {"time": 4.1, "place": 4},
        },
    )
    _record_heat_result(client, heat_id, results)

    resp = client.post(
        "/graphql",
        json={"query": FULL_RACE_STATS_QUERY, "variables": {"raceId": race_id}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "errors" not in body, body["errors"]
    graphql_data = body["data"]["raceStats"]
    assert graphql_data is not None

    # Sanity check the fixture actually exercised every branch, so a payload
    # that is field-for-field equal to an all-empty dict can't pass by
    # accident.
    service_data = race_stats_module.compute_race_stats(db, race_id)
    assert service_data is not None
    for key in (
        "lane_stats",
        "racer_stats",
        "highlights",
        "racing_group_stats",
        "heat_results",
        "track_records",
    ):
        assert service_data[key], f"fixture produced no {key} to compare"

    _assert_matches(service_data, graphql_data, "raceStats")


def test_race_stats_payload_matches_with_no_results_recorded(client, db):
    """The empty-payload branches are field-for-field equal too.

    `racerStats`, `highlights`, `racingGroupStats` and `heatResults` are all empty
    lists before anything is recorded, and `trackRecords` has nothing to
    show either — the shape a mechanical mapping still has to get right, not
    just the populated one above.
    """
    race_id, racer_ids, racing_group_ids = _setup_race(client, db)
    _create_round_and_get_heats(client, race_id)

    resp = client.post(
        "/graphql",
        json={"query": FULL_RACE_STATS_QUERY, "variables": {"raceId": race_id}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "errors" not in body, body["errors"]
    graphql_data = body["data"]["raceStats"]
    assert graphql_data is not None

    service_data = race_stats_module.compute_race_stats(db, race_id)
    assert service_data is not None

    _assert_matches(service_data, graphql_data, "raceStats")
