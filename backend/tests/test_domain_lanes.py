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


# --------------------------------------------------------------------------- #
# carry_extras — the write path (#5, step 5)                                    #
# --------------------------------------------------------------------------- #


def test_carry_extras_keeps_keys_the_client_cannot_send():
    """Structured input names every key this module models. Anything else is
    invisible to the client, so the update has to inherit it."""
    stored = lanes.parse(_blob({"lane": 1, "racer_id": 5, "someFutureKey": "keep"}))
    updates = [lanes.Lane(lane=1, racer_id=5, time=3.2, place=1)]

    merged = lanes.carry_extras(updates, stored)

    assert merged[0].extra == {"someFutureKey": "keep"}
    assert (merged[0].time, merged[0].place) == (3.2, 1)


def test_carry_extras_does_not_carry_skipped():
    """`skipped` is modelled now, so an update that omits it is un-skipping the
    heat. Carrying it would make a skipped heat impossible to re-run."""
    stored = lanes.parse(_blob({"lane": 1, "racer_id": 5, "skipped": True}))
    merged = lanes.carry_extras([lanes.Lane(lane=1, racer_id=5)], stored)
    assert merged[0].extra == {}
    assert not merged[0].skipped


def test_carry_extras_prefers_the_update():
    stored = lanes.parse(_blob({"lane": 1, "racer_id": 5, "note": "old"}))
    updates = [lanes.Lane(lane=1, racer_id=5, extra={"note": "new"})]
    assert lanes.carry_extras(updates, stored)[0].extra == {"note": "new"}


def test_carry_extras_matches_on_lane_number():
    """Lanes can be sent in any order, and a lane can change occupant."""
    stored = lanes.parse(
        _blob({"lane": 1, "racer_id": 5, "note": "one"}, {"lane": 2, "note": "two"})
    )
    updates = [lanes.Lane(lane=2, racer_id=9), lanes.Lane(lane=1, racer_id=5)]

    merged = lanes.carry_extras(updates, stored)

    assert [lane.lane for lane in merged] == [2, 1]
    assert merged[0].extra == {"note": "two"}
    assert merged[1].extra == {"note": "one"}


def test_carry_extras_handles_a_lane_with_no_stored_counterpart():
    merged = lanes.carry_extras([lanes.Lane(lane=3, racer_id=7)], [])
    assert merged[0].extra == {}
    assert merged[0].racer_id == 7


def test_an_entry_without_a_lane_number_is_dropped():
    """`lane` is the key everything sorts, arms and displays by, and `Lane.lane`
    is typed as one. No write path produces an entry without it, so a blob that
    holds one is malformed — treated like the other malformed input above."""
    assert lanes.parse(_blob({"racer_id": 5, "time": 3.1})) == []
    assert lanes.parse(_blob({"lane": "one", "racer_id": 5})) == []
    # `bool` is an `int`; `{"lane": true}` is not lane 1.
    assert lanes.parse(_blob({"lane": True, "racer_id": 5})) == []


def test_a_placeholder_reports_its_slot():
    """The sign convention lives in one property rather than an `abs()` at each
    call site."""
    assert lanes.Lane(lane=1, racer_id=-3).placeholder_slot == 3
    assert lanes.Lane(lane=1, racer_id=7).placeholder_slot is None
    assert lanes.Lane(lane=1, racer_id=None).placeholder_slot is None


def test_a_real_racer_reports_its_id():
    assert lanes.Lane(lane=1, racer_id=7).real_racer_id == 7
    assert lanes.Lane(lane=1, racer_id=-1).real_racer_id is None
    assert lanes.Lane(lane=1, racer_id=None).real_racer_id is None
