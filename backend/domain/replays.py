"""What a stored replay clip is, and which heat it belongs to (#177 stage 1a).

Pure value objects only — no SQLAlchemy, no Strawberry, no filesystem. The I/O
(writing bytes to `DATA_DIR/replays/`, deleting them, sweeping the directory at
startup) lives in `services/replays.py`; this module holds the shapes that I/O
moves around and the one rule that decides whether an uploaded clip still
belongs to the heat it claims.

The clip key is a heat id plus the *exact* `recorded_at` string `heatSession`
published for that heat — the same pair `frontend/src/features/observation/
resultsOverlay.ts`'s `observeHeatResult` already uses to decide "is this a new
result". A heat re-run gets a fresh `recorded_at` (`crud.stamp_recorded`), so a
clip keyed to the old one is for a result that no longer exists — see
`is_stale`.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = [
    "ReplayKey",
    "ReplayClip",
    "is_stale",
    "HeatActivity",
    "heats_beyond_count",
    "heats_beyond_size",
]


@dataclass(frozen=True)
class ReplayKey:
    """Which heat, and which running of it, a clip belongs to.

    `recorded_at` is the string `Heat.recorded_at` held at the moment the
    camera captured the clip — not the moment the upload arrives, which can be
    a second or two later. A heat re-run in between (Reset Heat, a corrected
    result) moves `recorded_at` on, and the old clip is for a race that, as
    far as the record is concerned, did not happen.
    """

    heat_id: int
    recorded_at: str


@dataclass(frozen=True)
class ReplayClip:
    """One camera's clip for one heat.

    `path` is the file's name under `DATA_DIR/replays/` — a non-enumerable
    name (a UUID), the same access-control shape `POST /upload/` already uses
    for photographs (#552's reasoning extended: a video of the finish line is
    a video of children too). `race_id` is carried on the clip, not only on
    its key, so the store can find every clip belonging to a race without a
    second index — see `ReplayStore.discard_other_heats`.
    """

    camera_id: str
    path: str
    race_id: int
    t0_offset_ms: int
    duration_ms: int
    #: Exact byte count on disk. Defaulted for the stage 1a call sites that
    #: never needed a size (`test_replays.py` builds several of these with
    #: no `size_bytes` at all) — only stage 2's MB retention bound reads it.
    size_bytes: int = 0


def is_stale(current_recorded_at: str | None, uploaded_recorded_at: str) -> bool:
    """Whether an uploaded clip's `recorded_at` no longer matches the heat's.

    `current_recorded_at` is `None` for a heat with no recorded result at
    all — that is stale too: there is nothing this clip could be a replay of.
    """
    return current_recorded_at is None or current_recorded_at != uploaded_recorded_at


@dataclass(frozen=True)
class HeatActivity:
    """One heat's footprint in the stored-replay index, for retention.

    ``last_activity`` is whichever `ReplayKey.recorded_at`/`HeatReplay.
    created_at` string sorts latest among the heat's own clips — reruns of
    the same heat share one `heat_id` and so one retention "slot" (a
    corrected result's clip is history worth keeping *alongside* the run it
    replaced, not a second heat competing for the budget), but the heat's
    place in the last-N ordering is decided by its most recent touch.
    ``total_bytes`` sums every clip under every `recorded_at` the heat has.
    """

    heat_id: int
    last_activity: str
    total_bytes: int


def _ordered_most_recent_first(heats: list[HeatActivity]) -> list[HeatActivity]:
    return sorted(heats, key=lambda h: h.last_activity, reverse=True)


def heats_beyond_count(
    heats: list[HeatActivity], retention_heats: int | None
) -> list[int]:
    """Which heat ids fall outside the last-N-heats bound.

    `None` (or a negative value, which cannot mean anything else) means no
    bound at this dimension — nothing is ever purged for it alone. Ties in
    `last_activity` (two heats resulted in the same second) are broken by
    the stable sort's own input order, which callers hand in whatever order
    the store itself iterates — deterministic per call, not claimed to be
    meaningful beyond that.
    """
    if retention_heats is None or retention_heats < 0:
        return []
    ordered = _ordered_most_recent_first(heats)
    return [h.heat_id for h in ordered[retention_heats:]]


def heats_beyond_size(heats: list[HeatActivity], retention_mb: int | None) -> list[int]:
    """Which heat ids to drop, oldest first, until the total fits under
    *retention_mb* megabytes.

    `None` means no bound at this dimension. Walks from the least recently
    active heat forward, which is what makes this a *retention* rule rather
    than an eviction of whichever heat happens to be largest — two heats
    the same size should not decide which one survives by chance.
    """
    if retention_mb is None:
        return []
    cap_bytes = retention_mb * 1024 * 1024
    ordered = _ordered_most_recent_first(heats)
    total = sum(h.total_bytes for h in ordered)
    to_purge: list[int] = []
    for heat in reversed(ordered):
        if total <= cap_bytes:
            break
        to_purge.append(heat.heat_id)
        total -= heat.total_bytes
    return to_purge
