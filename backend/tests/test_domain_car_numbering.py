"""Pure rules for car-number ranges (#741). No database, no Strawberry."""

from backend.domain.car_numbering import range_is_valid, ranges_overlap


def test_range_is_valid_when_end_at_or_after_start():
    assert range_is_valid(100, 199) is True
    assert range_is_valid(100, 100) is True


def test_range_is_valid_false_when_end_before_start():
    assert range_is_valid(199, 100) is False


def test_range_is_valid_true_when_either_bound_is_open():
    assert range_is_valid(None, 100) is True
    assert range_is_valid(100, None) is True
    assert range_is_valid(None, None) is True


def test_ranges_overlap_when_they_intersect():
    assert ranges_overlap(100, 199, 150, 299) is True
    assert ranges_overlap(150, 299, 100, 199) is True
    # One entirely inside the other.
    assert ranges_overlap(100, 299, 150, 199) is True


def test_ranges_do_not_overlap_when_disjoint():
    assert ranges_overlap(100, 199, 200, 299) is False
    assert ranges_overlap(200, 299, 100, 199) is False


def test_ranges_touching_at_a_single_number_overlap():
    # Closed intervals: sharing car number 200 is a real collision.
    assert ranges_overlap(100, 200, 200, 299) is True


def test_open_ended_range_overlaps_anything_past_its_start():
    assert ranges_overlap(100, None, 200, 299) is True
    assert ranges_overlap(100, None, 50, 99) is False
    assert ranges_overlap(100, None, 100, None) is True
