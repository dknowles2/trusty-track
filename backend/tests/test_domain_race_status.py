"""Rolling a race's heats up into NOT_STARTED/IN_PROGRESS/FINISHED (#847).

Pure domain test — no database, no GraphQL. `status_of` takes one lane
sequence per official heat and reuses `domain.lanes.is_finished` per heat,
which is already pinned by `test_domain_lanes.py`; this file is about the
rollup, not about re-proving `is_finished` itself.
"""

from backend.domain import race_status
from backend.domain.lanes import Lane


def _run(lane: int = 1, **overrides) -> Lane:
    """A lane holding a result, defaulting the fields a test does not care
    about."""
    return Lane(lane=lane, racer_id=1, time=5.0, place=1, **overrides)


def _unrun(lane: int = 1, **overrides) -> Lane:
    """A lane assigned but not yet raced."""
    return Lane(lane=lane, racer_id=1, **overrides)


def _skipped() -> Lane:
    return Lane(lane=1, racer_id=1, skipped=True)


def test_no_heats_at_all_is_not_started():
    assert race_status.status_of([]) == race_status.NOT_STARTED


def test_heats_generated_but_none_run_is_not_started():
    """A schedule with nothing recorded on it reads the same as no schedule
    at all — see the module docstring for why the two are not split into a
    fourth word."""
    heats = [[_unrun()], [_unrun(), _unrun()]]
    assert race_status.status_of(heats) == race_status.NOT_STARTED


def test_some_heats_finished_and_some_not_is_in_progress():
    heats = [[_run()], [_unrun()]]
    assert race_status.status_of(heats) == race_status.IN_PROGRESS


def test_every_heat_finished_is_finished():
    heats = [[_run()], [_run(2)]]
    assert race_status.status_of(heats) == race_status.FINISHED


def test_a_skipped_heat_counts_as_finished():
    """`is_finished` treats a skip as done — the operator is not coming back
    to it — and this rollup must not disagree with the predicate it reuses."""
    heats = [[_skipped()], [_run()]]
    assert race_status.status_of(heats) == race_status.FINISHED


def test_a_race_that_is_entirely_skipped_heats_is_finished_not_not_started():
    """The failure `has_results` would produce if it were used here instead
    of `is_finished`: a race finished purely by skipping every heat must not
    read as though racing never began."""
    heats = [[_skipped()], [_skipped()]]
    assert race_status.status_of(heats) == race_status.FINISHED


def test_a_heat_with_one_finished_lane_and_one_still_a_placeholder_counts_as_finished():
    """Matches `is_finished`'s own per-heat rule: any lane done is enough for
    the heat to be done, even with an unfilled championship slot in another
    lane — this module adds no second opinion about placeholders."""
    placeholder = Lane(lane=2, placeholder_slot=1)
    heats = [[_run(), placeholder]]
    assert race_status.status_of(heats) == race_status.FINISHED
