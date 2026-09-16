"""Stored replay clips: an in-memory index over `DATA_DIR/replays/` (#177
stage 1a), plus the persisted, longer-lived half of it (#177 stage 2).

Stage 1's retention is delete-after-next-heat: a clip is kept only for as
long as it might still be the one thing a display plays after a heat's
results overlay, and is deleted the moment that heat stops being the
current one — either because its own result was just recorded (an earlier
heat's clip is now stale) or because the next heat was armed (this heat's
clip has had its turn). That is still exactly what happens when
`models.Organization.keep_replays` is off, which is the install-wide
default — an upgrade into stage 2 changes nothing until an operator opts in.

**Stage 2 adds a second, independent life for a clip: `models.HeatReplay`.**
A row is written **only when `keep_replays` was on at the moment a clip was
uploaded** (`record_stored_clip`, called from `POST /replay/`) — never
retroactively, never for the off case — so `Heat.replays` being empty and
the setting being off are the same fact told two ways, and a Schedule-tab ▶
needs no separate check of the setting itself. `enforce_retention` is what
bounds it: applied once per upload (not once per heat transition, the way
delete-after-next-heat is), because a retention bound is a property of the
*whole* stored set, not a rule about which single heat is current.

**Nothing in-memory survives a restart on its own.** `ReplayStore` is
process memory, exactly like `services/displays.py`'s `DisplayRegistry`.
With `keep_replays` off, `sweep()` still empties the directory at startup,
because a lingering file would cost SD card space on a Pi with nothing left
that could ever clean it up. With it on, `rebuild_from_db` replaces the
sweep: every file the table still names is exactly the file that should
still be on disk (nothing else ever writes here), so startup reads the
table back into the index instead of discarding it.

**Never `uploads/`.** `services/backup.py` archives `UPLOAD_DIR` by name; a
replay clip landing there would be swept into every backup, which the
retention story says must not happen regardless of how long a clip is kept
— see `.claude/rules/ops.md`'s backup section. `REPLAY_DIRNAME` is a
sibling of `uploads/` under `DATA_DIR`, not a child of it.
"""

from __future__ import annotations

import shutil
import uuid
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from backend.db.database import DATA_DIR
from backend.domain import replays as domain_replays
from backend.domain.replays import ReplayClip, ReplayKey

