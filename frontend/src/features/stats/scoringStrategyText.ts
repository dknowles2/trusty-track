/**
 * Saying a scoring strategy out loud (#547 stage 3).
 *
 * `Race.scoringStrategy` crosses the GraphQL boundary as a plain string —
 * `backend.domain.scoring`'s module docstring is explicit that the four
 * members are a `str` enum whose values equal their names — which is exactly
 * the wrong thing to put in front of an operator choosing a setting or
 * reading a standings label. This is the one place the four strategies get
 * put into words, the same reasoning `tiebreakText.ts` gives for its own
 * vocabulary, and for the same reason: the `RaceForm` picker and every
 * standings/results screen have to describe a strategy the same way.
 *
 * `ALL_STRATEGIES` in `backend/domain/scoring.py` states the order `RaceForm`
 * offers these in — `SCORING_STRATEGY_OPTIONS` below is that order, the same
 * way `TIEBREAKER_OPTIONS` mirrors `domain.tiebreak.ALL_METHODS`.
 */

import { isTimeBasedStrategy } from '../racing/lanes';

export const TIMED = 'TIMED';
export const POINTS = 'POINTS';
export const CUMULATIVE_TIME = 'CUMULATIVE_TIME';
export const FASTEST_TIME = 'FASTEST_TIME';

export interface ScoringStrategyOption {
  value: string;
  label: string;
  /** The one-line description `RaceForm` shows under this option, always —
   * never only under whichever is currently selected (#304), the same rule
   * `TIEBREAKER_OPTIONS` follows. */
  description: string;
}

/** Every scoring strategy, in `backend.domain.scoring.ALL_STRATEGIES`'
 * order — also the order `RaceForm` offers them in. */
export const SCORING_STRATEGY_OPTIONS: readonly ScoringStrategyOption[] = [
  {
    value: TIMED,
    label: 'Timed (average)',
    description:
      "Each heat time is averaged. A single bad run costs a little, not everything.",
  },
  {
    value: POINTS,
    label: 'Points (by finish)',
    description:
      '1st place scores 1 point, 2nd scores 2, and so on — heat times never enter it.',
  },
  {
    value: CUMULATIVE_TIME,
    label: 'Cumulative time (total)',
    description:
      "Each heat time is added up rather than averaged. Fair only while every racer runs the same number of heats — a disrupted round is left out of standings automatically, the same as it is under Points.",
  },
  {
    value: FASTEST_TIME,
    label: 'Fastest single run',
    description:
      "Only each racer's single best heat time counts. A bad run is never the one that's used, so it isn't penalised.",
  },
] as const;

/**
 * A short, human name for a scoring strategy — "Timed (average)", "Points
 * (by finish)" — for a settings summary that used to show the raw enum
 * value directly. Falls back to the raw string for a value this module does
 * not recognise, the same "print something rather than throw" rule
 * `themeByKey` follows for an unrecognised theme key.
 */
export function strategyLabel(scoringStrategy: string | null | undefined): string {
  return (
    SCORING_STRATEGY_OPTIONS.find((option) => option.value === scoringStrategy)?.label ??
    scoringStrategy ??
    '-'
  );
}

/**
 * A short label for the score column — "Avg Time", "Total Time", "Best
 * Time", "Points" — used by the Standings page and the audience display.
 * `isTimeBasedStrategy` is the one predicate for "is this a time or a
 * placement" (see its own docstring on why that is stated once rather than
 * spelled out per site); the three time-based strategies still need their
 * own word here, since "average", "total" and "best" mean different things
 * to an operator even though they format the same way.
 */
export function scoreLabel(scoringStrategy: string | null | undefined): string {
  switch (scoringStrategy) {
    case CUMULATIVE_TIME:
      return 'Total Time';
    case FASTEST_TIME:
      return 'Best Time';
    case POINTS:
      return 'Points';
    default:
      return 'Avg Time';
  }
}

/**
 * `backend/domain/scoring.py`'s `DNF_PENALTY_SECONDS` — a DNF (a recorded
 * time of zero or less) is scored as a bad-but-finite result under `TIMED`
 * and `CUMULATIVE_TIME` rather than erasing the racer's average outright.
 * A racer whose *only* counted heat was a DNF therefore has an average of
 * exactly this value, and printing "9.999s" with nothing marking it as the
 * penalty sentinel reads as an unusually slow car rather than a scratch
 * (#763). Mirrored here, rather than sent across the wire, for the same
 * reason `DEFAULT_SCALE` and the other small numeric constants this app
 * shares between the two languages are: it is a fact about the domain rule,
 * not something a race configures.
 */
export const DNF_PENALTY_SECONDS = 9.999;

/** The score value, formatted for the strategy that produced it — seconds to
 * three places for a time-based strategy, a bare integer for Points.
 *
 * The one place this rule is stated (#763) — every screen that shows a
 * standings score (the operator's own Standings page, the audience Standings
 * tab, the projector view) calls this rather than keeping its own copy, so
 * "3.414s" cannot read as "3.4141s" on one wall and "3.414s" on another.
 *
 * `unit: false` drops the trailing "s" for a caller that already labels the
 * unit separately — the projector view prints "Avg Time"/"Points" as its own
 * line under the number, where a second "s" would be redundant. Defaults to
 * `true`, which is every other caller's shape: the number stands alone in its
 * own column with nothing else saying what it is.
 *
 * A score exactly equal to `DNF_PENALTY_SECONDS` — reachable when a racer's
 * one and only counted heat was a DNF — prints "DNF" instead of "9.999s",
 * the same labelling `features/racing/lanes.ts`'s `formatLaneTime` applies
 * to a raw per-lane time of zero or less. A multi-heat average landing on
 * that exact value by genuine coincidence is not a real floating-point
 * concern.
 */
export function formatScore(
  score: number,
  scoringStrategy: string | null | undefined,
  { unit = true }: { unit?: boolean } = {},
): string {
  if (!isTimeBasedStrategy(scoringStrategy)) {
    return score.toString();
  }
  if (score === DNF_PENALTY_SECONDS) {
    return 'DNF';
  }
  const formatted = score.toFixed(3);
  return unit ? `${formatted}s` : formatted;
}
