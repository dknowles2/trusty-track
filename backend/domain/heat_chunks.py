"""Splitting an ordered field into heats that fit the track.

Shared by :mod:`backend.domain.elimination` (``next_wave``) and
:mod:`backend.domain.balanced` (``next_phase``) — both grow their schedule a
batch at a time from an already-ordered list of racer ids, and both need the
same two guarantees about the heats that batch is cut into: nobody races
alone, and nobody is asked onto a track that has fewer lanes than the heat
holds. A single function is what keeps a fix here from reaching only one of
the two callers (issue #48's lesson) — an earlier version of this rule was
copied into each module by hand, and a fix landed in one copy and not the
other twice in a row (issue #751).

Pure, like the rest of :mod:`backend.domain` — no SQLAlchemy, no Strawberry.
"""

from __future__ import annotations

from collections.abc import Sequence


def chunk_heats(ordered: Sequence[int], heat_size: int) -> list[list[int]]:
    """Partition ``ordered`` into heats of between 2 and ``heat_size`` racers.

    Two things must both hold for every heat: at least 2 racers (a heat of
    one is a meaningless guaranteed win) and at most ``heat_size`` racers (a
    heat the track cannot seat — one lane would have to hold two cars).
    Racers are split as evenly as possible across the fewest heats that keep
    every heat within the track's width.

    When the field cannot be split that way — an odd field on a two-lane
    track is the common case — the racer(s) at the *end* of ``ordered`` sit
    this batch out instead of forcing an oversized or a solo heat. That is a
    bye, not a heat: they are simply absent from the result, which is what
    lets the caller (``next_wave``, ``next_phase``) reconsider them next
    time with nothing recorded against them, the same "rejoins next wave"
    rule a lane outage or a latecomer already follows elsewhere in this
    package. Because ``ordered`` is worst-to-best within each caller's own
    ranking (elimination: fewest losses first; balanced: best record
    first), a bye falls on whoever is currently ranked lowest among those
    being chunked — and because each caller reshuffles ties before calling
    this, the same racer is not guaranteed to bye every time the field
    stays the same parity.

    At most one racer ever needs a bye for ``heat_size == 2``; higher lane
    counts need at most one too across every field size this project's own
    property sweep checks (2..25 racers, 2..8 lanes) but the search below
    is general rather than hard-coded to that fact. It always terminates
    for ``heat_size >= 2``: a field of exactly two racers is always
    fittable (one heat, everyone else already excluded), so the loop cannot
    run past ``len(ordered) - 2`` byes.
    """
    n = len(ordered)
    if n < 2 or heat_size < 1:
        return []

    for byes in range(n - 1):
        m = n - byes
        min_heats = -(-m // heat_size)  # ceil(m / heat_size)
        max_heats = m // 2
        if min_heats > max_heats:
            continue
        num_heats = min_heats
        base, rem = divmod(m, num_heats)
        racing = ordered[:m]
        heats: list[list[int]] = []
        idx = 0
        for i in range(num_heats):
            size = base + (1 if i < rem else 0)
            heats.append(list(racing[idx : idx + size]))
            idx += size
        return heats

    # Unreachable for heat_size >= 2 (see the docstring); a bare defensive
    # fallback for heat_size < 2, which every caller already refuses before
    # reaching here.
    return []
