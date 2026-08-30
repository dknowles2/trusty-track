/**
 * Telling the operator when "drop the worst run" is on but did not fire
 * (#547 stage 3).
 *
 * `Race.dropWorstRuns` is a modifier over the scoring strategy, not a
 * strategy of its own (`backend.domain.scoring`'s module docstring). It only
 * drops anything when every racer who has raced has the *same* number of
 * counted results and it is at least `dropWorstRuns + 1` —
 * `backend.domain.scoring.drop_worst_status` decides that server-side and
 * rides its answer along on every `LeaderboardEntry` as
 * `dropWorstRunsApplied`, since it is a fact about the whole computation
 * rather than about any one racer. Silently dropping nothing when the
 * setting is on is worse than saying so: an operator who turned the setting
 * on has a reason to, and standings that quietly ignore it look like the
 * setting did not save.
 *
 * Pure, same reasoning `disruptedRounds.ts` gives its own notice: the
 * interesting part is the wording, not the rendering.
 */

/**
 * What to tell the operator, or `null` when there is nothing to say —
 * either the setting is off, or it actually applied.
 */
export function dropWorstNotice(
  dropWorstRuns: number,
  dropWorstRunsApplied: boolean,
): string | null {
  if (dropWorstRuns <= 0 || dropWorstRunsApplied) return null;

  const runWord = dropWorstRuns === 1 ? 'run' : 'runs';
  return (
    `Drop the worst ${dropWorstRuns} ${runWord} is on, but is not applied to these ` +
    `standings: everyone who has raced needs the same number of runs, with at ` +
    `least ${dropWorstRuns + 1} each. Nothing was dropped.`
  );
}
