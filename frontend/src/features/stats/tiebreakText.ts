/**
 * Saying a tiebreak method out loud (#540).
 *
 * `Race.tiebreaker` and a leaderboard row's `resolvedBy` cross the GraphQL
 * boundary as plain strings — `"BEST_TIME"`, `"HEAD_TO_HEAD"` — which is
 * exactly the wrong thing to put in front of an operator choosing a setting
 * or reading a standings row. This is the one place the five methods get put
 * into words, so the `RaceForm` picker (#540 part d) and the standings note
 * (#540 part a) cannot describe the same method two different ways.
 *
 * Pure, the same reasoning `awardText.ts` gives for its own vocabulary: it is
 * a rule about words, not about rendering, and the awards screen wants the
 * same phrase the standings page already uses (#540 part c).
 */

import { ordinal } from '../awards/awardText';

export const SHARED = 'SHARED';
export const BEST_TIME = 'BEST_TIME';
export const TOTAL_TIME = 'TOTAL_TIME';
export const COUNTBACK = 'COUNTBACK';
export const HEAD_TO_HEAD = 'HEAD_TO_HEAD';

export interface TiebreakerOption {
  value: string;
  label: string;
  /** The one-line description `RaceForm` shows under this option, always —
   * never only under whichever is currently selected (#304). */
  description: string;
  /** Whether this method reads recorded heat *times* — `BEST_TIME` and
   * `TOTAL_TIME` — as opposed to places or head-to-head results, which every
   * scoring strategy produces. What that is used for lives in
   * `tiebreakerWontFire` below; kept alongside the option it describes so
   * the two cannot drift apart. */
  needsTime?: boolean;
}

/** Every tiebreaker option, in the order the issue's own table lists them —
 * also the order `RaceForm` offers them in. */
export const TIEBREAKER_OPTIONS: readonly TiebreakerOption[] = [
  {
    value: SHARED,
    label: 'Leave it shared',
    description:
      "Ties keep a shared rank on the standings. You settle it yourself — a race-off, a corrected time — and nothing here decides for you.",
  },
  {
    value: BEST_TIME,
    label: 'Fastest single heat',
    description: "Whoever's best recorded heat time is lowest wins the tie.",
    needsTime: true,
  },
  {
    value: TOTAL_TIME,
    label: 'Lowest total time',
    description: "Whoever's heats add up to the least total time wins the tie.",
    needsTime: true,
  },
  {
    value: COUNTBACK,
    label: 'Countback',
    description:
      'Most 1st-place finishes wins; a tie on that goes to most 2nd-place finishes, and so on.',
  },
  {
    value: HEAD_TO_HEAD,
    label: 'Head-to-head',
    description:
      'Among the tied cars, whoever won more of the heats they actually shared wins the tie.',
  },
] as const;

/** A short phrase for how a row was resolved — `null` for a method this
 * module has never heard of, which is what a `resolvedBy` off a stale build
 * would be. */
export function methodPhrase(method: string): string | null {
  const option = TIEBREAKER_OPTIONS.find((o) => o.value === method);
  return option && option.value !== SHARED ? option.label.toLowerCase() : null;
}

/** "2nd, on fastest single heat" — the standings note for a resolved row
 * (#540 part a). `null` when the row was never tied, or was tied and the
 * chain left it that way; an unresolved tie keeps the shared rank exactly as
 * it read before this feature existed, so there is nothing to say. */
export function resolutionNote(
  rank: number,
  resolvedBy: string | null | undefined,
): string | null {
  if (!resolvedBy) return null;
  const phrase = methodPhrase(resolvedBy);
  return phrase ? `${ordinal(rank)}, on ${phrase}` : null;
}

/** Whether `value` can ever fire for a race with no timer at all under
 * `POINTS` scoring — the one gap the issue names by example, not a general
 * "does this race have enough data" engine. `BEST_TIME` and `TOTAL_TIME`
 * both read recorded heat times, and a `POINTS` race on a `NONE` timer never
 * records one: the hand-entry modal shows a place column only (#490), so
 * every lane's time is permanently absent. `TIMED` races always type a time
 * by hand even with no timer, so this is specifically the `POINTS` + `NONE`
 * combination, nothing broader. */
export function tiebreakerWontFire(
  value: string,
  scoringStrategy: string,
  trackTimerType: string | null | undefined,
): boolean {
  const option = TIEBREAKER_OPTIONS.find((o) => o.value === value);
  return Boolean(option?.needsTime) && scoringStrategy === 'POINTS' && trackTimerType === 'NONE';
}
