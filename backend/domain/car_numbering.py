"""Pure rules for car numbers and racing-group number ranges (#739, #741).

No SQLAlchemy, no Strawberry — see `CLAUDE.md`'s rule for `domain/`. The
"which numbers are a race's racers already holding" question is answered
once, in `backend.db.crud._taken_car_numbers` (#789, #739) — that needs a
database and stays there. This module holds the two questions that do not:
whether a racing group's own range makes sense, and whether two racing
groups' ranges intersect.
"""


def range_is_valid(start: int | None, end: int | None) -> bool:
    """False only when both bounds are given and the end is before the start.

    Either bound absent means "open" — see `ranges_overlap` — and there is
    nothing to compare.
    """
    if start is None or end is None:
        return True
    return end >= start


def ranges_overlap(a_start: int, a_end: int | None, b_start: int, b_end: int | None) -> bool:
    """Whether two closed car-number ranges intersect.

    ``None`` for an end means "open, no upper bound" — the same meaning
    ``RacingGroup.car_number_range_end`` already carries for auto-numbering
    (`crud.next_free_car_number`), so this treats it the same way rather
    than as "no range". A range with no *start* does not participate in
    per-group numbering at all (`next_free_car_number` returns ``None`` for
    it) and has nothing to overlap with — callers filter those out before
    calling this, rather than this function guessing what a missing start
    means.
    """
    if a_end is not None and a_end < b_start:
        return False
    if b_end is not None and b_end < a_start:
        return False
    return True
