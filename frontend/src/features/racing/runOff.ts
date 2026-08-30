/**
 * Saying a run-off heat out loud (#550).
 *
 * `Heat.runOffPlacement` / `RunOffHeat.placement` cross the GraphQL boundary
 * as a plain `Int | null` — the standings rank the heat is racing off to
 * decide, or `null` when it isn't (an ordinary heat), or no longer is (the
 * tie it was created for has since moved — see `services.scoring.
 * run_off_contested_rank`'s docstring for why). This is the one place that
 * turns the number into the sentence the audience display shows while it
 * races, the same "words live in one pure module" split `tiebreakText.ts`
 * and `awardText.ts` already use.
 */

import { ordinal } from '../awards/awardText';

/**
 * "Racing off for 2nd place" — or `null` when there is nothing to announce.
 *
 * `null` covers three cases the caller does not need to tell apart: the
 * heat is not a run-off, it is one but has not been matched to a live tie,
 * or the tie it was created for has since been settled or dissolved. All
 * three mean the same thing to a screen deciding whether to show a banner —
 * say nothing rather than guess.
 */
export function runOffAnnouncement(placement: number | null | undefined): string | null {
  if (placement == null) return null;
  return `Racing off for ${ordinal(placement)} place`;
}
