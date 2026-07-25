/**
 * Predicates over a heat's lanes.
 *
 * These questions — has this heat run? was it skipped? — were asked in eight
 * places across the race-control screens, each with its own inline copy of the
 * test, and they had drifted: some counted a skipped heat as run and some did
 * not. Naming them makes the difference deliberate rather than accidental.
 *
 * Also the conversion to `HeatLaneInput` for the write path, which is a
 * near-identity — the read and write shapes match on purpose.
 */
import type { Lane, LaneInput } from './types';

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

/**
 * A lane as the mutation takes it.
 *
 * Field-for-field the same as {@link Lane}, but spelt out rather than spread:
 * the cache attaches `__typename` to what it hands back, and GraphQL rejects an
 * input object carrying a field the type does not declare.
 */
export const toInput = (lane: Lane): LaneInput => ({
  lane: lane.lane,
  racerId: lane.racerId,
  placeholderSlot: lane.placeholderSlot,
  time: lane.time,
  place: lane.place,
  skipped: lane.skipped,
});

/** The same lanes with any result removed — what re-running a heat sends. */
export const cleared = (lanes: readonly Lane[]): LaneInput[] =>
  lanes.map((lane) => ({ ...toInput(lane), time: null, place: null, skipped: false }));
