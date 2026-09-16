"""Perfect-N chart data: which car is in which lane, for one heat count.

**Provenance, honestly stated.** #1090's decisions (2026-09-13 comment on
the epic) call for transcribing these tables *by hand* from Stan Pope's
published Perfect-N pages (`stanpope.net`, starting at `ppn.html`), then
comparing them row-for-row against DerbyNet's implementation. That is not
what happened here, and the reason is worth recording rather than papering
over: `stanpope.net` was unreachable from this environment throughout this
PR's authorship — every fetch attempt (the live site directly, an Angelfire
mirror also turned up by search, the Wayback Machine's availability API,
which reports no snapshot on file for `ppn.html`) either timed out or came
back with no route to the host. The PR body records the exact attempts.

What is here instead: the same combinatorial objects Pope's charts *are* —
a Perfect-N chart is, by definition, a schedule where (a) every car runs
every lane exactly once and (b) every pair of cars meets the same number of
times `k` — constructed directly from known designs and verified
computationally against exactly that definition before being hardcoded
below, rather than typed in from a page this environment could not load.
Two constructions cover every table here:

* **The trivial case, `n == lanes`.** Every heat necessarily contains the
  whole field (heat size is `min(n, lanes)`), so any Latin square works;
  every pair meets in every one of the `n` heats. `heat[l] = (h + l) % n`.
* **The "one absence" case, `n == lanes + 1`.** Heat `h` (1-indexed, `1..n`)
  is the one heat car `h` sits out of; the other `n - 1 = lanes` cars fill
  the heat, one per lane. Every car appears in exactly `lanes` heats (the
  required "every lane once"), and any two cars meet in every heat except
  the (at most two) heats that exclude one of them, so `k = lanes - 1`
  constant. The lane a present car gets in heat `h` is
  `((car - h - 1) % n) + 1`, which is a bijection onto `1..lanes` for each
  car across the heats it appears in (see the derivation in this module's
  git history / the PR body — checked computationally, not just argued).
* **The `(2, 4)`- and `(3, 9)`-Singer difference sets, for the two `k = 1`
  cases in range: `lanes=3, n=7` (the Fano plane, `PG(2,2)`) and
  `lanes=4, n=13` (`PG(2,3)`).** `D = {1, 2, 4}` mod 7 and
  `D = {0, 1, 3, 9}` mod 13 are both *planar difference sets*: their
  pairwise differences cover every nonzero residue exactly once. Heat `i`
  (`0..n-1`) is `{d + i mod n : d in D}`, one car per `d`; lane `l` is the
  position of `D[l]` in `D`'s fixed order. Every pair of cars `(a, b)`
  meets in exactly the one heat `i` where `a - b` equals some difference
  `d1 - d2` in `D` — which the difference-set property guarantees happens
  exactly once. This is the standard construction behind every published
  "meets exactly once" pinewood-derby chart of this size; GPRM's own
  "Perfect-N Type" page (fetched during this PR — see the PR body)
  attributes exactly this mathematics to Pope, without reproducing his
  literal HTML tables either.

**Which of the necessary shapes exist but are not here.** A Perfect-N chart
for `(lanes, n)` can only exist when `(n - 1)` divides `lanes * (lanes - 1)`
— the identity `total pair-meetings / total pairs = lanes*(lanes-1)/(n-1)`
must be a non-negative integer for a constant `k` to be possible at all.
That is necessary, not sufficient: within `test_domain_scheduling.py`'s
racer sweep (2..20) it additionally permits `lanes=4, n=7` (`k=2`) and
`lanes=5, n=6/11` and `lanes=6, n=11/16`, none of which this module
constructs a design for — each needs a genuine block-design existence proof
or search this PR did not do the combinatorics for. `available_for` refuses
those shapes honestly (mentioning the Partial Perfect Chart instead) rather
than claiming a table that was never verified. A later PR can add them.

**The DerbyNet comparison.** `jeffpiazza/derbynet`
(`website/inc/generators/{2,3,4,5,6,8}-lanes.inc`, fetched during this PR)
builds its own schedules from *generator sequences* (a cyclic
starter-and-adder method) rather than publishing literal chart rows, and
its repository carries no declared licence (`gh api .../license` reports
`NOASSERTION`) — so its tables are not reproduced here as fixture data,
following this epic's own fallback for exactly that case. The comparison
that *is* possible — running DerbyNet's published generator algorithm
against the shapes this module covers and checking the same invariants
(lane-balance; and, where DerbyNet's first generator alone is a genuine
perfect design, constant pairwise meetings) — is in the PR body and in
``scripts/compare_perfect_n_with_derbynet.py``, which fetches DerbyNet's
generator files itself rather than embedding them.

**Reading a table.** ``TABLES[(lanes, n)]`` is a list of ``n`` heats, each a
tuple of ``lanes`` chart-relative car numbers ``1..n`` (never ``None`` —
every table here has ``n >= lanes``, so every lane is always filled).
Position ``l`` in a heat's tuple is chart lane ``l + 1``; car numbers are
positions in the field, not database ids — :func:`perfect_n.generate_perfect_n`
maps both onto a shuffled ``racer_ids`` list and the caller's actual
``usable_lanes``.
"""

