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
import { CUMULATIVE_TIME, FASTEST_TIME, POINTS } from './scoringStrategyText';

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
      "The tied car whose heat times add up to less wins. Under Timed (average) it only helps when the tied cars ran a different number of heats; under Cumulative time it's the score itself unless worst runs are dropped.",
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
 * a table over `(method, scoringStrategy, trackTimerType, dropWorstRuns)`,
 * generalised from the single Points-and-no-timer case the issue first named
 * (#1089). A review of the first version of this table found two of its four
 * cases overclaimed a tautology the backend's own rules do not support —
 * both corrected below, and pinned by counterexample in
 * `tiebreakText.test.ts` so neither regresses:
 *
 * 1. **`BEST_TIME` under `FASTEST_TIME` is genuinely tautological, with or
 *    without a drop.** `FASTEST_TIME` scoring already ranks by each racer's
 *    single best heat time, which is exactly what `BEST_TIME` compares — a
 *    tie under it is already a tie on that value. `drop_worst_runs` removes
 *    each racer's *highest*-valued counted results before aggregating
 *    (`backend/domain/scoring.py`'s module docstring), which can never
 *    remove a *minimum* — so this holds regardless of the drop setting.
 * 2. **`TOTAL_TIME` under `TIMED` is *not* tautological, and is never
 *    flagged.** `TIMED` is scale-free, so unlike the two summing strategies
 *    a round a lane outage or a latecomer disrupted is *kept* rather than
 *    dropped from standings (`domain.scoring.counts_a_disrupted_round`,
 *    `.claude/rules/scoring.md`'s #171/#172 entries) — so two tied racers
 *    can have run a different number of counted heats and still average the
 *    same. `TOTAL_TIME` sums the raw recorded times regardless
 *    (`domain.tiebreak._by_total_time`), and a different heat count behind
 *    an equal average sums to a different total: `[4, 6]` and
 *    `[5, 5, 5]` both average 5.0 but total 10 and 15. `TIMED` never drops a
 *    disrupted round in the first place, so `dropWorstRuns` does not change
 *    this conclusion either — it stays unconditionally `null`.
 * 3. **`TOTAL_TIME` under `CUMULATIVE_TIME` is tautological only when
 *    nothing is being dropped.** `CUMULATIVE_TIME` sums every *counted*
 *    time, but `drop_worst_runs > 0` drops each racer's highest values
 *    first (once every ranked racer has enough to drop evenly —
 *    `domain.scoring.drop_worst_status`); `TOTAL_TIME` sums the *raw*,
 *    undropped list regardless. Two racers can reach an identical
 *    post-drop `CUMULATIVE_TIME` score from different raw sums —
 *    `[2, 3, 100]` and `[1, 4, 50]` both score 5.0 once the highest is
 *    dropped, but total 105 and 55 — so `TOTAL_TIME` can still separate
 *    them. Flagged only when `dropWorstRuns === 0`, where nothing is
 *    dropped and the two totals are the same total by construction.
 * 4. **No time was ever recorded.** `BEST_TIME` and `TOTAL_TIME` both read
 *    recorded heat times, and a `POINTS` race on a `NONE` timer never
 *    records one — the hand-entry modal shows a place column only (#490),
 *    so every lane's time is permanently absent. The other three scoring
 *    strategies always type a time by hand even with no physical timer, so
 *    this is specifically the `POINTS` + `NONE` combination, and dropping
 *    runs changes nothing about whether a time was recorded in the first
 *    place.
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
  dropWorstRuns = 0,
): string | null {
  const option = TIEBREAKER_OPTIONS.find((o) => o.value === value);
  if (!option) return null;

  if (value === BEST_TIME && scoringStrategy === FASTEST_TIME) {
    return "Fastest single run scoring already ranks cars by their best heat time — this can't break a tie it created.";
  }
  if (value === TOTAL_TIME && scoringStrategy === CUMULATIVE_TIME && dropWorstRuns === 0) {
    return "Cumulative time scoring already adds up the same heats this does — this can't break a tie it created.";
  }
  if (option.needsTime && scoringStrategy === POINTS && trackTimerType === 'NONE') {
    return 'Points scoring on a track with no timer never records a time to compare.';
  }
  return null;
}
