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

/**
 * Lanes a track can actually use right now — every lane it has, less any
 * marked out of service (#171) — issue #766. Mirrors
 * `crud.usable_lanes_for_race`'s bound, which `create_run_off_heat` refuses
 * past: comparing against a track's raw `laneCount` instead is the mistake
 * #303 already found and fixed at three other call sites.
 *
 * `laneOutages` may still name a lane past the track's *current*
 * `laneCount` — a stale row from before the track was reconfigured smaller,
 * only pruned the next time the lane-outage form is saved — so an outage
 * outside `1..laneCount` does not count against the total, the same floor
 * the backend's own range-based computation (`range(1, lane_count + 1)`)
 * gets for free.
 */
export function usableLaneCount(laneCount: number, laneOutages: readonly number[]): number {
  const outOfService = laneOutages.filter((lane) => lane >= 1 && lane <= laneCount).length;
  return laneCount - outOfService;
}

/**
 * Why `RunOffControl`'s "Start run-off" button should be disabled for this
 * tied cluster, or `null` when there is room — issue #766.
 *
 * `usableLanes` of `null` means "not known" (no track configured for this
 * race, or a caller that has not supplied one) rather than "no lanes at
 * all" — nothing is disabled on account of a fact this cannot see, the same
 * way `RunOffControl`'s own `trackId` already treats `null` as "no track"
 * rather than as a lane count of zero. The server's own refusal
 * ("More tied racers than usable lanes.") stays the backstop for that case.
 */
export function tooManyForRunOff(racerCount: number, usableLanes: number | null): string | null {
  if (usableLanes == null || racerCount <= usableLanes) return null;
  return `Not enough usable lanes for all ${racerCount} tied racers (only ${usableLanes} available).`;
}