from __future__ import annotations


def _trivial(lanes: int) -> list[tuple[int, ...]]:
    """``n == lanes``: any Latin square. See the module docstring."""
    n = lanes
    return [tuple(((h + lane) % n) + 1 for lane in range(lanes)) for h in range(n)]


def _one_absence(lanes: int) -> list[tuple[int, ...]]:
    """``n == lanes + 1``: heat ``h`` is the one heat car ``h`` sits out."""
    n = lanes + 1
    rows: list[tuple[int, ...]] = []
    for h in range(1, n + 1):
        heat = [0] * lanes
        for car in range(1, n + 1):
            if car == h:
                continue
            lane = ((car - h - 1) % n) + 1
            heat[lane - 1] = car
        rows.append(tuple(heat))
    return rows


def _difference_set(lanes: int, n: int, d: tuple[int, ...]) -> list[tuple[int, ...]]:
    """A planar difference set ``d`` mod ``n``: every pair meets exactly once.

    ``d`` must have ``lanes`` elements whose pairwise differences cover
    every nonzero residue mod ``n`` exactly once (verified by the property
    tests, not just asserted here — this only checks the shape, i.e. that
    the caller passed a ``d`` of the size it claims).
    """
    assert len(d) == lanes, f"difference set has {len(d)} elements, expected {lanes}"
    rows: list[tuple[int, ...]] = []
    for i in range(n):
        rows.append(tuple(((v + i) % n) + 1 for v in d))
    return rows


#: ``(lanes, n) -> heats``, each heat a tuple of ``lanes`` chart car numbers
#: (``1..n``, never a gap — every table here has a full field).
TABLES: dict[tuple[int, int], list[tuple[int, ...]]] = {
    # n == lanes: trivial Latin square, k == lanes (every pair meets in
    # every heat, since every heat holds the whole field).
    (3, 3): _trivial(3),
    (4, 4): _trivial(4),
    (5, 5): _trivial(5),
    (6, 6): _trivial(6),
    # n == lanes + 1: one car sits out each heat, k == lanes - 1.
    (3, 4): _one_absence(3),
    (4, 5): _one_absence(4),
    (5, 6): _one_absence(5),
    (6, 7): _one_absence(6),
    # Planar difference sets: k == 1, every pair meets exactly once.
    # Fano plane (PG(2,2)): D = {1, 2, 4} mod 7 — the classic quadratic
    # residues mod 7.
    (3, 7): _difference_set(3, 7, (1, 2, 4)),
    # PG(2,3): D = {0, 1, 3, 9} mod 13.
    (4, 13): _difference_set(4, 13, (0, 1, 3, 9)),
}

#: Which tables are a *true* Perfect-N chart (every pair meets exactly the
#: same number of times ``k``) versus merely "lane-perfect" (every car runs
#: every lane once, without a pairing guarantee). Every table this module
#: ships is the former — see the module docstring's two constructions, both
#: of which produce a constant ``k`` by construction. Kept as an explicit
#: set (rather than assumed) because #1090's brief distinguishes the two
#: guarantees, and a future table built from a less rigid source (Pope's own
#: site, once reachable, publishes both "Perfect-N" and "Partial Perfect-N"
#: charts under the same portal) must say which it is rather than default to
#: the stronger claim.
TRUE_PERFECT: frozenset[tuple[int, int]] = frozenset(TABLES)
