"""Perfect-N chart data: Stan Pope's Race Grid Directory, transcribed by hand.

**Source.** Stan Pope, in collaboration with Cory Young, "'Perfect N' Race
Grid Directory", http://www.stanpope.net/grdir.html — about 90 charts for 3
through 10 lanes, each row giving the car count (N), heat count (H), a
"chart symbol" (``P N-L (M)`` or ``CP N-L (M)`` — see below) and one or more
*generators*, the compact difference-vector notation the page's own
"Chart Generation: Steps" section explains how to expand into a full grid by
hand. Transcribed by hand 2026-09-16, together with the worked example at
http://www.stanpope.net/grdirex.html (a CP7-3(2) chart, expanded step by
step) and the formal "Complementary Perfect-N" definitions at
http://www.stanpope.net/cyoung2.html. Copyright 1997 by Stan Pope and Cory
Young.

(An earlier version of this module, written when ``stanpope.net`` appeared
unreachable from the development environment, constructed a small set of
tables from first-principles combinatorics instead of transcribing Pope's
own data. That was wrong to ship as "Perfect-N" — decision 1 of #1090's epic
asks for Pope's own published charts, not an independently-derived
substitute — and is replaced entirely by this transcription once the site
was confirmed reachable and a local mirror was available to read from.)

**Reading the directory's own notation, and how :func:`perfect_n.build_grid`
turns it into a schedule.** A "generator" is a vector of ``lanes - 1``
integers. Given ``N`` cars and a generator ``g = (g_1, ..., g_{lanes-1})``,
one *block* of ``N`` heats is built by: for each car ``c`` from 1 to ``N``
in turn, put ``c`` in lane 1, then lane ``i+1``'s car is lane ``i``'s car
plus ``g_i``, wrapping into ``1..N`` whenever the sum exceeds ``N``. A chart
with multiple generators is multiple such blocks stacked (heat count
``H`` is always a multiple of ``N`` — the directory's own "Steps" describe
this identically, just as a by-hand table-filling procedure rather than a
formula; both produce the same grid, verified against the worked example in
``grdirex.html`` heat by heat during this transcription).

**``P`` vs ``CP``.** Per ``cyoung2.html``'s formal definitions: a chart is
*Perfect N-X (Y)* if every pair of cars meets exactly ``Y`` times and every
car runs every lane the same number of times. It is additionally
*Complementary* if, for every pair of lanes ``(x, y)`` and every pair of
cars ``(n, m)``, the number of heats with ``n`` in lane ``x`` and ``m`` in
lane ``y`` equals the number with ``n`` in lane ``y`` and ``m`` in lane
``x`` — "if two cars are in the same race, there is a corresponding race
where they swap lanes," which cancels out any remaining lane bias a plain
Perfect-N chart's *aggregate* fairness does not. Every ``CP`` row in the
directory is built from a ``P`` row's own generator(s) plus their
"complement" (``N - g_i`` componentwise, per generator) — Lemma 3/Theorem in
``cyoung2.html`` — which is why a ``CP`` chart always has twice the ``P``
chart's heat count and lists the complement generator(s) alongside the
originals.

**Runs are not always one.** Where PPC and ROTATION always produce exactly
``len(racer_ids)`` heats (one run per lane), a Pope chart's heat count ``H``
is whatever the directory lists — sometimes ``N`` (one run), often a
multiple (multiple runs per lane, still perfect). ``H`` is always a multiple
of ``N`` (verified below, for every row this module keeps); a car's runs
per lane for a given chart is ``H // N``.

**Verification, not blind faith in 1997 HTML.** Every row below is checked,
at import time in the test suite (`backend/tests/test_perfect_n_tables.py`),
against the exact definitions above — not just trusted because Pope
published it. That check found three rows whose listed generators do not
actually produce what their own symbol claims (see ``EXCLUDED`` below) —
each re-read against the raw HTML more than once, and checked against a
hand-computation of the generator formula, before being called a
transcription error in the source rather than a bug in the reader. They are
kept here, transcribed exactly as printed, and excluded from the registry
so nothing can schedule with them.

**The DerbyNet comparison.** `jeffpiazza/derbynet` builds its own charts
from an equivalent generator method (`website/inc/generators/*.inc`,
transliterated in `scripts/compare_perfect_n_with_derbynet.py`), and its
repository carries no declared licence, so its tables are not vendored here
as fixture data — the comparison script fetches them live. See that
script's own docstring and the PR body for the per-shape comparison.

**Reading this module.** ``ALL_ROWS`` is the literal transcription — every
row the directory lists, one :class:`Chart` each, grouped exactly as the
page groups them (by lane count, in the page's own order). ``EXCLUDED``
names the three rows whose own claim does not verify, with why. ``CHARTS``
is ``ALL_ROWS`` minus ``EXCLUDED``, grouped by ``(lanes, cars)`` — a
``(lanes, cars)`` pair can have several charts (a ``P`` and its ``CP``
double, sometimes more than one ``P`` of different heat counts);
:func:`perfect_n.default_chart` picks the fewest-heats non-``CP`` one.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Chart:
    """One row of Pope's directory: a single Perfect-N (or Complementary
    Perfect-N) chart for a given car count and lane count.

    ``generators`` is one tuple of ``lanes - 1`` integers per block of
    ``cars`` heats — ``len(generators) == heats // cars`` always (checked at
    transcription time, not merely assumed). ``meetings`` is the ``(M)`` the
    chart symbol claims: how many times the chart makes every pair of cars
    meet. ``complementary`` is whether the symbol is ``CP`` rather than
    plain ``P`` — see the module docstring for what that guarantees beyond
    plain Perfect-N.
    """

    lanes: int
    cars: int
    heats: int
    symbol: str
    meetings: int
    complementary: bool
    generators: tuple[tuple[int, ...], ...]

    def __post_init__(self) -> None:
        assert self.heats % self.cars == 0, (
            f"{self.symbol}: {self.heats} heats is not a multiple of {self.cars} cars"
        )
        assert len(self.generators) == self.heats // self.cars, (
            f"{self.symbol}: {len(self.generators)} generators, expected "
            f"{self.heats // self.cars} ({self.heats}/{self.cars})"
        )
        for g in self.generators:
            assert len(g) == self.lanes - 1, (
                f"{self.symbol}: a generator has {len(g)} elements, "
                f"expected {self.lanes - 1}"
            )


def _row(
    lanes: int,
    cars: int,
    heats: int,
    symbol: str,
    meetings: int,
    complementary: bool,
    generators: tuple[tuple[int, ...], ...],
) -> Chart:
    return Chart(
        lanes=lanes,
        cars=cars,
        heats=heats,
        symbol=symbol,
        meetings=meetings,
        complementary=complementary,
        generators=generators,
    )


#: The whole directory, transcribed by hand from http://www.stanpope.net/grdir.html
#: (2026-09-16), in the page's own order — one entry per row, grouped by lane
#: count exactly as the page groups them.
ALL_ROWS: tuple[Chart, ...] = (
    # --- 3 lanes ---
    _row(3, 3, 3, "P 3-3 (3)", 3, False, ((1, 1),)),
    _row(3, 3, 6, "CP 3-3 (6)", 6, True, ((1, 1), (2, 2))),
    _row(3, 4, 4, "P4-3 (2)", 2, False, ((1, 1),)),
    _row(3, 4, 8, "CP4-3 (4)", 4, True, ((1, 1), (3, 3))),
    _row(3, 5, 10, "P5-3 (3)", 3, False, ((1, 1), (2, 2))),
    _row(3, 7, 7, "P7-3 (1)", 1, False, ((1, 2),)),
    _row(3, 7, 14, "P7-3 (2)", 2, False, ((1, 2), (2, 1))),
    _row(3, 7, 14, "CP7-3 (2)", 2, True, ((1, 2), (6, 5))),
    _row(3, 7, 21, "P7-3 (3)", 3, False, ((1, 1), (2, 2), (3, 3))),
    _row(3, 7, 28, "CP7-3 (4)", 4, True, ((1, 3), (6, 4), (3, 2), (4, 5))),
    _row(3, 9, 36, "P9-3 (3)", 3, False, ((1, 1), (2, 2), (3, 3), (4, 4))),
    _row(
        3,
        9,
        72,
        "CP9-3 (6)",
        6,
        True,
        ((1, 1), (8, 8), (2, 2), (7, 7), (3, 3), (6, 6), (4, 4), (5, 5)),
    ),
    _row(3, 13, 26, "P13-3 (1)", 1, False, ((1, 3), (2, 5))),
    _row(3, 13, 52, "CP13-3 (2)", 2, True, ((1, 3), (12, 10), (2, 5), (11, 8))),
    _row(3, 19, 57, "P19-3 (1)", 1, False, ((1, 3), (2, 7), (5, 6))),
    _row(
        3,
        19,
        114,
        "CP19-3 (2)",
        2,
        True,
        ((1, 3), (18, 16), (2, 7), (17, 12), (5, 6), (14, 13)),
    ),
    _row(3, 25, 100, "P25-3 (1)", 1, False, ((1, 2), (4, 7), (5, 8), (6, 9))),
    _row(
        3,
        25,
        200,
        "CP25-3 (2)",
        2,
        True,
        (
            (1, 2),
            (24, 23),
            (4, 7),
            (21, 18),
            (5, 8),
            (20, 17),
            (6, 9),
            (19, 16),
        ),
    ),
    # --- 4 lanes ---
    _row(4, 4, 4, "P4-4 (4)", 4, False, ((1, 1, 1),)),
    _row(4, 4, 8, "CP4-4 (8)", 8, True, ((1, 1, 1), (3, 3, 3))),
    _row(4, 5, 5, "P5-4 (3)", 3, False, ((1, 1, 1),)),
    _row(4, 5, 10, "CP5-4 (6)", 6, True, ((1, 1, 1), (4, 4, 4))),
    _row(4, 5, 15, "P5-4 (9)", 9, False, ((1, 1, 1), (2, 2, 2), (3, 3, 3))),
    _row(4, 7, 7, "P7-4 (2)", 2, False, ((1, 1, 2),)),
    _row(4, 7, 14, "CP7-4 (4)", 4, True, ((1, 1, 2), (6, 6, 5))),
    _row(4, 7, 21, "P7-4 (6)", 6, False, ((1, 1, 1), (2, 2, 2), (3, 3, 3))),
    _row(4, 9, 18, "P9-4 (3)", 3, False, ((1, 1, 2), (2, 3, 1))),
    _row(4, 9, 36, "CP9-4 (6)", 6, True, ((1, 1, 2), (8, 8, 7), (2, 3, 1), (7, 6, 8))),
    _row(4, 10, 30, "P10-4 (4)", 4, False, ((1, 1, 2), (2, 2, 3), (3, 6, 5))),
    _row(
        4,
        10,
        60,
        "CP10-4 (8)",
        8,
        True,
        ((1, 1, 2), (9, 9, 8), (2, 2, 3), (8, 8, 7), (3, 6, 5), (7, 4, 5)),
    ),
    _row(4, 13, 13, "P13-4 (1)", 1, False, ((1, 2, 6),)),
    _row(4, 13, 26, "CP13-4 (2)", 2, True, ((1, 2, 6), (12, 11, 7))),
    _row(4, 13, 39, "P13-4 (3)", 3, False, ((1, 1, 3), (2, 5, 5), (3, 4, 2))),
    _row(4, 19, 57, "P19-4 (2)", 2, False, ((1, 1, 4), (2, 6, 3), (3, 4, 5))),
    _row(
        4,
        19,
        114,
        "CP19-4 (4)",
        4,
        True,
        (
            (1, 1, 4),
            (18, 18, 15),
            (2, 6, 3),
            (17, 13, 16),
            (3, 4, 5),
            (16, 15, 14),
        ),
    ),
    _row(4, 37, 111, "P37-4 (1)", 1, False, ((1, 2, 21), (4, 5, 6), (7, 10, 8))),
    _row(
        4,
        37,
        222,
        "CP37-4 (2)",
        2,
        True,
        (
            (1, 2, 21),
            (36, 35, 16),
            (4, 5, 6),
            (33, 32, 31),
            (7, 10, 8),
            (30, 27, 29),
        ),
    ),
    # --- 5 lanes ---
    _row(5, 5, 5, "P5-5 (5)", 5, False, ((1, 1, 1, 1),)),
    _row(5, 5, 10, "CP5-5 (10)", 10, True, ((1, 1, 1, 1), (4, 4, 4, 4))),
    _row(5, 6, 6, "P6-5 (4)", 4, False, ((1, 1, 1, 1),)),
    _row(5, 6, 12, "CP6-5 (8)", 8, True, ((1, 1, 1, 1), (5, 5, 5, 5))),
    _row(
        5,
        6,
        18,
        "P6-5 (12)",
        12,
        False,
        ((1, 1, 1, 1), (2, 2, 3, 2), (3, 4, 4, 3)),
    ),
    _row(
        5,
        7,
        21,
        "P7-5 (10)",
        10,
        False,
        ((1, 1, 1, 1), (2, 2, 2, 2), (3, 3, 3, 3)),
    ),
    _row(
        5,
        7,
        42,
        "CP7-5 (20)",
        20,
        True,
        (
            (1, 1, 1, 1),
            (6, 6, 6, 6),
            (2, 2, 2, 2),
            (5, 5, 5, 5),
            (3, 3, 3, 3),
            (4, 4, 4, 4),
        ),
    ),
    _row(5, 9, 18, "P9-5 (5)", 5, False, ((1, 1, 1, 3), (2, 2, 3, 1))),
    _row(
        5,
        9,
        36,
        "CP9-5 (10)",
        10,
        True,
        ((1, 1, 1, 3), (8, 8, 8, 6), (2, 2, 3, 1), (7, 7, 6, 8)),
    ),
    _row(5, 11, 11, "P11-5 (2)", 2, False, ((1, 1, 2, 3),)),
    _row(5, 11, 22, "CP11-5 (4)", 4, True, ((1, 1, 2, 3), (10, 10, 9, 8))),
    _row(5, 21, 21, "P21-5 (1)", 1, False, ((1, 3, 10, 2),)),
    _row(5, 21, 42, "CP21-5 (2)", 2, True, ((1, 3, 10, 2), (20, 18, 11, 19))),
    _row(5, 41, 82, "P41-5 (1)", 1, False, ((1, 3, 7, 18), (2, 6, 9, 5))),
    _row(
        5,
        41,
        164,
        "CP41-5 (2)",
        2,
        True,
        ((1, 3, 7, 18), (40, 38, 34, 23), (2, 6, 9, 5), (39, 35, 32, 36)),
    ),
    # --- 6 lanes ---
    _row(6, 6, 6, "P6-6 (6)", 6, False, ((1, 1, 1, 1, 1),)),
    _row(6, 6, 12, "CP6-6 (12)", 12, True, ((1, 1, 1, 1, 1), (5, 5, 5, 5, 5))),
    _row(6, 7, 7, "P7-6 (5)", 5, False, ((1, 1, 1, 1, 1),)),
    _row(6, 7, 14, "CP7-6 (10)", 10, True, ((1, 1, 1, 1, 1), (6, 6, 6, 6, 6))),
    _row(
        6,
        7,
        21,
        "P7-6 (15)",
        15,
        False,
        ((1, 1, 1, 1, 1), (2, 2, 2, 2, 2), (3, 3, 3, 3, 3)),
    ),
    _row(6, 11, 11, "P11-6 (3)", 3, False, ((1, 1, 2, 1, 2),)),
    _row(6, 11, 22, "CP11-6 (6)", 6, True, ((1, 1, 2, 1, 2), (10, 10, 9, 10, 9))),
    _row(6, 13, 26, "P13-6 (5)", 5, False, ((1, 1, 1, 2, 4), (2, 3, 3, 1, 7))),
    _row(
        6,
        13,
        52,
        "CP13-6 (10)",
        10,
        True,
        (
            (1, 1, 1, 2, 4),
            (12, 12, 12, 11, 9),
            (2, 3, 3, 1, 7),
            (11, 10, 10, 12, 6),
        ),
    ),
    _row(6, 31, 31, "P31-6 (1)", 1, False, ((1, 2, 5, 4, 6),)),
    _row(6, 31, 62, "CP31-6 (2)", 2, True, ((1, 2, 5, 4, 6), (30, 29, 26, 27, 25))),
    # --- 7 lanes ---
    _row(7, 7, 7, "P7-7 (7)", 7, False, ((1, 1, 1, 1, 1, 1),)),
    _row(
        7,
        7,
        14,
        "CP7-7 (14)",
        14,
        True,
        ((1, 1, 1, 1, 1, 1), (6, 6, 6, 6, 6, 6)),
    ),
    _row(7, 8, 8, "P8-7 (6)", 6, False, ((1, 1, 1, 1, 1, 1),)),
    _row(
        7,
        8,
        16,
        "CP8-7 (12)",
        12,
        True,
        ((1, 1, 1, 1, 1, 1), (7, 7, 7, 7, 7, 7)),
    ),
    _row(7, 15, 15, "P15-7 (3)", 3, False, ((1, 1, 2, 1, 3, 2),)),
    _row(
        7,
        15,
        30,
        "CP15-7 (6)",
        6,
        True,
        ((1, 1, 2, 1, 3, 2), (14, 14, 13, 14, 12, 13)),
    ),
    # --- 8 lanes ---
    _row(8, 8, 8, "P8-8 (8)", 8, False, ((1, 1, 1, 1, 1, 1, 1),)),
    _row(
        8,
        8,
        16,
        "CP8-8 (16)",
        16,
        True,
        ((1, 1, 1, 1, 1, 1, 1), (7, 7, 7, 7, 7, 7, 7)),
    ),
    _row(8, 9, 9, "P9-8 (7)", 7, False, ((1, 1, 1, 1, 1, 1, 1),)),
    _row(
        8,
        9,
        18,
        "CP9-8 (14)",
        14,
        True,
        ((1, 1, 1, 1, 1, 1, 1), (8, 8, 8, 8, 8, 8, 8)),
    ),
    _row(8, 15, 15, "P15-8 (4)", 4, False, ((1, 1, 1, 2, 2, 1, 3),)),
    _row(
        8,
        15,
        30,
        "CP15-8 (8)",
        8,
        True,
        ((1, 1, 1, 2, 2, 1, 3), (14, 14, 14, 13, 13, 14, 12)),
    ),
    _row(8, 57, 57, "P57-8 (1)", 1, False, ((1, 2, 10, 19, 4, 7, 9),)),
    _row(
        8,
        57,
        114,
        "CP57-8 (2)",
        2,
        True,
        ((1, 2, 10, 19, 4, 7, 9), (56, 55, 47, 38, 53, 50, 48)),
    ),
    # --- 9 lanes ---
    _row(9, 9, 9, "P9-9 (9)", 9, False, ((1, 1, 1, 1, 1, 1, 1, 1),)),
    _row(
        9,
        9,
        18,
        "CP9-9 (18)",
        18,
        True,
        ((1, 1, 1, 1, 1, 1, 1, 1), (8, 8, 8, 8, 8, 8, 8, 8)),
    ),
    _row(9, 10, 10, "P10-9 (8)", 8, False, ((1, 1, 1, 1, 1, 1, 1, 1),)),
    _row(
        9,
        10,
        20,
        "CP10-9 (16)",
        16,
        True,
        ((1, 1, 1, 1, 1, 1, 1, 1), (9, 9, 9, 9, 9, 9, 9, 9)),
    ),
    _row(9, 13, 13, "P13-9 (6)", 6, False, ((1, 1, 1, 1, 1, 2, 2, 1),)),
    _row(
        9,
        13,
        26,
        "CP13-9 (12)",
        12,
        True,
        ((1, 1, 1, 1, 1, 2, 2, 1), (12, 12, 12, 12, 12, 11, 11, 12)),
    ),
    _row(9, 19, 19, "P19-9 (4)", 4, False, ((1, 1, 1, 2, 2, 5, 1, 3),)),
    _row(
        9,
        19,
        38,
        "CP19-9 (8)",
        8,
        True,
        ((1, 1, 1, 2, 2, 5, 1, 3), (18, 18, 18, 17, 17, 14, 18, 16)),
    ),
    _row(9, 37, 37, "P37-9 (2)", 2, False, ((1, 2, 4, 10, 7, 1, 4, 6),)),
    _row(
        9,
        37,
        74,
        "CP37-9 (4)",
        4,
        True,
        ((1, 2, 4, 10, 7, 1, 4, 6), (36, 35, 33, 27, 30, 36, 33, 31)),
    ),
    _row(9, 73, 73, "P73-9 (1)", 1, False, ((1, 2, 4, 6, 16, 5, 18, 9),)),
    _row(
        9,
        73,
        146,
        "CP73-9 (2)",
        2,
        True,
        ((1, 2, 4, 6, 16, 5, 18, 9), (72, 71, 69, 67, 57, 68, 55, 64)),
    ),
    # --- 10 lanes ---
    _row(
        10,
        91,
        91,
        "P91-10 (1)",
        1,
        False,
        ((1, 2, 6, 18, 22, 7, 5, 16, 4),),
    ),
    _row(
        10,
        91,
        182,
        "CP91-10 (2)",
        2,
        True,
        (
            (1, 2, 6, 18, 22, 7, 5, 16, 4),
            (90, 89, 85, 73, 69, 84, 86, 75, 87),
        ),
    ),
)


#: Rows whose own claim does not verify against ``cyoung2.html``'s
#: definitions, keyed by symbol, with the specific reason found while
#: checking `test_perfect_n_tables.py`'s exhaustive per-row verification.
#: Kept in ``ALL_ROWS`` above (the transcription is complete and literal —
#: "do not fix a row") but never reachable through ``CHARTS``, so nothing
#: can schedule with a chart that does not deliver what it claims.
#:
#: All three were checked twice against the raw HTML byte-for-byte (no
#: parsing artefact) and against a hand-run of the generator formula in
#: ``cyoung2.html``/``genleft.html`` before being called a source error
#: rather than a misreading:
#:
#: * ``CP7-3 (4)``: the base generators ``(1, 3)`` and ``(3, 2)``, run alone
#:   (7 heats each), do not individually satisfy Perfect-N — only 14 of the
#:   21 possible pairs of 7 cars ever meet, with counts of 1 or 2, not a
#:   constant. Compare the *other* 7-cars/3-lanes rows, whose base
#:   generators (``(1, 2)``, or ``(1, 1)``/``(2, 2)``/``(3, 3)``) each do
#:   verify alone. Complementing a generator pair that was never itself
#:   Perfect-N cannot produce a Perfect-N result (`cyoung2.html`'s Lemma 1
#:   requires the base chart to already be Perfect N-X).
#: * ``P73-9 (1)``: the single generator ``(1, 2, 4, 6, 16, 5, 18, 9)``
#:   leaves some pairs of the 73 cars never meeting at all (``kvals`` were
#:   ``{1, 2}`` over only part of the ``C(73, 2) = 2628`` pairs, not the
#:   claimed constant 1 over all of them) — a single mistyped difference in
#:   a 9-element vector mod 73 is exactly the failure mode a hand-transcribed
#:   1997 table would have and nobody would have mechanically re-checked
#:   since.
#: * ``CP73-9 (2)``: built from the same broken base generator as
#:   ``P73-9 (1)`` plus its complement, so it inherits the same failure.
EXCLUDED: dict[str, str] = {
    "CP7-3 (4)": (
        "generators {1,3} and {3,2} do not individually satisfy Perfect-N "
        "for 7 cars/3 lanes (only 14 of 21 pairs meet, counts {1,2} not "
        "constant) — the source row's own generators are not a valid base "
        "chart to complement"
    ),
    "P73-9 (1)": (
        "generator (1,2,4,6,16,5,18,9) leaves some pairs of the 73 cars "
        "never meeting — not every one of the C(73,2)=2628 pairs meets "
        "the claimed constant of 1"
    ),
    "CP73-9 (2)": (
        "built from P73-9 (1)'s broken base generator plus its complement; "
        "inherits that row's failure"
    ),
}


#: ``ALL_ROWS`` grouped by ``(lanes, cars)``, with :data:`EXCLUDED` rows
#: left out. A ``(lanes, cars)`` pair can hold several charts — see the
#: module docstring.
CHARTS: dict[tuple[int, int], list[Chart]] = {}
for _chart in ALL_ROWS:
    if _chart.symbol in EXCLUDED:
        continue
    CHARTS.setdefault((_chart.lanes, _chart.cars), []).append(_chart)
del _chart
