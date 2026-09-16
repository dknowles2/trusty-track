#!/usr/bin/env python3
"""Compare `backend/domain/schedulers/perfect_n_tables.py` against DerbyNet.

#1090 (part C) decision 1 asks for a row-for-row comparison between this
repo's Perfect-N tables (hand-transcribed from Stan Pope's own "Race Grid
Directory", `perfect_n_tables.py`) and DerbyNet's own. DerbyNet
(`jeffpiazza/derbynet`) does not publish a directory of literal chart rows
either — it builds a schedule at request time from a *generator sequence*
(`website/inc/generators/{lanes}-lanes.inc`, the same "difference vector"
construction Pope's directory describes by hand in `grdir.html`'s "Chart
Generation: Steps") — and its repository carries no declared licence
(`gh api repos/jeffpiazza/derbynet --jq .license` reports `NOASSERTION`), so
its generator data is not vendored into this repo as fixture data. This
script fetches it live instead (no vendored copy) and does the actual
row-for-row comparison decision 1 asks for.

**What "row-for-row" means here.** Both this repo's `build_grid` and
DerbyNet's own `apply_generator` (`website/inc/schedule_rough.inc`, ported
below as `apply_generator`) construct a chart identically: car `c` in lane
1, and lane `l+1`'s car is lane `l`'s car plus the generator's `l`-th
element, wrapping into `1..cars`. Both conventions put car `c` in heat
`c - 1`'s lane 1 (0-indexed heats), so **no relabeling is needed** for a
literal comparison when both sides use the same number of heats: heat `i`,
lane `l` should simply be the same car number on both sides, or it is not.
Where DerbyNet's own base ("`type=1`", non-complementary) generator list
produces a different heat count than this repo's default chart for the same
shape, an exact row comparison is not meaningful — that case is reported as
"different heat count", with the meeting-count structure on each side
instead of a row diff, exactly as decision 1's own fallback allows.

Usage::

    uv run python scripts/compare_perfect_n_with_derbynet.py

Network access to raw.githubusercontent.com required; not part of CI or the
pytest suite (see `backend/tests/test_perfect_n_tables.py` for what *is*
checked automatically, without a network dependency — the exhaustive,
row-level verification of every transcribed chart against its own claimed
symbol).
"""

from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from collections import Counter

sys.path.insert(0, ".")

from backend.domain.schedulers.perfect_n import build_grid, default_chart  # noqa: E402
from backend.domain.schedulers.perfect_n_tables import CHARTS  # noqa: E402

RAW_BASE = (
    "https://raw.githubusercontent.com/jeffpiazza/derbynet/master/"
    "website/inc/generators/{lanes}-lanes.inc"
)

# make_scheduler_data($nlanes, $ncars, array(array(...), ...), array(...), ...)
# The third positional argument is the *base* ("type 1", non-complementary)
# generator list — one array per block, exactly Pope's own per-block
# generator notation. Nested `array(...)` calls mean this needs a real
# balanced-paren split, not a regex over the whole call.
_CALL_START_RE = re.compile(r"make_scheduler_data\(")
_NUMS_RE = re.compile(r"array\(([^()]*)\)")


def _split_top_level_args(s: str) -> list[str]:
    """Split ``s`` (the text between a call's outer parens) on commas at
    paren-depth 0 — a plain ``str.split(",")`` breaks on the very first
    nested ``array(...)``.
    """
    args = []
    depth = 0
    current: list[str] = []
    for ch in s:
        if ch == "(":
            depth += 1
            current.append(ch)
        elif ch == ")":
            depth -= 1
            current.append(ch)
        elif ch == "," and depth == 0:
            args.append("".join(current))
            current = []
        else:
            current.append(ch)
    if current:
        args.append("".join(current))
    return args


