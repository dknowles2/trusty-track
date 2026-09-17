/**
 * Playing a heat's replay clip(s) back on a display, after its results
 * overlay (#177 stage 1b).
 *
 * The clip *keying* rule — same heat id + `recordedAt` pair
 * `resultsOverlay.ts`'s `observeHeatResult` already uses, and the same
 * `seen === null` reconnect rule — is not duplicated here: `Observation.tsx`
 * calls `observeHeatResult` directly against `heatReplay`'s payload, which
 * carries the identical two fields. What lives here is everything *after*
 * that: the pure step machine for "showings × rate" (this stage's
 * per-display, client-only settings — `showings`/`rate` themselves are
 * `localStorage`, not a server column; only the `replays` on/off toggle is
 * server-stored, on `Assignment`).
 *
 * **Multiple cameras' clips arrive already ordered, and this module does
 * not reorder them a second time (#177 stage 4).** Stage 1 had no
 * operator-facing ordering control, so this file used to export its own
 * `orderClipsByCameraId` and sort alphabetically on the client; stage 4
 * replaces that with `setCameraOrder` and a server-side sort
 * (`api/schema.py`'s `_order_replay_clips`, ties broken by `cameraId` —
 * the same fallback an untouched multi-camera race always had) applied to
 * both `heatReplay` and `Heat.replays`. `Observation.tsx` and
 * `HeatReplayModal.tsx` both play/list `clips` in the array order the
 * server hands back, with nothing client-side left to disagree with it.
 */

export interface PlaybackState {
  readonly clipIndex: number;
  readonly playCount: number;
}

export const INITIAL_PLAYBACK_STATE: PlaybackState = { clipIndex: 0, playCount: 0 };

/**
 * What to do when the clip currently playing reaches its end: play it
 * again (until `showings` has been reached), advance to the next clip, or
 * stop — `'done'`, meaning the player should unmount.
 */
export function afterClipEnded(
  state: PlaybackState,
  showings: number,
  clipCount: number,
): PlaybackState | 'done' {
  if (clipCount === 0) return 'done';
  if (state.playCount + 1 < showings) {
    return { clipIndex: state.clipIndex, playCount: state.playCount + 1 };
  }
  if (state.clipIndex + 1 < clipCount) {
    return { clipIndex: state.clipIndex + 1, playCount: 0 };
  }
  return 'done';
}

export interface ReplaySettings {
  readonly showings: number;
  readonly rate: number;
}

/** The issue's own defaults: twice, at half speed. */
export const DEFAULT_REPLAY_SETTINGS: ReplaySettings = { showings: 2, rate: 0.5 };

function storageKey(displayId: string): string {
  return `trustytrack.replaySettings.${displayId}`;
}

/**
 * Per-display showings/rate, `localStorage`-only for stage 1 — see this
 * module's own header docs for why. Falls back to the default on any
 * storage failure or malformed value, the same "best effort" shape
 * `displayIdentity.ts` already uses for its own storage reads.
 */
export function readReplaySettings(
  displayId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): ReplaySettings {
  try {
    const raw = storage.getItem(storageKey(displayId));
    if (!raw) return DEFAULT_REPLAY_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    const showings = (parsed as { showings?: unknown })?.showings;
    const rate = (parsed as { rate?: unknown })?.rate;
    return {
      showings: typeof showings === 'number' && showings > 0 ? showings : DEFAULT_REPLAY_SETTINGS.showings,
      rate: typeof rate === 'number' && rate > 0 ? rate : DEFAULT_REPLAY_SETTINGS.rate,
    };
  } catch {
    return DEFAULT_REPLAY_SETTINGS;
  }
}

export function writeReplaySettings(
  displayId: string,
  settings: ReplaySettings,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  try {
    storage.setItem(storageKey(displayId), JSON.stringify(settings));
  } catch {
    // Best effort, same as everywhere else this shape is used.
  }
}
