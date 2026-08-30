import { describe, it, expect } from 'vitest';
import { executionComparator, type OrderedHeat } from './runningOrder';

/**
 * The frontend copy of `backend/domain/running_order.execution_sort_key`.
 * The fixtures here mirror the backend's `test_domain_running_order.py`
 * execution-key cases, so a change to the rule on either side fails a test
 * on that side — the two copies cannot drift apart silently.
 */

const heat = (roundId: number, roundNumber: number, heatNumber: number): OrderedHeat => ({
  roundId,
  roundNumber,
  heatNumber,
});

// Two general rounds whose pending heats carry interleaved (globally unique)
// numbers 5–7, one championship round numbered 1..2 by its own generator, and
// two recorded heats keeping the per-round numbers they were announced under.
const heats: OrderedHeat[] = [
  heat(1, 1, 1), // round 1, recorded before the interleave
  heat(2, 2, 1), // round 2, recorded before the interleave
  heat(1, 1, 5), // interleaved pending heats: 5, 6, 7 across rounds 1 and 2
  heat(2, 2, 6),
  heat(1, 1, 7),
  heat(3, 3, 1), // the final
  heat(3, 3, 2),
];
const championshipRoundIds = new Set([3]);

describe('executionComparator', () => {
  it('orders by (roundNumber, heatNumber) when the master order is off', () => {
    const sorted = [...heats].sort(executionComparator(false, championshipRoundIds));
    expect(sorted).toEqual([
      heat(1, 1, 1),
      heat(1, 1, 5),
      heat(1, 1, 7),
      heat(2, 2, 1),
      heat(2, 2, 6),
      heat(3, 3, 1),
      heat(3, 3, 2),
    ]);
  });

  it('follows heatNumber across general rounds when the master order is on', () => {
    const sorted = [...heats].sort(executionComparator(true, championshipRoundIds));
    expect(sorted.filter((h) => !championshipRoundIds.has(h.roundId))).toEqual([
      heat(1, 1, 1),
      heat(2, 2, 1),
      heat(1, 1, 5),
      heat(2, 2, 6),
      heat(1, 1, 7),
    ]);
  });

  it('runs championship rounds after every general round, whatever numbers they hold', () => {
    // The advancement cascade renumbers a championship round's heats 1..N on
    // every rebuild, so their low numbers must not put the final first.
    const sorted = [...heats].sort(executionComparator(true, championshipRoundIds));
    expect(sorted.slice(-2)).toEqual([heat(3, 3, 1), heat(3, 3, 2)]);
  });

  it('zips colliding numbers deterministically by roundNumber', () => {
    // A round regenerated after the last apply counts 1..N again; until the
    // operator re-applies, its numbers collide with other rounds' and the
    // tiebreak keeps the order stable rather than arbitrary.
    const colliding = [heat(2, 2, 1), heat(1, 1, 1), heat(2, 2, 2), heat(1, 1, 2)];
    const sorted = [...colliding].sort(executionComparator(true, new Set()));
    expect(sorted).toEqual([heat(1, 1, 1), heat(2, 2, 1), heat(1, 1, 2), heat(2, 2, 2)]);
  });
});
