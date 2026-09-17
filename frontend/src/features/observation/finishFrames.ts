/**
 * Where each lane crosses the line inside a replay clip, and the window
 * worth slowing down for (#177 stage 4 — polish, on top of stage 1's clip
 * itself and stage 2's stored one).
 *
 * Pure arithmetic over plain numbers — no DOM, no `<video>`, no GraphQL —
 * the same "sweep the pure rule" shape `clipBounds.ts` already uses for the
 * clip's own boundaries. `ReplayPlayer.tsx` is the only real caller; both
 * functions here are exercised directly in `finishFrames.test.ts`.
 *
 * **Where a mark comes from.** A clip's own `t0OffsetMs` (`clipBounds.ts`,
 * stage 1b) says where the gate opened inside the clip; a lane's own
 * recorded time says how long after that it crossed the line. `atMs =
 * t0OffsetMs + timeS * 1000` is the whole of the arithmetic — everything
 * else here is about which lanes qualify and what to do once every mark is
 * known.
 */

export interface LaneResultLike {
  /** The lane number this result belongs to — `HeatLane.lane` /
   * `timingStats.lanes[].laneNumber`, not a position in an array. */
  readonly lane: number;
  readonly racerName: string;
  /** Seconds, or `null`/non-positive for a DNF — the exact convention
   * `features/racing/lanes.ts`'s `formatLaneTime` already reads (`time <=
   * 0` means DNF, never a real crossing to mark). */
  readonly time: number | null;
  /** A lane nobody raced in this heat (fewer cars than lanes) — excluded
   * the same as a DNF, since there is no crossing to place a mark at
   * either. */
  readonly skipped?: boolean;
}

export interface ClipLike {
  readonly t0OffsetMs: number;
  readonly durationMs: number;
}

export interface FinishMark {
  readonly lane: number;
  readonly racerName: string;
  /** The lane's own recorded time, in seconds — what the caption prints
   * (`formatLaneTime`), not re-derived from `atMs`. */
  readonly timeS: number;
  /** Milliseconds into the clip this lane crossed the line. */
  readonly atMs: number;
}

/**
 * Every lane's finish, placed inside one clip and sorted by when it
 * happens — first across the line first, which is also the order the
 * timeline strip's ticks read left to right.
 *
 * **A DNF, a skipped lane, or a lane with no time at all is excluded
 * outright**, not shown as a mark with nothing to say — there is no
 * crossing for any of the three to point at.
 *
 * **A mark past the clip's own end is excluded, not clamped to the last
 * frame.** The post-roll (`clipBounds.ts`'s `DEFAULT_POST_ROLL_MS`, 1s
 * past the slowest *recorded* lane) is sized against the lanes the clip
 * itself was cut for; a mark landing after `durationMs` means this
 * particular clip — a second camera with a shorter buffer, one that
 * started recording late — genuinely does not contain that crossing. A
 * clamped tick at the very last frame would claim a lane finished on
 * camera when the picture never shows it, which is a worse lie than
 * simply not drawing a tick for it — the caption for a lane that isn't in
 * `marks` never renders at all, so there is nothing half-true on screen
 * either way.
 */
export function finishMarks(clip: ClipLike, lanes: readonly LaneResultLike[]): FinishMark[] {
  const marks: FinishMark[] = [];
  for (const lane of lanes) {
    if (lane.skipped) continue;
    if (lane.time == null || lane.time <= 0) continue;
    const atMs = clip.t0OffsetMs + lane.time * 1000;
    if (atMs > clip.durationMs) continue;
    marks.push({ lane: lane.lane, racerName: lane.racerName, timeS: lane.time, atMs });
  }
  return [...marks].sort((a, b) => a.atMs - b.atMs);
}

export interface SlowMotionWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** How long after the last lane's finish the slow-motion window keeps
 * running — long enough to see the car settle in frame, not so long the
 * "slow it down" request the issue asks for reads as merely a slow clip. */
export const SLOW_MOTION_TAIL_MS = 200;

/** How far ahead of the first finish the slow-motion window starts — "the
 * last second before each finish," the issue's own phrase. */
export const SLOW_MOTION_LEAD_MS = 1000;

/**
 * The one stretch of a clip worth playing at the display's own slow-motion
 * rate — normal speed everywhere else, so a multi-second clip's lead-in
 * and its final second of camera settling are not dragged out at half
 * speed for no reason.
 *
 * `null` with no marks at all (nothing to slow down for — the whole clip
 * plays at normal speed, the pre-#177-stage-4 behaviour) or when the
 * computed window does not leave a real span inside the clip (every mark
 * past `durationMs`, already excluded by `finishMarks` itself, or a
 * clip shorter than the lead-in it would need).
 */
export function slowMotionWindow(
  marks: readonly FinishMark[],
  durationMs: number,
): SlowMotionWindow | null {
  if (marks.length === 0) return null;
  const firstFinishAtMs = Math.min(...marks.map((m) => m.atMs));
  const lastFinishAtMs = Math.max(...marks.map((m) => m.atMs));
  const startMs = Math.max(0, firstFinishAtMs - SLOW_MOTION_LEAD_MS);
  const endMs = Math.min(durationMs, lastFinishAtMs + SLOW_MOTION_TAIL_MS);
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/** Whether `atMs` (milliseconds into a clip) sits inside a slow-motion
 * window — the one comparison `ReplayPlayer.tsx`'s per-frame callback
 * needs, kept here so the "which side is inclusive" choice has one home.
 * Inclusive of both ends, so the frame the window starts or ends on is
 * still played at the slow rate rather than snapping to normal speed one
 * frame early. */
export function isWithinSlowMotionWindow(atMs: number, window: SlowMotionWindow | null): boolean {
  if (window === null) return false;
  return atMs >= window.startMs && atMs <= window.endMs;
}
