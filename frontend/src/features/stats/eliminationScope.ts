/**
 * When the Standings selector should default away from "Overall" (#1020).
 *
 * `services/scoring._scoring_heats` drops `ELIMINATION` rounds from the
 * ordinary preliminary aggregate by design (`.claude/rules/scheduling.md`:
 * "Elimination heats never feed the aggregate standings") — survival is a
 * different question than a `TIMED` average or a `POINTS` sum, and mixing
 * the two would be wrong in either direction. That is correct and
 * deliberate. What it leaves is a race whose *only* round is an elimination
 * one: "Overall (qualifying rounds)" can never hold anything for it, however
 * completely the race has been raced, because there is no qualifying round
 * to aggregate. `Leaderboard.tsx` reads this to pick a better default than
 * an aggregate that is empty by construction.
 *
 * Pure, in the tradition of `disruptedRounds.ts` and `slowestFirst.ts`: the
 * interesting part is which round to land on, not the rendering.
 */

import type { RoundSummary } from './disruptedRounds';

/**
 * True when the race has no PPC/BALANCED *general* round — every round is
 * either a championship round (drawing its field from another round's
 * standings, whatever its own scheduling strategy) or scheduled as
 * `ELIMINATION` — and at least one of those is an elimination round. A race
 * like this can be raced to a winner while "Overall" stays empty forever.
 */
export function isEliminationOnlyRace(rounds: readonly RoundSummary[]): boolean {
  return (
    rounds.length > 0 &&
    rounds.every((r) => Boolean(r.advancementSource) || r.schedulingStrategy === 'ELIMINATION') &&
    rounds.some((r) => r.schedulingStrategy === 'ELIMINATION')
  );
}

/**
 * The elimination round the selector should default to: the last one run.
 * A chain of elimination rounds (a semifinal, then a final) ends at the one
 * that actually holds the winner, which is the round worth landing on
 * without a click.
 */
export function defaultEliminationRound(
  rounds: readonly RoundSummary[],
): RoundSummary | null {
  const eliminationRounds = rounds.filter((r) => r.schedulingStrategy === 'ELIMINATION');
  if (eliminationRounds.length === 0) return null;
  return eliminationRounds.reduce((latest, r) => (r.roundNumber > latest.roundNumber ? r : latest));
}
