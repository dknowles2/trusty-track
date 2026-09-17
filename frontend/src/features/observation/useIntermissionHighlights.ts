import { useState } from 'react';
import { formatDisplayName } from '../core/displayName';
import type { IntermissionData } from '../racing/intermission';
import { highlightCaption, highlightReel, type HighlightHeat } from './highlights';
import type { IntermissionHighlightClip } from './components/IntermissionOverlay';

/**
 * The one place a break's highlight reel is computed and looped (#177 stage
 * 3) — shared by `Observation.tsx` and `AwardCeremony.tsx` so a break takes
 * over the ceremony route exactly like every other display (#592, #1072),
 * rather than each page re-deriving `IntermissionOverlay`'s `highlightClip`
 * prop its own way. The ordering rule itself stays in `highlights.ts`; this
 * is only the React wiring around it — resolving a winner's name, looping
 * the index, and gating on `intermission.highlights`.
 */

interface RawHighlightLane {
  readonly place: number | null;
  readonly time: number | null;
  readonly racerId: number | null;
}

interface RawHighlightClip {
  readonly cameraId: string;
  readonly url: string;
  readonly durationMs: number;
  readonly t0OffsetMs: number;
}

/** The heat shape both callers already fetch (or now fetch) off their own
 * race query — a structural subset of the generated `Heat` type, so either
 * page's own query result satisfies it with no adapter object. */
export interface RawHighlightHeat {
  readonly id: number;
  readonly heatNumber: number;
  readonly roundId: number;
  readonly recordedAt: string | null;
  readonly lanes: readonly RawHighlightLane[];
  readonly replays: readonly RawHighlightClip[];
}

interface RawHighlightRound {
  readonly id: number;
  readonly roundNumber: number;
}

interface RawHighlightRacer {
  readonly id: number;
  readonly firstName: string;
  readonly lastName: string;
}

export interface UseIntermissionHighlightsArgs {
  readonly intermission: IntermissionData;
  /** Whether the break is actually up right now, live-ticked
   * (`useLiveIntermission`) — used only to reset the loop to its first clip
   * when a break starts, the same "adjust during render" pattern
   * `RaceControl.tsx` pins `selectedHeatId` with. */
  readonly intermissionActive: boolean;
  readonly heats: readonly RawHighlightHeat[] | undefined;
  readonly rounds: readonly RawHighlightRound[] | undefined;
  readonly racers: readonly RawHighlightRacer[] | undefined;
  readonly nameDisplay: string;
}

export interface UseIntermissionHighlightsResult {
  /** `null` whenever there is nothing to show — highlights off, or on but
   * the reel is empty — so a caller just spreads this onto
   * `IntermissionOverlay` and gets the ordinary layout for free. */
  readonly highlightClip: IntermissionHighlightClip | null;
  readonly onHighlightEnded: () => void;
}

export function useIntermissionHighlights({
  intermission,
  intermissionActive,
  heats,
  rounds,
  racers,
  nameDisplay,
}: UseIntermissionHighlightsArgs): UseIntermissionHighlightsResult {
  const roundNumberById: Record<number, number> = {};
  (rounds ?? []).forEach((r) => {
    roundNumberById[r.id] = r.roundNumber;
  });

  const highlightHeats: HighlightHeat[] = (heats ?? [])
    // A heat with no `roundId` in the payload has no room to belong to a
    // round's own highlight reel — defensive against a caller (a test
    // fixture, an older cached query result) that has not fetched the
    // fields this stage added, not something a real GraphQL response from
    // the current schema ever omits.
    .filter((h): h is RawHighlightHeat & { roundId: number } => h.roundId != null)
    .map((h) => ({
      heatId: h.id,
      heatNumber: h.heatNumber ?? 0,
      roundId: h.roundId,
      roundNumber: roundNumberById[h.roundId] ?? 0,
      recordedAt: h.recordedAt,
      lanes: h.lanes ?? [],
      replays: h.replays ?? [],
    }));

  const highlightClips = highlightReel(highlightHeats);

  // Reset to the first clip each time a break starts (or a fresh reel
  // arrives mid-break) rather than leaving the index wherever the previous
  // break's loop happened to stop. Adjusted *during render* — see this
  // hook's own docstring.
  const highlightsResetKey = `${intermissionActive}:${highlightClips.length}`;
  const [seenHighlightsResetKey, setSeenHighlightsResetKey] = useState(highlightsResetKey);
  const [highlightIndex, setHighlightIndex] = useState(0);
  if (highlightsResetKey !== seenHighlightsResetKey) {
    setSeenHighlightsResetKey(highlightsResetKey);
    setHighlightIndex(0);
  }

  const currentHighlight =
    highlightClips[highlightIndex % Math.max(highlightClips.length, 1)] ?? null;

  const racersMap: Record<number, RawHighlightRacer> = {};
  (racers ?? []).forEach((r) => {
    racersMap[r.id] = r;
  });

  const currentHighlightCaption = currentHighlight
    ? highlightCaption(
        currentHighlight.heatNumber,
        currentHighlight.winnerRacerId != null && racersMap[currentHighlight.winnerRacerId]
          ? formatDisplayName(
              nameDisplay,
              racersMap[currentHighlight.winnerRacerId].firstName,
              racersMap[currentHighlight.winnerRacerId].lastName,
            )
          : null,
        currentHighlight.winnerTime,
      )
    : '';

  const highlightClip: IntermissionHighlightClip | null =
    intermission.highlights && currentHighlight
      ? { url: currentHighlight.clip.url, caption: currentHighlightCaption }
      : null;

  return {
    highlightClip,
    onHighlightEnded: () => setHighlightIndex((i) => i + 1),
  };
}
