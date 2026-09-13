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
 *
 * Each description (#1089) says three things, in order: what the method
 * looks at, who wins, and — as a second sentence — when it can't help for
 * the scoring strategy chosen above it on the form. That third part is also
 * `tiebreakerWontFire`'s job: a live note under the option, computed from
 * this race's actual scoring and timer rather than left for the operator to
 * infer from the static text.
 */

import { ordinal } from '../awards/awardText';
import { CUMULATIVE_TIME, FASTEST_TIME, POINTS, TIMED } from './scoringStrategyText';

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
      'Tied cars share the place — two 1sts, then 3rd. Settle it yourself with a Run-off from the standings, or by correcting a time.',
  },
  {
    value: BEST_TIME,
    label: 'Fastest single heat',
    description:
      "The tied car with the single fastest heat wins. Doesn't apply under Fastest single run scoring, where that's already what's being compared.",
    needsTime: true,
  },
  {
    value: TOTAL_TIME,
    label: 'Lowest total time',
    description:
      'The tied car whose heat times add up to less wins. Only helps under Points or Fastest single run — under Timed (average) or Cumulative time, tied cars have the same total.',
    needsTime: true,
  },
  {
    value: COUNTBACK,
    label: 'Countback',
    description:
      'Compares finishing places, not times: most 1st-place heats wins, then most 2nds, and so on. Works with no timer at all.',
  },
  {
    value: HEAD_TO_HEAD,
    label: 'Head-to-head',
    description:
      'Looks only at heats where the tied cars raced each other; whoever won more of those wins. If they never shared a heat, the tie stays shared.',
  },
] as const;

/** `RUN_OFF` on its own, outside `TIEBREAKER_OPTIONS` — it is not a policy
 * an operator picks in Race Settings (`.claude/rules/scoring.md`: "deliberately
 * absent from `ALL_METHODS`"), it is what happened when they held one. Kept
 * out of the picker's own list so `RaceForm`'s five choices are untouched;
 * `methodPhrase` still needs to say something about it, since a row's
 * `resolvedBy` can hold it. */
export const RUN_OFF = 'RUN_OFF';

/** A short phrase for how a row was resolved — `null` for a method this
 * module has never heard of, which is what a `resolvedBy` off a stale build
 * would be. */
export function methodPhrase(method: string): string | null {
  if (method === RUN_OFF) return 'a run-off';
  const option = TIEBREAKER_OPTIONS.find((o) => o.value === method);
  return option && option.value !== SHARED ? option.label.toLowerCase() : null;
}

/** "2nd, on fastest single heat" / "1st, on a run-off" — the standings note
 * for a resolved row (#540 part a, #550's `RUN_OFF` folded in by #1017).
 * `null` when the row was never tied, or the tie is still shared — an
 * unresolved tie keeps the shared rank exactly as it read before this
 * feature existed, so there is nothing to say. */
export function resolutionNote(
  rank: number,
  resolvedBy: string | null | undefined,
): string | null {
  if (!resolvedBy) return null;
  const phrase = methodPhrase(resolvedBy);
  return phrase ? `${ordinal(rank)}, on ${phrase}` : null;
}

/** Why `value` can never settle a tie for this race, or `null` if it might —
 * a table over `(method, scoringStrategy, trackTimerType)`, generalised from
 * the single Points-and-no-timer case the issue first named (#1089). Three
 * independent reasons, checked in order:
 *
 * 1. **Tautological under the scoring strategy it mirrors.** `BEST_TIME`
 *    ("fastest single heat") is exactly what `FASTEST_TIME` scoring already
 *    ranks by, and `TOTAL_TIME` ("lowest total time") is exactly what
 *    `CUMULATIVE_TIME` scoring already ranks by — a tie under either
 *    strategy is already a tie on the value the method would compare, so it
 *    can never separate the tied cars.
 * 2. **`TOTAL_TIME` under `TIMED`.** `TIMED` averages each racer's heat
 *    times over the same heat count for everyone in a tied cluster (a
 *    disrupted round is dropped from standings entirely — see
 *    `.claude/rules/scoring.md` — so a counted racer's heat count always
 *    matches), and dividing every side of a tied average by the same number
 *    cannot un-tie the totals behind it.
 * 3. **No time was ever recorded.** `BEST_TIME` and `TOTAL_TIME` both read
 *    recorded heat times, and a `POINTS` race on a `NONE` timer never
 *    records one — the hand-entry modal shows a place column only (#490),
 *    so every lane's time is permanently absent. The other three scoring
 *    strategies always type a time by hand even with no physical timer, so
 *    this is specifically the `POINTS` + `NONE` combination.
 *
 * `COUNTBACK` reads finishing places, which every scoring strategy produces
 * regardless of a timer, so it is never flagged here. `HEAD_TO_HEAD`'s gap —
 * the tied cars may never have shared a heat under PPC — depends on the
 * heats actually raced, not on the race's settings, so it is a caveat in the
 * option's own text rather than something this function can predict; it is
 * never flagged here either. */
export function tiebreakerWontFire(
  value: string,
  scoringStrategy: string,
  trackTimerType: string | null | undefined,
): string | null {
  const option = TIEBREAKER_OPTIONS.find((o) => o.value === value);
  if (!option) return null;

  if (value === BEST_TIME && scoringStrategy === FASTEST_TIME) {
    return "Fastest single run scoring already ranks cars by their best heat time — this can't break a tie it created.";
  }
  if (value === TOTAL_TIME && scoringStrategy === CUMULATIVE_TIME) {
    return "Cumulative time scoring already ranks cars by their total time — this can't break a tie it created.";
  }
  if (value === TOTAL_TIME && scoringStrategy === TIMED) {
    return "Timed (average) divides every tied car's total by the same heat count, so a tie on the average is a tie on the total too.";
  }
  if (option.needsTime && scoringStrategy === POINTS && trackTimerType === 'NONE') {
    return 'Points scoring on a track with no timer never records a time to compare.';
  }
  return null;
}
