"""Tests for the lane_results codec and heat-level predicates.

The round-trip tests matter most: advancement parses, modifies, and re-serializes
every championship heat, so anything the codec drops is silently gone from the
user's race data.
"""

import json

import pytest

from backend.domain import lanes


def _blob(*entries) -> str:
    return json.dumps(list(entries))


def test_parse_reads_the_documented_shape():
    parsed = lanes.parse(_blob({"lane": 1, "racer_id": 10, "time": 3.452, "place": 2}))
    assert len(parsed) == 1
    lane = parsed[0]
    assert (lane.lane, lane.racer_id, lane.time, lane.place) == (1, 10, 3.452, 2)


@pytest.mark.parametrize("raw", [None, "", "not json", "{}", "[1, 2]", "null"])
def test_unreadable_blobs_parse_as_no_lanes(raw):
    """A corrupt heat should read as unraced, not take down the display."""
    assert lanes.parse(raw) == []


def test_unknown_keys_survive_a_round_trip():
    """`skipped` is written by the operator UI and never read by the backend.

    Dropping it while resolving placeholders would make a skipped heat look
    unrun in the schedule view.
    """
    raw = _blob(
        {"lane": 1, "racer_id": 5, "time": None, "place": None, "skipped": True}
    )
    out = json.loads(lanes.serialize(lanes.parse(raw)))
    assert out[0]["skipped"] is True


def test_time_is_stored_exactly_as_found():
    """The frontend sometimes writes a string; rewriting it is not our call."""
    raw = _blob({"lane": 1, "racer_id": 5, "time": "3.45", "place": 1})
    parsed = lanes.parse(raw)
    assert parsed[0].time == "3.45"
    assert parsed[0].seconds == 3.45
    assert json.loads(lanes.serialize(parsed))[0]["time"] == "3.45"


@pytest.mark.parametrize("value", [None, "", "abc", [], {}])
def test_seconds_is_none_for_anything_unparseable(value):
    assert lanes.Lane(lane=1, racer_id=1, time=value).seconds is None


def test_lane_classification():
    assert lanes.Lane(lane=1).is_empty
    assert lanes.Lane(lane=1, racer_id=-2).is_placeholder
    assert lanes.Lane(lane=1, racer_id=7).is_real_racer
    assert not lanes.Lane(lane=1, racer_id=-2).is_real_racer


def test_has_results_only_looks_at_times():
    """It deliberately ignores `skipped` — see the note in lanes.has_results."""
    unrun = lanes.parse(_blob({"lane": 1, "racer_id": 1, "time": None}))
    assert not lanes.has_results(unrun)

    skipped = lanes.parse(_blob({"lane": 1, "racer_id": 1, "time": None, "skipped": 1}))
    assert not lanes.has_results(skipped)

    run = lanes.parse(_blob({"lane": 1, "racer_id": 1, "time": 3.1}))
    assert lanes.has_results(run)


def test_is_complete_requires_a_time_for_every_assigned_racer():
    assert lanes.is_complete(
        lanes.parse(
            _blob(
                {"lane": 1, "racer_id": 1, "time": 3.1},
                {"lane": 2, "racer_id": 2, "time": 3.2},
            )
        )
    )
    # An unused lane does not block completion.
    assert lanes.is_complete(
        lanes.parse(
            _blob(
                {"lane": 1, "racer_id": 1, "time": 3.1}, {"lane": 2, "racer_id": None}
            )
        )
    )
    # A missing time does.
    assert not lanes.is_complete(
        lanes.parse(
            _blob(
                {"lane": 1, "racer_id": 1, "time": 3.1},
                {"lane": 2, "racer_id": 2, "time": None},
            )
        )
    )


def test_a_placeholder_can_never_complete_a_heat():
    """Even with a time — the racer for that slot has not been decided."""
    assert not lanes.is_complete(
        lanes.parse(_blob({"lane": 1, "racer_id": -1, "time": 3.1}))
    )


def test_an_empty_heat_is_not_complete():
    assert not lanes.is_complete([])


def test_resolve_placeholders_maps_minus_one_to_the_first_racer():
    parsed = lanes.parse(
        _blob(
            {"lane": 1, "racer_id": -1, "time": None},
            {"lane": 2, "racer_id": -2, "time": None},
        )
    )
    assert lanes.resolve_placeholders(parsed, [77, 88])
    assert [lane.racer_id for lane in parsed] == [77, 88]


def test_resolve_placeholders_leaves_unfilled_slots_alone():
    """Fewer racers advanced than the round has slots."""
    parsed = lanes.parse(
        _blob({"lane": 1, "racer_id": -1}, {"lane": 2, "racer_id": -2})
    )
    assert lanes.resolve_placeholders(parsed, [77])
    assert [lane.racer_id for lane in parsed] == [77, -2]


def test_resolve_placeholders_reports_no_change():
    """So callers can skip a needless write."""
    parsed = lanes.parse(_blob({"lane": 1, "racer_id": 5}))
    assert not lanes.resolve_placeholders(parsed, [77])
    assert parsed[0].racer_id == 5


def test_real_racer_ids_excludes_placeholders_and_gaps():
    parsed = lanes.parse(
        _blob(
            {"lane": 1, "racer_id": 5},
            {"lane": 2, "racer_id": -1},
            {"lane": 3, "racer_id": None},
            {"lane": 4, "racer_id": 9},
        )
    )
    assert lanes.real_racer_ids(parsed) == [5, 9]
