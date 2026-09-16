/**
 * Playing a heat's replay clip(s) back on a display, after its results
 * overlay (#177 stage 1b).
 *
 * The clip *keying* rule — same heat id + `recordedAt` pair
 * `resultsOverlay.ts`'s `observeHeatResult` already uses, and the same
 * `seen === null` reconnect rule — is not duplicated here: `Observation.tsx`
 * calls `observeHeatResult` directly against `heatReplay`'s payload, which
 * carries the identical two fields. What lives here is everything *after*
 * that: which order two cameras' clips play in, and the pure step machine
 * for "showings × rate" (this stage's per-display, client-only settings —
 * `showings`/`rate` themselves are `localStorage`, not a server column;
 * only the `replays` on/off toggle is server-stored, on `Assignment`).
 */

export interface ReplayClipLike {
  readonly cameraId: string;
  readonly url: string;
}

/** Multiple cameras → clips in cameraId order, back to back — the issue's
 * own rule, since there is no operator-facing ordering control in stage 1. */
export function orderClipsByCameraId<T extends ReplayClipLike>(clips: readonly T[]): T[] {
  return [...clips].sort((a, b) => a.cameraId.localeCompare(b.cameraId));
}

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
