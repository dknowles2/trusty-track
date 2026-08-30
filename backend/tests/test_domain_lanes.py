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
    return _lanes({"lane": 1, **kwargs})[0]


@pytest.mark.parametrize("value", [None, "", "abc", [], {}])
def test_seconds_is_none_for_anything_unparseable(value):
    assert lanes.Lane(lane=1, racer_id=1, time=value).seconds is None


def _lanes(*entries) -> list[lanes.Lane]:
    """Dict literals as lanes — still the most readable way to write a heat.

    A negative `racer_id` is an unadvanced championship slot, which is a fixture
    shorthand rather than how `Lane` holds it (#164).
    """
    out = []
    for e in entries:
        racer_id = e.get("racer_id")
        placeholder = -racer_id if racer_id is not None and racer_id < 0 else None
        out.append(
            lanes.Lane(
                lane=e["lane"],
                racer_id=None if placeholder is not None else racer_id,
                placeholder_slot=placeholder,
                time=e.get("time"),
                place=e.get("place"),
                skipped=bool(e.get("skipped")),
            )
        )
    return out


def test_lane_classification():
    assert lanes.Lane(lane=1).is_empty
    assert lanes.Lane(lane=1, placeholder_slot=2).is_placeholder
    assert not lanes.Lane(lane=1, racer_id=7).is_placeholder


def test_an_undecided_slot_is_not_an_empty_lane():
    """The trap in giving `Lane` real fields (#164).

    A placeholder used to hold a negative id, so it was never empty. With the
    id now `None`, an `is_empty` that asked only about `racer_id` would call it
    empty — and `is_complete` skips empty lanes, so a round of slots nobody has
    advanced into would read as finished.
    """
    slot = lanes.Lane(lane=1, placeholder_slot=1)
    assert not slot.is_empty
    assert lanes.Lane(lane=1).is_empty
    assert not lanes.is_complete([slot])


def test_has_results_ignores_skipped():
    """It deliberately ignores `skipped` — see the note in lanes.has_results."""
    unrun = _lanes({"lane": 1, "racer_id": 1, "time": None})
    assert not lanes.has_results(unrun)

    skipped = _lanes({"lane": 1, "racer_id": 1, "time": None, "skipped": 1})
    assert not lanes.has_results(skipped)

    run = _lanes({"lane": 1, "racer_id": 1, "time": 3.1})
    assert lanes.has_results(run)


def test_has_results_counts_a_place_with_no_time():
    """A `POINTS` race entered by hand (#490) never has a time at all — the
    place is the only record there is, and a round holding one must not be
    regenerable as though nothing had happened."""
    placed = _lanes({"lane": 1, "racer_id": 1, "time": None, "place": 1})
    assert lanes.has_results(placed)
    assert lanes.is_finished(placed)


def test_a_placeholder_still_has_no_result_of_its_own():
    """A slot cannot hold a hand-entered place any more than it can a time —
    it has not been decided into a racer yet."""
    slot = lanes.Lane(lane=1, placeholder_slot=1)
    assert not slot.has_result


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
    assert [lane.racer_id for lane in parsed] == [77, None]
    # The filled lane stops being a placeholder; the unfilled one does not.
    assert [lane.placeholder_slot for lane in parsed] == [None, 2]


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


def test_the_scheduler_s_negative_ids_are_decoded_at_one_boundary():
    """`from_participant` is where the convention lives now (#164).

    `domain/scheduling.py` matches opaque ids and hands out negative ones for
    undecided slots. That is the scheduler's vocabulary; `Lane` no longer
    speaks it, and this is the only place on the write path that translates.
    """
    slot = lanes.from_participant(1, -3)
    assert (slot.placeholder_slot, slot.racer_id) == (3, None)

    racer = lanes.from_participant(2, 7)
    assert (racer.placeholder_slot, racer.racer_id) == (None, 7)

    empty = lanes.from_participant(3, None)
    assert (empty.placeholder_slot, empty.racer_id) == (None, None)
    assert empty.is_empty


