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

__all__ = ["ReplayKey", "ReplayClip", "is_stale"]


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


def is_stale(current_recorded_at: str | None, uploaded_recorded_at: str) -> bool:
    """Whether an uploaded clip's `recorded_at` no longer matches the heat's.

    `current_recorded_at` is `None` for a heat with no recorded result at
    all — that is stale too: there is nothing this clip could be a replay of.
    """
    return current_recorded_at is None or current_recorded_at != uploaded_recorded_at
