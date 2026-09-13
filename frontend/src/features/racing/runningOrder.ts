/**
 * Where a heat sits in the race-wide running order (#549).
 *
 * The frontend mirror of `backend/domain/running_order.execution_sort_key`,
 * which the `currentlyRacing` / `onDeck` subscriptions read through — the
 * operator's Race tab and the audience displays must agree about which heat
 * is next, so the rule is stated once on each side and each side's copy is
 * pinned by its own tests.
 *
 * With `masterRunningOrder` off (the default, and every race that predates
 * the flag), the order is `(roundNumber, heatNumber)`: one round's block,
 * then the next round's — exactly what the Race tab always did.
 *
 * With it on, a general round's heats follow `heatNumber` alone, because
 * that is where `applyMasterRunningOrder` wrote the interleave — globally
 * unique numbers, one sequence across rounds. `roundNumber` stays as a
 * tiebreak only, for heats the interleave has not renumbered yet (a round
 * regenerated after the last apply counts 1..N again): colliding numbers
 * then zip deterministically rather than jumping around, until the operator
 * re-applies.
 *
 * A championship round is exempt and runs *after* every general round, in
 * its own `(roundNumber, heatNumber)` block. Its field is drawn from the
 * general rounds' standings, so it cannot meaningfully run earlier — and the
 * advancement cascade renumbers a championship round's heats 1..N on every
 * rebuild, so a master number written onto one could not survive anyway.
 */
import type { Lane } from './types';
import { hasRun } from './lanes';

export interface OrderedHeat {
  roundId: number;
  roundNumber: number;
  heatNumber: number;
}

/**
 * Whether the race has not got to this heat yet — the client mirror of
 * `_unfinished` in `backend/api/schema.py` (~L105), which the `onDeck` and
 * `currentlyRacing` subscriptions filter through before slicing. "Not got to
 * yet" is `!lanes.is_finished(...)` there; `!hasRun(heat.lanes)` here is the
 * identical rule — a skipped heat counts as done (#1001) on both sides, since
 * `hasRun` (`features/racing/lanes.ts`) already mirrors `is_finished`
 * exactly (see that file's own docstring).
 *
 * Exists so `nextExecutionHeat` in `RaceControl.tsx` can ask "the first heat
 * after this one that is unfinished" rather than "the next one positionally"
 * (#1084) — re-running an earlier heat must not put an already-completed
 * later heat On Deck.
 */
export function isUnfinished(heat: { readonly lanes: readonly Lane[] }): boolean {
  return !hasRun(heat.lanes);
}

function executionSortKey(
  heat: OrderedHeat,
  masterRunningOrder: boolean,
  championshipRoundIds: ReadonlySet<number>,
): [number, number, number] {
  const championship = championshipRoundIds.has(heat.roundId);
  if (masterRunningOrder && !championship) {
    return [0, heat.heatNumber, heat.roundNumber];
  }
  return [masterRunningOrder ? 1 : 0, heat.roundNumber, heat.heatNumber];
}

/** A comparator for `Array.prototype.sort`, ascending running order. */
export function executionComparator(
  masterRunningOrder: boolean,
  championshipRoundIds: ReadonlySet<number>,
): (a: OrderedHeat, b: OrderedHeat) => number {
  return (a, b) => {
    const ka = executionSortKey(a, masterRunningOrder, championshipRoundIds);
    const kb = executionSortKey(b, masterRunningOrder, championshipRoundIds);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  };
}
