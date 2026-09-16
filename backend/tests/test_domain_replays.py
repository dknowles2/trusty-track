"""Pure retention rules for stored replay clips (#177 stage 2).

No database, no filesystem — `domain.replays.heats_beyond_count`/
`heats_beyond_size` take a list of `HeatActivity` and return which heat ids
fall outside the bound. `services.replays.enforce_retention` is the I/O
wrapper tested against a real database in `test_replays.py`.
"""

from backend.domain.replays import HeatActivity, heats_beyond_count, heats_beyond_size


def _activity(heat_id: int, last_activity: str, total_bytes: int = 100) -> HeatActivity:
    return HeatActivity(
        heat_id=heat_id, last_activity=last_activity, total_bytes=total_bytes
    )


# --------------------------------------------------------------------------- #
# heats_beyond_count                                                          #
# --------------------------------------------------------------------------- #


def test_none_means_unbounded():
    heats = [_activity(1, "a"), _activity(2, "b")]
    assert heats_beyond_count(heats, None) == []


def test_a_negative_bound_also_means_unbounded():
    """Cannot mean anything else — there is no such thing as keeping a
    negative number of heats."""
    heats = [_activity(1, "a"), _activity(2, "b")]
    assert heats_beyond_count(heats, -1) == []


def test_keeps_the_most_recently_active_n_heats():
    heats = [
        _activity(1, "2026-01-01T00:00:00+00:00"),
        _activity(2, "2026-01-02T00:00:00+00:00"),
        _activity(3, "2026-01-03T00:00:00+00:00"),
    ]
    # Keep the newest 2 — heat 1 (oldest `last_activity`) falls outside it.
    assert heats_beyond_count(heats, 2) == [1]


def test_zero_purges_every_heat():
    heats = [_activity(1, "a"), _activity(2, "b")]
    assert set(heats_beyond_count(heats, 0)) == {1, 2}


def test_a_bound_at_or_above_the_count_purges_nothing():
    heats = [_activity(1, "a"), _activity(2, "b")]
    assert heats_beyond_count(heats, 5) == []


# --------------------------------------------------------------------------- #
# heats_beyond_size                                                           #
# --------------------------------------------------------------------------- #


def test_size_none_means_unbounded():
    heats = [_activity(1, "a", total_bytes=10_000_000)]
    assert heats_beyond_size(heats, None) == []


def test_purges_the_oldest_heats_first_until_under_the_cap():
    heats = [
        _activity(1, "2026-01-01T00:00:00+00:00", total_bytes=1 * 1024 * 1024),
        _activity(2, "2026-01-02T00:00:00+00:00", total_bytes=1 * 1024 * 1024),
        _activity(3, "2026-01-03T00:00:00+00:00", total_bytes=1 * 1024 * 1024),
    ]
    # 3 MB total, cap at 2 MB — the oldest (heat 1) has to go; that alone
    # brings the total to 2 MB, right at the cap, so nothing else is purged.
    assert heats_beyond_size(heats, 2) == [1]


def test_purges_more_than_one_heat_if_it_takes_that_many_to_fit():
    heats = [
        _activity(1, "2026-01-01T00:00:00+00:00", total_bytes=3 * 1024 * 1024),
        _activity(2, "2026-01-02T00:00:00+00:00", total_bytes=3 * 1024 * 1024),
        _activity(3, "2026-01-03T00:00:00+00:00", total_bytes=1 * 1024 * 1024),
    ]
    # 7 MB total, cap at 2 MB — heats 1 and 2 both have to go; heat 3 alone
    # (1 MB) already fits under the cap, so it survives.
    assert set(heats_beyond_size(heats, 2)) == {1, 2}


def test_already_under_the_cap_purges_nothing():
    heats = [_activity(1, "a", total_bytes=1024)]
    assert heats_beyond_size(heats, 100) == []


def test_both_bounds_are_evaluated_independently_by_the_caller():
    """This module hands back one set per bound; `services.replays.
    enforce_retention` is what unions them. Documented here so the split
    doesn't quietly move."""
    heats = [
        _activity(1, "2026-01-01T00:00:00+00:00", total_bytes=1),
        _activity(2, "2026-01-02T00:00:00+00:00", total_bytes=1),
    ]
    assert heats_beyond_count(heats, 1) == [1]
    assert heats_beyond_size(heats, 100) == []
