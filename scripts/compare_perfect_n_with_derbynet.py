#!/usr/bin/env python3
"""Compare `backend/domain/schedulers/perfect_n_tables.py` against DerbyNet.

#1090 (part C) asks for a row-for-row comparison between this repo's
Perfect-N tables and DerbyNet's own. DerbyNet (`jeffpiazza/derbynet`) does
not publish literal chart rows — it builds a schedule at request time from a
*generator sequence* (`website/inc/generators/{lanes}-lanes.inc`, a cyclic
starter-and-adder construction: heat h's lane-0 car is h, and lane l's car
is the previous lane's car plus `generators[l-1]`, mod the car count) — and
its repository carries no declared licence (`gh api repos/jeffpiazza/
derbynet --jq .license` reports `NOASSERTION`), so those files are not
vendored into this repo as fixture data. This script is the fallback #1090's
brief calls for instead: it fetches DerbyNet's generator file for a given
lane count directly (no vendored copy) and compares the schedule it builds
against the corresponding entry in `perfect_n_tables.TABLES`, for every
shape both sources cover.

"Compares" means: same invariants, not identical rows. The two are
different valid solutions to the same problem in general — DerbyNet's
generator method and this repo's difference-set / sit-out / trivial
constructions can (and for most shapes, do) label cars and heats
differently while both satisfying "every car every lane once." Where a
shape is one of this module's *true* Perfect-N tables (constant pairwise
meetings — see `perfect_n_tables.TRUE_PERFECT`), this script also checks
DerbyNet's single-generator schedule for the same constant, which is the
strongest comparison two independently-constructed charts for the same
shape can be given without assuming either published the "one true"
chart — for many shapes there are several equally valid ones.

Usage::

    uv run python scripts/compare_perfect_n_with_derbynet.py

Network access to raw.githubusercontent.com required; not part of CI or the
pytest suite (see `backend/tests/test_perfect_n_tables.py` for what *is*
checked automatically, without a network dependency).
"""

from __future__ import annotations

import itertools
import re
import sys
import urllib.request

sys.path.insert(0, ".")

from backend.domain.schedulers.perfect_n_tables import (  # noqa: E402
    TABLES,
    TRUE_PERFECT,
)

RAW_BASE = (
    "https://raw.githubusercontent.com/jeffpiazza/derbynet/master/"
    "website/inc/generators/{lanes}-lanes.inc"
)

# make_scheduler_data($nlanes, $ncars, array(array(...), ...), array(...), ...)
# We only need the first argument (the ncars) and the first generator array
# in the second argument — the one a single "time per lane" schedule uses.
_CALL_RE = re.compile(
    r"make_scheduler_data\(\s*(\d+)\s*,\s*(\d+)\s*,\s*array\(\s*array\(([^)]*)\)",
    re.DOTALL,
)


def fetch_generators(lanes: int) -> dict[int, list[int]]:
    """``{ncars: first_generator}`` for one lane count, from DerbyNet's own
    source file. Every ``make_scheduler_data`` call's *first* generator
    array — the one used for a single run per lane, matching the shape
    every table in this repo's ``perfect_n_tables`` covers.
    """
    url = RAW_BASE.format(lanes=lanes)
    with urllib.request.urlopen(url, timeout=15) as resp:  # noqa: S310
        text = resp.read().decode("utf-8")
    out: dict[int, list[int]] = {}
    for m in _CALL_RE.finditer(text):
        file_lanes, ncars, gen_body = m.groups()
        if int(file_lanes) != lanes:
            continue
        out[int(ncars)] = [int(x) for x in gen_body.split(",")]
    return out


def apply_generator(gen: list[int], nlanes: int, ncars: int) -> list[list[int]]:
    """DerbyNet's own construction (`schedule_rough.inc`'s `apply_generator`,
    transliterated): heat h's lane 0 is h; lane l is the previous lane's car
    plus `gen[l-1]`, mod `ncars`.
    """
    heats = []
    for h in range(ncars):
        heat = [h]
        for lane in range(1, nlanes):
            heat.append((heat[lane - 1] + gen[lane - 1]) % ncars)
        heats.append(heat)
    return heats


def pairwise_meetings(heats: list[list[int]]) -> set[int]:
    counts: dict[tuple[int, int], int] = {}
    for heat in heats:
        for a, b in itertools.combinations(sorted(heat), 2):
            counts[(a, b)] = counts.get((a, b), 0) + 1
    return set(counts.values())


def main() -> int:
    lane_counts = sorted({lanes for lanes, _n in TABLES})
    print(f"Comparing against DerbyNet for lane counts: {lane_counts}\n")
    ok = True
    for lanes in lane_counts:
        try:
            derbynet = fetch_generators(lanes)
        except Exception as exc:  # noqa: BLE001
            print(f"lanes={lanes}: could not fetch DerbyNet's generators: {exc}")
            ok = False
            continue

        for n in sorted(n for (table_lanes, n) in TABLES if table_lanes == lanes):
            if n not in derbynet:
                print(f"({lanes}, {n}): DerbyNet has no entry — ours only")
                continue
            gen = derbynet[n]
            derbynet_heats = apply_generator(gen, lanes, n)
            # Every car every lane once, exactly like ours.
            for lane in range(lanes):
                in_lane = [heat[lane] for heat in derbynet_heats]
                assert len(in_lane) == len(set(in_lane))
            derbynet_k = pairwise_meetings(derbynet_heats)

            our_heats = [
                [pos - 1 for pos in row] for row in TABLES[(lanes, n)]
            ]  # 0-indexed, matching DerbyNet's convention
            our_k = pairwise_meetings(our_heats)

            if (lanes, n) in TRUE_PERFECT:
                verdict = (
                    "both constant (perfect)"
                    if len(derbynet_k) == 1 and len(our_k) == 1
                    else f"ours constant={our_k}, DerbyNet's constant={derbynet_k}"
                )
            else:
                verdict = (
                    f"ours k-values={sorted(our_k)}, DerbyNet's={sorted(derbynet_k)}"
                )
            print(f"({lanes}, {n}): {verdict}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
