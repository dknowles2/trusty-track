/**
 * Explaining a round that was disrupted by a lane going out of service (#171).
 *
 * Pure, because the interesting part is the wording rather than the rendering,
 * and because getting it wrong is worse than saying nothing: an operator whose
 * only prelim round was disrupted sees empty standings, and "complete some
 * heats to see standings" is a lie when they have completed all of them.
 */

export interface RoundSummary {
  id: number;
  name?: string | null;
  roundNumber: number;
  advancementSource?: string | null;
  advancementFromBottom?: boolean | null;
  disrupted?: boolean | null;
}

/** A round's display name, falling back to its number. */
export function roundLabel(round: RoundSummary): string {
  return round.name?.trim() || `Round ${round.roundNumber}`;
}

/**
 * Rounds that a lane outage stopped counting toward the standings.
 *
 * Only under `POINTS`, and only preliminary rounds — a championship round is
 * never in the standings anyway (#17), so calling it excluded would be telling
 * the operator about a consequence that does not exist.
 */
export function excludedRounds(
  rounds: RoundSummary[],
  scoringStrategy: string,
): RoundSummary[] {
  if (scoringStrategy !== 'POINTS') return [];
  return rounds.filter((r) => r.disrupted && !r.advancementSource);
}

/**
 * What to tell the operator, or null when there is nothing to say.
 *
 * Names the rounds, because "a round was excluded" invites the question this
 * should already have answered.
 */
export function exclusionNotice(
  rounds: RoundSummary[],
  scoringStrategy: string,
): string | null {
  const excluded = excludedRounds(rounds, scoringStrategy);
  if (excluded.length === 0) return null;

  const names = excluded.map(roundLabel).join(', ');
  const subject = excluded.length === 1 ? 'is' : 'are';
  return (
    `${names} ${subject} not counted in these standings: a lane went out of ` +
    `service part-way through, so some racers ran fewer heats than others. ` +
    `This race is scored on points, which add up, so counting it would put ` +
    `those racers ahead for heats they never ran.`
  );
}