def test_duplicate_lane_numbers_finds_a_repeat():
    """Two rows claiming lane 1 (#307) — what a valid heat never has."""
    parsed = _lanes({"lane": 1, "racer_id": 5}, {"lane": 1, "racer_id": 9}, {"lane": 2})
    assert lanes.duplicate_lane_numbers(parsed) == [1]


def test_duplicate_lane_numbers_names_each_repeat_once():
    parsed = _lanes(
        {"lane": 1, "racer_id": 5},
        {"lane": 1, "racer_id": 9},
        {"lane": 1, "racer_id": 3},
    )
    assert lanes.duplicate_lane_numbers(parsed) == [1]


def test_duplicate_lane_numbers_empty_for_a_clean_set():
    parsed = _lanes({"lane": 1, "racer_id": 5}, {"lane": 2, "racer_id": 9})
    assert lanes.duplicate_lane_numbers(parsed) == []


def test_places_below_one_flags_zero_and_negative():
    """#524: a hand-entered `0` or negative place is a reward under `POINTS`,
    not merely a bad number — it subtracts from the racer's total."""
    parsed = _lanes(
        {"lane": 1, "racer_id": 5, "place": 0},
        {"lane": 2, "racer_id": 9, "place": -1},
        {"lane": 3, "racer_id": 3, "place": 1},
    )
    assert lanes.places_below_one(parsed) == [1, 2]


def test_places_below_one_empty_for_a_clean_set():
    parsed = _lanes({"lane": 1, "racer_id": 5, "place": 1}, {"lane": 2, "racer_id": 9})
    assert lanes.places_below_one(parsed) == []


def test_places_above_field_flags_a_place_past_the_racers_present():
    """A four-car heat has no 5th place to hand out."""
    parsed = _lanes(
        {"lane": 1, "racer_id": 5, "place": 1},
        {"lane": 2, "racer_id": 9, "place": 5},
        {"lane": 3, "racer_id": 3, "place": 3},
        {"lane": 4, "racer_id": 7, "place": 4},
    )
    assert lanes.places_above_field(parsed) == [2]


def test_places_above_field_ignores_placeholders_and_empty_lanes():
    """The bound is real racers, not lane count."""
    parsed = _lanes(
        {"lane": 1, "racer_id": 5, "place": 1},
        {"lane": 2, "place": 2},  # an empty lane — no racer, no placeholder
    )
    assert lanes.places_above_field(parsed) == [2]


def test_places_above_field_is_unbounded_when_nobody_is_a_real_racer():
    """An anonymous free race heat has no field to bound against."""
    parsed = _lanes({"lane": 1, "racer_id": None, "place": 1})
    assert lanes.places_above_field(parsed) == []


def test_duplicate_places_finds_a_repeat():
    """Two lanes both placed 1st: both cars score a point, nobody scores two."""
    parsed = _lanes(
        {"lane": 1, "racer_id": 5, "place": 1},
        {"lane": 2, "racer_id": 9, "place": 1},
    )
    assert lanes.duplicate_places(parsed) == [1]


def test_duplicate_places_names_each_repeat_once():
    parsed = _lanes(
        {"lane": 1, "racer_id": 5, "place": 2},
        {"lane": 2, "racer_id": 9, "place": 2},
        {"lane": 3, "racer_id": 3, "place": 2},
    )
    assert lanes.duplicate_places(parsed) == [2]


def test_duplicate_places_ignores_unplaced_lanes():
    parsed = _lanes(
        {"lane": 1, "racer_id": 5, "place": None}, {"lane": 2, "racer_id": 9}
    )
    assert lanes.duplicate_places(parsed) == []


def test_real_racer_ids_is_dense():
    """It drops unused lanes and undecided slots rather than yielding None."""
    assert lanes.real_racer_ids(
        [
            lanes.Lane(lane=1, racer_id=7),
            lanes.Lane(lane=2, placeholder_slot=1),
            lanes.Lane(lane=3),
            lanes.Lane(lane=4, racer_id=9),
        ]
    ) == [7, 9]
