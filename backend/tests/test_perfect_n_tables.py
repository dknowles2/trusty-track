"""``perfect_n_tables.py`` itself, exhaustively (#1090, part C).

`test_domain_scheduling.py`'s PERFECT_N section checks the property that
matters through the real scheduling path — `generate_perfect_n`'s output,
shuffled and lane-mapped, for the *default* chart of each shape. This file
checks every row of the transcription directly, against the raw grid
:func:`backend.domain.schedulers.perfect_n.build_grid` produces — including
the alternates `default_chart` never picks (a CP chart, or a P chart that
is not the fewest-heats one for its shape) and the three rows excluded for
not verifying (confirming *why*, so a future re-read of the source finding
them fine would have something concrete to overturn).

**No DerbyNet fixture comparison lives here.** DerbyNet
(`jeffpiazza/derbynet`) publishes its own charts as generator code, not
rows, and its repository declares no licence (`gh api repos/jeffpiazza/
derbynet --jq .license` → `NOASSERTION`), so its data is not vendored into
this repo's fixtures. `scripts/compare_perfect_n_with_derbynet.py` fetches
it live and compares rows after normalising car numbering; the PR body
carries the per-shape result.
"""

from __future__ import annotations

from collections import Counter

import pytest

from backend.domain.schedulers.perfect_n import build_grid
from backend.domain.schedulers.perfect_n_tables import ALL_ROWS, CHARTS, EXCLUDED


def _pairwise_meetings(grid: list[tuple[int, ...]]) -> Counter[tuple[int, int]]:
    counts: Counter[tuple[int, int]] = Counter()
    for row in grid:
        for i in range(len(row)):
            for j in range(i + 1, len(row)):
                a, b = row[i], row[j]
                counts[(min(a, b), max(a, b))] += 1
    return counts


def _is_complementary(grid: list[tuple[int, ...]], lanes: int) -> bool:
    """Per `cyoung2.html`'s formal definition: for every pair of lanes
    ``(x, y)`` and every pair of cars, the count of "n at x, m at y" equals
    the count of "n at y, m at x" — a lane-reversal symmetry, stronger than
    (and not implied by) a constant overall meeting count.
    """
    for x in range(lanes):
        for y in range(x + 1, lanes):
            counts = Counter((row[x], row[y]) for row in grid)
            for (a, b), c in counts.items():
                if counts.get((b, a), 0) != c:
                    return False
    return True


ALL_SYMBOLS = [chart.symbol for chart in ALL_ROWS]


def test_no_duplicate_symbols():
    assert len(ALL_SYMBOLS) == len(set(ALL_SYMBOLS)), "a chart symbol repeats"


def test_charts_omits_exactly_the_excluded_symbols():
    kept = {chart.symbol for charts in CHARTS.values() for chart in charts}
    assert kept == set(ALL_SYMBOLS) - set(EXCLUDED)


@pytest.mark.parametrize("chart", ALL_ROWS, ids=lambda c: c.symbol)
def test_every_row_gives_every_car_every_lane_the_same_number_of_times(chart):
    """Half of Perfect-N's own definition (`cyoung2.html`): every car races
    the same number of times in each lane. Checked for every transcribed
    row, including the three excluded ones — a chart can satisfy this half
    and still fail the pairing half below, which is exactly what happened.
    """
    grid = build_grid(chart)
    assert len(grid) == chart.heats
    runs = chart.heats // chart.cars
    lane_of: dict[int, Counter[int]] = {c: Counter() for c in range(1, chart.cars + 1)}
    for row in grid:
        assert len(row) == chart.lanes
        assert len(set(row)) == chart.lanes, f"{chart.symbol}: a heat repeats a car"
        for lane_index, car in enumerate(row):
            lane_of[car][lane_index] += 1
    for car, counts in lane_of.items():
        assert set(counts.values()) == {runs} and len(counts) == chart.lanes, (
            f"{chart.symbol}: car {car} ran lanes {dict(counts)}, "
            f"expected {runs} each across all {chart.lanes}"
        )


@pytest.mark.parametrize(
    "chart", [c for c in ALL_ROWS if c.symbol not in EXCLUDED], ids=lambda c: c.symbol
)
def test_every_kept_row_meets_its_own_claimed_pair_count(chart):
    """The other half: every pair of cars meets exactly the chart's own
    ``(M)`` — checked for every row `CHARTS` actually serves, i.e. every row
    except the three in `EXCLUDED` (checked separately, below, to fail with
    the *expected* reason rather than by omission).
    """
    grid = build_grid(chart)
    meetings = _pairwise_meetings(grid)
    total_pairs = chart.cars * (chart.cars - 1) // 2
    assert len(meetings) == total_pairs, (
        f"{chart.symbol}: {len(meetings)} distinct pairs met, "
        f"expected all {total_pairs}"
    )
    kvals = set(meetings.values())
    assert kvals == {chart.meetings}, (
        f"{chart.symbol}: pairwise meeting counts {sorted(kvals)}, "
        f"claimed constant {chart.meetings}"
    )


@pytest.mark.parametrize(
    "chart",
    [c for c in ALL_ROWS if c.complementary and c.symbol not in EXCLUDED],
    ids=lambda c: c.symbol,
)
def test_every_kept_cp_row_is_genuinely_complementary(chart):
    """The extra guarantee a "CP" symbol claims over a plain "P" one — see
    `cyoung2.html`'s formal definition, reproduced in `_is_complementary`
    above. Every "P" row in `perfect_n_tables.py` was built by hand from
    Pope's own `(g, -g)` construction (his Theorem: a Perfect-N chart plus
    its complement is Perfect-N *and* Complementary), so this is confirming
    the transcription reproduced that correctly, not testing new math.
    """
    grid = build_grid(chart)
    assert _is_complementary(grid, chart.lanes), (
        f"{chart.symbol}: claims Complementary but a lane-reversal pair is unequal"
    )


def test_excluded_rows_fail_for_the_documented_reason():
    """`EXCLUDED` names three rows whose own claim does not verify — pinned
    here so a table edit that accidentally "fixes" one silently (rather
    than through a deliberate correction to `EXCLUDED` and its comment) is
    caught: if a row starts verifying, this test's inverted assertion
    breaks, which is the signal to go re-read the module docstring's
    account of it and decide whether the row belongs in `CHARTS` now.
    """
    by_symbol = {c.symbol: c for c in ALL_ROWS}
    assert set(EXCLUDED) == {"CP7-3 (4)", "P73-9 (1)", "CP73-9 (2)"}
    for symbol in EXCLUDED:
        chart = by_symbol[symbol]
        grid = build_grid(chart)
        meetings = _pairwise_meetings(grid)
        total_pairs = chart.cars * (chart.cars - 1) // 2
        kvals = set(meetings.values())
        fails = len(meetings) != total_pairs or kvals != {chart.meetings}
        assert fails, (
            f"{symbol} now verifies — remove it from EXCLUDED and update "
            "the module docstring's account of it, rather than leaving a "
            "working chart excluded"
        )
