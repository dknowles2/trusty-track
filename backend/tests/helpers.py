"""Shared helpers for the GraphQL tests."""

from typing import Any

UPDATE_HEAT_RESULT = """
mutation UpdateHeatResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
  updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
}
"""

RECORD_FREE_RACE_RESULT = """
mutation RecordFreeRaceResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
  recordFreeRaceResult(heatId: $heatId, lanes: $lanes) { id laneResults }
}
"""


def lane_input(entry: dict[str, Any]) -> dict[str, Any]:
    """A ``lane_results`` blob entry as ``HeatLaneInput``.

    Most of these tests build a heat's lanes in the blob's shape because that is
    what the fixtures and `crud` still use. This converts one, including the
    negative-id placeholder encoding the input replaced.
    """
    racer_id = entry.get("racer_id")
    placeholder = -racer_id if racer_id is not None and racer_id < 0 else None
    time = entry.get("time")
    return {
        "lane": entry["lane"],
        "racerId": None if placeholder is not None or racer_id is None else racer_id,
        "placeholderSlot": placeholder,
        "time": float(time) if time is not None else None,
        "place": entry.get("place"),
        "skipped": bool(entry.get("skipped")),
    }


def record_heat_result(client, heat_id: int, entries: list[dict]) -> dict:
    """Record a heat's results through the GraphQL mutation."""
    response = client.post(
        "/graphql",
        json={
            "query": UPDATE_HEAT_RESULT,
            "variables": {
                "heatId": heat_id,
                "lanes": [lane_input(entry) for entry in entries],
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "errors" not in body, body["errors"]
    return body["data"]
