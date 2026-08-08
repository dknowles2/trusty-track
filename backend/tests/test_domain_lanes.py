"""Tests for the lane value object and the heat-level predicates over it.

This used to be mostly codec tests — parse, serialize, and the round trip that
advancement puts every championship heat through, where anything dropped was
silently gone from the user's race data. #72 removed the blob, so those went
with it: there is no string to parse, no unreadable blob to survive, and no
unmodelled key to carry.

What is left is the part that was never about storage: what a lane *is*, and
what a set of them says about a heat.
"""

import pytest

from backend.domain import lanes


def _lane(**kwargs) -> lanes.Lane:
    """A lane, defaulting the fields a given test does not care about."""
    return lanes.Lane(
        lane=kwargs.pop("lane", 1),
        racer_id=kwargs.pop("racer_id", None),
        time=kwargs.pop("time", None),
        place=kwargs.pop("place", None),
        extra=kwargs.pop("extra", {}),
    )


@pytest.mark.parametrize("value", [None, "", "abc", [], {}])
def test_seconds_is_none_for_anything_unparseable(value):
    assert lanes.Lane(lane=1, racer_id=1, time=value).seconds is None


def _lanes(*entries) -> list[lanes.Lane]:
    """Dict literals as lanes — still the most readable way to write a heat."""
    known = ("lane", "racer_id", "time", "place")
    return [
        lanes.Lane(
            lane=e["lane"],
            racer_id=e.get("racer_id"),
            time=e.get("time"),
            place=e.get("place"),
            extra={k: v for k, v in e.items() if k not in known},
        )
        for e in entries
    ]


def test_lane_classification():
    assert lanes.Lane(lane=1).is_empty
    assert lanes.Lane(lane=1, racer_id=-2).is_placeholder
    assert lanes.Lane(lane=1, racer_id=7).is_real_racer
    assert not lanes.Lane(lane=1, racer_id=-2).is_real_racer


def test_has_results_only_looks_at_times():
    """It deliberately ignores `skipped` — see the note in lanes.has_results."""
    unrun = _lanes({"lane": 1, "racer_id": 1, "time": None})
    assert not lanes.has_results(unrun)

    skipped = _lanes({"lane": 1, "racer_id": 1, "time": None, "skipped": 1})
    assert not lanes.has_results(skipped)

    run = _lanes({"lane": 1, "racer_id": 1, "time": 3.1})
    assert lanes.has_results(run)


def test_is_complete_requires_a_time_for_every_assigned_racer():
    assert lanes.is_complete(
        _lanes(
            {"lane": 1, "racer_id": 1, "time": 3.1},
            {"lane": 2, "racer_id": 2, "time": 3.2},
        )
    )
    # An unused lane does not block completion.
    assert lanes.is_complete(
        _lanes({"lane": 1, "racer_id": 1, "time": 3.1}, {"lane": 2, "racer_id": None})
    )
    # A missing time does.
    assert not lanes.is_complete(
        _lanes(
            {"lane": 1, "racer_id": 1, "time": 3.1},
            {"lane": 2, "racer_id": 2, "time": None},
        )
    )


def test_a_placeholder_can_never_complete_a_heat():
    """Even with a time — the racer for that slot has not been decided."""
    assert not lanes.is_complete(_lanes({"lane": 1, "racer_id": -1, "time": 3.1}))


def test_an_empty_heat_is_not_complete():
    assert not lanes.is_complete([])


def test_resolve_placeholders_maps_minus_one_to_the_first_racer():
    parsed = _lanes(
        {"lane": 1, "racer_id": -1, "time": None},
        {"lane": 2, "racer_id": -2, "time": None},
    )
    assert lanes.resolve_placeholders(parsed, [77, 88])
    assert [lane.racer_id for lane in parsed] == [77, 88]


def test_resolve_placeholders_leaves_unfilled_slots_alone():
    """Fewer racers advanced than the round has slots."""
    parsed = _lanes({"lane": 1, "racer_id": -1}, {"lane": 2, "racer_id": -2})
    assert lanes.resolve_placeholders(parsed, [77])
    assert [lane.racer_id for lane in parsed] == [77, -2]


def test_resolve_placeholders_reports_no_change():
    """So callers can skip a needless write."""
    parsed = _lanes({"lane": 1, "racer_id": 5})
    assert not lanes.resolve_placeholders(parsed, [77])
    assert parsed[0].racer_id == 5


def test_real_racer_ids_excludes_placeholders_and_gaps():
    parsed = _lanes(
        {"lane": 1, "racer_id": 5},
        {"lane": 2, "racer_id": -1},
        {"lane": 3, "racer_id": None},
        {"lane": 4, "racer_id": 9},
    )
    assert lanes.real_racer_ids(parsed) == [5, 9]


# --------------------------------------------------------------------------- #
# carry_extras — the write path (#5, step 5)                                    #
# --------------------------------------------------------------------------- #


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
