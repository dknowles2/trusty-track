"""Stored replay clips: an in-memory index over `DATA_DIR/replays/` (#177 stage 1a).

Stage 1's retention is delete-after-next-heat, and deliberately nothing
fancier: a clip is kept only for as long as it might still be the one thing
a display plays after a heat's results overlay, and is deleted the moment
that heat stops being the current one — either because its own result was
just recorded (an earlier heat's clip is now stale) or because the next heat
was armed (this heat's clip has had its turn). Stage 2 (#177) is what gives a
clip a longer life than that; nothing here should be read as laying
groundwork for it.

**Nothing here survives a restart.** The index is process memory, exactly like
`services/displays.py`'s `DisplayRegistry` — and unlike that registry, a
lingering file on disk *would* actually cost something (SD card space on a
Pi), so `sweep()` empties the directory at startup rather than merely
forgetting the index. A clip from before a restart has no index entry
pointing at it and nothing left that would ever clean it up otherwise.

**Never `uploads/`.** `services/backup.py` archives `UPLOAD_DIR` by name; a
replay clip landing there would be swept into every backup, which is exactly
what the issue's retention story says must not happen. `REPLAY_DIRNAME` is a
sibling of `uploads/` under `DATA_DIR`, not a child of it.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from backend.db.database import DATA_DIR
from backend.domain.replays import ReplayClip, ReplayKey

__all__ = [
    "ALLOWED_CONTENT_TYPES",
    "MAX_REPLAY_CLIP_BYTES",
    "REPLAY_DIRNAME",
    "ReplayStore",
    "store",
]

REPLAY_DIRNAME = "replays"

#: Content types a camera may upload, and the extension each is stored under.
#: The camera's own muxed output (#177's "Upload, then play"): WebCodecs
#: encodes to a fragmented MP4 or WebM container depending on the browser, so
#: both are accepted and nothing else is.
ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "video/webm": ".webm",
    "video/mp4": ".mp4",
}

#: The most a single clip may be. A ~10 s ring at 720p/30fps is a few MB
#: (the issue's own estimate); this leaves headroom above that rather than
#: trimming it, the same "generous, not tight" reasoning `MAX_UPLOAD_BYTES`
#: uses for a photograph.
MAX_REPLAY_CLIP_BYTES = 12 * 1024 * 1024

#: How much is read at a time while enforcing that cap — the same
#: "measure while reading, not after" rule `_read_capped` in `api/main.py`
#: already follows for a photograph.
REPLAY_UPLOAD_CHUNK = 1024 * 1024


class ReplayStore:
    """Which clips exist right now, keyed by `(heat_id, recorded_at)`.

    Not thread-safe and does not need to be, for the same reason
    `DisplayRegistry` is not: every caller is a coroutine on the one event
    loop this application runs as (#9 is about the timer's own database
    session, not about concurrency here).
    """

    def __init__(self, replay_dir: Path) -> None:
        self._dir = replay_dir
        self._clips: dict[ReplayKey, list[ReplayClip]] = {}
        #: The most recently touched key for each race — what a display's
        #: `heatReplay` subscription actually reads (`api/schema.py`'s
        #: `_current_heat_replay`). Not necessarily the *only* key a race has
        #: clips under (a second camera can add to an already-current key
        #: after the first), but always the one worth showing: an older key
        #: is, by definition, a heat `discard_other_heats` has already
        #: purged or is about to.
        self._latest_key: dict[int, ReplayKey] = {}

    @property
    def directory(self) -> Path:
        return self._dir

    def sweep(self) -> None:
        """Empty the replay directory and forget every clip.

        Called once at startup (`main.py`'s lifespan) and after a restore
        replaces the running event. Stage 1 keeps nothing across either —
        see this module's docstring for why that is deliberate rather than
        an oversight.
        """
        if self._dir.exists():
            shutil.rmtree(self._dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._clips.clear()
        self._latest_key.clear()

    def new_clip_path(self, extension: str) -> tuple[str, Path]:
        """A fresh, non-enumerable filename for an incoming upload, and where
        to write it.

        The same "a UUID, not the caller's own name" shape `POST /upload/`
        already uses (`api/main.py`'s `_sniffed_extension` docstring, #322)
        — a clip is served back from a credential-free route (`GET
        /replay/<name>`), so the name *is* the access control.
        """
        name = f"{uuid.uuid4()}{extension}"
        return name, self._dir / name

    def add(self, key: ReplayKey, clip: ReplayClip) -> None:
        """Record a clip that has already been written to disk."""
        self._clips.setdefault(key, []).append(clip)
        self._latest_key[clip.race_id] = key

    def clips_for(self, key: ReplayKey) -> list[ReplayClip]:
        return list(self._clips.get(key, ()))

    def latest_for_race(
        self, race_id: int
    ) -> tuple[ReplayKey, list[ReplayClip]] | None:
        """The current heat's key and clips for *race_id*, if any camera has
        uploaded one that has not since been discarded."""
        key = self._latest_key.get(race_id)
        if key is None:
            return None
        return key, self.clips_for(key)

    def discard_other_heats(self, race_id: int, keep_heat_id: int) -> int:
        """Delete every clip for *race_id* whose heat is not *keep_heat_id*.

        Called from two places, both meaning "this heat is no longer the one
        whose replay might still be shown": `updateHeatResult`/the timer's
        own result path, once a heat's result lands (an *earlier* heat's
        clip is now stale — the newly-resulted heat's own clip has not been
        uploaded yet, so it is never the one this call removes), and
        `prepareHeat`, once the *next* heat is armed (the heat that just
        finished has had its turn on a display).

        Returns the number of clips removed, so a caller can log or test it.
        """
        removed = 0
        for key in list(self._clips):
            if key.heat_id == keep_heat_id:
                continue
            clips = self._clips[key]
            if not clips or clips[0].race_id != race_id:
                continue
            for clip in clips:
                self._delete_file(clip.path)
                removed += 1
            del self._clips[key]
        if (
            race_id in self._latest_key
            and self._latest_key[race_id].heat_id != keep_heat_id
        ):
            del self._latest_key[race_id]
        return removed

    def _delete_file(self, filename: str) -> None:
        (self._dir / filename).unlink(missing_ok=True)


#: One per process, like `DisplayRegistry.registry` and the timer managers.
store = ReplayStore(Path(DATA_DIR) / REPLAY_DIRNAME)