def _matching_paren(text: str, open_index: int) -> int:
    """Index of the ``)`` matching the ``(`` at ``open_index``."""
    depth = 0
    for i in range(open_index, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    raise ValueError("unbalanced parens")


def fetch_generators(lanes: int) -> dict[int, list[tuple[int, ...]]]:
    """``{ncars: [generator, ...]}`` for one lane count — DerbyNet's own
    base ("P"-equivalent) generator blocks, straight from its source file.
    """
    url = RAW_BASE.format(lanes=lanes)
    with urllib.request.urlopen(url, timeout=15) as resp:  # noqa: S310
        text = resp.read().decode("utf-8")

    out: dict[int, list[tuple[int, ...]]] = {}
    for m in _CALL_START_RE.finditer(text):
        open_paren = m.end() - 1
        close_paren = _matching_paren(text, open_paren)
        inner = text[open_paren + 1 : close_paren]
        args = _split_top_level_args(inner)
        file_lanes = int(args[0].strip())
        ncars = int(args[1].strip())
        if file_lanes != lanes:
            continue
        generators_arg = args[2].strip()  # "array(array(...), array(...), ...)"
        gens = [
            tuple(int(x.strip()) for x in g.split(","))
            for g in _NUMS_RE.findall(generators_arg)
        ]
        out[ncars] = gens
    return out


def apply_generators(
    generators: list[tuple[int, ...]], ncars: int
) -> list[tuple[int, ...]]:
    """DerbyNet's own construction (`schedule_rough.inc`'s
    `apply_generator`, transliterated, stacked over every listed block —
    identical in shape to `perfect_n.build_grid`).
    """
    grid: list[tuple[int, ...]] = []
    for gen in generators:
        for car in range(1, ncars + 1):
            row = [car]
            current = car
            for step in gen:
                current += step
                if current > ncars:
                    current -= ncars
                row.append(current)
            grid.append(tuple(row))
    return grid


def meetings(grid: list[tuple[int, ...]]) -> Counter[tuple[int, int]]:
    counts: Counter[tuple[int, int]] = Counter()
    for row in grid:
        for i in range(len(row)):
            for j in range(i + 1, len(row)):
                a, b = row[i], row[j]
                counts[(min(a, b), max(a, b))] += 1
    return counts


def main() -> int:
    lane_counts = sorted({lanes for lanes, _n in CHARTS})
    print(f"Comparing against DerbyNet for lane counts: {lane_counts}\n")
    ok = True
    rows_out = []
    for lanes in lane_counts:
        try:
            derbynet = fetch_generators(lanes)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                # DerbyNet's own generator files only cover 2, 3, 4, 5, 6
                # and 8 lanes — no 404 here is a fetch failure, it just
                # means DerbyNet does not publish charts for this many
                # lanes at all.
                print(
                    f"lanes={lanes}: DerbyNet publishes no charts for this many lanes"
                )
                continue
            print(f"lanes={lanes}: could not fetch DerbyNet's generators: {exc}")
            ok = False
            continue
        except Exception as exc:  # noqa: BLE001
            print(f"lanes={lanes}: could not fetch DerbyNet's generators: {exc}")
            ok = False
            continue

        for n in sorted(cars for (chart_lanes, cars) in CHARTS if chart_lanes == lanes):
            ours_chart = default_chart(n, lanes)
            assert ours_chart is not None
            ours_grid = build_grid(ours_chart)

            if n not in derbynet:
                verdict = "DerbyNet has no entry for this shape"
                rows_out.append((lanes, n, verdict))
                continue

            # DerbyNet's own generator list for a shape is usually several
            # blocks meant to be used cumulatively for more runs per lane
            # (their own "how many times per lane" control) — comparable to
            # Pope naming *several separate* P alternatives of increasing
            # heat count for the same shape, just concatenated into one
            # list rather than offered as named alternatives. Take only as
            # many of DerbyNet's blocks as our own default chart uses, so
            # the comparison is like-for-like (same run count) wherever
            # DerbyNet published enough blocks to match; short of that,
            # compare against everything DerbyNet has and let the heat
            # count mismatch below say so.
            our_blocks = len(ours_chart.generators)
            derbynet_gens = derbynet[n][:our_blocks]
            derbynet_grid = apply_generators(derbynet_gens, n)

            if len(ours_grid) != len(derbynet_grid):
                ours_k = sorted(set(meetings(ours_grid).values()))
                derbynet_k = sorted(set(meetings(derbynet_grid).values()))
                verdict = (
                    f"different heat count (ours={len(ours_grid)}, "
                    f"DerbyNet's={len(derbynet_grid)}); meeting counts "
                    f"ours={ours_k} DerbyNet's={derbynet_k}"
                )
            elif ours_grid == derbynet_grid:
                verdict = f"identical rows ({len(ours_grid)} heats)"
            else:
                ours_k = sorted(set(meetings(ours_grid).values()))
                derbynet_k = sorted(set(meetings(derbynet_grid).values()))
                same_k = ours_k == derbynet_k
                verdict = (
                    f"same heat count ({len(ours_grid)}) but different rows; "
                    f"meeting counts {'match' if same_k else 'differ'}: "
                    f"ours={ours_k} DerbyNet's={derbynet_k}"
                )
            rows_out.append((lanes, n, verdict))
            print(f"({lanes}, {n}): {verdict}")

    print("\n| Lanes | Cars | Comparison |")
    print("| --- | --- | --- |")
    for lanes, n, verdict in rows_out:
        print(f"| {lanes} | {n} | {verdict} |")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