__all__ = [
    "ALLOWED_CONTENT_TYPES",
    "MAX_REPLAY_CLIP_BYTES",
    "REPLAY_DIRNAME",
    "ReplayStore",
    "store",
    "discard_or_retain",
    "record_stored_clip",
    "enforce_retention",
    "discard_rows_for_deleted_heats",
    "discard_clips_for_race",
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
        #: purged or is about to — or, in stage 2's stored mode, a heat that
        #: is no longer the *current* one even though its clip survives.
        self._latest_key: dict[int, ReplayKey] = {}
        #: Every filename any currently-known clip is stored under — what
        #: `GET /replay/<name>` checks before ever touching the filesystem
        #: (stage 2's revisit of stage 1a's review note: the serving guard
        #: was `is_relative_to(directory)` plus `is_file()` alone, "worth
        #: revisiting with longer retention"). Kept in step with `_clips` by
        #: `add`/`_delete_file` rather than derived on every lookup.
        self._filenames: set[str] = set()

    @property
    def directory(self) -> Path:
        return self._dir

    def sweep(self) -> None:
        """Empty the replay directory and forget every clip.

        Called at startup (`main.py`'s lifespan) and after a restore
        replaces the running event, whenever `keep_replays` is off — see
        `rebuild_from_db` for the on case. This module's own docstring
        explains why "off" still means nothing here survives either event.
        """
        if self._dir.exists():
            shutil.rmtree(self._dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._clips.clear()
        self._latest_key.clear()
        self._filenames.clear()

    def rebuild_from_db(self, db: Session) -> None:
        """Replace `sweep()` at startup when `models.Organization.
        keep_replays` is on: read the index back from `models.HeatReplay`
        rather than discarding it.

        Does not touch the filesystem — every file a surviving row names is
        exactly the file that should still be on disk, since nothing else
        ever writes to this directory. Rows are read oldest-`recorded_at`
        first so that `add`'s own "last call wins" update of `_latest_key`
        lands on the genuinely most recent heat per race, not merely
        whichever row happened to be read last.
        """
        from backend.db import models  # local: avoid a module-level cycle

        self._dir.mkdir(parents=True, exist_ok=True)
        self._clips.clear()
        self._latest_key.clear()
        self._filenames.clear()
        rows = (
            db.query(models.HeatReplay, models.Heat.race_id)
            .join(models.Heat, models.Heat.id == models.HeatReplay.heat_id)
            .order_by(models.HeatReplay.recorded_at, models.HeatReplay.id)
            .all()
        )
        for row, race_id in rows:
            key = ReplayKey(heat_id=row.heat_id, recorded_at=row.recorded_at)
            clip = ReplayClip(
                camera_id=row.camera_id,
                path=row.path,
                race_id=race_id,
                t0_offset_ms=row.t0_offset_ms,
                duration_ms=row.duration_ms,
                size_bytes=row.size_bytes,
            )
            self.add(key, clip)

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
        self._filenames.add(clip.path)

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

    def known_filename(self, filename: str) -> bool:
        """Whether *filename* names a clip this store currently knows
        about — the index lookup `GET /replay/<name>` checks first, so an
        unknown name is refused with no `stat` call at all."""
        return filename in self._filenames

    def discard_other_heats(self, race_id: int, keep_heat_id: int) -> int:
        """Delete every clip for *race_id* whose heat is not *keep_heat_id*.

        Stage 1's delete-after-next-heat rule. Called from `discard_or_
        retain` below, which is the door every caller should use now —
        kept as its own method (rather than folded into that function)
        because `test_discard_other_heats_reports_how_many_it_removed`
        and several other stage 1a tests exercise it directly against a
        store with no organization/session in play at all.

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

    def forget_heats(self, heat_ids: Iterable[int]) -> None:
        """Drop every clip belonging to any of *heat_ids* from the index,
        with no filesystem side effect — the in-memory counterpart to
        `enforce_retention`'s/`delete_files`'s own row-and-file deletion,
        called once the caller has already removed what it means to remove.
        """
        heat_id_set = set(heat_ids)
        for key in list(self._clips):
            if key.heat_id in heat_id_set:
                for clip in self._clips[key]:
                    self._filenames.discard(clip.path)
                del self._clips[key]
        for race_id, key in list(self._latest_key.items()):
            if key.heat_id in heat_id_set:
                del self._latest_key[race_id]

    def _delete_file(self, filename: str) -> None:
        (self._dir / filename).unlink(missing_ok=True)
        self._filenames.discard(filename)


#: One per process, like `DisplayRegistry.registry` and the timer managers.
store = ReplayStore(Path(DATA_DIR) / REPLAY_DIRNAME)


def discard_or_retain(db: Session, race_id: int, keep_heat_id: int) -> int:
    """Stage 1's delete-after-next-heat, unless stored retention (#177
    stage 2 — `models.Organization.keep_replays`) is on for this install.

    Off (the default): identical to `ReplayStore.discard_other_heats` — a
    clip is deleted the moment its heat stops being the current one. On:
    nothing is deleted here. A clip that has fallen out of the operator's
    own retention bound is trimmed by `enforce_retention` instead, called
    once per upload rather than once per heat transition, because
    retention bounds the whole stored set rather than singling out which
    one heat is current.

    This is the one seam every purge call site should go through —
    `api.schema._purge_older_replays` and `services.timer.manager`'s own
    result path both call this rather than `store.discard_other_heats`
    directly, so the setting only has to be read in one place.
    """
    from backend.db import models  # local: avoid a module-level cycle

    organization = db.query(models.Organization).first()
    if organization is not None and organization.keep_replays:
        return 0
    return store.discard_other_heats(race_id, keep_heat_id)


def record_stored_clip(db: Session, key: ReplayKey, clip: ReplayClip) -> None:
    """Write a `models.HeatReplay` row for a clip that was just added to
    the in-memory store.

    Call only when `Organization.keep_replays` is on — see that model's own
    docstring for why this single call site is what makes an empty
    `Heat.replays` and the setting being off the same fact told two ways.
    """
    from backend.db import models  # local: avoid a module-level cycle

    db.add(
        models.HeatReplay(
            heat_id=key.heat_id,
            camera_id=clip.camera_id,
            recorded_at=key.recorded_at,
            path=clip.path,
            duration_ms=clip.duration_ms,
            t0_offset_ms=clip.t0_offset_ms,
            size_bytes=clip.size_bytes,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    )
    db.commit()


def enforce_retention(
    db: Session,
    race_id: int,
    retention_heats: int | None,
    retention_mb: int | None,
) -> None:
    """Trim stored clips for *race_id* down to the operator's own bound(s).

    Applied by **heat**, not by clip or by run (`domain.replays.
    HeatActivity`'s own docstring): a heat that was re-run while
    `keep_replays` is on keeps every one of its `recorded_at` runs as long
    as the heat itself is inside the bound — a corrected result's clip is
    history worth keeping *alongside* the run it replaced, not a second
    heat competing for the same budget.

    Both bounds are independent and additive: a heat purged by either one
    is purged. Both `None` (the state right after `keepReplays` is first
    turned on) means genuinely unbounded — the operator's own choice to
    make and to document, not a default this function invents on their
    behalf.
    """
    from backend.db import models  # local: avoid a module-level cycle

    if retention_heats is None and retention_mb is None:
        return

    rows = (
        db.query(models.HeatReplay)
        .join(models.Heat, models.Heat.id == models.HeatReplay.heat_id)
        .filter(models.Heat.race_id == race_id)
        .all()
    )
    by_heat: dict[int, list[models.HeatReplay]] = {}
    for row in rows:
        by_heat.setdefault(row.heat_id, []).append(row)
    if not by_heat:
        return

    activity = [
        domain_replays.HeatActivity(
            heat_id=heat_id,
            last_activity=max(r.recorded_at for r in heat_rows),
            total_bytes=sum(r.size_bytes for r in heat_rows),
        )
        for heat_id, heat_rows in by_heat.items()
    ]
    purge_ids = set(domain_replays.heats_beyond_count(activity, retention_heats))
    purge_ids |= set(domain_replays.heats_beyond_size(activity, retention_mb))
    if not purge_ids:
        return

    for heat_id in purge_ids:
        for row in by_heat[heat_id]:
            store._delete_file(row.path)
    db.query(models.HeatReplay).filter(models.HeatReplay.heat_id.in_(purge_ids)).delete(
        synchronize_session=False
    )
    db.commit()
    store.forget_heats(purge_ids)


def discard_rows_for_deleted_heats(db: Session, heat_ids: Iterable[int]) -> None:
    """Delete every stored clip file for the given heat ids, and forget them
    in the live index.

    Call this **before** the heat rows themselves are deleted — `ON DELETE
    CASCADE` on `HeatReplay.heat_id` (#125: deletion is the schema's job)
    removes every row naming a deleted heat at the same moment the heat
    goes, which is right for the database but leaves nothing in the table
    left to ask afterward, since SQLite cannot also delete a file for us.
    Every heat-deleting path in `crud.py` — `delete_heat`, `delete_round`
    (over `round_obj.heats`), `delete_free_race_heat`, `delete_run_off_heat`,
    and `generate_heats_for_round`'s `clear_existing` branch — calls this
    with the heat id(s) about to be removed, while they can still be
    queried. A no-op for a heat with no rows, which is the ordinary case
    when `keep_replays` has never been turned on. `_reset_heats_in_place`
    does not call this: it rewrites a championship round's existing heat
    rows rather than deleting them, so their ids survive and there is
    nothing here for it to collect.

    **The reset case is deliberately not a call site of this function.**
    `crud.stamp_recorded` clearing `Heat.recorded_at` back to `None` (a
    "Re-Run"/reset) leaves any `HeatReplay` row for that heat exactly as it
    was — a clip stays keyed to the `recorded_at` it was captured under, and
    a corrected result's earlier clip is history worth keeping alongside the
    one that replaced it, the same "every run, not just the latest" rule
    `enforce_retention` already follows. That is also what makes a reset
    heat's stored clip reachable *at all* once the heat itself is deleted:
    a reset heat looks unraced (`Heat.recorded_at is None`, no lane has
    results) and so becomes deletable through the ordinary refusal checks —
    it is this function, called from the delete path rather than the reset
    one, that is what stops the now-orphaned clip from outliving the heat.
    """
    heat_id_set = set(heat_ids)
    if not heat_id_set:
        return
    from backend.db import models  # local: avoid a module-level cycle

    rows = (
        db.query(models.HeatReplay.heat_id, models.HeatReplay.path)
        .filter(models.HeatReplay.heat_id.in_(heat_id_set))
        .all()
    )
    if not rows:
        return
    touched_heat_ids: set[int] = set()
    for heat_id, path in rows:
        store._delete_file(path)
        touched_heat_ids.add(heat_id)
    store.forget_heats(touched_heat_ids)


def discard_clips_for_race(db: Session, race_id: int) -> None:
    """Delete every stored clip file for *race_id*, and forget them in the
    live index.

    Call this **before** `crud.delete_race` removes the race's heats — see
    `discard_rows_for_deleted_heats`, which this delegates to once the
    race's own heat ids are known; kept as its own name and call site
    because `delete_race` (unlike the four heat/round-scoped delete paths)
    has no single heat id or round to collect ids from, only a race.
    """
    from backend.db import models  # local: avoid a module-level cycle

    heat_ids = [
        row[0]
        for row in (
            db.query(models.HeatReplay.heat_id)
            .join(models.Heat, models.Heat.id == models.HeatReplay.heat_id)
            .filter(models.Heat.race_id == race_id)
            .distinct()
            .all()
        )
    ]
    discard_rows_for_deleted_heats(db, heat_ids)
