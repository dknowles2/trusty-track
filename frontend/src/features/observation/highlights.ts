/**
 * The break's highlight reel: which round's stored replay clips play during
 * an intermission, and in what order (#177 stage 3).
 *
 * Pure — no React, no GraphQL — the same split `slideshow.ts` and
 * `standingsScroll.ts` already draw between the rule and the React wiring
 * that drives it (`IntermissionOverlay.tsx`).
 */

/** Bounded to the most recent heats, by heat number, when a round holds
 * more clips than this — a long round's break should not loop through
 * every heat it ever raced. */
export const LAST_N_HEATS = 10;

export interface HighlightLane {
  readonly place: number | null;
  readonly time: number | null;
  readonly racerId: number | null;
}

export interface HighlightClipSource {
  readonly cameraId: string;
  readonly url: string;
  readonly durationMs: number;
  readonly t0OffsetMs: number;
}

/** The one heat shape both `highlightRoundId` and `highlightOrder` need. */
export interface HighlightHeat {
  readonly heatId: number;
  readonly heatNumber: number;
  readonly roundId: number;
  readonly roundNumber: number;
  readonly recordedAt: string | null;
  readonly lanes: readonly HighlightLane[];
  readonly replays: readonly HighlightClipSource[];
}

export interface HighlightClip {
  readonly heatId: number;
  readonly heatNumber: number;
  /** The winning lane's own time, or `null` for a heat with no timed
   * winner — a hand-entered `POINTS` heat with a place but no time, or an
   * unplaced/skipped heat. Sorts last, by heat number. */
  readonly winnerTime: number | null;
  readonly winnerRacerId: number | null;
  readonly clip: HighlightClipSource;
}

/** The winning lane — `place === 1` — or `null` if this heat has none. */
function winningLane(lanes: readonly HighlightLane[]): HighlightLane | null {
  return lanes.find((lane) => lane.place === 1) ?? null;
}

/** The first camera's clip, in the operator's own camera order (#177 stage
 * 3's own choice, updated by stage 4) — multiple cameras per heat would
 * otherwise multiply the loop's own length, and one representative clip
 * per heat is enough for a break. `replays` arrives already sorted by
 * `Display.cameraOrder` (`api/schema.py`'s `_order_replay_clips`, ties
 * broken by `cameraId`) — the same order `setCameraOrder` controls and
 * the results-flow player and the ▶ modal's own camera picker both
 * follow, so this is nothing more than "the first one" rather than a
 * second, alphabetical-only ordering rule of its own. */
function firstClip(replays: readonly HighlightClipSource[]): HighlightClipSource {
  return replays[0];
}

/**
 * Which round the break's highlights should draw from: the round of the
 * most recently recorded heat, or — if that round has no stored clips at
 * all (a break called before anything in it was captured, or between
 * rounds) — the latest round that does have one. `null` when nothing in
 * the race has a stored clip.
 */
export function highlightRoundId(heats: readonly HighlightHeat[]): number | null {
  const recorded = heats.filter((h): h is HighlightHeat & { recordedAt: string } => h.recordedAt !== null);
  if (recorded.length > 0) {
    const latest = [...recorded].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    return latest.roundId;
  }
  const withClips = heats.filter((h) => h.replays.length > 0);
  if (withClips.length === 0) return null;
  return [...withClips].sort((a, b) => b.roundNumber - a.roundNumber)[0].roundId;
}

/**
 * The ordered highlight list for one round's heats — fastest winning time
 * first, a heat with no timed winner last (by heat number), bounded to the
 * most recent `LAST_N_HEATS` (by heat number) when the round holds more
 * clips than that.
 */
export function highlightOrder(heats: readonly HighlightHeat[]): HighlightClip[] {
  const withClips = heats.filter((h) => h.replays.length > 0);
  const windowed =
    withClips.length > LAST_N_HEATS
      ? [...withClips].sort((a, b) => a.heatNumber - b.heatNumber).slice(-LAST_N_HEATS)
      : withClips;

  return windowed
    .map((h) => {
      const winner = winningLane(h.lanes);
      return {
        heatId: h.heatId,
        heatNumber: h.heatNumber,
        winnerTime: winner?.time ?? null,
        winnerRacerId: winner?.racerId ?? null,
        clip: firstClip(h.replays),
      };
    })
    .sort((a, b) => {
      if (a.winnerTime === null && b.winnerTime === null) return a.heatNumber - b.heatNumber;
      if (a.winnerTime === null) return 1;
      if (b.winnerTime === null) return -1;
      if (a.winnerTime !== b.winnerTime) return a.winnerTime - b.winnerTime;
      return a.heatNumber - b.heatNumber;
    });
}

/** `highlightRoundId` plus `highlightOrder` in one call — the reel
 * `IntermissionOverlay` actually plays, filtered to whichever round
 * `highlightRoundId` picked. Empty when nothing in the race has a clip. */
export function highlightReel(heats: readonly HighlightHeat[]): HighlightClip[] {
  const roundId = highlightRoundId(heats);
  if (roundId === null) return [];
  return highlightOrder(heats.filter((h) => h.roundId === roundId));
}

/** "Heat 7 · Dash Tire · 3.148 s" — the caption under a highlight clip.
 * `winnerName` is resolved by the caller (`formatDisplayName`, #552 — this
 * module has no terminology or privacy context of its own); `null` when
 * there is no name to show (an empty lane, an unresolved racer), same for
 * `winnerTime`. */
export function highlightCaption(
  heatNumber: number,
  winnerName: string | null,
  winnerTime: number | null,
): string {
  const parts = [`Heat ${heatNumber}`];
  if (winnerName) parts.push(winnerName);
  if (winnerTime !== null) parts.push(`${winnerTime.toFixed(3)} s`);
  return parts.join(' · ');
}
