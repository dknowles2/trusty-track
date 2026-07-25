/**
 * Predicates over a heat's lanes.
 *
 * These questions — has this heat run? was it skipped? — were asked in eight
 * places across the race-control screens, each with its own inline copy of the
 * test, and they had drifted: some counted a skipped heat as run and some did
 * not. Naming them makes the difference deliberate rather than accidental.
 *
 * Reads only. Mutations still take the `laneResults` JSON string, so the
 * screens that write a heat still build that blob — see #5, step 5.
 */
import type { Lane } from './types';

/** A lane with a recorded time. */
export const hasTime = (lane: Lane): boolean => lane.time !== null;

/** Any time recorded in this heat. */
export const hasTimes = (lanes: readonly Lane[]): boolean => lanes.some(hasTime);

/**
 * The heat is done with — raced, or passed over.
 *
 * The operator can skip a heat (everyone in it scratched, say), and for
 * "what's next" purposes that is as finished as one that ran. Note the backend
 * disagrees: `lanes.has_results` ignores `skipped`, so a skipped round can
 * still be regenerated.
 */
export const hasRun = (lanes: readonly Lane[]): boolean =>
  lanes.some((lane) => lane.time !== null || lane.skipped);

/** Passed over rather than raced — skipped, and nothing was timed. */
export const wasSkipped = (lanes: readonly Lane[]): boolean =>
  lanes.some((lane) => lane.skipped) && !hasTimes(lanes);

/** Lanes in finishing order, unplaced last. */
export const byPlace = (lanes: readonly Lane[]): Lane[] =>
  [...lanes].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));

/**
 * The racer in this lane, if it holds one.
 *
 * `null` covers both an empty lane and a championship slot whose racer has not
 * been decided yet — `placeholderSlot` tells those apart when it matters.
 */
export const racerIdIn = (lane: Lane): number | null => lane.racerId;
